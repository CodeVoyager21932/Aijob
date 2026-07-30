import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import { JobInsightRunSchema } from "@aijob/contracts";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from "../identity/fastify.js";
import { createAnonymousSession, type OwnerContext } from "../identity/session-repository.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const encryptionKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

function config(): AppConfig {
  return {
    appEnv: "test",
    databaseUrl: databaseUrl as string,
    snapshotDirectory: ".data/job-snapshots",
    host: "127.0.0.1",
    port: 3000,
    probeRequestIntervalMs: 750,
    logLevel: "silent",
    enableInternalPreview: true,
    enableSourceProbe: false,
    enableLocalMvp: true,
    resumeEncryptionKey: encryptionKey,
    resumeMaxBytes: 5 * 1024 * 1024,
    ai: { enabled: false, requestTimeoutMs: 30_000 },
    workspaceRoot: ".",
  };
}

function sessionHeaders(session: { sessionToken: string; csrfToken: string }) {
  return {
    host: "127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
    cookie: `${SESSION_COOKIE_NAME}=${session.sessionToken}; ${CSRF_COOKIE_NAME}=${session.csrfToken}`,
    [CSRF_HEADER_NAME]: session.csrfToken,
  };
}

describeWithDatabase("job insight API persistence boundary", () => {
  let app: FastifyInstance;
  let db: Kysely<Database>;
  const ownerContexts: OwnerContext[] = [];
  const organizationId = randomUUID();

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
    app = buildApp({ config: config(), db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const ownerIds = ownerContexts.map(({ ownerId }) => ownerId);
    if (ownerIds.length > 0) {
      await db.deleteFrom("matching.job_insight_runs").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owner_sessions").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owners").where("id", "in", ownerIds).execute();
    }
    await db.deleteFrom("source_control.organizations").where("id", "=", organizationId).execute();
    await db.destroy();
  });

  it("persists an immutable run, replays idempotently and isolates owners", async () => {
    const firstSession = await createAnonymousSession({ db });
    const secondSession = await createAnonymousSession({ db });
    ownerContexts.push(firstSession.context, secondSession.context);
    const idempotencyKey = `insight-${randomUUID()}`;
    const body = {
      scope: {
        jobFamily: "product",
        cities: [`no-such-city-${randomUUID()}`],
        companyScaleBands: [],
      },
      evidenceRevisionId: null,
    };

    const created = await app.inject({
      method: "POST",
      url: "/v1/job-insight-runs",
      headers: { ...sessionHeaders(firstSession), "idempotency-key": idempotencyKey },
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    const run = JobInsightRunSchema.parse(created.json());
    expect(run.result).toMatchObject({
      dataSufficient: false,
      insufficiencyReasons: expect.arrayContaining(["too_few_jobs", "too_few_companies"]),
      sample: { jobCount: 0, companyCount: 0 },
      commonHardRequirements: [],
      frequentCapabilities: [],
      preferredRequirements: [],
    });

    const replayed = await app.inject({
      method: "POST",
      url: "/v1/job-insight-runs",
      headers: { ...sessionHeaders(firstSession), "idempotency-key": idempotencyKey },
      payload: body,
    });
    expect(replayed.statusCode).toBe(201);
    expect(replayed.json().id).toBe(run.id);

    const conflictingReplay = await app.inject({
      method: "POST",
      url: "/v1/job-insight-runs",
      headers: { ...sessionHeaders(firstSession), "idempotency-key": idempotencyKey },
      payload: { ...body, scope: { ...body.scope, jobFamily: "operations" } },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const otherOwnerRead = await app.inject({
      method: "GET",
      url: `/v1/job-insight-runs/${run.id}`,
      headers: sessionHeaders(secondSession),
    });
    expect(otherOwnerRead.statusCode).toBe(404);
    expect(otherOwnerRead.json()).toMatchObject({ code: "INSIGHT_RUN_NOT_FOUND" });

    const ownRead = await app.inject({
      method: "GET",
      url: `/v1/job-insight-runs/${run.id}`,
      headers: sessionHeaders(firstSession),
    });
    expect(ownRead.statusCode).toBe(200);
    expect(ownRead.json()).toEqual(run);

    await expect(
      db
        .updateTable("matching.job_insight_runs")
        .set({ algorithm_version: "job-market-insight-v1" })
        .where("id", "=", run.id)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_PROFILE_REVISION");
  });

  it("enforces complete company scale evidence in PostgreSQL", async () => {
    await expect(
      db
        .insertInto("source_control.organizations")
        .values({
          id: organizationId,
          slug: `insight-scale-${organizationId}`,
          name: "Insight Scale Constraint Test",
          official_domain: "insight-scale.example.test",
          scale_band: "unknown",
          scale_evidence_url: "https://insight-scale.example.test/about",
        })
        .execute(),
    ).rejects.toThrow();

    await db
      .insertInto("source_control.organizations")
      .values({
        id: organizationId,
        slug: `insight-scale-${organizationId}`,
        name: "Insight Scale Constraint Test",
        official_domain: "insight-scale.example.test",
        scale_band: "medium",
        scale_evidence_url: "https://insight-scale.example.test/about",
        scale_evidence_text: "Official company profile states 500 employees.",
        scale_verified_at: new Date("2026-07-21T00:00:00.000Z"),
      })
      .execute();
  });
});
