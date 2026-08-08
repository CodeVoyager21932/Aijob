import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  ApplicationCaseCommandResponseSchema,
  ApplicationCaseJobVersionDiffResponseSchema,
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
  const upgradeFixture = {
    versionId: randomUUID(),
    requirementSetId: randomUUID(),
    revisionId: randomUUID(),
  };
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
            requirements: JSON.stringify(
              fixture.index === 0
                ? [
                    {
                      id: "requirement-old-sql",
                      kind: "skill",
                      operator: "contains",
                      expectedValue: ["SQL"],
                      sourceText: "掌握 SQL",
                      evidenceRefs: [`${fixture.revisionId}#sql`],
                      sourceSpan: null,
                      necessity: "required",
                    },
                    {
                      id: "requirement-old-language",
                      kind: "language",
                      operator: "contains",
                      expectedValue: "英语六级",
                      sourceText: "英语六级",
                      evidenceRefs: [`${fixture.revisionId}#language`],
                      sourceSpan: null,
                      necessity: "preferred",
                    },
                  ]
                : [],
            ),
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

      const firstPublic = publicFixtures[0];
      if (!firstPublic) throw new Error("PUBLIC_FIXTURE_MISSING");
      const upgradedSourceUrl = `https://application-case.example.test/jobs/${firstPublic.recordId}`;
      await transaction
        .insertInto("ingestion.source_job_revisions")
        .values({
          id: upgradeFixture.revisionId,
          source_job_record_id: firstPublic.recordId,
          revision_content_hash: "9".repeat(64),
          import_mode: "manual",
          adapter_version: "2",
          normalizer_version: "1",
          company_name: "Application Case Fixture Company",
          title: "Synthetic AI product internship",
          job_family: JSON.stringify({
            state: "known",
            value: "product",
            evidenceRefs: [`${upgradeFixture.revisionId}#family`],
          }),
          locations: JSON.stringify({
            state: "known",
            value: ["Shanghai"],
            evidenceRefs: [`${upgradeFixture.revisionId}#location`],
          }),
          business_groups: JSON.stringify([]),
          entry_scope: "internship",
          source_project_name: null,
          recruit_label_name: "internship",
          recruitment_type: JSON.stringify({
            state: "known",
            value: "internship",
            evidenceRefs: [`${upgradeFixture.revisionId}#type`],
          }),
          responsibilities: "Synthetic AI product research and delivery responsibilities.",
          requirements: "掌握 SQL 与 Python；具备用户研究项目经验。",
          structured_fields: JSON.stringify({}),
          ingestion_state: "validated",
          publication_state: "published",
          activity_state: "active",
          source_url: upgradedSourceUrl,
          apply_url: `${upgradedSourceUrl}/apply`,
          quality_flags: JSON.stringify([]),
        })
        .execute();
      await transaction
        .insertInto("catalog.published_job_versions")
        .values({
          id: upgradeFixture.versionId,
          published_job_id: firstPublic.jobId,
          source_job_revision_id: upgradeFixture.revisionId,
          content_hash: "9".repeat(64),
          company_name: "Application Case Fixture Company",
          title: "Synthetic AI product internship",
          job_family: JSON.stringify({
            state: "known",
            value: "product",
            evidenceRefs: [`${upgradeFixture.revisionId}#family`],
          }),
          locations: unknown,
          responsibilities: "Synthetic AI product research and delivery responsibilities.",
          requirements: "掌握 SQL 与 Python；具备用户研究项目经验。",
          structured_fields: JSON.stringify({}),
          activity_state: "active",
          source_url: upgradedSourceUrl,
          apply_url: `${upgradedSourceUrl}/apply`,
          effective_at: new Date(Date.now() + 1_000),
        })
        .execute();
      await transaction
        .insertInto("catalog.job_requirement_sets")
        .values({
          id: upgradeFixture.requirementSetId,
          published_job_version_id: upgradeFixture.versionId,
          schema_version: "application-case-fixture-v2",
          requirements: JSON.stringify([
            {
              id: "requirement-new-sql",
              kind: "skill",
              operator: "contains",
              expectedValue: ["SQL", "Python"],
              sourceText: "掌握 SQL",
              evidenceRefs: [`${upgradeFixture.revisionId}#sql`],
              sourceSpan: null,
              necessity: "required",
            },
            {
              id: "requirement-new-project",
              kind: "experience",
              operator: "contains",
              expectedValue: ["用户研究"],
              sourceText: "具备用户研究项目经验",
              evidenceRefs: [`${upgradeFixture.revisionId}#project`],
              sourceSpan: null,
              necessity: "required",
            },
          ]),
          content_hash: "8".repeat(64),
        })
        .execute();
      await transaction
        .updateTable("catalog.published_job_versions")
        .set({ active_requirement_set_id: upgradeFixture.requirementSetId })
        .where("id", "=", upgradeFixture.versionId)
        .execute();

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
      const versionIds = [
        ...publicFixtures.map(({ versionId }) => versionId),
        upgradeFixture.versionId,
      ];
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
        .where("id", "in", [
          ...publicFixtures.map(({ revisionId }) => revisionId),
          upgradeFixture.revisionId,
        ])
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

    const initialDiff = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdBody.applicationCase.id}/job-version-diff`,
      headers,
    });
    expect(initialDiff.statusCode).toBe(200);
    expect(initialDiff.headers["cache-control"]).toBe("no-store");
    expect(ApplicationCaseJobVersionDiffResponseSchema.parse(initialDiff.json())).toMatchObject({
      status: "up_to_date",
      pinnedPublishedJobVersionId: firstPublic.versionId,
      targetPublishedJobVersionId: firstPublic.versionId,
      fieldChanges: [],
    });

    const privateDiff = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${privateBody.applicationCase.id}/job-version-diff`,
      headers,
    });
    expect(privateDiff.statusCode).toBe(409);
    expect(privateDiff.json()).toMatchObject({ code: "JOB_VERSION_UPGRADE_NOT_APPLICABLE" });

    await db
      .updateTable("catalog.published_jobs")
      .set({
        current_version_id: upgradeFixture.versionId,
        public_version_id: upgradeFixture.versionId,
      })
      .where("id", "=", firstPublic.jobId)
      .execute();
    const availableDiffResponse = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdBody.applicationCase.id}/job-version-diff`,
      headers,
    });
    expect(availableDiffResponse.statusCode).toBe(200);
    const availableDiff = ApplicationCaseJobVersionDiffResponseSchema.parse(
      availableDiffResponse.json(),
    );
    expect(availableDiff).toMatchObject({
      status: "update_available",
      targetPublishedJobVersionId: upgradeFixture.versionId,
      targetRequirementSetId: upgradeFixture.requirementSetId,
    });
    expect(availableDiff.fieldChanges.map(({ field }) => field)).toEqual(
      expect.arrayContaining(["title", "responsibilities", "requirements"]),
    );
    expect(availableDiff.requirementChanges.added.map(({ id }) => id)).toEqual([
      "requirement-new-project",
    ]);
    expect(availableDiff.requirementChanges.removed.map(({ id }) => id)).toEqual([
      "requirement-old-language",
    ]);
    expect(availableDiff.requirementChanges.changed).toMatchObject([
      {
        from: { id: "requirement-old-sql" },
        to: { id: "requirement-new-sql" },
      },
    ]);

    const upgradeKey = `upgrade-${randomUUID()}`;
    const upgraded = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdBody.applicationCase.id}/job-version-upgrades`,
      headers: { ...headers, "idempotency-key": upgradeKey },
      payload: {
        expectedRevision: 1,
        targetPublishedJobVersionId: upgradeFixture.versionId,
      },
    });
    expect(upgraded.statusCode).toBe(200);
    const upgradedBody = ApplicationCaseCommandResponseSchema.parse(upgraded.json());
    expect(upgradedBody.event).toMatchObject({
      caseId: createdBody.applicationCase.id,
      sequence: 2,
      eventType: "job_version_upgraded",
      eventData: {
        fromPublishedJobVersionId: firstPublic.versionId,
        toPublishedJobVersionId: upgradeFixture.versionId,
        fromRequirementSetId: firstPublic.requirementSetId,
        toRequirementSetId: upgradeFixture.requirementSetId,
      },
    });
    const upgradeReplay = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdBody.applicationCase.id}/job-version-upgrades`,
      headers: { ...headers, "idempotency-key": upgradeKey },
      payload: {
        expectedRevision: 1,
        targetPublishedJobVersionId: upgradeFixture.versionId,
      },
    });
    expect(upgradeReplay.statusCode).toBe(200);
    expect(upgradeReplay.json()).toEqual(upgradedBody);
    const upgradeKeyConflict = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdBody.applicationCase.id}/job-version-upgrades`,
      headers: { ...headers, "idempotency-key": upgradeKey },
      payload: {
        expectedRevision: 2,
        targetPublishedJobVersionId: firstPublic.versionId,
      },
    });
    expect(upgradeKeyConflict.statusCode).toBe(409);
    expect(upgradeKeyConflict.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const staleUpgrade = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdBody.applicationCase.id}/job-version-upgrades`,
      headers: { ...headers, "idempotency-key": `stale-upgrade-${randomUUID()}` },
      payload: {
        expectedRevision: 1,
        targetPublishedJobVersionId: upgradeFixture.versionId,
      },
    });
    expect(staleUpgrade.statusCode).toBe(409);
    expect(staleUpgrade.json()).toMatchObject({ code: "APPLICATION_CASE_REVISION_CONFLICT" });
    const crossJobUpgrade = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdBody.applicationCase.id}/job-version-upgrades`,
      headers: { ...headers, "idempotency-key": `cross-upgrade-${randomUUID()}` },
      payload: {
        expectedRevision: 2,
        targetPublishedJobVersionId: secondPublic.versionId,
      },
    });
    expect(crossJobUpgrade.statusCode).toBe(422);
    expect(crossJobUpgrade.json()).toMatchObject({ code: "PUBLIC_JOB_CONTEXT_UNAVAILABLE" });
    const upgradedCase = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdBody.applicationCase.id}`,
      headers,
    });
    expect(upgradedCase.json()).toMatchObject({
      revision: 2,
      jobContext: {
        publishedJobVersionId: upgradeFixture.versionId,
        requirementSetId: upgradeFixture.requirementSetId,
      },
    });

    const missingTransitionCsrf = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${secondPublicBody.applicationCase.id}/transitions`,
      headers: { ...headersWithoutCsrf, "idempotency-key": `csrf-${randomUUID()}` },
      payload: { expectedRevision: 1, toStage: "preparing" },
    });
    expect(missingTransitionCsrf.statusCode).toBe(403);
    const invalidTransition = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${secondPublicBody.applicationCase.id}/transitions`,
      headers: { ...headers, "idempotency-key": `invalid-${randomUUID()}` },
      payload: { expectedRevision: 1, toStage: "applied" },
    });
    expect(invalidTransition.statusCode).toBe(409);
    expect(invalidTransition.json()).toMatchObject({ code: "INVALID_CASE_TRANSITION" });
    const transitionKey = `transition-${randomUUID()}`;
    const transitioned = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${secondPublicBody.applicationCase.id}/transitions`,
      headers: { ...headers, "idempotency-key": transitionKey },
      payload: { expectedRevision: 1, toStage: "preparing", reason: "USER_CONFIRMED" },
    });
    expect(transitioned.statusCode).toBe(200);
    const transitionedBody = ApplicationCaseCommandResponseSchema.parse(transitioned.json());
    expect(transitionedBody.event).toMatchObject({
      sequence: 2,
      eventType: "stage_transitioned",
      eventData: {
        fromStage: "interested",
        toStage: "preparing",
        outcome: null,
        reasonCode: "USER_CONFIRMED",
      },
    });
    const transitionReplay = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${secondPublicBody.applicationCase.id}/transitions`,
      headers: { ...headers, "idempotency-key": transitionKey },
      payload: { expectedRevision: 1, toStage: "preparing", reason: "USER_CONFIRMED" },
    });
    expect(transitionReplay.json()).toEqual(transitionedBody);
    const transitionKeyConflict = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${secondPublicBody.applicationCase.id}/transitions`,
      headers: { ...headers, "idempotency-key": transitionKey },
      payload: { expectedRevision: 2, toStage: "interested" },
    });
    expect(transitionKeyConflict.statusCode).toBe(409);
    expect(transitionKeyConflict.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const concurrentTransitions = await Promise.all(
      ["interested", "applied"].map((toStage) =>
        app.inject({
          method: "POST",
          url: `/v1/application-cases/${secondPublicBody.applicationCase.id}/transitions`,
          headers: { ...headers, "idempotency-key": `race-${toStage}-${randomUUID()}` },
          payload: { expectedRevision: 2, toStage },
        }),
      ),
    );
    expect(concurrentTransitions.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expect(
      concurrentTransitions.find(({ statusCode }) => statusCode === 409)?.json(),
    ).toMatchObject({ code: "APPLICATION_CASE_REVISION_CONFLICT" });
    const crossOwnerTransition = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdBody.applicationCase.id}/transitions`,
      headers: {
        ...sessionHeaders(secondSession),
        "idempotency-key": `cross-transition-${randomUUID()}`,
      },
      payload: { expectedRevision: 2, toStage: "preparing" },
    });
    expect(crossOwnerTransition.statusCode).toBe(404);
    expect(crossOwnerTransition.headers["cache-control"]).toBe("no-store");

    const resolved = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${privateBody.applicationCase.id}/transitions`,
      headers: { ...headers, "idempotency-key": `resolve-${randomUUID()}` },
      payload: { expectedRevision: 1, toStage: "resolved", outcome: "withdrawn" },
    });
    expect(resolved.statusCode).toBe(200);
    expect(ApplicationCaseCommandResponseSchema.parse(resolved.json()).event).toMatchObject({
      sequence: 2,
      eventType: "stage_transitioned",
      eventData: { toStage: "resolved", outcome: "withdrawn" },
    });
    const corrected = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${privateBody.applicationCase.id}/transitions`,
      headers: { ...headers, "idempotency-key": `correct-${randomUUID()}` },
      payload: {
        expectedRevision: 2,
        toStage: "resolved",
        outcome: "rejected",
        reason: "USER_CORRECTION",
      },
    });
    expect(corrected.statusCode).toBe(200);
    expect(ApplicationCaseCommandResponseSchema.parse(corrected.json()).event).toMatchObject({
      sequence: 3,
      eventType: "outcome_corrected",
      eventData: { fromOutcome: "withdrawn", toOutcome: "rejected" },
    });
    const correctionWithoutReason = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${privateBody.applicationCase.id}/transitions`,
      headers: { ...headers, "idempotency-key": `correct-missing-${randomUUID()}` },
      payload: { expectedRevision: 3, toStage: "resolved", outcome: "offer" },
    });
    expect(correctionWithoutReason.statusCode).toBe(409);
    expect(correctionWithoutReason.json()).toMatchObject({ code: "INVALID_CASE_TRANSITION" });
    const reopened = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${privateBody.applicationCase.id}/transitions`,
      headers: { ...headers, "idempotency-key": `reopen-${randomUUID()}` },
      payload: { expectedRevision: 3, toStage: "interested" },
    });
    expect(reopened.statusCode).toBe(409);
    expect(reopened.json()).toMatchObject({ code: "INVALID_CASE_TRANSITION" });

    const savedDecision = await app.inject({
      method: "PUT",
      url: `/v1/job-decisions/${firstPublic.jobId}`,
      headers,
      payload: { expectedRevision: 0, status: "saved", reason: null },
    });
    expect(savedDecision.statusCode).toBe(200);
    expect(savedDecision.json()).toMatchObject({ revision: 1, status: "saved" });
    const preparingDecision = await app.inject({
      method: "PUT",
      url: `/v1/job-decisions/${firstPublic.jobId}`,
      headers,
      payload: { expectedRevision: 1, status: "preparing_to_apply", reason: "继续准备" },
    });
    expect(preparingDecision.statusCode).toBe(200);
    const appliedDecision = await app.inject({
      method: "PUT",
      url: `/v1/job-decisions/${firstPublic.jobId}`,
      headers,
      payload: { expectedRevision: 2, status: "applied", reason: "用户手动确认" },
    });
    expect(appliedDecision.statusCode).toBe(200);
    const interviewing = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdBody.applicationCase.id}/transitions`,
      headers: { ...headers, "idempotency-key": `interviewing-${randomUUID()}` },
      payload: { expectedRevision: 4, toStage: "interviewing" },
    });
    expect(interviewing.statusCode).toBe(200);
    const lossyLegacyWrite = await app.inject({
      method: "PUT",
      url: `/v1/job-decisions/${firstPublic.jobId}`,
      headers,
      payload: { expectedRevision: 3, status: "abandoned", reason: "旧页面写入" },
    });
    expect(lossyLegacyWrite.statusCode).toBe(409);
    expect(lossyLegacyWrite.json()).toMatchObject({
      code: "CAREER_OS_STATE_NOT_REPRESENTABLE",
    });
    const decisionsAfterRollback = await app.inject({
      method: "GET",
      url: "/v1/job-decisions",
      headers,
    });
    expect(decisionsAfterRollback.json()).toContainEqual(
      expect.objectContaining({
        publishedJobId: firstPublic.jobId,
        revision: 3,
        status: "applied",
      }),
    );
    const firstCaseEvents = await db
      .selectFrom("application.case_events")
      .select(["sequence", "event_type"])
      .where("case_id", "=", createdBody.applicationCase.id)
      .orderBy("sequence")
      .execute();
    expect(firstCaseEvents).toEqual([
      { sequence: 1, event_type: "case_created" },
      { sequence: 2, event_type: "job_version_upgraded" },
      { sequence: 3, event_type: "stage_transitioned" },
      { sequence: 4, event_type: "stage_transitioned" },
      { sequence: 5, event_type: "stage_transitioned" },
    ]);
  }, 40_000);

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
