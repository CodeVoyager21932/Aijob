import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  ApplicationCaseCommandResponseSchema,
  ApplicationCaseJobVersionDiffResponseSchema,
  ApplicationCaseMutationResponseSchema,
  ApplicationCaseRequirementsSchema,
  CreateApplicationCaseResponseSchema,
  DeleteApplicationCaseResponseSchema,
  ListApplicationCaseEventsResponseSchema,
  ListApplicationCasesResponseSchema,
} from "@aijob/contracts";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
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
  let requirementsSession: Awaited<ReturnType<typeof createAnonymousSession>>;
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
  const requirementsPrivateSnapshotId = randomUUID();
  const requirementsEvidenceRevisionId = randomUUID();
  const unconfirmedEvidenceRevisionId = randomUUID();
  const otherEvidenceRevisionId = randomUUID();
  const evidenceIds = ["evidence-alpha", "evidence-beta"] as const;

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
    firstSession = await createAnonymousSession({ db });
    secondSession = await createAnonymousSession({ db });
    requirementsSession = await createAnonymousSession({ db });
    expiredSession = await createAnonymousSession({ db });
    ownerContexts.push(
      firstSession.context,
      secondSession.context,
      requirementsSession.context,
      expiredSession.context,
    );

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
            locations:
              fixture.index === 1
                ? JSON.stringify({
                    state: "known",
                    value: ["Shanghai"],
                    evidenceRefs: [`${fixture.revisionId}#location`],
                  })
                : unknown,
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

      await transaction
        .insertInto("application.private_job_snapshots")
        .values({
          id: requirementsPrivateSnapshotId,
          owner_id: requirementsSession.context.ownerId,
          owner_epoch: requirementsSession.context.ownerEpoch,
          current_content_revision: null,
          current_requirement_set_revision: null,
          creation_idempotency_key: `private-snapshot-${requirementsPrivateSnapshotId}`,
          creation_request_hash: "c".repeat(64),
          deleted_at: null,
        })
        .execute();
      await transaction
        .insertInto("application.private_job_snapshot_revisions")
        .values({
          owner_id: requirementsSession.context.ownerId,
          owner_epoch: requirementsSession.context.ownerEpoch,
          snapshot_id: requirementsPrivateSnapshotId,
          content_revision: 1,
          requirement_set_revision: 1,
          title: "Synthetic private requirements internship",
          company_name: "Private Fixture Company",
          source_label: "user_pasted",
          official_url: null,
          source_provided: false,
          content_text: "Synthetic private JD for requirement service tests.",
          requirements: JSON.stringify([
            {
              id: "private-requirement-1",
              kind: "experience",
              operator: "contains",
              expectedValue: ["user research"],
              sourceText: "具备用户研究项目经历",
              evidenceRefs: ["private-jd#experience"],
              sourceSpan: null,
              necessity: "required",
            },
          ]),
          content_hash: "b".repeat(64),
        })
        .execute();
      await transaction
        .updateTable("application.private_job_snapshots")
        .set({ current_content_revision: 1, current_requirement_set_revision: 1 })
        .where("id", "=", requirementsPrivateSnapshotId)
        .execute();

      await transaction
        .insertInto("profile.resume_evidence_revisions")
        .values([
          {
            id: requirementsEvidenceRevisionId,
            owner_id: requirementsSession.context.ownerId,
            owner_epoch: requirementsSession.context.ownerEpoch,
            resume_analysis_id: null,
            revision: 1,
            base_revision: null,
            evidence: JSON.stringify(
              evidenceIds.map((id, index) => ({
                id,
                resumeAnalysisId: null,
                section: "项目经历",
                originalText: `Synthetic confirmed evidence ${index + 1}`,
                claim: `Synthetic confirmed claim ${index + 1}`,
                skills: ["research"],
                outcomes: [],
                confirmed: true,
              })),
            ),
            content_hash: "a".repeat(64),
            confirmed_at: new Date(),
            schema_version: "resume-evidence-v1",
            document_revision_id: null,
          },
          {
            id: unconfirmedEvidenceRevisionId,
            owner_id: requirementsSession.context.ownerId,
            owner_epoch: requirementsSession.context.ownerEpoch,
            resume_analysis_id: null,
            revision: 2,
            base_revision: 1,
            evidence: JSON.stringify([
              {
                id: "unconfirmed-evidence",
                resumeAnalysisId: null,
                section: "项目经历",
                originalText: "Unconfirmed evidence must be rejected",
                claim: "Unconfirmed claim",
                skills: [],
                outcomes: [],
                confirmed: false,
              },
            ]),
            content_hash: "6".repeat(64),
            confirmed_at: new Date(),
            schema_version: "resume-evidence-v1",
            document_revision_id: null,
          },
          {
            id: otherEvidenceRevisionId,
            owner_id: secondSession.context.ownerId,
            owner_epoch: secondSession.context.ownerEpoch,
            resume_analysis_id: null,
            revision: 1,
            base_revision: null,
            evidence: JSON.stringify([
              {
                id: "other-owner-evidence",
                resumeAnalysisId: null,
                section: "项目经历",
                originalText: "Other owner evidence",
                claim: "Other owner claim",
                skills: [],
                outcomes: [],
                confirmed: true,
              },
            ]),
            content_hash: "7".repeat(64),
            confirmed_at: new Date(),
            schema_version: "resume-evidence-v1",
            document_revision_id: null,
          },
        ])
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
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("application.private_job_snapshots")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("profile.resume_evidence_revisions")
        .where("owner_id", "in", ownerIds)
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
    expect(createdBody.applicationCase.jobDisplay).toMatchObject({
      title: "Synthetic product internship 1",
      companyName: "Application Case Fixture Company",
      locations: { state: "unknown", reason: "source_not_stated" },
      source: {
        kind: "catalog",
        displayName: "Application Case Fixture Source",
        policyStatus: "approved",
        provenanceLevel: "organization_owned",
      },
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

    await db
      .updateTable("source_control.source_policy_versions")
      .set({ policy_status: "pending_review" })
      .where("source_id", "=", sourceId)
      .where("version", "=", 1)
      .executeTakeFirstOrThrow();
    const pendingSourceRead = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdBody.applicationCase.id}`,
      headers,
    });
    expect(pendingSourceRead.statusCode).toBe(200);
    expect(pendingSourceRead.json()).toMatchObject({
      jobDisplay: {
        source: {
          kind: "catalog",
          displayName: "本地待复核来源",
          policyStatus: "pending_review",
        },
      },
    });
    await db
      .updateTable("source_control.source_policy_versions")
      .set({ policy_status: "approved" })
      .where("source_id", "=", sourceId)
      .where("version", "=", 1)
      .executeTakeFirstOrThrow();

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
    expect(secondPublicBody.applicationCase.jobDisplay.locations).toEqual({
      state: "known",
      value: ["Shanghai"],
      evidenceRefs: [`${secondPublic.revisionId}#location`],
    });

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
    const pinnedDisplayRead = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdBody.applicationCase.id}`,
      headers,
    });
    expect(pinnedDisplayRead.statusCode).toBe(200);
    expect(pinnedDisplayRead.json()).toMatchObject({
      jobContext: { publishedJobVersionId: firstPublic.versionId },
      jobDisplay: { title: "Synthetic product internship 1" },
    });
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

    const crossOwnerCaseDelete = await app.inject({
      method: "DELETE",
      url: `/v1/application-cases/${privateBody.applicationCase.id}`,
      headers: sessionHeaders(secondSession),
      payload: {
        expectedRevision: 3,
        resumeDocuments: "delete",
        interviewSessions: "delete",
        debriefs: "delete",
      },
    });
    expect(crossOwnerCaseDelete.statusCode).toBe(404);
    expect(crossOwnerCaseDelete.json()).toMatchObject({ code: "APPLICATION_CASE_NOT_FOUND" });

    const privateCaseDeleteRequest = {
      expectedRevision: 3,
      resumeDocuments: "delete" as const,
      interviewSessions: "delete" as const,
      debriefs: "delete" as const,
    };
    const missingCaseDeleteCsrf = await app.inject({
      method: "DELETE",
      url: `/v1/application-cases/${privateBody.applicationCase.id}`,
      headers: headersWithoutCsrf,
      payload: privateCaseDeleteRequest,
    });
    expect(missingCaseDeleteCsrf.statusCode).toBe(403);

    const privateCaseDeletedResponse = await app.inject({
      method: "DELETE",
      url: `/v1/application-cases/${privateBody.applicationCase.id}`,
      headers,
      payload: privateCaseDeleteRequest,
    });
    expect(privateCaseDeletedResponse.statusCode).toBe(200);
    const privateCaseDeleted = DeleteApplicationCaseResponseSchema.parse(
      privateCaseDeletedResponse.json(),
    );
    expect(privateCaseDeleted).toMatchObject({
      caseId: privateBody.applicationCase.id,
      revision: 4,
      relatedAssets: {
        resumeDocuments: { deletedIds: [], detachedIds: [] },
        interviewSessions: { deletedIds: [], detachedIds: [] },
        debriefs: { deletedIds: [], detachedIds: [] },
      },
      privateJobSnapshotRetained: false,
    });
    const privateCaseDeleteReplay = await app.inject({
      method: "DELETE",
      url: `/v1/application-cases/${privateBody.applicationCase.id}`,
      headers,
      payload: privateCaseDeleteRequest,
    });
    expect(privateCaseDeleteReplay.json()).toEqual(privateCaseDeleted);
    const deletedSnapshot = await db
      .selectFrom("application.private_job_snapshots")
      .select("deleted_at")
      .where("id", "=", privateSnapshotId)
      .where("owner_id", "=", firstSession.context.ownerId)
      .executeTakeFirstOrThrow();
    expect(deletedSnapshot.deleted_at).not.toBeNull();
  }, 40_000);

  it("records an application only through an explicit Case command and exposes its timeline", async () => {
    const fixture = publicFixtures[1];
    if (!fixture) throw new Error("PUBLIC_FIXTURE_MISSING");
    const headers = sessionHeaders(secondSession);
    const { [CSRF_HEADER_NAME]: _csrf, ...headersWithoutCsrf } = headers;
    const created = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `m3-public-case-${randomUUID()}` },
      payload: {
        jobContext: {
          kind: "public",
          publishedJobId: fixture.jobId,
          publishedJobVersionId: fixture.versionId,
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const applicationCase = CreateApplicationCaseResponseSchema.parse(
      created.json(),
    ).applicationCase;
    expect(applicationCase).toMatchObject({ stage: "interested", revision: 1 });

    const initialTimeline = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${applicationCase.id}/events?limit=1`,
      headers,
    });
    expect(initialTimeline.statusCode).toBe(200);
    expect(initialTimeline.headers["cache-control"]).toBe("no-store");
    expect(ListApplicationCaseEventsResponseSchema.parse(initialTimeline.json())).toMatchObject({
      items: [{ eventType: "case_created", sequence: 1 }],
      nextCursor: null,
    });

    const crossOwnerTimeline = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${applicationCase.id}/events`,
      headers: sessionHeaders(firstSession),
    });
    expect(crossOwnerTimeline.statusCode).toBe(404);
    expect(crossOwnerTimeline.json()).toMatchObject({ code: "APPLICATION_CASE_NOT_FOUND" });

    const missingCsrf = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${applicationCase.id}/manual-applications`,
      headers: { ...headersWithoutCsrf, "idempotency-key": `m3-csrf-${randomUUID()}` },
      payload: { expectedRevision: 1 },
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.json()).toMatchObject({ code: "CSRF_REJECTED" });

    const missingKey = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${applicationCase.id}/manual-applications`,
      headers,
      payload: { expectedRevision: 1 },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });

    const commandKey = `m3-manual-application-${randomUUID()}`;
    const recorded = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${applicationCase.id}/manual-applications`,
      headers: { ...headers, "idempotency-key": commandKey },
      payload: { expectedRevision: 1 },
    });
    expect(recorded.statusCode).toBe(200);
    expect(recorded.headers["cache-control"]).toBe("no-store");
    const recordedBody = ApplicationCaseCommandResponseSchema.parse(recorded.json());
    expect(recordedBody).toMatchObject({
      event: {
        caseId: applicationCase.id,
        sequence: 2,
        eventType: "manual_application_recorded",
        eventData: {
          fromStage: "interested",
          toStage: "applied",
          reasonCode: null,
        },
      },
    });

    const replay = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${applicationCase.id}/manual-applications`,
      headers: { ...headers, "idempotency-key": commandKey },
      payload: { expectedRevision: 1 },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(recordedBody);

    const conflictingReplay = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${applicationCase.id}/manual-applications`,
      headers: { ...headers, "idempotency-key": commandKey },
      payload: { expectedRevision: 2 },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const refreshed = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${applicationCase.id}`,
      headers,
    });
    expect(refreshed.json()).toMatchObject({ stage: "applied", revision: 2 });
    const legacyProjection = await app.inject({
      method: "GET",
      url: "/v1/job-decisions",
      headers,
    });
    expect(legacyProjection.json()).toEqual([
      expect.objectContaining({
        publishedJobId: fixture.jobId,
        status: "applied",
        revision: 1,
      }),
    ]);

    const firstTimelinePage = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${applicationCase.id}/events?limit=1`,
      headers,
    });
    const firstTimelineBody = ListApplicationCaseEventsResponseSchema.parse(
      firstTimelinePage.json(),
    );
    expect(firstTimelineBody.items).toMatchObject([
      { eventType: "manual_application_recorded", sequence: 2 },
    ]);
    expect(firstTimelineBody.nextCursor).toBeTruthy();
    const secondTimelinePage = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${applicationCase.id}/events?limit=1&cursor=${encodeURIComponent(firstTimelineBody.nextCursor as string)}`,
      headers,
    });
    expect(ListApplicationCaseEventsResponseSchema.parse(secondTimelinePage.json())).toMatchObject({
      items: [{ eventType: "case_created", sequence: 1 }],
      nextCursor: null,
    });

    const malformedCursor = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${applicationCase.id}/events?cursor=not-a-cursor`,
      headers,
    });
    expect(malformedCursor.statusCode).toBe(400);
    expect(malformedCursor.json()).toMatchObject({
      code: "INVALID_APPLICATION_CASE_EVENT_CURSOR",
    });

    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${applicationCase.id}/manual-applications`,
      headers: { ...headers, "idempotency-key": `m3-duplicate-${randomUUID()}` },
      payload: { expectedRevision: 2 },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "APPLICATION_ALREADY_RECORDED" });

    const privateCreated = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `m3-private-case-${randomUUID()}` },
      payload: {
        jobContext: {
          kind: "private_input",
          title: "M3 synthetic private internship",
          companyName: null,
          contentText: "职责：完成合成投递记录。\n要求：在校生。",
          source: { kind: "unspecified" },
          duplicateHandling: "create_separate",
        },
      },
    });
    const privateCase = CreateApplicationCaseResponseSchema.parse(
      privateCreated.json(),
    ).applicationCase;
    const privateRecorded = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${privateCase.id}/manual-applications`,
      headers: { ...headers, "idempotency-key": `m3-private-record-${randomUUID()}` },
      payload: { expectedRevision: 1 },
    });
    expect(privateRecorded.statusCode).toBe(200);
    const legacyAfterPrivate = await app.inject({
      method: "GET",
      url: "/v1/job-decisions",
      headers,
    });
    expect(legacyAfterPrivate.json()).toHaveLength(1);
  }, 20_000);

  it("creates owner-private JD Cases atomically without publishing or sharing them", async () => {
    const headers = sessionHeaders(secondSession);
    const contentText =
      "  私有用户研究实习生\r\n职责：\r\n负责用户研究与需求分析。\r\n要求：\r\n每周至少实习 4 天；掌握 SQL。\r\n具备良好的自驱力。  ";
    const normalizedContent =
      "私有用户研究实习生\n职责：\n负责用户研究与需求分析。\n要求：\n每周至少实习 4 天；掌握 SQL。\n具备良好的自驱力。";
    const publicCountBefore = await db
      .selectFrom("catalog.published_jobs")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();
    const createKey = `private-input-${randomUUID()}`;
    const createRequest = {
      jobContext: {
        kind: "private_input" as const,
        title: "私有用户研究实习生",
        companyName: null,
        contentText,
        source: { kind: "unspecified" as const },
        duplicateHandling: "reuse" as const,
      },
    };

    const created = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": createKey },
      payload: createRequest,
    });
    expect(created.statusCode, JSON.stringify(created.json())).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    const createdBody = CreateApplicationCaseResponseSchema.parse(created.json());
    expect(createdBody).toMatchObject({
      created: true,
      applicationCase: {
        jobContext: {
          kind: "private",
          ownerId: secondSession.context.ownerId,
          contentRevision: 1,
          requirementSetRevision: 1,
          sourceProvided: false,
        },
        jobDisplay: {
          title: "私有用户研究实习生",
          locations: { state: "unknown", reason: "source_not_stated" },
          workMode: { state: "unknown", reason: "source_not_stated" },
          deadlineAt: { state: "unknown", reason: "source_not_stated" },
          source: {
            kind: "owner_private",
            displayName: "来源未提供，请自行核验",
            sourceProvided: false,
            verified: false,
          },
        },
      },
    });
    if (createdBody.applicationCase.jobContext.kind !== "private") {
      throw new Error("PRIVATE_INPUT_CASE_CONTEXT_MISSING");
    }
    const snapshotId = createdBody.applicationCase.jobContext.snapshotId;
    const storedSnapshot = await db
      .selectFrom("application.private_job_snapshot_revisions")
      .select(["content_text", "requirements"])
      .where("owner_id", "=", secondSession.context.ownerId)
      .where("snapshot_id", "=", snapshotId)
      .where("content_revision", "=", 1)
      .executeTakeFirstOrThrow();
    expect(storedSnapshot.content_text).toBe(normalizedContent);

    const requirementsResponse = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdBody.applicationCase.id}/requirements`,
      headers,
    });
    expect(requirementsResponse.statusCode).toBe(200);
    const requirements = ApplicationCaseRequirementsSchema.parse(requirementsResponse.json());
    expect(requirements.requirements.length).toBeGreaterThan(0);
    expect(requirements.requirements.map(({ sourceText }) => sourceText)).not.toContain(
      "私有用户研究实习生",
    );
    expect(requirements.requirements.map(({ sourceText }) => sourceText)).not.toContain("职责");
    expect(requirements.requirements.map(({ sourceText }) => sourceText)).not.toContain("要求");
    expect(requirements.requirements).toContainEqual(
      expect.objectContaining({
        kind: "other",
        operator: "unknown",
        sourceText: "具备良好的自驱力",
      }),
    );
    for (const requirement of requirements.requirements) {
      expect(requirement.sourceSpan).not.toBeNull();
      if (requirement.sourceSpan) {
        expect(
          normalizedContent.slice(requirement.sourceSpan.start, requirement.sourceSpan.end),
        ).toBe(requirement.sourceText);
      }
    }

    const replay = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": createKey },
      payload: createRequest,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(createdBody);
    const conflictingReplay = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": createKey },
      payload: {
        ...createRequest,
        jobContext: { ...createRequest.jobContext, title: "不同请求" },
      },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const reused = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `private-reuse-${randomUUID()}` },
      payload: {
        jobContext: {
          ...createRequest.jobContext,
          title: "同一正文的新标题不会覆盖原快照",
          contentText: normalizedContent,
          source: { kind: "referral" },
        },
      },
    });
    expect(reused.statusCode).toBe(200);
    expect(reused.json()).toMatchObject({
      created: false,
      applicationCase: { id: createdBody.applicationCase.id },
    });

    const separate = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `private-separate-${randomUUID()}` },
      payload: {
        jobContext: {
          ...createRequest.jobContext,
          contentText: normalizedContent,
          duplicateHandling: "create_separate",
        },
      },
    });
    expect(separate.statusCode).toBe(201);
    const separateBody = CreateApplicationCaseResponseSchema.parse(separate.json());
    expect(separateBody.applicationCase.id).not.toBe(createdBody.applicationCase.id);
    expect(separateBody.applicationCase.jobContext).toMatchObject({ kind: "private" });
    if (separateBody.applicationCase.jobContext.kind !== "private") {
      throw new Error("SEPARATE_PRIVATE_CONTEXT_MISSING");
    }
    expect(separateBody.applicationCase.jobContext.snapshotId).not.toBe(snapshotId);

    const crossOwner = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: {
        ...sessionHeaders(firstSession),
        "idempotency-key": `private-cross-owner-${randomUUID()}`,
      },
      payload: {
        jobContext: { ...createRequest.jobContext, contentText: normalizedContent },
      },
    });
    expect(crossOwner.statusCode).toBe(201);
    const crossOwnerBody = CreateApplicationCaseResponseSchema.parse(crossOwner.json());
    expect(crossOwnerBody.applicationCase.jobContext).toMatchObject({
      kind: "private",
      ownerId: firstSession.context.ownerId,
    });
    if (crossOwnerBody.applicationCase.jobContext.kind !== "private") {
      throw new Error("CROSS_OWNER_PRIVATE_CONTEXT_MISSING");
    }
    expect(crossOwnerBody.applicationCase.jobContext.snapshotId).not.toBe(snapshotId);

    const concurrentPrivateRequest = {
      jobContext: {
        kind: "private_input" as const,
        title: "并发私有岗位",
        companyName: null,
        contentText: `并发复用正文 ${randomUUID()}`,
        source: { kind: "referral" as const },
        duplicateHandling: "reuse" as const,
      },
    };
    const concurrentPrivateResponses = await Promise.all(
      [randomUUID(), randomUUID()].map((idempotencyKey) =>
        app.inject({
          method: "POST",
          url: "/v1/application-cases",
          headers: { ...headers, "idempotency-key": idempotencyKey },
          payload: concurrentPrivateRequest,
        }),
      ),
    );
    expect(concurrentPrivateResponses.map(({ statusCode }) => statusCode).sort()).toEqual([
      200, 201,
    ]);
    const concurrentPrivateBodies = concurrentPrivateResponses.map((response) =>
      CreateApplicationCaseResponseSchema.parse(response.json()),
    );
    expect(
      new Set(concurrentPrivateBodies.map(({ applicationCase }) => applicationCase.id)).size,
    ).toBe(1);
    expect(
      new Set(
        concurrentPrivateBodies.map(({ applicationCase }) => {
          if (applicationCase.jobContext.kind !== "private") {
            throw new Error("CONCURRENT_PRIVATE_CONTEXT_MISSING");
          }
          return applicationCase.jobContext.snapshotId;
        }),
      ).size,
    ).toBe(1);

    const providedUrl = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `private-url-${randomUUID()}` },
      payload: {
        jobContext: {
          kind: "private_input",
          title: "用户链接岗位",
          companyName: "私有示例公司",
          contentText: "负责产品分析与项目管理。",
          source: { kind: "provided_url", url: "https://private.example.test/job/1" },
          duplicateHandling: "reuse",
        },
      },
    });
    expect(providedUrl.statusCode).toBe(201);
    expect(providedUrl.json()).toMatchObject({
      applicationCase: {
        jobContext: {
          kind: "private",
          officialUrl: "https://private.example.test/job/1",
          sourceProvided: true,
        },
        jobDisplay: {
          source: {
            kind: "owner_private",
            displayName: "用户提供链接，平台未核验",
            verified: false,
          },
        },
      },
    });

    const rollbackKey = `m1-rollback-${randomUUID()}`;
    await sql`
      CREATE FUNCTION application.fail_m1_private_case_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.creation_idempotency_key LIKE 'm1-rollback-%' THEN
          RAISE EXCEPTION 'M1_FORCED_CASE_INSERT_FAILURE';
        END IF;
        RETURN NEW;
      END;
      $$
    `.execute(db);
    await sql`
      CREATE TRIGGER fail_m1_private_case_insert
      BEFORE INSERT ON application.application_cases
      FOR EACH ROW EXECUTE FUNCTION application.fail_m1_private_case_insert()
    `.execute(db);
    try {
      const rolledBack = await app.inject({
        method: "POST",
        url: "/v1/application-cases",
        headers: { ...headers, "idempotency-key": rollbackKey },
        payload: {
          jobContext: {
            kind: "private_input",
            title: "强制回滚岗位",
            companyName: null,
            contentText: `只用于回滚验证 ${randomUUID()}`,
            source: { kind: "unspecified" },
            duplicateHandling: "create_separate",
          },
        },
      });
      expect(rolledBack.statusCode).toBe(500);
    } finally {
      await sql`DROP TRIGGER IF EXISTS fail_m1_private_case_insert ON application.application_cases`.execute(
        db,
      );
      await sql`DROP FUNCTION IF EXISTS application.fail_m1_private_case_insert()`.execute(db);
    }
    const rolledBackSnapshots = await db
      .selectFrom("application.private_job_snapshots")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("owner_id", "=", secondSession.context.ownerId)
      .where("creation_idempotency_key", "=", rollbackKey)
      .executeTakeFirstOrThrow();
    expect(Number(rolledBackSnapshots.count)).toBe(0);

    const publicCountAfter = await db
      .selectFrom("catalog.published_jobs")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();
    expect(Number(publicCountAfter.count)).toBe(Number(publicCountBefore.count));
  }, 30_000);

  it("keeps fixed requirements, evidence and questions in one revisioned Case aggregate", async () => {
    const firstPublic = publicFixtures[0];
    if (!firstPublic) throw new Error("PUBLIC_FIXTURE_MISSING");
    const headers = sessionHeaders(requirementsSession);
    const { [CSRF_HEADER_NAME]: _csrf, ...headersWithoutCsrf } = headers;

    const publicCreated = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `requirements-public-${randomUUID()}` },
      payload: {
        jobContext: {
          kind: "public",
          publishedJobId: firstPublic.jobId,
          publishedJobVersionId: upgradeFixture.versionId,
        },
      },
    });
    expect(publicCreated.statusCode).toBe(201);
    const publicCase = CreateApplicationCaseResponseSchema.parse(publicCreated.json());

    const privateCreated = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `requirements-private-${randomUUID()}` },
      payload: {
        jobContext: {
          kind: "private",
          snapshotId: requirementsPrivateSnapshotId,
          contentRevision: 1,
        },
      },
    });
    expect(privateCreated.statusCode).toBe(201);
    const privateCase = CreateApplicationCaseResponseSchema.parse(privateCreated.json());

    const publicRequirementsResponse = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements`,
      headers,
    });
    expect(publicRequirementsResponse.statusCode).toBe(200);
    expect(publicRequirementsResponse.headers["cache-control"]).toBe("no-store");
    const publicRequirements = ApplicationCaseRequirementsSchema.parse(
      publicRequirementsResponse.json(),
    );
    expect(publicRequirements.requirementContext).toEqual({
      kind: "public",
      requirementSetId: upgradeFixture.requirementSetId,
    });
    expect(publicRequirements.requirements.map(({ id }) => id)).toEqual([
      "requirement-new-sql",
      "requirement-new-project",
    ]);
    expect(publicRequirements.states).toEqual(
      publicRequirements.requirements.map(({ id }) =>
        expect.objectContaining({
          id: null,
          requirementId: id,
          state: "unconfirmed",
          persisted: false,
          revision: null,
        }),
      ),
    );
    const concurrentRequirementReads = await Promise.all(
      Array.from({ length: 12 }, () =>
        app.inject({
          method: "GET",
          url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements`,
          headers,
        }),
      ),
    );
    expect(concurrentRequirementReads.map(({ statusCode }) => statusCode)).toEqual(
      Array.from({ length: 12 }, () => 200),
    );

    const privateRequirementsResponse = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${privateCase.applicationCase.id}/requirements`,
      headers,
    });
    expect(privateRequirementsResponse.statusCode).toBe(200);
    const privateRequirements = ApplicationCaseRequirementsSchema.parse(
      privateRequirementsResponse.json(),
    );
    expect(privateRequirements.requirementContext).toEqual({
      kind: "private",
      requirementSetRevision: 1,
    });
    expect(privateRequirements.requirements.map(({ id }) => id)).toEqual(["private-requirement-1"]);

    const crossOwnerRequirements = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements`,
      headers: sessionHeaders(secondSession),
    });
    const missingRequirements = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${randomUUID()}/requirements`,
      headers,
    });
    expect(crossOwnerRequirements.statusCode).toBe(404);
    expect(crossOwnerRequirements.headers["cache-control"]).toBe("no-store");
    expect(crossOwnerRequirements.json().code).toBe(missingRequirements.json().code);

    const missingStateCsrf = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements/requirement-new-sql`,
      headers: headersWithoutCsrf,
      payload: { expectedRevision: 1, state: "confirmed", userNote: null },
    });
    expect(missingStateCsrf.statusCode).toBe(403);
    const invalidRequirement = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements/not-in-fixed-jd`,
      headers,
      payload: { expectedRevision: 1, state: "confirmed", userNote: null },
    });
    expect(invalidRequirement.statusCode).toBe(422);
    expect(invalidRequirement.json()).toMatchObject({ code: "REQUIREMENT_REFERENCE_INVALID" });

    const stateRequest = {
      expectedRevision: 1,
      state: "confirmed" as const,
      userNote: "已核对项目证据",
    };
    const stateUpdated = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements/requirement-new-sql`,
      headers,
      payload: stateRequest,
    });
    expect(stateUpdated.statusCode).toBe(200);
    const stateMutation = ApplicationCaseMutationResponseSchema.parse(stateUpdated.json());
    expect(stateMutation).toMatchObject({
      caseRevision: 2,
      event: {
        sequence: 2,
        eventType: "requirement_state_changed",
        eventData: {
          schemaVersion: "case-event-v2",
          fromState: null,
          toState: "confirmed",
          noteChanged: true,
        },
      },
    });
    const stateReplay = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements/requirement-new-sql`,
      headers,
      payload: stateRequest,
    });
    expect(stateReplay.json()).toEqual(stateMutation);
    const stateNoop = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements/requirement-new-sql`,
      headers,
      payload: { ...stateRequest, expectedRevision: 2 },
    });
    expect(ApplicationCaseMutationResponseSchema.parse(stateNoop.json())).toEqual({
      caseRevision: 2,
      event: null,
    });
    const noteOnly = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements/requirement-new-sql`,
      headers,
      payload: { ...stateRequest, expectedRevision: 2, userNote: "补充核对说明" },
    });
    expect(noteOnly.statusCode, JSON.stringify(noteOnly.json())).toBe(200);
    expect(ApplicationCaseMutationResponseSchema.parse(noteOnly.json())).toMatchObject({
      caseRevision: 3,
      event: {
        sequence: 3,
        eventType: "requirement_state_changed",
        eventData: {
          fromState: "confirmed",
          toState: "confirmed",
          noteChanged: true,
        },
      },
    });
    const staleOtherRequirement = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements/requirement-new-project`,
      headers,
      payload: { expectedRevision: 2, state: "needs_work", userNote: null },
    });
    expect(staleOtherRequirement.statusCode).toBe(409);
    expect(staleOtherRequirement.json()).toMatchObject({
      code: "APPLICATION_CASE_REVISION_CONFLICT",
    });

    const concurrentStates = await Promise.all([
      app.inject({
        method: "PUT",
        url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements/requirement-new-sql`,
        headers,
        payload: { expectedRevision: 3, state: "needs_work", userNote: null },
      }),
      app.inject({
        method: "PUT",
        url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements/requirement-new-sql`,
        headers,
        payload: { expectedRevision: 3, state: "confirmed", userNote: "并发页面的另一份草稿" },
      }),
    ]);
    expect(concurrentStates.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expect(concurrentStates.find(({ statusCode }) => statusCode === 409)?.json()).toMatchObject({
      code: "APPLICATION_CASE_REVISION_CONFLICT",
    });

    const crossOwnerEvidence = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${privateCase.applicationCase.id}/requirements/private-requirement-1/evidence-links`,
      headers,
      payload: {
        expectedRevision: 1,
        evidenceRevisionId: otherEvidenceRevisionId,
        evidenceIds: ["other-owner-evidence"],
      },
    });
    expect(crossOwnerEvidence.statusCode).toBe(422);
    expect(crossOwnerEvidence.json()).toMatchObject({ code: "EVIDENCE_REFERENCE_INVALID" });
    const unknownEvidence = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${privateCase.applicationCase.id}/requirements/private-requirement-1/evidence-links`,
      headers,
      payload: {
        expectedRevision: 1,
        evidenceRevisionId: requirementsEvidenceRevisionId,
        evidenceIds: ["unknown-evidence"],
      },
    });
    expect(unknownEvidence.statusCode).toBe(422);
    const unconfirmedEvidence = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${privateCase.applicationCase.id}/requirements/private-requirement-1/evidence-links`,
      headers,
      payload: {
        expectedRevision: 1,
        evidenceRevisionId: unconfirmedEvidenceRevisionId,
        evidenceIds: ["unconfirmed-evidence"],
      },
    });
    expect(unconfirmedEvidence.statusCode).toBe(422);
    expect(unconfirmedEvidence.json()).toMatchObject({ code: "EVIDENCE_REFERENCE_INVALID" });
    const duplicateEvidence = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${privateCase.applicationCase.id}/requirements/private-requirement-1/evidence-links`,
      headers,
      payload: {
        expectedRevision: 1,
        evidenceRevisionId: requirementsEvidenceRevisionId,
        evidenceIds: [evidenceIds[0], evidenceIds[0]],
      },
    });
    expect(duplicateEvidence.statusCode).toBe(400);

    const firstLinkRequest = {
      expectedRevision: 1,
      evidenceRevisionId: requirementsEvidenceRevisionId,
      evidenceIds: [evidenceIds[0]],
    };
    const firstLink = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${privateCase.applicationCase.id}/requirements/private-requirement-1/evidence-links`,
      headers,
      payload: firstLinkRequest,
    });
    const firstLinkMutation = ApplicationCaseMutationResponseSchema.parse(firstLink.json());
    expect(firstLinkMutation).toMatchObject({
      caseRevision: 2,
      event: {
        sequence: 2,
        eventType: "requirement_evidence_changed",
        eventData: {
          schemaVersion: "case-event-v2",
          requirementContextKind: "private",
          linkedEvidenceIds: [evidenceIds[0]],
          removedEvidenceIds: [],
        },
      },
    });
    const firstLinkReplay = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${privateCase.applicationCase.id}/requirements/private-requirement-1/evidence-links`,
      headers,
      payload: firstLinkRequest,
    });
    expect(firstLinkReplay.json()).toEqual(firstLinkMutation);
    const linkNoop = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${privateCase.applicationCase.id}/requirements/private-requirement-1/evidence-links`,
      headers,
      payload: { ...firstLinkRequest, expectedRevision: 2 },
    });
    expect(ApplicationCaseMutationResponseSchema.parse(linkNoop.json())).toEqual({
      caseRevision: 2,
      event: null,
    });
    const mixedLink = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${privateCase.applicationCase.id}/requirements/private-requirement-1/evidence-links`,
      headers,
      payload: {
        expectedRevision: 2,
        evidenceRevisionId: requirementsEvidenceRevisionId,
        evidenceIds: [evidenceIds[1]],
      },
    });
    expect(ApplicationCaseMutationResponseSchema.parse(mixedLink.json())).toMatchObject({
      caseRevision: 3,
      event: {
        sequence: 3,
        eventData: {
          linkedEvidenceIds: [evidenceIds[1]],
          removedEvidenceIds: [evidenceIds[0]],
        },
      },
    });
    const clearLinks = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${privateCase.applicationCase.id}/requirements/private-requirement-1/evidence-links`,
      headers,
      payload: {
        expectedRevision: 3,
        evidenceRevisionId: requirementsEvidenceRevisionId,
        evidenceIds: [],
      },
    });
    expect(ApplicationCaseMutationResponseSchema.parse(clearLinks.json())).toMatchObject({
      caseRevision: 4,
      event: { eventData: { linkedEvidenceIds: [], removedEvidenceIds: [evidenceIds[1]] } },
    });
    const relink = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${privateCase.applicationCase.id}/requirements/private-requirement-1/evidence-links`,
      headers,
      payload: {
        expectedRevision: 4,
        evidenceRevisionId: requirementsEvidenceRevisionId,
        evidenceIds: [evidenceIds[0]],
      },
    });
    expect(ApplicationCaseMutationResponseSchema.parse(relink.json())).toMatchObject({
      caseRevision: 5,
      event: { eventData: { linkedEvidenceIds: [evidenceIds[0]], removedEvidenceIds: [] } },
    });
    const privateAfterLinks = ApplicationCaseRequirementsSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/application-cases/${privateCase.applicationCase.id}/requirements`,
          headers,
        })
      ).json(),
    );
    expect(privateAfterLinks).toMatchObject({
      revision: 5,
      states: [
        {
          requirementId: "private-requirement-1",
          state: "unconfirmed",
          persisted: true,
          revision: 2,
        },
      ],
    });
    expect(
      privateAfterLinks.evidenceLinks.map(({ evidenceId, revision, removedAt }) => ({
        evidenceId,
        revision,
        removed: removedAt !== null,
      })),
    ).toEqual([
      { evidenceId: evidenceIds[0], revision: 5, removed: false },
      { evidenceId: evidenceIds[1], revision: 4, removed: true },
    ]);

    const publicAfterStates = ApplicationCaseRequirementsSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements`,
          headers,
        })
      ).json(),
    );
    let publicRevision = publicAfterStates.revision;
    const missingQuestionKey = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions`,
      headers,
      payload: { expectedRevision: publicRevision, question: "岗位是否有明确截止日期？" },
    });
    expect(missingQuestionKey.statusCode).toBe(400);
    const questionKey = `case-question-${randomUUID()}`;
    const questionRequest = {
      expectedRevision: publicRevision,
      question: "岗位是否有明确截止日期？",
    };
    const caseQuestionCreated = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions`,
      headers: { ...headers, "idempotency-key": questionKey },
      payload: questionRequest,
    });
    const caseQuestionMutation = ApplicationCaseMutationResponseSchema.parse(
      caseQuestionCreated.json(),
    );
    expect(caseQuestionMutation.event?.eventType).toBe("question_added");
    expect(caseQuestionMutation.caseRevision).toBe(publicRevision + 1);
    const caseQuestionReplay = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions`,
      headers: { ...headers, "idempotency-key": questionKey },
      payload: questionRequest,
    });
    expect(caseQuestionReplay.json()).toEqual(caseQuestionMutation);
    const questionKeyConflict = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions`,
      headers: { ...headers, "idempotency-key": questionKey },
      payload: { ...questionRequest, question: "同一键不能创建另一个问题" },
    });
    expect(questionKeyConflict.statusCode).toBe(409);
    expect(questionKeyConflict.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    publicRevision = caseQuestionMutation.caseRevision;

    const invalidRequirementQuestion = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions`,
      headers: { ...headers, "idempotency-key": `invalid-question-${randomUUID()}` },
      payload: {
        expectedRevision: publicRevision,
        requirementId: "not-in-fixed-jd",
        question: "无效要求问题",
      },
    });
    expect(invalidRequirementQuestion.statusCode).toBe(422);
    const requirementQuestionCreated = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions`,
      headers: { ...headers, "idempotency-key": `requirement-question-${randomUUID()}` },
      payload: {
        expectedRevision: publicRevision,
        requirementId: "requirement-new-project",
        question: "哪段经历最能证明用户研究能力？",
      },
    });
    const requirementQuestionMutation = ApplicationCaseMutationResponseSchema.parse(
      requirementQuestionCreated.json(),
    );
    if (
      !requirementQuestionMutation.event ||
      requirementQuestionMutation.event.eventType !== "question_added"
    ) {
      throw new Error("REQUIREMENT_QUESTION_EVENT_MISSING");
    }
    const requirementQuestionId = requirementQuestionMutation.event.eventData.questionId;
    publicRevision = requirementQuestionMutation.caseRevision;

    const answered = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions/${requirementQuestionId}`,
      headers,
      payload: { expectedRevision: publicRevision, status: "answered", answer: "项目经历 A" },
    });
    const answeredMutation = ApplicationCaseMutationResponseSchema.parse(answered.json());
    expect(answeredMutation).toMatchObject({
      caseRevision: publicRevision + 1,
      event: {
        eventType: "question_updated",
        eventData: { schemaVersion: "case-event-v2", answerChanged: true },
      },
    });
    publicRevision = answeredMutation.caseRevision;
    const answerNoop = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions/${requirementQuestionId}`,
      headers,
      payload: { expectedRevision: publicRevision, status: "answered", answer: "项目经历 A" },
    });
    expect(ApplicationCaseMutationResponseSchema.parse(answerNoop.json())).toEqual({
      caseRevision: publicRevision,
      event: null,
    });
    const answerEdited = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions/${requirementQuestionId}`,
      headers,
      payload: {
        expectedRevision: publicRevision,
        status: "answered",
        answer: "项目经历 B",
      },
    });
    const answerEditedMutation = ApplicationCaseMutationResponseSchema.parse(answerEdited.json());
    expect(answerEditedMutation.event).toMatchObject({
      eventData: { fromStatus: "answered", toStatus: "answered", answerChanged: true },
    });
    publicRevision = answerEditedMutation.caseRevision;
    const reopenedQuestion = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions/${requirementQuestionId}`,
      headers,
      payload: { expectedRevision: publicRevision, status: "open", answer: null },
    });
    publicRevision = ApplicationCaseMutationResponseSchema.parse(
      reopenedQuestion.json(),
    ).caseRevision;
    const dismissedQuestion = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions/${requirementQuestionId}`,
      headers,
      payload: { expectedRevision: publicRevision, status: "dismissed", answer: null },
    });
    publicRevision = ApplicationCaseMutationResponseSchema.parse(
      dismissedQuestion.json(),
    ).caseRevision;
    const invalidAnswer = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions/${requirementQuestionId}`,
      headers,
      payload: { expectedRevision: publicRevision, status: "answered" },
    });
    expect(invalidAnswer.statusCode).toBe(400);
    const crossOwnerQuestion = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${publicCase.applicationCase.id}/questions/${requirementQuestionId}`,
      headers: sessionHeaders(secondSession),
      payload: { expectedRevision: publicRevision, status: "open", answer: null },
    });
    expect(crossOwnerQuestion.statusCode).toBe(404);

    const publicFinal = ApplicationCaseRequirementsSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/application-cases/${publicCase.applicationCase.id}/requirements`,
          headers,
        })
      ).json(),
    );
    expect(publicFinal.revision).toBe(publicRevision);
    expect(publicFinal.questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requirementId: null, status: "open", answer: null }),
        expect.objectContaining({
          id: requirementQuestionId,
          requirementId: "requirement-new-project",
          status: "dismissed",
          answer: null,
        }),
      ]),
    );

    const privateRows = await db
      .selectFrom("application.case_events")
      .select(["sequence", "schema_version"])
      .where("case_id", "=", privateCase.applicationCase.id)
      .orderBy("sequence")
      .execute();
    expect(privateRows).toEqual([
      { sequence: 1, schema_version: "case-event-v1" },
      { sequence: 2, schema_version: "case-event-v2" },
      { sequence: 3, schema_version: "case-event-v2" },
      { sequence: 4, schema_version: "case-event-v2" },
      { sequence: 5, schema_version: "case-event-v2" },
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
