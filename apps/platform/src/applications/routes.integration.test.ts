import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  CreateApplicationCaseResponseSchema,
  ListApplicationCasesResponseSchema,
} from "@aijob/contracts";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from "../identity/fastify.js";
import {
  createAnonymousSession,
  type OwnerContext,
  revokeOwnerSessions,
} from "../identity/session-repository.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const encryptionKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const unknown = JSON.stringify({ state: "unknown", reason: "source_not_stated" });

function config(overrides: Partial<AppConfig> = {}): AppConfig {
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
    identity: { acceptedOrigins: [], alphaInviteCodeHashes: [] },
    workspaceRoot: ".",
    ...overrides,
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

describeWithDatabase("ApplicationCase owner-protected API", () => {
  let app: FastifyInstance;
  let db: Kysely<Database>;
  let firstSession: Awaited<ReturnType<typeof createAnonymousSession>>;
  let secondSession: Awaited<ReturnType<typeof createAnonymousSession>>;
  let expiredSession: Awaited<ReturnType<typeof createAnonymousSession>>;
  const ownerContexts: OwnerContext[] = [];
  const organizationId = randomUUID();
  const sourceId = randomUUID();
  const publicFixtures = Array.from({ length: 3 }, (_, index) => ({
    jobId: randomUUID(),
    versionId: randomUUID(),
    requirementSetId: randomUUID(),
    recordId: randomUUID(),
    revisionId: randomUUID(),
    index,
  }));
  const privateSnapshotId = randomUUID();

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
    firstSession = await createAnonymousSession({ db });
    secondSession = await createAnonymousSession({ db });
    expiredSession = await createAnonymousSession({ db });
    ownerContexts.push(firstSession.context, secondSession.context, expiredSession.context);

    await db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("source_control.organizations")
        .values({
          id: organizationId,
          slug: `application-case-${organizationId}`,
          name: "Application Case Fixture Company",
          official_domain: "application-case.example.test",
        })
        .execute();
      await transaction
        .insertInto("source_control.sources")
        .values({
          id: sourceId,
          organization_id: organizationId,
          source_candidate_id: null,
          source_key: `application-case-${sourceId}`,
          source_type: "organization_career_site",
          name: "Application Case Fixture Source",
          current_policy_version: 1,
        })
        .execute();
      await transaction
        .insertInto("source_control.source_policy_versions")
        .values({
          source_id: sourceId,
          version: 1,
          policy_status: "approved",
          config_registered: true,
          catalog_role: "canonical",
          runtime_scope: "alpha",
          provenance_level: "organization_owned",
          acquisition_mode: "public_api",
          adapter_key: "application-case-fixture",
          adapter_version: "1",
          entrypoints: JSON.stringify(["https://application-case.example.test/jobs"]),
          crawl_interval: "24h",
          policy_notes: "Offline ApplicationCase API fixture.",
          reviewed_at: new Date(),
        })
        .execute();
      await transaction
        .insertInto("source_control.source_runtime_states")
        .values({
          source_id: sourceId,
          policy_version: 1,
          freshness_state: "fresh",
          last_complete_run_at: new Date(),
          consecutive_failures: 0,
          last_error_code: null,
          next_due_at: null,
        })
        .execute();

      for (const fixture of publicFixtures) {
        const sourceUrl = `https://application-case.example.test/jobs/${fixture.recordId}`;
        await transaction
          .insertInto("ingestion.source_job_records")
          .values({
            id: fixture.recordId,
            source_id: sourceId,
            source_job_id: `application-case-${fixture.recordId}`,
            canonical_source_url: sourceUrl,
            first_seen_at: new Date(),
            last_seen_at: new Date(),
          })
          .execute();
        await transaction
          .insertInto("ingestion.source_job_revisions")
          .values({
            id: fixture.revisionId,
            source_job_record_id: fixture.recordId,
            revision_content_hash: String(fixture.index + 1).repeat(64),
            import_mode: "manual",
            adapter_version: "1",
            normalizer_version: "1",
            company_name: "Application Case Fixture Company",
            title: `Synthetic product internship ${fixture.index + 1}`,
            job_family: JSON.stringify({
              state: "known",
              value: "product",
              evidenceRefs: [`${fixture.revisionId}#family`],
            }),
            locations: JSON.stringify({
              state: "known",
              value: ["Shanghai"],
              evidenceRefs: [`${fixture.revisionId}#location`],
            }),
            business_groups: JSON.stringify([]),
            entry_scope: "internship",
            source_project_name: null,
            recruit_label_name: "internship",
            recruitment_type: JSON.stringify({
              state: "known",
              value: "internship",
              evidenceRefs: [`${fixture.revisionId}#type`],
            }),
            responsibilities: "Synthetic product research responsibilities.",
            requirements: "Current student with synthetic research evidence.",
            structured_fields: JSON.stringify({}),
            ingestion_state: "validated",
            publication_state: "published",
            activity_state: "active",
            source_url: sourceUrl,
            apply_url: `${sourceUrl}/apply`,
            quality_flags: JSON.stringify([]),
          })
          .execute();
        await transaction
          .insertInto("catalog.published_jobs")
          .values({ id: fixture.jobId, current_version_id: null, public_version_id: null })
          .execute();
        await transaction
          .insertInto("catalog.published_job_versions")
          .values({
            id: fixture.versionId,
            published_job_id: fixture.jobId,
            source_job_revision_id: fixture.revisionId,
            content_hash: String.fromCharCode(97 + fixture.index).repeat(64),
            company_name: "Application Case Fixture Company",
            title: `Synthetic product internship ${fixture.index + 1}`,
            job_family: JSON.stringify({
              state: "known",
              value: "product",
              evidenceRefs: [`${fixture.revisionId}#family`],
            }),
            locations: unknown,
            responsibilities: "Synthetic product research responsibilities.",
            requirements: "Current student with synthetic research evidence.",
            structured_fields: JSON.stringify({}),
            activity_state: "active",
            source_url: sourceUrl,
            apply_url: `${sourceUrl}/apply`,
            effective_at: new Date(),
          })
          .execute();
        await transaction
          .insertInto("catalog.job_requirement_sets")
          .values({
            id: fixture.requirementSetId,
            published_job_version_id: fixture.versionId,
            schema_version: "application-case-fixture-v1",
            requirements: JSON.stringify([]),
            content_hash: String.fromCharCode(100 + fixture.index).repeat(64),
          })
          .execute();
        await transaction
          .updateTable("catalog.published_job_versions")
          .set({ active_requirement_set_id: fixture.requirementSetId })
          .where("id", "=", fixture.versionId)
          .execute();
        await transaction
          .updateTable("catalog.published_jobs")
          .set({ current_version_id: fixture.versionId, public_version_id: fixture.versionId })
          .where("id", "=", fixture.jobId)
          .execute();
      }

      await transaction
        .insertInto("application.private_job_snapshots")
        .values({
          id: privateSnapshotId,
          owner_id: firstSession.context.ownerId,
          owner_epoch: firstSession.context.ownerEpoch,
          current_content_revision: null,
          current_requirement_set_revision: null,
          creation_idempotency_key: `private-snapshot-${privateSnapshotId}`,
          creation_request_hash: "e".repeat(64),
          deleted_at: null,
        })
        .execute();
      await transaction
        .insertInto("application.private_job_snapshot_revisions")
        .values({
          owner_id: firstSession.context.ownerId,
          owner_epoch: firstSession.context.ownerEpoch,
          snapshot_id: privateSnapshotId,
          content_revision: 1,
          requirement_set_revision: 1,
          title: "Synthetic private product internship",
          company_name: null,
          source_label: "user_pasted",
          official_url: null,
          source_provided: false,
          content_text: "Synthetic private JD used only by the isolated API test.",
          requirements: JSON.stringify([]),
          content_hash: "f".repeat(64),
        })
        .execute();
      await transaction
        .updateTable("application.private_job_snapshots")
        .set({ current_content_revision: 1, current_requirement_set_revision: 1 })
        .where("id", "=", privateSnapshotId)
        .execute();
    });

    app = buildApp({ config: config(), db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const ownerIds = ownerContexts.map(({ ownerId }) => ownerId);
    await db.transaction().execute(async (transaction) => {
      await transaction
        .deleteFrom("application.application_cases")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .updateTable("application.private_job_snapshots")
        .set({ current_content_revision: null, current_requirement_set_revision: null })
        .where("id", "=", privateSnapshotId)
        .execute();
      await transaction
        .deleteFrom("application.private_job_snapshots")
        .where("id", "=", privateSnapshotId)
        .execute();
      await transaction
        .deleteFrom("decision.job_decisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("identity.owner_sessions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction.deleteFrom("identity.owners").where("id", "in", ownerIds).execute();

      const jobIds = publicFixtures.map(({ jobId }) => jobId);
      const versionIds = publicFixtures.map(({ versionId }) => versionId);
      await transaction
        .deleteFrom("catalog.company_quota_selections")
        .where("published_job_id", "in", jobIds)
        .execute();
      await transaction
        .updateTable("catalog.published_jobs")
        .set({ current_version_id: null, public_version_id: null })
        .where("id", "in", jobIds)
        .execute();
      await transaction
        .updateTable("catalog.published_job_versions")
        .set({ active_requirement_set_id: null })
        .where("id", "in", versionIds)
        .execute();
      await transaction
        .deleteFrom("catalog.job_requirement_sets")
        .where("published_job_version_id", "in", versionIds)
        .execute();
      await transaction
        .deleteFrom("catalog.published_job_versions")
        .where("id", "in", versionIds)
        .execute();
      await transaction.deleteFrom("catalog.published_jobs").where("id", "in", jobIds).execute();
      await transaction
        .deleteFrom("ingestion.source_job_revisions")
        .where(
          "id",
          "in",
          publicFixtures.map(({ revisionId }) => revisionId),
        )
        .execute();
      await transaction
        .deleteFrom("ingestion.source_job_records")
        .where(
          "id",
          "in",
          publicFixtures.map(({ recordId }) => recordId),
        )
        .execute();
      await transaction
        .deleteFrom("source_control.source_runtime_states")
        .where("source_id", "=", sourceId)
        .execute();
      await transaction
        .deleteFrom("source_control.source_policy_versions")
        .where("source_id", "=", sourceId)
        .execute();
      await transaction.deleteFrom("source_control.sources").where("id", "=", sourceId).execute();
      await transaction
        .deleteFrom("source_control.organizations")
        .where("id", "=", organizationId)
        .execute();
    });
    await db.destroy();
  });

  it("creates public and private Cases idempotently without changing legacy decisions", async () => {
    const firstPublic = publicFixtures[0];
    const secondPublic = publicFixtures[1];
    const thirdPublic = publicFixtures[2];
    if (!firstPublic || !secondPublic || !thirdPublic) throw new Error("PUBLIC_FIXTURE_MISSING");
    const publicRequest = {
      jobContext: {
        kind: "public" as const,
        publishedJobId: firstPublic.jobId,
        publishedJobVersionId: firstPublic.versionId,
      },
    };
    const publicKey = `public-case-${randomUUID()}`;
    const headers = sessionHeaders(firstSession);
    const { [CSRF_HEADER_NAME]: _csrf, ...headersWithoutCsrf } = headers;

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headersWithoutCsrf, "idempotency-key": publicKey },
      payload: publicRequest,
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.json()).toMatchObject({ code: "CSRF_REJECTED" });

    const missingKey = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers,
      payload: publicRequest,
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });

    const created = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": publicKey },
      payload: publicRequest,
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    const createdBody = CreateApplicationCaseResponseSchema.parse(created.json());
    expect(createdBody.created).toBe(true);
    expect(createdBody.applicationCase.jobContext).toEqual({
      kind: "public",
      publishedJobId: firstPublic.jobId,
      publishedJobVersionId: firstPublic.versionId,
      requirementSetId: firstPublic.requirementSetId,
      officialUrl: `https://application-case.example.test/jobs/${firstPublic.recordId}/apply`,
    });

    const replay = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": publicKey },
      payload: publicRequest,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(createdBody);

    const conflictingReplay = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": publicKey },
      payload: {
        jobContext: {
          kind: "public",
          publishedJobId: secondPublic.jobId,
          publishedJobVersionId: secondPublic.versionId,
        },
      },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const sameContext = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `same-public-${randomUUID()}` },
      payload: publicRequest,
    });
    expect(sameContext.statusCode).toBe(200);
    expect(sameContext.json()).toMatchObject({
      applicationCase: { id: createdBody.applicationCase.id },
      created: false,
    });

    const events = await db
      .selectFrom("application.case_events")
      .select(["sequence", "event_type", "event_data"])
      .where("owner_id", "=", firstSession.context.ownerId)
      .where("case_id", "=", createdBody.applicationCase.id)
      .execute();
    expect(events).toEqual([
      {
        sequence: 1,
        event_type: "case_created",
        event_data: {
          schemaVersion: "case-event-v1",
          initialStage: "interested",
          jobContextKind: "public",
          jobContextRevision: 1,
        },
      },
    ]);

    const ownRead = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdBody.applicationCase.id}`,
      headers,
    });
    expect(ownRead.statusCode).toBe(200);
    expect(ownRead.headers["cache-control"]).toBe("no-store");
    expect(ownRead.json()).toEqual(createdBody.applicationCase);

    const otherOwnerList = await app.inject({
      method: "GET",
      url: "/v1/application-cases",
      headers: sessionHeaders(secondSession),
    });
    expect(otherOwnerList.statusCode).toBe(200);
    expect(otherOwnerList.headers["cache-control"]).toBe("no-store");
    expect(ListApplicationCasesResponseSchema.parse(otherOwnerList.json())).toEqual({
      items: [],
      nextCursor: null,
    });

    const otherOwnerRead = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdBody.applicationCase.id}`,
      headers: sessionHeaders(secondSession),
    });
    const missingRead = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${randomUUID()}`,
      headers,
    });
    expect(otherOwnerRead.statusCode).toBe(404);
    expect(missingRead.statusCode).toBe(404);
    expect(otherOwnerRead.json().code).toBe(missingRead.json().code);

    const crossOwnerPrivate = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: {
        ...sessionHeaders(secondSession),
        "idempotency-key": `cross-private-${randomUUID()}`,
      },
      payload: {
        jobContext: { kind: "private", snapshotId: privateSnapshotId, contentRevision: 1 },
      },
    });
    expect(crossOwnerPrivate.statusCode).toBe(404);
    expect(crossOwnerPrivate.json()).toMatchObject({ code: "PRIVATE_JOB_CONTEXT_NOT_FOUND" });

    const missingPrivateRevision = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `private-revision-${randomUUID()}` },
      payload: {
        jobContext: { kind: "private", snapshotId: privateSnapshotId, contentRevision: 2 },
      },
    });
    expect(missingPrivateRevision.statusCode).toBe(404);
    expect(missingPrivateRevision.json()).toMatchObject({ code: "PRIVATE_JOB_CONTEXT_NOT_FOUND" });

    const privateCreated = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `private-${randomUUID()}` },
      payload: {
        jobContext: { kind: "private", snapshotId: privateSnapshotId, contentRevision: 1 },
      },
    });
    expect(privateCreated.statusCode).toBe(201);
    const privateBody = CreateApplicationCaseResponseSchema.parse(privateCreated.json());
    expect(privateBody.applicationCase.jobContext).toMatchObject({
      kind: "private",
      snapshotId: privateSnapshotId,
      ownerId: firstSession.context.ownerId,
      contentRevision: 1,
      requirementSetRevision: 1,
    });

    const unavailablePublicVersion = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `public-version-${randomUUID()}` },
      payload: {
        jobContext: {
          kind: "public",
          publishedJobId: secondPublic.jobId,
          publishedJobVersionId: firstPublic.versionId,
        },
      },
    });
    expect(unavailablePublicVersion.statusCode).toBe(422);
    expect(unavailablePublicVersion.json()).toMatchObject({
      code: "PUBLIC_JOB_CONTEXT_UNAVAILABLE",
    });

    const secondPublicCreated = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `public-two-${randomUUID()}` },
      payload: {
        jobContext: {
          kind: "public",
          publishedJobId: secondPublic.jobId,
          publishedJobVersionId: secondPublic.versionId,
        },
      },
    });
    expect(secondPublicCreated.statusCode).toBe(201);
    const secondPublicBody = CreateApplicationCaseResponseSchema.parse(secondPublicCreated.json());

    const concurrentRequest = {
      jobContext: {
        kind: "public" as const,
        publishedJobId: thirdPublic.jobId,
        publishedJobVersionId: thirdPublic.versionId,
      },
    };
    const concurrentResponses = await Promise.all(
      ["first", "second"].map((label) =>
        app.inject({
          method: "POST",
          url: "/v1/application-cases",
          headers: {
            ...headers,
            "idempotency-key": `concurrent-${label}-${randomUUID()}`,
          },
          payload: concurrentRequest,
        }),
      ),
    );
    expect(concurrentResponses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 201]);
    const concurrentBodies = concurrentResponses.map((response) =>
      CreateApplicationCaseResponseSchema.parse(response.json()),
    );
    expect(new Set(concurrentBodies.map(({ applicationCase }) => applicationCase.id)).size).toBe(1);
    expect(concurrentBodies.map(({ created }) => created).sort()).toEqual([false, true]);
    const concurrentCaseId = concurrentBodies[0]?.applicationCase.id;
    if (!concurrentCaseId) throw new Error("CONCURRENT_CASE_MISSING");
    const concurrentEventCount = await db
      .selectFrom("application.case_events")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("case_id", "=", concurrentCaseId)
      .executeTakeFirstOrThrow();
    expect(Number(concurrentEventCount.count)).toBe(1);

    const sameTimestamp = new Date(Date.now() + 60_000);
    const expectedIds = [
      createdBody.applicationCase.id,
      privateBody.applicationCase.id,
      secondPublicBody.applicationCase.id,
      concurrentCaseId,
    ].sort((left, right) => right.localeCompare(left));
    await db
      .updateTable("application.application_cases")
      .set({ updated_at: sameTimestamp })
      .where("id", "in", expectedIds)
      .execute();

    const firstPage = await app.inject({
      method: "GET",
      url: "/v1/application-cases?limit=2",
      headers,
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.headers["cache-control"]).toBe("no-store");
    const firstPageBody = ListApplicationCasesResponseSchema.parse(firstPage.json());
    expect(firstPageBody.items.map(({ id }) => id)).toEqual(expectedIds.slice(0, 2));
    expect(firstPageBody.nextCursor).toBeTruthy();

    const secondPage = await app.inject({
      method: "GET",
      url: `/v1/application-cases?limit=2&cursor=${encodeURIComponent(firstPageBody.nextCursor as string)}`,
      headers,
    });
    const secondPageBody = ListApplicationCasesResponseSchema.parse(secondPage.json());
    expect(secondPageBody.items.map(({ id }) => id)).toEqual(expectedIds.slice(2));
    expect(secondPageBody.nextCursor).toBeNull();

    const crossFilterCursor = await app.inject({
      method: "GET",
      url: `/v1/application-cases?stage=interested&cursor=${encodeURIComponent(firstPageBody.nextCursor as string)}`,
      headers,
    });
    expect(crossFilterCursor.statusCode).toBe(400);
    expect(crossFilterCursor.json()).toMatchObject({ code: "INVALID_APPLICATION_CASE_CURSOR" });
    const malformedCursor = await app.inject({
      method: "GET",
      url: "/v1/application-cases?cursor=not-a-cursor",
      headers,
    });
    expect(malformedCursor.statusCode).toBe(400);
    expect(malformedCursor.json()).toMatchObject({ code: "INVALID_APPLICATION_CASE_CURSOR" });

    const resolvedCases = await app.inject({
      method: "GET",
      url: "/v1/application-cases?stage=resolved",
      headers,
    });
    expect(resolvedCases.statusCode).toBe(200);
    expect(ListApplicationCasesResponseSchema.parse(resolvedCases.json())).toEqual({
      items: [],
      nextCursor: null,
    });

    const legacyDecisions = await app.inject({
      method: "GET",
      url: "/v1/job-decisions",
      headers,
    });
    expect(legacyDecisions.statusCode).toBe(200);
    expect(legacyDecisions.json()).toEqual([]);
  }, 20_000);

  it("rejects an expired owner session without enumerating Case data", async () => {
    const alphaApp = buildApp({
      config: config({
        appEnv: "alpha",
        host: "0.0.0.0",
        enableInternalPreview: false,
        enableLocalMvp: false,
        identity: {
          acceptedOrigins: ["https://alpha.aijob.example"],
          alphaInviteCodeHashes: [],
        },
      }),
      db,
    });
    await alphaApp.ready();
    try {
      await revokeOwnerSessions({ db, ownerId: expiredSession.context.ownerId });
      const response = await alphaApp.inject({
        method: "GET",
        url: `/v1/application-cases/${randomUUID()}`,
        headers: { cookie: `${SESSION_COOKIE_NAME}=${expiredSession.sessionToken}` },
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject({ code: "SESSION_REQUIRED" });
    } finally {
      await alphaApp.close();
    }
  });
});
