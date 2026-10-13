import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAppConfig } from "@aijob/config";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reserveUserAiUsage } from "./ai/user-ai-budget.js";
import { saveUserAiSettings } from "./ai/user-ai-service.js";
import { restoreDeviceSession } from "./identity/device-binding.js";
import { createAnonymousSession } from "./identity/session-repository.js";
import { saveOpportunitySettings } from "./opportunities/local-settings.js";
import {
  saveUserDiscoverySettings,
  userDiscoverySettings,
} from "./opportunities/user-discovery-settings.js";
import { queueUserDiscoveryTest } from "./opportunities/user-discovery-worker.js";
import { saveSearch } from "./planner/service.js";
import { requestOwnerDeletion } from "./profile/deletion-service.js";
import { runOwnerRetentionMaintenance } from "./profile/retention-service.js";
import {
  getTenantOnboarding,
  queueTenantOnboarding,
  runTenantOnboardingCycle,
} from "./sources/tenant-onboarding-queue.js";
import { runOneOwnerTask } from "./workers/owner-task-worker.js";
import { createCatalogRepository } from "./catalog/repository.js";
import { JobSearchQuerySchema } from "@aijob/contracts";
import { createApplicationCase } from "./applications/service.js";
import { provisionBenchmarkJob } from "./performance/fixtures.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("local productization persistence", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  const config = parseAppConfig({
    APP_ENV: "test",
    DATABASE_URL: url ?? "postgresql://unused",
    RESUME_ENCRYPTION_KEY: "c".repeat(64),
    LOG_LEVEL: "silent",
  });
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  it("prepares a public job as web without gaining permission to change public facts", async () => {
    const fixture = await provisionBenchmarkJob(db, `runtime-${randomUUID()}`),
      owner = (await createAnonymousSession({ db })).context;
    await db.connection().execute(async (connection) => {
      await sql`SET ROLE aijob_web_api`.execute(connection);
      try {
        const result = await createApplicationCase({
          db: connection,
          owner,
          enableLocalMvp: true,
          idempotencyKey: randomUUID(),
          request: {
            jobContext: {
              kind: "public",
              publishedJobId: fixture.publishedJobId,
              publishedJobVersionId: fixture.publishedJobVersionId,
            },
          },
        });
        expect(result.created).toBe(true);
        const grants = await sql<{
          writable: boolean;
        }>`SELECT has_table_privilege(current_user,'catalog.published_jobs','UPDATE') AS writable`.execute(
          connection,
        );
        expect(grants.rows[0]?.writable).toBe(false);
      } finally {
        await sql`RESET ROLE`.execute(connection);
      }
    });
  });
  it("reads local jobs with the web role without granting catalogue writes", async () => {
    await db.connection().execute(async (connection) => {
      await sql`SET ROLE aijob_web_api`.execute(connection);
      try {
        const catalog = createCatalogRepository({ db: connection, enableLocalMvp: true });
        const result = await catalog.search(JobSearchQuerySchema.parse({ keyword: randomUUID() }));
        expect(result.items).toEqual([]);
        const grants = await sql<{
          writable: boolean;
        }>`SELECT has_table_privilege(current_user,'catalog.published_job_versions','INSERT') AS writable`.execute(
          connection,
        );
        expect(grants.rows[0]?.writable).toBe(false);
      } finally {
        await sql`RESET ROLE`.execute(connection);
      }
    });
  });
  it("restores expired cookies to the same owner and refuses revoked/deleting owners", async () => {
    const first = await restoreDeviceSession(db, {});
    expect(first.reuse).toBe(false);
    if (first.reuse) throw Error("expected session");
    if (!("credential" in first)) throw Error("device credential missing");
    const credential = first.credential!;
    expect(
      await restoreDeviceSession(db, { credential, sessionToken: first.session.sessionToken }),
    ).toEqual({ reuse: true });
    await sql`UPDATE identity.owner_sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=${first.session.context.sessionId}::uuid`.execute(
      db,
    );
    const restored = await restoreDeviceSession(db, {
      credential,
      sessionToken: first.session.sessionToken,
    });
    if (restored.reuse) throw Error("expected fresh cookie");
    expect(restored.session.context.ownerId).toBe(first.session.context.ownerId);
    await saveUserDiscoverySettings(db, restored.session.context, config, {
      expectedRevision: 0,
      mode: "tavily",
      apiKey: "fixture",
    });
    await db.connection().execute(async (connection) => {
      await sql`SET ROLE aijob_web_api`.execute(connection);
      try {
        await requestOwnerDeletion({ db: connection, owner: restored.session.context });
      } finally {
        await sql`RESET ROLE`.execute(connection);
      }
    });
    await expect(restoreDeviceSession(db, { credential })).rejects.toThrow();
    await db.connection().execute(async (connection) => {
      await sql`SET ROLE aijob_match_worker`.execute(connection);
      try {
        await runOneOwnerTask({
          db: connection,
          config,
          taskTypes: ["owner_deletion"],
          ownerIds: [first.session.context.ownerId],
        });
      } finally {
        await sql`RESET ROLE`.execute(connection);
      }
    });
    expect(
      (
        await sql`SELECT 1 FROM identity.device_bindings WHERE owner_id=${first.session.context.ownerId}`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await sql`SELECT 1 FROM profile.discovery_settings WHERE owner_id=${first.session.context.ownerId}`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("runs retention maintenance with the match role while collector cannot access private audits", async () => {
    await db.connection().execute(async (connection) => {
      await sql`SET ROLE aijob_match_worker`.execute(connection);
      try {
        await runOwnerRetentionMaintenance({ db: connection });
      } finally {
        await sql`RESET ROLE`.execute(connection);
      }
      const access = await sql<{
        allowed: boolean;
      }>`SELECT has_schema_privilege('aijob_collector_worker','decision_feedback_audit','USAGE') AS allowed`.execute(
        connection,
      );
      expect(access.rows[0]?.allowed).toBe(false);
    });
  });
  it("reserves one shared AI allowance across concurrent requests", async () => {
    const owner = (await createAnonymousSession({ db })).context;
    const saved = await saveUserAiSettings(db, owner, config, {
      expectedRevision: 0,
      apiKey: "fixture",
      baseUrl: "https://fixture.example/v1",
      model: "fixture",
      dailyCalls: 1,
    });
    const outcomes = await Promise.allSettled(
      [1, 2, 3].map(() =>
        db.transaction().execute((tx) =>
          reserveUserAiUsage(tx, {
            owner,
            connectionId: saved.settings!.connectionId,
            revision: 1,
            tokens: 100,
            id: randomUUID(),
            purpose: "source_discovery",
          }),
        ),
      ),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("cuts over the old search only after the explicitly adopted connection succeeds", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aijob-discovery-cutover-"));
    try {
      const local = parseAppConfig(
        {
          APP_ENV: "local",
          DATABASE_URL: url!,
          RESUME_ENCRYPTION_KEY: "c".repeat(64),
          LOG_LEVEL: "silent",
        },
        { rootDirectory: directory },
      );
      saveOpportunitySettings(local, { enabled: true, apiKey: "fixture-tavily-" + randomUUID() });
      const owner = (await createAnonymousSession({ db })).context;
      const saved = await saveSearch({
        db,
        owner,
        idempotencyKey: randomUUID(),
        request: {
          label: "产品实习",
          scope: { cities: [], recruitmentTypes: [], educationLevels: [] },
          catalogQuery: { keyword: "产品实习-" + randomUUID(), cities: ["上海"] },
          subscription: {
            discoveryEnabled: true,
            digestEnabled: false,
            digestTime: "09:00",
            timezone: "Asia/Shanghai",
          },
        },
      });
      await saveUserDiscoverySettings(db, owner, local, {
        expectedRevision: 0,
        mode: "tavily",
        useLegacyKey: true,
      });
      const demand = async () =>
        Number(
          (
            await sql<{
              count: string;
            }>`SELECT count(*) FROM source_control.legacy_discovery_demand d JOIN application.saved_searches s ON s.discovery_query_hash=d.discovery_query_hash WHERE s.owner_id=${owner.ownerId}`.execute(
              db,
            )
          ).rows[0]?.count,
        );
      expect(await demand()).toBeGreaterThan(0);
      await queueUserDiscoveryTest(db, owner, 1, randomUUID());
      // Separate queue readiness from the host/PG clocks in this fixture.
      await sql`UPDATE task_queue.tasks SET available_at=now()-interval '1 minute' WHERE owner_id=${owner.ownerId}::uuid AND task_type='user_source_discovery' AND status='queued'`.execute(
        db,
      );
      await runOneOwnerTask({
        db,
        config: local,
        taskTypes: ["user_source_discovery"],
        ownerIds: [owner.ownerId],
        fetchImpl: async () =>
          Response.json({ results: [{ url: "https://careers.example/jobs", title: "官方入口" }] }),
      });
      expect((await userDiscoverySettings(db, owner, local)).settings?.capability).toBe("ready");
      expect(await demand()).toBe(0);
      expect(saved).toBeDefined();
    } finally {
      if (
        path.dirname(directory) === path.resolve(tmpdir()) &&
        path.basename(directory).startsWith("aijob-discovery-cutover-")
      )
        await rm(directory, { recursive: true });
    }
  });
  it("runs tenant probes only in the collector queue and preserves explicit-empty diagnostics", async () => {
    const queued = await queueTenantOnboarding(db, {
      sourceKey: "fixture-" + randomUUID(),
      companyName: "夹具公司",
      officialUrl: "https://fixture.zhiye.com/intern/jobs",
      officialEvidenceUrl: "https://example.com/careers",
      termsUrl: null,
      termsExcerpt: "夹具政策原句",
      category: "3",
      confirmedPublicScope: true,
    });
    expect(
      await runTenantOnboardingCycle({ db, signal: new AbortController().signal, enabled: false }),
    ).toBe(false);
    await db.connection().execute(async (connection) => {
      await sql`SET ROLE aijob_collector_worker`.execute(connection);
      try {
        await runTenantOnboardingCycle({
          db: connection,
          signal: new AbortController().signal,
          enabled: true,
          probe: async () => ({
            state: "explicit_empty",
            reason: null,
            requestCount: 3,
            reportedTotal: 0,
            parsedCount: 0,
            vendor: "beisen-zhiye",
            portalId: "fixture",
            categories: [],
            preview: [],
            proposal: null,
          }),
        });
      } finally {
        await sql`RESET ROLE`.execute(connection);
      }
    });
    expect(await getTenantOnboarding(db, queued.id)).toMatchObject({
      status: "explicit_empty",
      result: { reportedTotal: 0 },
    });
  });
});
