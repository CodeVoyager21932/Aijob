import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { createAnonymousSession } from "../identity/session-repository.js";
import { provisionBenchmarkJob } from "../performance/fixtures.js";
import { saveSearch, deleteSavedSearch } from "../planner/service.js";
import {
  listOpportunityDigests,
  processOpportunityDigest,
  scheduleOpportunityDigests,
} from "./digests.js";
import { reserveDiscoveryBudget, runDiscoveryCycle } from "./discovery.js";
import { updateSubscription } from "./subscriptions.js";
import { parseAppConfig } from "@aijob/config";
import { buildApp } from "../app.js";
import { SESSION_COOKIE_NAME } from "../identity/fastify.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("opportunity chain in isolated PostgreSQL", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  it("reads discovery activity with web permissions and scopes timing to the signed-in owner", async () => {
    const sessions = await Promise.all([
      createAnonymousSession({ db }),
      createAnonymousSession({ db }),
    ]);
    const savedIds: { id: string; owner: (typeof sessions)[0]["context"] }[] = [];
    for (const [index, session] of sessions.entries()) {
      const saved = await saveSearch({
        db,
        owner: session.context,
        idempotencyKey: randomUUID(),
        request: {
          label: `status-${randomUUID()}`,
          scope: { cities: [], recruitmentTypes: [], educationLevels: [] },
          catalogQuery: { keyword: `status-${randomUUID()}` },
          subscription: {
            discoveryEnabled: true,
            digestEnabled: true,
            digestTime: "09:00",
            timezone: "Asia/Shanghai",
          },
        },
      });
      savedIds.push({ id: saved.id, owner: session.context });
      await sql`UPDATE source_control.discovery_queries SET last_success_at=${index === 0 ? "2026-10-10T00:00:00Z" : "2026-10-11T00:00:00Z"}::timestamptz,last_status='succeeded'
        WHERE query_hash=(SELECT discovery_query_hash FROM application.saved_searches WHERE id=${saved.id}::uuid)`.execute(
        db,
      );
    }
    const config = parseAppConfig({
      APP_ENV: "test",
      LOG_LEVEL: "silent",
      RESUME_ENCRYPTION_KEY: "a".repeat(64),
      OPPORTUNITY_DISCOVERY_ENABLED: "true",
      TAVILY_API_KEY: "fixture-not-used",
    });
    try {
      await db.connection().execute(async (connection) => {
        await sql`SET ROLE aijob_web_api`.execute(connection);
        const app = buildApp({ config, db: connection });
        try {
          const response = await app.inject({
            method: "GET",
            url: "/v1/opportunity-discovery/status",
            headers: { cookie: `${SESSION_COOKIE_NAME}=${sessions[0].sessionToken}` },
          });
          expect(response.statusCode, response.body).toBe(200);
          expect(response.json()).toMatchObject({
            configured: true,
            enabled: true,
            lastSearchAt: "2026-10-10T00:00:00.000Z",
            lastSearchStatus: "succeeded",
            lastDigestAt: null,
            setupUrl: null,
            sourceRefresh: null,
          });
          expect(response.json().nextSearchAt).toBeTruthy();
          expect(response.json().nextDigestAt).toBeTruthy();
        } finally {
          await app.close();
          await sql`RESET ROLE`.execute(connection);
        }
      });
    } finally {
      for (const saved of savedIds)
        await deleteSavedSearch({
          db,
          owner: saved.owner,
          searchId: saved.id,
          idempotencyKey: randomUUID(),
        });
    }
  });
  it("atomically caps parallel attempts and prevents web/match access to collector tasks", async () => {
    const now = new Date("2041-03-02T00:00:00Z");
    await sql`DELETE FROM source_control.discovery_budget_buckets WHERE bucket IN ('tavily:day:2041-03-02','tavily:month:2041-03')`.execute(
      db,
    );
    const allowed = await Promise.all(
      Array.from({ length: 25 }, () => reserveDiscoveryBudget(db, now)),
    );
    expect(allowed.filter(Boolean)).toHaveLength(20);
    const bucket = (
      await sql<{
        used: number;
      }>`SELECT used FROM source_control.discovery_budget_buckets WHERE bucket='tavily:month:2041-03'`.execute(
        db,
      )
    ).rows[0];
    expect(bucket?.used).toBe(20);
    const id = randomUUID();
    await sql`INSERT INTO task_queue.tasks(id,task_type,idempotency_key,status,backoff_policy) VALUES(${id}::uuid,'source_discovery',${id},'queued','{}')`.execute(
      db,
    );
    for (const role of ["aijob_web_api", "aijob_match_worker"] as const)
      await db.transaction().execute(async (tx) => {
        await sql.raw(`SET LOCAL ROLE ${role}`).execute(tx);
        expect(
          (await sql`SELECT id FROM task_queue.tasks WHERE id=${id}::uuid`.execute(tx)).rows,
        ).toHaveLength(0);
      });
    await expect(
      db.transaction().execute(async (tx) => {
        await sql`SET LOCAL ROLE aijob_web_api`.execute(tx);
        await sql`INSERT INTO task_queue.tasks(task_type,idempotency_key,status,backoff_policy) VALUES('source_discovery',${randomUUID()},'queued','{}')`.execute(
          tx,
        );
      }),
    ).rejects.toThrow();
    await sql`DELETE FROM task_queue.tasks WHERE id=${id}::uuid`.execute(db);
  });
  it("shares one search, stores link metadata only, and does not call a result URL", async () => {
    const hash = `fixture-${randomUUID()}`;
    await sql`INSERT INTO source_control.discovery_queries(query_hash,query_text,next_due_at) VALUES(${hash},'数据分析 校招 官网',now()-interval '1 hour')`.execute(
      db,
    );
    const mocked = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: "官方招聘",
                url: `https://${hash}.example.com/jobs`,
                content: "not retained",
              },
            ],
          }),
        ),
    );
    await runDiscoveryCycle({
      db,
      queryHash: hash,
      now: new Date(Date.now() + 60_000),
      config: { enabled: true, apiKey: "fixture" },
      fetchImpl: mocked as typeof fetch,
    });
    await runDiscoveryCycle({
      db,
      queryHash: hash,
      now: new Date(Date.now() + 60_000),
      config: { enabled: true, apiKey: "fixture" },
      fetchImpl: mocked as typeof fetch,
    });
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(mocked.mock.calls[0]?.length).toBe(2);
    const lead = (
      await sql<{
        status: string;
        proposal: unknown;
      }>`SELECT status,proposal FROM source_control.discovery_leads WHERE query_hash=${hash}`.execute(
        db,
      )
    ).rows[0];
    expect(lead).toEqual({ status: "discovered", proposal: null });
    expect(
      (await sql`SELECT id FROM source_control.sources WHERE source_key=${hash}`.execute(db)).rows,
    ).toHaveLength(0);
  });
  it("builds an owner-scoped first digest, replays safely, preserves unknown failure state and deletes through saved search cascade", async () => {
    const { context: owner } = await createAnonymousSession({ db }),
      { context: other } = await createAnonymousSession({ db });
    const label = `digest-${randomUUID()}`;
    const fixture = await provisionBenchmarkJob(db, label, {
      title: label,
      requirements: "在校生，参与数据分析。",
    });
    const saved = await saveSearch({
      db,
      owner,
      idempotencyKey: randomUUID(),
      request: {
        label,
        scope: { cities: [], recruitmentTypes: [], educationLevels: [] },
        catalogQuery: { keyword: label },
        subscription: {
          discoveryEnabled: true,
          digestEnabled: true,
          digestTime: "09:00",
          timezone: "Asia/Shanghai",
        },
      },
    });
    await db.connection().execute(async (connection) => {
      await sql`SET ROLE aijob_match_worker`.execute(connection);
      try {
        await scheduleOpportunityDigests(connection, new Date(Date.now() + 60_000));
      } finally {
        await sql`RESET ROLE`.execute(connection);
      }
    });
    const row = await db
      .selectFrom("task_queue.tasks")
      .selectAll()
      .where("owner_id", "=", owner.ownerId)
      .where("task_type", "=", "opportunity_digest")
      .executeTakeFirstOrThrow();
    const worker = randomUUID();
    await db
      .updateTable("task_queue.tasks")
      .set({
        status: "running",
        lease_owner: worker,
        lease_until: new Date(Date.now() + 60_000),
        fencing_token: 1,
      })
      .where("id", "=", row.id)
      .execute();
    const lease = {
      taskId: row.id,
      taskType: "opportunity_digest",
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      leaseOwner: worker,
      fencingToken: 1,
    };
    const payload = row.payload as { searchId: string; revision: number; localDate: string };
    await db.connection().execute(async (connection) => {
      await sql`SET ROLE aijob_match_worker`.execute(connection);
      try {
        await processOpportunityDigest({ db: connection, lease, ...payload, local: false });
      } finally {
        await sql`RESET ROLE`.execute(connection);
      }
    });
    await processOpportunityDigest({ db, lease, ...payload, local: false });
    let digests = await listOpportunityDigests({ db, owner, local: false });
    expect(digests.items).toHaveLength(1);
    expect(digests.items[0]?.localDate).toBe(payload.localDate);
    expect(digests.items[0]?.items).toMatchObject([
      { jobId: fixture.publishedJobId, kind: "initial" },
    ]);
    expect((await listOpportunityDigests({ db, owner: other, local: false })).items).toEqual([]);
    await db
      .updateTable("source_control.source_runtime_states")
      .set({ freshness_state: "stale", automation_paused: true })
      .where("source_id", "=", fixture.sourceId)
      .execute();
    const nextDate = new Date(`${payload.localDate}T00:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    await processOpportunityDigest({
      db,
      lease,
      ...payload,
      localDate: nextDate.toISOString().slice(0, 10),
      local: false,
    });
    digests = await listOpportunityDigests({ db, owner, local: false });
    expect(digests.items[0]?.partial).toBe(true);
    expect(digests.items[0]?.items.some((i) => i.kind === "closed")).toBe(false);
    await expect(
      updateSubscription({
        db,
        owner: other,
        searchId: saved.id,
        idempotencyKey: randomUUID(),
        request: {
          expectedRevision: saved.revision,
          discoveryEnabled: false,
          digestEnabled: false,
          digestTime: "09:00",
          timezone: "Asia/Shanghai",
        },
      }),
    ).rejects.toMatchObject({ code: "SAVED_SEARCH_NOT_FOUND" });
    await deleteSavedSearch({ db, owner, searchId: saved.id, idempotencyKey: randomUUID() });
    expect((await listOpportunityDigests({ db, owner, local: false })).items).toEqual([]);
    await processOpportunityDigest({ db, lease, ...payload, local: false });
    expect((await listOpportunityDigests({ db, owner, local: false })).items).toEqual([]);
  });
});
