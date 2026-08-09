import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  CreateResumeDocumentResponseSchema,
  CurrentResumeDocumentSchema,
  LegacyResumeContentConversionSchema,
  ListResumeDocumentContentRevisionsResponseSchema,
  ListResumeDocumentLayoutRevisionsResponseSchema,
  ListResumeDocumentsResponseSchema,
  PutResumeDocumentContentRevisionResponseSchema,
  PutResumeDocumentLayoutRevisionResponseSchema,
  ResumeDocumentSchema,
} from "@aijob/contracts";
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
const unknown = JSON.stringify({ state: "unknown", reason: "source_not_stated" });

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
    identity: { acceptedOrigins: [], alphaInviteCodeHashes: [] },
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

interface ResumeFixture {
  legacyRevisionId: string;
  baseDocumentId: string;
  baseContentRevisionId: string;
  evidenceRevisionId: string;
  evidenceId: string;
  sectionId: string;
  blockId: string;
}

async function seedResumeFixture(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  fixture: ResumeFixture;
  prefix: string;
  includeEvidence: boolean;
}): Promise<void> {
  const confirmedAt = new Date();
  await input.db
    .insertInto("profile.resume_document_revisions")
    .values({
      id: input.fixture.legacyRevisionId,
      owner_id: input.owner.ownerId,
      owner_epoch: input.owner.ownerEpoch,
      resume_analysis_id: null,
      revision: 1,
      base_revision: null,
      schema_version: "resume-document-v1",
      sections: JSON.stringify([
        {
          id: randomUUID(),
          ordinal: 0,
          title: "项目经历",
          blocks: [{ id: randomUUID(), ordinal: 0, text: "Synthetic legacy resume source." }],
        },
      ]),
      content_hash: "1".repeat(64),
      confirmed_at: confirmedAt,
      document_id: null,
      document_revision: null,
      base_document_revision_id: null,
    })
    .execute();
  await input.db
    .insertInto("profile.resume_documents")
    .values({
      id: input.fixture.baseDocumentId,
      owner_id: input.owner.ownerId,
      owner_epoch: input.owner.ownerEpoch,
      kind: "base",
      title: `${input.prefix} base resume`,
      case_id: null,
      detached_from_case_id: null,
      job_context_kind: null,
      published_job_id: null,
      published_job_version_id: null,
      requirement_set_id: null,
      private_job_snapshot_id: null,
      job_context_revision: null,
      base_document_id: null,
      base_document_revision_id: null,
      evidence_revision_id: null,
      current_content_revision_id: null,
      current_layout_revision_id: null,
      revision: 1,
      creation_idempotency_key: `${input.prefix}-fixture-base`,
      creation_request_hash: "2".repeat(64),
      expires_at: null,
      deleted_at: null,
    })
    .execute();
  await input.db
    .insertInto("profile.resume_document_revisions")
    .values({
      id: input.fixture.baseContentRevisionId,
      owner_id: input.owner.ownerId,
      owner_epoch: input.owner.ownerEpoch,
      resume_analysis_id: null,
      revision: 2,
      base_revision: 1,
      schema_version: "resume-content-v1",
      sections: JSON.stringify([
        {
          id: input.fixture.sectionId,
          ordinal: 0,
          title: "项目经历",
          blocks: [
            {
              id: input.fixture.blockId,
              ordinal: 0,
              text: "Synthetic confirmed resume statement.",
              evidenceIds: input.includeEvidence ? [input.fixture.evidenceId] : [],
            },
          ],
        },
      ]),
      content_hash: "3".repeat(64),
      confirmed_at: confirmedAt,
      document_id: input.fixture.baseDocumentId,
      document_revision: 1,
      base_document_revision_id: null,
    })
    .execute();
  await input.db
    .updateTable("profile.resume_documents")
    .set({ current_content_revision_id: input.fixture.baseContentRevisionId })
    .where("id", "=", input.fixture.baseDocumentId)
    .executeTakeFirstOrThrow();

  if (!input.includeEvidence) return;
  await input.db
    .insertInto("profile.resume_evidence_revisions")
    .values({
      id: input.fixture.evidenceRevisionId,
      owner_id: input.owner.ownerId,
      owner_epoch: input.owner.ownerEpoch,
      resume_analysis_id: null,
      revision: 1,
      base_revision: null,
      evidence: JSON.stringify([
        {
          id: input.fixture.evidenceId,
          resumeAnalysisId: null,
          section: "项目经历",
          originalText: "Synthetic confirmed evidence.",
          claim: "Synthetic confirmed evidence claim.",
          skills: ["research"],
          outcomes: [],
          confirmed: true,
        },
      ]),
      content_hash: "4".repeat(64),
      confirmed_at: confirmedAt,
      schema_version: "resume-evidence-v1",
      document_revision_id: null,
    })
    .execute();
}

describeWithDatabase("Resume Document aggregate owner-protected API", () => {
  let app: FastifyInstance;
  let db: Kysely<Database>;
  let mainSession: Awaited<ReturnType<typeof createAnonymousSession>>;
  let otherSession: Awaited<ReturnType<typeof createAnonymousSession>>;
  let noEvidenceSession: Awaited<ReturnType<typeof createAnonymousSession>>;

  const organizationId = randomUUID();
  const sourceId = randomUUID();
  const sourceRecordId = randomUUID();
  const sourceRevisionV1Id = randomUUID();
  const sourceRevisionV2Id = randomUUID();
  const publicJobId = randomUUID();
  const publicVersionV1Id = randomUUID();
  const publicVersionV2Id = randomUUID();
  const publicRequirementV1Id = randomUUID();
  const publicRequirementV2Id = randomUUID();
  const publicCaseId = randomUUID();
  const noEvidenceCaseId = randomUUID();
  const privateSnapshotId = randomUUID();
  const privateSnapshotRevisionId = randomUUID();
  const privateCaseId = randomUUID();

  const mainResume: ResumeFixture = {
    legacyRevisionId: randomUUID(),
    baseDocumentId: randomUUID(),
    baseContentRevisionId: randomUUID(),
    evidenceRevisionId: randomUUID(),
    evidenceId: "main-confirmed-evidence",
    sectionId: randomUUID(),
    blockId: randomUUID(),
  };
  const otherResume: ResumeFixture = {
    legacyRevisionId: randomUUID(),
    baseDocumentId: randomUUID(),
    baseContentRevisionId: randomUUID(),
    evidenceRevisionId: randomUUID(),
    evidenceId: "other-confirmed-evidence",
    sectionId: randomUUID(),
    blockId: randomUUID(),
  };
  const noEvidenceResume: ResumeFixture = {
    legacyRevisionId: randomUUID(),
    baseDocumentId: randomUUID(),
    baseContentRevisionId: randomUUID(),
    evidenceRevisionId: randomUUID(),
    evidenceId: "unused-evidence",
    sectionId: randomUUID(),
    blockId: randomUUID(),
  };

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
    mainSession = await createAnonymousSession({ db });
    otherSession = await createAnonymousSession({ db });
    noEvidenceSession = await createAnonymousSession({ db });

    const sourceUrl = `https://resume-document-${sourceRecordId}.example.test/jobs/1`;
    await db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("source_control.organizations")
        .values({
          id: organizationId,
          slug: `resume-document-${organizationId}`,
          name: "Resume Document Fixture Company",
          official_domain: `resume-document-${organizationId}.example.test`,
        })
        .execute();
      await transaction
        .insertInto("source_control.sources")
        .values({
          id: sourceId,
          organization_id: organizationId,
          source_candidate_id: null,
          source_key: `resume-document-${sourceId}`,
          source_type: "organization_career_site",
          name: "Resume Document Fixture Source",
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
          adapter_key: "resume-document-fixture",
          adapter_version: "1",
          entrypoints: JSON.stringify([sourceUrl]),
          crawl_interval: "24h",
          policy_notes: "Offline Resume Document API fixture.",
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
      await transaction
        .insertInto("ingestion.source_job_records")
        .values({
          id: sourceRecordId,
          source_id: sourceId,
          source_job_id: `resume-document-${sourceRecordId}`,
          canonical_source_url: sourceUrl,
          first_seen_at: new Date(),
          last_seen_at: new Date(),
        })
        .execute();

      for (const [index, revisionId] of [sourceRevisionV1Id, sourceRevisionV2Id].entries()) {
        await transaction
          .insertInto("ingestion.source_job_revisions")
          .values({
            id: revisionId,
            source_job_record_id: sourceRecordId,
            revision_content_hash: String(index + 5).repeat(64),
            import_mode: "manual",
            adapter_version: String(index + 1),
            normalizer_version: "1",
            company_name: "Resume Document Fixture Company",
            title: `Synthetic product internship v${index + 1}`,
            job_family: JSON.stringify({
              state: "known",
              value: "product",
              evidenceRefs: [`${revisionId}#family`],
            }),
            locations: JSON.stringify({
              state: "known",
              value: ["Shanghai"],
              evidenceRefs: [`${revisionId}#location`],
            }),
            business_groups: JSON.stringify([]),
            entry_scope: "internship",
            source_project_name: null,
            recruit_label_name: "internship",
            recruitment_type: JSON.stringify({
              state: "known",
              value: "internship",
              evidenceRefs: [`${revisionId}#type`],
            }),
            responsibilities: `Synthetic responsibilities v${index + 1}.`,
            requirements: `Synthetic requirements v${index + 1}.`,
            structured_fields: JSON.stringify({}),
            ingestion_state: "validated",
            publication_state: "published",
            activity_state: "active",
            source_url: sourceUrl,
            apply_url: `${sourceUrl}/apply`,
            quality_flags: JSON.stringify([]),
          })
          .execute();
      }
      await transaction
        .insertInto("catalog.published_jobs")
        .values({ id: publicJobId, current_version_id: null, public_version_id: null })
        .execute();

      for (const version of [
        {
          id: publicVersionV1Id,
          sourceRevisionId: sourceRevisionV1Id,
          requirementSetId: publicRequirementV1Id,
          hash: "a".repeat(64),
          title: "Synthetic product internship v1",
        },
        {
          id: publicVersionV2Id,
          sourceRevisionId: sourceRevisionV2Id,
          requirementSetId: publicRequirementV2Id,
          hash: "b".repeat(64),
          title: "Synthetic product internship v2",
        },
      ]) {
        await transaction
          .insertInto("catalog.published_job_versions")
          .values({
            id: version.id,
            published_job_id: publicJobId,
            source_job_revision_id: version.sourceRevisionId,
            content_hash: version.hash,
            company_name: "Resume Document Fixture Company",
            title: version.title,
            job_family: JSON.stringify({ state: "known", value: "product", evidenceRefs: [] }),
            locations: unknown,
            responsibilities: `${version.title} responsibilities.`,
            requirements: `${version.title} requirements.`,
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
            id: version.requirementSetId,
            published_job_version_id: version.id,
            schema_version: "resume-document-fixture-v1",
            requirements: JSON.stringify([]),
            content_hash: version.hash,
          })
          .execute();
        await transaction
          .updateTable("catalog.published_job_versions")
          .set({ active_requirement_set_id: version.requirementSetId })
          .where("id", "=", version.id)
          .execute();
      }
      await transaction
        .updateTable("catalog.published_jobs")
        .set({ current_version_id: publicVersionV2Id, public_version_id: publicVersionV2Id })
        .where("id", "=", publicJobId)
        .execute();

      await transaction
        .insertInto("application.private_job_snapshots")
        .values({
          id: privateSnapshotId,
          owner_id: mainSession.context.ownerId,
          owner_epoch: mainSession.context.ownerEpoch,
          current_content_revision: null,
          current_requirement_set_revision: null,
          creation_idempotency_key: `private-snapshot-${privateSnapshotId}`,
          creation_request_hash: "c".repeat(64),
          deleted_at: null,
        })
        .execute();
      await transaction
        .insertInto("application.private_job_snapshot_revisions")
        .values({
          id: privateSnapshotRevisionId,
          owner_id: mainSession.context.ownerId,
          owner_epoch: mainSession.context.ownerEpoch,
          snapshot_id: privateSnapshotId,
          content_revision: 1,
          requirement_set_revision: 1,
          title: "Private synthetic AI internship",
          company_name: "Private Fixture Company",
          source_label: "用户私有岗位",
          official_url: "https://private-job.example.test/apply",
          source_provided: true,
          content_text: "Synthetic private JD content.",
          requirements: JSON.stringify([]),
          content_hash: "d".repeat(64),
        })
        .execute();
      await transaction
        .updateTable("application.private_job_snapshots")
        .set({ current_content_revision: 1, current_requirement_set_revision: 1 })
        .where("id", "=", privateSnapshotId)
        .execute();

      await transaction
        .insertInto("application.application_cases")
        .values([
          {
            id: publicCaseId,
            owner_id: mainSession.context.ownerId,
            owner_epoch: mainSession.context.ownerEpoch,
            job_context_kind: "public",
            published_job_id: publicJobId,
            published_job_version_id: publicVersionV1Id,
            requirement_set_id: publicRequirementV1Id,
            private_job_snapshot_id: null,
            job_context_revision: 1,
            stage: "interested",
            outcome: null,
            revision: 1,
            creation_idempotency_key: `public-case-${publicCaseId}`,
            creation_request_hash: "e".repeat(64),
            expires_at: null,
            ended_at: null,
            deleted_at: null,
          },
          {
            id: privateCaseId,
            owner_id: mainSession.context.ownerId,
            owner_epoch: mainSession.context.ownerEpoch,
            job_context_kind: "private",
            published_job_id: null,
            published_job_version_id: null,
            requirement_set_id: null,
            private_job_snapshot_id: privateSnapshotId,
            job_context_revision: 1,
            stage: "preparing",
            outcome: null,
            revision: 1,
            creation_idempotency_key: `private-case-${privateCaseId}`,
            creation_request_hash: "f".repeat(64),
            expires_at: null,
            ended_at: null,
            deleted_at: null,
          },
          {
            id: noEvidenceCaseId,
            owner_id: noEvidenceSession.context.ownerId,
            owner_epoch: noEvidenceSession.context.ownerEpoch,
            job_context_kind: "public",
            published_job_id: publicJobId,
            published_job_version_id: publicVersionV1Id,
            requirement_set_id: publicRequirementV1Id,
            private_job_snapshot_id: null,
            job_context_revision: 1,
            stage: "interested",
            outcome: null,
            revision: 1,
            creation_idempotency_key: `no-evidence-case-${noEvidenceCaseId}`,
            creation_request_hash: "0".repeat(64),
            expires_at: null,
            ended_at: null,
            deleted_at: null,
          },
        ])
        .execute();
    });

    await seedResumeFixture({
      db,
      owner: mainSession.context,
      fixture: mainResume,
      prefix: `main-${mainSession.context.ownerId}`,
      includeEvidence: true,
    });
    await seedResumeFixture({
      db,
      owner: otherSession.context,
      fixture: otherResume,
      prefix: `other-${otherSession.context.ownerId}`,
      includeEvidence: true,
    });
    await seedResumeFixture({
      db,
      owner: noEvidenceSession.context,
      fixture: noEvidenceResume,
      prefix: `no-evidence-${noEvidenceSession.context.ownerId}`,
      includeEvidence: false,
    });

    app = buildApp({ config: config(), db });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    const ownerIds = [
      mainSession?.context.ownerId,
      otherSession?.context.ownerId,
      noEvidenceSession?.context.ownerId,
    ].filter((ownerId): ownerId is string => Boolean(ownerId));
    if (ownerIds.length > 0) {
      await db
        .deleteFrom("profile.resume_documents")
        .where("owner_id", "in", ownerIds)
        .where("kind", "=", "case_derived")
        .execute();
      await db.deleteFrom("profile.resume_documents").where("owner_id", "in", ownerIds).execute();
      await db
        .deleteFrom("profile.resume_evidence_revisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db
        .deleteFrom("profile.resume_document_revisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db.deleteFrom("application.case_events").where("owner_id", "in", ownerIds).execute();
      await db
        .deleteFrom("application.application_cases")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db
        .updateTable("application.private_job_snapshots")
        .set({ current_content_revision: null, current_requirement_set_revision: null })
        .where("owner_id", "in", ownerIds)
        .execute();
      await db
        .deleteFrom("application.private_job_snapshots")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db.deleteFrom("identity.owner_sessions").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owners").where("id", "in", ownerIds).execute();
    }

    await db
      .updateTable("catalog.published_jobs")
      .set({ current_version_id: null, public_version_id: null })
      .where("id", "=", publicJobId)
      .execute();
    await db
      .updateTable("catalog.published_job_versions")
      .set({ active_requirement_set_id: null })
      .where("id", "in", [publicVersionV1Id, publicVersionV2Id])
      .execute();
    await db
      .deleteFrom("catalog.job_requirement_sets")
      .where("id", "in", [publicRequirementV1Id, publicRequirementV2Id])
      .execute();
    await db
      .deleteFrom("catalog.published_job_versions")
      .where("id", "in", [publicVersionV1Id, publicVersionV2Id])
      .execute();
    await db.deleteFrom("catalog.published_jobs").where("id", "=", publicJobId).execute();
    await db
      .deleteFrom("ingestion.source_job_revisions")
      .where("id", "in", [sourceRevisionV1Id, sourceRevisionV2Id])
      .execute();
    await db.deleteFrom("ingestion.source_job_records").where("id", "=", sourceRecordId).execute();
    await db
      .deleteFrom("source_control.source_runtime_states")
      .where("source_id", "=", sourceId)
      .execute();
    await db
      .deleteFrom("source_control.source_policy_versions")
      .where("source_id", "=", sourceId)
      .execute();
    await db.deleteFrom("source_control.sources").where("id", "=", sourceId).execute();
    await db.deleteFrom("source_control.organizations").where("id", "=", organizationId).execute();
    await db?.destroy();
  });

  it("creates base documents idempotently and lists only V2 aggregates with a stable cursor", async () => {
    const headers = sessionHeaders(mainSession);
    const idempotencyKey = `resume-base-${randomUUID()}`;
    const request = {
      method: "POST" as const,
      url: "/v1/resume-documents",
      headers: { ...headers, "idempotency-key": idempotencyKey },
      payload: { kind: "base", title: "并发创建的基础简历" },
    };
    const [first, replay] = await Promise.all([app.inject(request), app.inject(request)]);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(first.headers["cache-control"]).toBe("no-store");
    const firstBody = CreateResumeDocumentResponseSchema.parse(first.json());
    const replayBody = CreateResumeDocumentResponseSchema.parse(replay.json());
    expect(firstBody).toEqual(replayBody);
    expect(firstBody.resumeDocument).toMatchObject({
      kind: "base",
      title: "并发创建的基础简历",
      ownerId: mainSession.context.ownerId,
      ownerEpoch: mainSession.context.ownerEpoch,
      currentContentRevisionId: null,
      currentLayoutRevisionId: null,
      expiresAt: null,
    });

    const conflict = await app.inject({
      ...request,
      payload: { kind: "base", title: "复用请求编号但内容不同" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/v1/resume-documents",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        cookie: `${SESSION_COOKIE_NAME}=${mainSession.sessionToken}; ${CSRF_COOKIE_NAME}=${mainSession.csrfToken}`,
        "idempotency-key": `missing-csrf-${randomUUID()}`,
      },
      payload: { kind: "base", title: "缺少 CSRF" },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const additionalDocuments: Array<{ id: string; key: string; title: string }> = [];
    for (const title of ["第二份基础简历", "待删除基础简历"]) {
      const key = `resume-base-${randomUUID()}`;
      const response = await app.inject({
        method: "POST",
        url: "/v1/resume-documents",
        headers: { ...headers, "idempotency-key": key },
        payload: { kind: "base", title },
      });
      expect(response.statusCode).toBe(201);
      const body = CreateResumeDocumentResponseSchema.parse(response.json());
      additionalDocuments.push({ id: body.resumeDocument.id, key, title });
    }

    const tiedUpdatedAt = new Date(Date.now() + 60_000);
    await db
      .updateTable("profile.resume_documents")
      .set({ updated_at: tiedUpdatedAt })
      .where("owner_id", "=", mainSession.context.ownerId)
      .where("deleted_at", "is", null)
      .execute();

    const pageOneResponse = await app.inject({
      method: "GET",
      url: "/v1/resume-documents?limit=2",
      headers,
    });
    expect(pageOneResponse.statusCode).toBe(200);
    expect(pageOneResponse.headers["cache-control"]).toBe("no-store");
    const pageOne = ListResumeDocumentsResponseSchema.parse(pageOneResponse.json());
    expect(pageOne.items).toHaveLength(2);
    expect(pageOne.nextCursor).not.toBeNull();
    expect(pageOne.legacySource).toMatchObject({
      legacySourceRevisionId: mainResume.legacyRevisionId,
      ownerId: mainSession.context.ownerId,
      ownerEpoch: mainSession.context.ownerEpoch,
      readOnly: true,
      migratedDocumentId: null,
    });
    expect(pageOne.items.map((item) => item.id)).not.toContain(mainResume.legacyRevisionId);

    const basePageResponse = await app.inject({
      method: "GET",
      url: "/v1/resume-documents?kind=base&limit=1",
      headers,
    });
    expect(basePageResponse.statusCode).toBe(200);
    const basePage = ListResumeDocumentsResponseSchema.parse(basePageResponse.json());
    expect(basePage.items).toHaveLength(1);
    expect(basePage.items[0]?.kind).toBe("base");
    expect(basePage.nextCursor).not.toBeNull();
    const crossFilterCursor = await app.inject({
      method: "GET",
      url: `/v1/resume-documents?kind=case_derived&cursor=${encodeURIComponent(basePage.nextCursor ?? "")}`,
      headers,
    });
    expect(crossFilterCursor.statusCode).toBe(400);
    expect(crossFilterCursor.json()).toMatchObject({ code: "INVALID_RESUME_DOCUMENT_CURSOR" });
    const invalidBaseCaseFilter = await app.inject({
      method: "GET",
      url: `/v1/resume-documents?kind=base&caseId=${publicCaseId}`,
      headers,
    });
    expect(invalidBaseCaseFilter.statusCode).toBe(400);

    const pageTwoResponse = await app.inject({
      method: "GET",
      url: `/v1/resume-documents?limit=2&cursor=${encodeURIComponent(pageOne.nextCursor ?? "")}`,
      headers,
    });
    expect(pageTwoResponse.statusCode).toBe(200);
    const pageTwo = ListResumeDocumentsResponseSchema.parse(pageTwoResponse.json());
    expect(pageTwo.items).toHaveLength(2);
    expect(pageTwo.nextCursor).toBeNull();
    expect(new Set([...pageOne.items, ...pageTwo.items].map((item) => item.id)).size).toBe(4);

    const invalidCursor = await app.inject({
      method: "GET",
      url: "/v1/resume-documents?cursor=not-a-cursor",
      headers,
    });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidCursor.json()).toMatchObject({ code: "INVALID_RESUME_DOCUMENT_CURSOR" });

    const ownDetail = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${mainResume.baseDocumentId}`,
      headers,
    });
    expect(ownDetail.statusCode).toBe(200);
    expect(ResumeDocumentSchema.parse(ownDetail.json()).id).toBe(mainResume.baseDocumentId);

    const crossOwner = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${otherResume.baseDocumentId}`,
      headers,
    });
    expect(crossOwner.statusCode).toBe(404);
    expect(crossOwner.json()).toMatchObject({ code: "RESUME_DOCUMENT_NOT_FOUND" });

    const deletedFixture = additionalDocuments.find((item) => item.title === "待删除基础简历");
    if (!deletedFixture) throw new Error("DELETED_DOCUMENT_FIXTURE_MISSING");
    const deletedAt = new Date(Date.now() + 120_000);
    await db
      .updateTable("profile.resume_documents")
      .set({ deleted_at: deletedAt, updated_at: deletedAt })
      .where("id", "=", deletedFixture.id)
      .executeTakeFirstOrThrow();
    const deletedDetail = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${deletedFixture.id}`,
      headers,
    });
    expect(deletedDetail.statusCode).toBe(404);
    const deletedReplay = await app.inject({
      method: "POST",
      url: "/v1/resume-documents",
      headers: { ...headers, "idempotency-key": deletedFixture.key },
      payload: { kind: "base", title: deletedFixture.title },
    });
    expect(deletedReplay.statusCode).toBe(410);
    expect(deletedReplay.json()).toMatchObject({ code: "RESUME_DOCUMENT_DELETED" });
  });

  it("creates public and private Case-derived documents from same-owner pinned inputs", async () => {
    const mainHeaders = sessionHeaders(mainSession);
    const staleCaseRevision = await app.inject({
      method: "POST",
      url: "/v1/resume-documents",
      headers: { ...mainHeaders, "idempotency-key": `stale-case-${randomUUID()}` },
      payload: {
        kind: "case_derived",
        caseId: privateCaseId,
        baseDocumentRevisionId: mainResume.baseContentRevisionId,
        expectedCaseRevision: 99,
        title: "过期 Case revision 不得产生空壳",
      },
    });
    expect(staleCaseRevision.statusCode).toBe(409);
    expect(staleCaseRevision.json()).toMatchObject({
      code: "APPLICATION_CASE_REVISION_CONFLICT",
    });
    const documentsAfterStaleWrite = await db
      .selectFrom("profile.resume_documents")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("owner_id", "=", mainSession.context.ownerId)
      .where("case_id", "=", privateCaseId)
      .executeTakeFirstOrThrow();
    expect(Number(documentsAfterStaleWrite.count)).toBe(0);

    const crossOwnerBase = await app.inject({
      method: "POST",
      url: "/v1/resume-documents",
      headers: { ...mainHeaders, "idempotency-key": `cross-owner-base-${randomUUID()}` },
      payload: {
        kind: "case_derived",
        caseId: privateCaseId,
        baseDocumentRevisionId: otherResume.baseContentRevisionId,
        expectedCaseRevision: 1,
        title: "不得使用其他 owner 的基础简历",
      },
    });
    expect(crossOwnerBase.statusCode).toBe(422);
    expect(crossOwnerBase.json()).toMatchObject({ code: "RESUME_BASE_REVISION_INVALID" });

    const noEvidence = await app.inject({
      method: "POST",
      url: "/v1/resume-documents",
      headers: {
        ...sessionHeaders(noEvidenceSession),
        "idempotency-key": `no-evidence-${randomUUID()}`,
      },
      payload: {
        kind: "case_derived",
        caseId: noEvidenceCaseId,
        baseDocumentRevisionId: noEvidenceResume.baseContentRevisionId,
        expectedCaseRevision: 1,
        title: "没有已确认证据时不得创建",
      },
    });
    expect(noEvidence.statusCode).toBe(409);
    expect(noEvidence.json()).toMatchObject({ code: "RESUME_EVIDENCE_REQUIRED" });

    const publicRequests = [randomUUID(), randomUUID()].map((idempotencyKey) =>
      app.inject({
        method: "POST",
        url: "/v1/resume-documents",
        headers: { ...mainHeaders, "idempotency-key": idempotencyKey },
        payload: {
          kind: "case_derived",
          caseId: publicCaseId,
          baseDocumentRevisionId: mainResume.baseContentRevisionId,
          expectedCaseRevision: 1,
          title: "岗位定制简历",
        },
      }),
    );
    const publicResponses = await Promise.all(publicRequests);
    expect(publicResponses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(publicResponses.find((response) => response.statusCode === 409)?.json()).toMatchObject({
      code: "APPLICATION_CASE_REVISION_CONFLICT",
    });
    const publicCreatedResponse = publicResponses.find((response) => response.statusCode === 201);
    if (!publicCreatedResponse) throw new Error("PUBLIC_DERIVED_RESUME_NOT_CREATED");
    const publicCreated = CreateResumeDocumentResponseSchema.parse(publicCreatedResponse.json());
    expect(publicCreated.resumeDocument).toMatchObject({
      kind: "case_derived",
      caseId: publicCaseId,
      baseDocumentId: mainResume.baseDocumentId,
      baseDocumentRevisionId: mainResume.baseContentRevisionId,
      evidenceRevisionId: mainResume.evidenceRevisionId,
      revision: 1,
      currentContentRevisionId: expect.any(String),
      currentLayoutRevisionId: expect.any(String),
      jobContext: {
        kind: "public",
        publishedJobId: publicJobId,
        publishedJobVersionId: publicVersionV1Id,
        requirementSetId: publicRequirementV1Id,
        officialUrl: expect.stringContaining("/apply"),
      },
    });
    const initialContentResponse = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/revisions`,
      headers: mainHeaders,
    });
    expect(initialContentResponse.statusCode).toBe(200);
    const initialContent = ListResumeDocumentContentRevisionsResponseSchema.parse(
      initialContentResponse.json(),
    );
    expect(initialContent.current).toMatchObject({
      id: publicCreated.resumeDocument.currentContentRevisionId,
      documentRevision: 1,
      baseDocumentRevisionId: null,
      content: {
        sections: [
          {
            id: mainResume.sectionId,
            blocks: [
              {
                id: mainResume.blockId,
                text: "Synthetic confirmed resume statement.",
                evidenceIds: [mainResume.evidenceId],
              },
            ],
          },
        ],
      },
    });
    if (!initialContent.current) throw new Error("DERIVED_INITIAL_CONTENT_MISSING");
    const initialLayoutResponse = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/layout-revisions`,
      headers: mainHeaders,
    });
    expect(initialLayoutResponse.statusCode).toBe(200);
    expect(
      ListResumeDocumentLayoutRevisionsResponseSchema.parse(initialLayoutResponse.json()).current,
    ).toMatchObject({
      id: publicCreated.resumeDocument.currentLayoutRevisionId,
      layoutRevision: 1,
      templateKey: "cn_classic_single_column",
      sectionOrder: [mainResume.sectionId],
      settings: {
        fontSizeToken: "standard",
        lineSpacingToken: "standard",
        sectionSpacingToken: "standard",
        colorToken: "charcoal",
        pageBreakPolicy: "keep_sections",
      },
    });
    const publicCaseAfterDerivation = await db
      .selectFrom("application.application_cases")
      .select("revision")
      .where("id", "=", publicCaseId)
      .executeTakeFirstOrThrow();
    expect(Number(publicCaseAfterDerivation.revision)).toBe(2);
    const publicDerivedEvent = await db
      .selectFrom("application.case_events")
      .select(["sequence", "event_type", "event_data"])
      .where("case_id", "=", publicCaseId)
      .where("event_type", "=", "resume_document_derived")
      .executeTakeFirstOrThrow();
    expect(publicDerivedEvent).toMatchObject({
      sequence: 2,
      event_type: "resume_document_derived",
      event_data: {
        schemaVersion: "case-event-v1",
        documentId: publicCreated.resumeDocument.id,
        contentRevisionId: initialContent.current.id,
      },
    });
    const catalogPointer = await db
      .selectFrom("catalog.published_jobs")
      .select("public_version_id")
      .where("id", "=", publicJobId)
      .executeTakeFirstOrThrow();
    expect(catalogPointer.public_version_id).toBe(publicVersionV2Id);

    const derivedContent = {
      schemaVersion: "resume-content-v1" as const,
      sections: [
        {
          id: mainResume.sectionId,
          ordinal: 0,
          title: "项目经历",
          blocks: [
            {
              id: mainResume.blockId,
              ordinal: 0,
              text: "Synthetic statement tailored for the fixed public job version.",
              evidenceIds: [mainResume.evidenceId],
            },
          ],
        },
      ],
    };
    const initializedDerived = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/revisions`,
      headers: {
        ...mainHeaders,
        "idempotency-key": `initialize-public-derived-${randomUUID()}`,
      },
      payload: {
        expectedRevision: 1,
        baseDocumentRevisionId: initialContent.current.id,
        content: derivedContent,
      },
    });
    expect(initializedDerived.statusCode, JSON.stringify(initializedDerived.json())).toBe(201);
    const initializedDerivedBody = PutResumeDocumentContentRevisionResponseSchema.parse(
      initializedDerived.json(),
    );
    expect(initializedDerivedBody).toMatchObject({
      documentRevision: 2,
      contentRevision: {
        documentRevision: 2,
        baseDocumentRevisionId: initialContent.current.id,
        content: derivedContent,
      },
    });
    const initializedDerivedDocument = ResumeDocumentSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/resume-documents/${publicCreated.resumeDocument.id}`,
          headers: mainHeaders,
        })
      ).json(),
    );
    expect(initializedDerivedDocument).toMatchObject({
      revision: 2,
      currentContentRevisionId: initializedDerivedBody.contentRevision.id,
      currentLayoutRevisionId: expect.any(String),
      baseDocumentRevisionId: mainResume.baseContentRevisionId,
      evidenceRevisionId: mainResume.evidenceRevisionId,
    });

    const invalidPinnedEvidence = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/revisions`,
      headers: {
        ...mainHeaders,
        "idempotency-key": `invalid-derived-evidence-${randomUUID()}`,
      },
      payload: {
        expectedRevision: 2,
        baseDocumentRevisionId: initializedDerivedBody.contentRevision.id,
        content: {
          ...derivedContent,
          sections: derivedContent.sections.map((section) => ({
            ...section,
            blocks: section.blocks.map((block) => ({
              ...block,
              text: `${block.text} changed`,
              evidenceIds: ["not-confirmed-in-pinned-revision"],
            })),
          })),
        },
      },
    });
    expect(invalidPinnedEvidence.statusCode).toBe(422);
    expect(invalidPinnedEvidence.json()).toMatchObject({
      code: "RESUME_EVIDENCE_REFERENCE_INVALID",
    });

    const privateKey = `private-derived-${randomUUID()}`;
    const privateCreatedResponse = await app.inject({
      method: "POST",
      url: "/v1/resume-documents",
      headers: { ...mainHeaders, "idempotency-key": privateKey },
      payload: {
        kind: "case_derived",
        caseId: privateCaseId,
        baseDocumentRevisionId: mainResume.baseContentRevisionId,
        expectedCaseRevision: 1,
        title: "私有岗位定制简历",
      },
    });
    expect(privateCreatedResponse.statusCode).toBe(201);
    expect(privateCreatedResponse.headers["cache-control"]).toBe("no-store");
    const privateCreated = CreateResumeDocumentResponseSchema.parse(privateCreatedResponse.json());
    expect(privateCreated.resumeDocument).toMatchObject({
      kind: "case_derived",
      caseId: privateCaseId,
      baseDocumentId: mainResume.baseDocumentId,
      baseDocumentRevisionId: mainResume.baseContentRevisionId,
      evidenceRevisionId: mainResume.evidenceRevisionId,
      jobContext: {
        kind: "private",
        snapshotId: privateSnapshotId,
        ownerId: mainSession.context.ownerId,
        title: "Private synthetic AI internship",
        companyName: "Private Fixture Company",
        sourceLabel: "用户私有岗位",
        officialUrl: "https://private-job.example.test/apply",
        contentRevision: 1,
        requirementSetRevision: 1,
        sourceProvided: true,
      },
    });

    const privateReplayResponse = await app.inject({
      method: "POST",
      url: "/v1/resume-documents",
      headers: { ...mainHeaders, "idempotency-key": privateKey },
      payload: {
        kind: "case_derived",
        caseId: privateCaseId,
        baseDocumentRevisionId: mainResume.baseContentRevisionId,
        expectedCaseRevision: 1,
        title: "私有岗位定制简历",
      },
    });
    expect(privateReplayResponse.statusCode).toBe(201);
    expect(CreateResumeDocumentResponseSchema.parse(privateReplayResponse.json())).toEqual(
      privateCreated,
    );

    const duplicateCaseResume = await app.inject({
      method: "POST",
      url: "/v1/resume-documents",
      headers: { ...mainHeaders, "idempotency-key": `duplicate-case-${randomUUID()}` },
      payload: {
        kind: "case_derived",
        caseId: privateCaseId,
        baseDocumentRevisionId: mainResume.baseContentRevisionId,
        expectedCaseRevision: 2,
        title: "第二份私有岗位简历",
      },
    });
    expect(duplicateCaseResume.statusCode).toBe(409);
    expect(duplicateCaseResume.json()).toMatchObject({
      code: "RESUME_DOCUMENT_FOR_CASE_EXISTS",
    });

    const publicCaseDocuments = await app.inject({
      method: "GET",
      url: `/v1/resume-documents?kind=case_derived&caseId=${publicCaseId}`,
      headers: mainHeaders,
    });
    expect(publicCaseDocuments.statusCode).toBe(200);
    expect(ListResumeDocumentsResponseSchema.parse(publicCaseDocuments.json())).toMatchObject({
      items: [{ id: publicCreated.resumeDocument.id, caseId: publicCaseId }],
      nextCursor: null,
      legacySource: null,
    });
    const baseDocuments = await app.inject({
      method: "GET",
      url: "/v1/resume-documents?kind=base",
      headers: mainHeaders,
    });
    expect(baseDocuments.statusCode).toBe(200);
    expect(
      ListResumeDocumentsResponseSchema.parse(baseDocuments.json()).items.every(
        (item) => item.kind === "base",
      ),
    ).toBe(true);

    const storedReferences = await db
      .selectFrom("profile.resume_documents")
      .select([
        "id",
        "case_id",
        "job_context_kind",
        "published_job_version_id",
        "private_job_snapshot_id",
        "base_document_revision_id",
        "evidence_revision_id",
      ])
      .where("owner_id", "=", mainSession.context.ownerId)
      .where("kind", "=", "case_derived")
      .orderBy("id")
      .execute();
    expect(storedReferences).toHaveLength(2);
    expect(storedReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          case_id: publicCaseId,
          job_context_kind: "public",
          published_job_version_id: publicVersionV1Id,
          base_document_revision_id: mainResume.baseContentRevisionId,
          evidence_revision_id: mainResume.evidenceRevisionId,
        }),
        expect.objectContaining({
          case_id: privateCaseId,
          job_context_kind: "private",
          private_job_snapshot_id: privateSnapshotId,
          base_document_revision_id: mainResume.baseContentRevisionId,
          evidence_revision_id: mainResume.evidenceRevisionId,
        }),
      ]),
    );

    const crossOwnerRead = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${privateCreated.resumeDocument.id}`,
      headers: sessionHeaders(otherSession),
    });
    expect(crossOwnerRead.statusCode).toBe(404);
  });

  it("converts legacy V1 without writes and appends immutable base content/layout revisions", async () => {
    const headers = sessionHeaders(mainSession);
    const beforeConversionCount = await db
      .selectFrom("profile.resume_document_revisions")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("owner_id", "=", mainSession.context.ownerId)
      .executeTakeFirstOrThrow();
    const conversionResponse = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/legacy-source/${mainResume.legacyRevisionId}`,
      headers,
    });
    expect(conversionResponse.statusCode).toBe(200);
    expect(conversionResponse.headers["cache-control"]).toBe("no-store");
    const conversion = LegacyResumeContentConversionSchema.parse(conversionResponse.json());
    expect(conversion).toMatchObject({
      legacySource: {
        legacySourceRevisionId: mainResume.legacyRevisionId,
        ownerId: mainSession.context.ownerId,
        ownerEpoch: mainSession.context.ownerEpoch,
        readOnly: true,
        migratedDocumentId: null,
      },
      content: { schemaVersion: "resume-content-v1" },
    });
    expect(
      conversion.content.sections.flatMap((section) =>
        section.blocks.flatMap((block) => block.evidenceIds),
      ),
    ).toEqual([]);
    const afterConversionCount = await db
      .selectFrom("profile.resume_document_revisions")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("owner_id", "=", mainSession.context.ownerId)
      .executeTakeFirstOrThrow();
    expect(Number(afterConversionCount.count)).toBe(Number(beforeConversionCount.count));

    const crossOwnerLegacy = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/legacy-source/${mainResume.legacyRevisionId}`,
      headers: sessionHeaders(otherSession),
    });
    expect(crossOwnerLegacy.statusCode).toBe(404);
    expect(crossOwnerLegacy.json()).toMatchObject({ code: "LEGACY_RESUME_SOURCE_NOT_FOUND" });

    const baseCreate = await app.inject({
      method: "POST",
      url: "/v1/resume-documents",
      headers: { ...headers, "idempotency-key": `revision-base-${randomUUID()}` },
      payload: { kind: "base", title: "由旧版简历初始化的基础简历" },
    });
    expect(baseCreate.statusCode).toBe(201);
    const baseDocument = CreateResumeDocumentResponseSchema.parse(baseCreate.json()).resumeDocument;
    const firstContent = {
      ...conversion.content,
      sections: conversion.content.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => ({
          ...block,
          text: `${block.text}（用户确认后的首版）`,
        })),
      })),
    };
    const firstContentKey = `first-content-${randomUUID()}`;
    const firstContentRequest = {
      method: "POST" as const,
      url: `/v1/resume-documents/${baseDocument.id}/revisions`,
      headers: { ...headers, "idempotency-key": firstContentKey },
      payload: {
        expectedRevision: 0,
        legacySourceRevisionId: mainResume.legacyRevisionId,
        content: firstContent,
      },
    };
    const missingCsrf = await app.inject({
      ...firstContentRequest,
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        cookie: `${SESSION_COOKIE_NAME}=${mainSession.sessionToken}; ${CSRF_COOKIE_NAME}=${mainSession.csrfToken}`,
        "idempotency-key": `missing-csrf-${randomUUID()}`,
      },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const [firstWrite, firstReplay] = await Promise.all([
      app.inject(firstContentRequest),
      app.inject(firstContentRequest),
    ]);
    expect(firstWrite.statusCode, JSON.stringify(firstWrite.json())).toBe(201);
    expect(firstReplay.statusCode, JSON.stringify(firstReplay.json())).toBe(201);
    expect(firstWrite.headers["cache-control"]).toBe("no-store");
    const firstWriteBody = PutResumeDocumentContentRevisionResponseSchema.parse(firstWrite.json());
    expect(PutResumeDocumentContentRevisionResponseSchema.parse(firstReplay.json())).toEqual(
      firstWriteBody,
    );
    expect(firstWriteBody).toMatchObject({
      documentRevision: 2,
      contentRevision: {
        documentId: baseDocument.id,
        documentRevision: 1,
        baseDocumentRevisionId: null,
        content: firstContent,
      },
    });

    const initializedDocumentResponse = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${baseDocument.id}`,
      headers,
    });
    const initializedDocument = ResumeDocumentSchema.parse(initializedDocumentResponse.json());
    expect(initializedDocument).toMatchObject({
      revision: 2,
      currentContentRevisionId: firstWriteBody.contentRevision.id,
      currentLayoutRevisionId: expect.any(String),
    });
    const migratedSourcePage = ListResumeDocumentsResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/v1/resume-documents?kind=base",
          headers,
        })
      ).json(),
    );
    expect(migratedSourcePage.legacySource?.migratedDocumentId).toBe(baseDocument.id);
    const migratedConversion = LegacyResumeContentConversionSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/resume-documents/legacy-source/${mainResume.legacyRevisionId}`,
          headers,
        })
      ).json(),
    );
    expect(migratedConversion.legacySource.migratedDocumentId).toBe(baseDocument.id);
    const firstLayoutPage = ListResumeDocumentLayoutRevisionsResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/resume-documents/${baseDocument.id}/layout-revisions`,
          headers,
        })
      ).json(),
    );
    expect(firstLayoutPage).toMatchObject({
      documentRevision: 2,
      currentLayoutRevisionId: initializedDocument.currentLayoutRevisionId,
      current: {
        schemaVersion: "resume-layout-v2",
        layoutRevision: 1,
        templateKey: "cn_classic_single_column",
        sectionOrder: firstContent.sections.map((section) => section.id),
      },
    });

    const legacyProfileDocument = CurrentResumeDocumentSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/v1/profile/document",
          headers,
        })
      ).json(),
    );
    expect(legacyProfileDocument.document?.id).toBe(mainResume.legacyRevisionId);
    expect(legacyProfileDocument.document?.schemaVersion).toBe("resume-document-v1");

    const changedReplay = await app.inject({
      ...firstContentRequest,
      payload: {
        ...firstContentRequest.payload,
        content: {
          ...firstContent,
          sections: firstContent.sections.map((section) => ({
            ...section,
            title: `${section.title} changed`,
          })),
        },
      },
    });
    expect(changedReplay.statusCode).toBe(409);
    expect(changedReplay.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const noOp = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${baseDocument.id}/revisions`,
      headers: { ...headers, "idempotency-key": `content-no-op-${randomUUID()}` },
      payload: {
        expectedRevision: 2,
        baseDocumentRevisionId: firstWriteBody.contentRevision.id,
        content: firstContent,
      },
    });
    expect(noOp.statusCode).toBe(409);
    expect(noOp.json()).toMatchObject({ code: "RESUME_CONTENT_UNCHANGED" });

    const secondContent = {
      ...firstContent,
      sections: firstContent.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => ({
          ...block,
          text: `${block.text} 第二次明确编辑`,
        })),
      })),
    };
    const secondWrite = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${baseDocument.id}/revisions`,
      headers: { ...headers, "idempotency-key": `second-content-${randomUUID()}` },
      payload: {
        expectedRevision: 2,
        baseDocumentRevisionId: firstWriteBody.contentRevision.id,
        content: secondContent,
      },
    });
    expect(secondWrite.statusCode, JSON.stringify(secondWrite.json())).toBe(201);
    const secondWriteBody = PutResumeDocumentContentRevisionResponseSchema.parse(
      secondWrite.json(),
    );
    expect(secondWriteBody).toMatchObject({
      documentRevision: 3,
      contentRevision: {
        documentRevision: 2,
        baseDocumentRevisionId: firstWriteBody.contentRevision.id,
      },
    });

    const concurrentRequests = ["A", "B"].map((suffix) =>
      app.inject({
        method: "POST",
        url: `/v1/resume-documents/${baseDocument.id}/revisions`,
        headers: { ...headers, "idempotency-key": `concurrent-content-${suffix}-${randomUUID()}` },
        payload: {
          expectedRevision: 3,
          baseDocumentRevisionId: secondWriteBody.contentRevision.id,
          content: {
            ...secondContent,
            sections: secondContent.sections.map((section) => ({
              ...section,
              blocks: section.blocks.map((block) => ({
                ...block,
                text: `${block.text} 并发版本 ${suffix}`,
              })),
            })),
          },
        },
      }),
    );
    const concurrentResponses = await Promise.all(concurrentRequests);
    expect(concurrentResponses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const concurrentWinner = concurrentResponses.find((response) => response.statusCode === 201);
    const concurrentLoser = concurrentResponses.find((response) => response.statusCode === 409);
    if (!concurrentWinner || !concurrentLoser)
      throw new Error("CONTENT_CONCURRENCY_RESULT_MISSING");
    const concurrentWinnerBody = PutResumeDocumentContentRevisionResponseSchema.parse(
      concurrentWinner.json(),
    );
    expect(concurrentWinnerBody.documentRevision).toBe(4);
    expect(concurrentLoser.json()).toMatchObject({
      code: "RESUME_DOCUMENT_REVISION_CONFLICT",
    });

    const addedSectionId = randomUUID();
    const structuralContent = {
      ...concurrentWinnerBody.contentRevision.content,
      sections: [
        ...concurrentWinnerBody.contentRevision.content.sections,
        {
          id: addedSectionId,
          ordinal: 1,
          title: "技能",
          blocks: [
            {
              id: randomUUID(),
              ordinal: 0,
              text: "Synthetic user-confirmed skill section.",
              evidenceIds: [],
            },
          ],
        },
      ],
    };
    const structuralWrite = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${baseDocument.id}/revisions`,
      headers: { ...headers, "idempotency-key": `structural-content-${randomUUID()}` },
      payload: {
        expectedRevision: 4,
        baseDocumentRevisionId: concurrentWinnerBody.contentRevision.id,
        content: structuralContent,
      },
    });
    expect(structuralWrite.statusCode, JSON.stringify(structuralWrite.json())).toBe(201);
    const structuralWriteBody = PutResumeDocumentContentRevisionResponseSchema.parse(
      structuralWrite.json(),
    );
    expect(structuralWriteBody).toMatchObject({
      documentRevision: 5,
      contentRevision: {
        documentRevision: 4,
        baseDocumentRevisionId: concurrentWinnerBody.contentRevision.id,
        content: structuralContent,
      },
    });
    const rebasedLayoutPage = ListResumeDocumentLayoutRevisionsResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/resume-documents/${baseDocument.id}/layout-revisions`,
          headers,
        })
      ).json(),
    );
    expect(rebasedLayoutPage.current).toMatchObject({
      layoutRevision: 2,
      baseLayoutRevision: 1,
      sectionOrder: structuralContent.sections.map((section) => section.id),
    });

    const pageOne = ListResumeDocumentContentRevisionsResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/resume-documents/${baseDocument.id}/revisions?limit=1`,
          headers,
        })
      ).json(),
    );
    expect(pageOne).toMatchObject({
      documentRevision: 5,
      currentContentRevisionId: structuralWriteBody.contentRevision.id,
      current: { id: structuralWriteBody.contentRevision.id, documentRevision: 4 },
    });
    expect(pageOne.items).toHaveLength(1);
    expect(pageOne.nextBeforeRevision).toBe(4);
    const pageTwo = ListResumeDocumentContentRevisionsResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/resume-documents/${baseDocument.id}/revisions?limit=1&beforeRevision=${pageOne.nextBeforeRevision}`,
          headers,
        })
      ).json(),
    );
    expect(pageTwo.items[0]?.documentRevision).toBe(3);

    const sectionOrder = structuralContent.sections.map((section) => section.id);
    const layoutSettings = {
      schemaVersion: "resume-layout-settings-v1" as const,
      fontSizeToken: "compact" as const,
      lineSpacingToken: "tight" as const,
      sectionSpacingToken: "tight" as const,
      colorToken: "navy" as const,
      pageBreakPolicy: "compact_to_fit" as const,
    };
    const invalidLayout = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${baseDocument.id}/layout-revisions`,
      headers: { ...headers, "idempotency-key": `invalid-layout-${randomUUID()}` },
      payload: {
        expectedRevision: 5,
        templateKey: "cn_compact_technical",
        sectionOrder: [],
        settings: layoutSettings,
      },
    });
    expect(invalidLayout.statusCode).toBe(422);
    expect(invalidLayout.json()).toMatchObject({ code: "RESUME_LAYOUT_SECTION_ORDER_INVALID" });

    const layoutKey = `layout-change-${randomUUID()}`;
    const layoutRequest = {
      method: "POST" as const,
      url: `/v1/resume-documents/${baseDocument.id}/layout-revisions`,
      headers: { ...headers, "idempotency-key": layoutKey },
      payload: {
        expectedRevision: 5,
        templateKey: "cn_compact_technical",
        sectionOrder,
        settings: layoutSettings,
      },
    };
    const layoutWrite = await app.inject(layoutRequest);
    expect(layoutWrite.statusCode, JSON.stringify(layoutWrite.json())).toBe(201);
    expect(layoutWrite.headers["cache-control"]).toBe("no-store");
    const layoutWriteBody = PutResumeDocumentLayoutRevisionResponseSchema.parse(layoutWrite.json());
    expect(layoutWriteBody).toMatchObject({
      documentRevision: 6,
      layoutRevision: {
        layoutRevision: 3,
        baseLayoutRevision: 2,
        templateKey: "cn_compact_technical",
        sectionOrder,
        settings: layoutSettings,
      },
    });
    const layoutReplay = await app.inject(layoutRequest);
    expect(layoutReplay.statusCode).toBe(201);
    expect(PutResumeDocumentLayoutRevisionResponseSchema.parse(layoutReplay.json())).toEqual(
      layoutWriteBody,
    );
    const layoutKeyConflict = await app.inject({
      ...layoutRequest,
      payload: {
        ...layoutRequest.payload,
        settings: { ...layoutSettings, colorToken: "black" },
      },
    });
    expect(layoutKeyConflict.statusCode).toBe(409);
    expect(layoutKeyConflict.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const layoutNoOp = await app.inject({
      ...layoutRequest,
      headers: { ...headers, "idempotency-key": `layout-no-op-${randomUUID()}` },
      payload: { ...layoutRequest.payload, expectedRevision: 6 },
    });
    expect(layoutNoOp.statusCode).toBe(409);
    expect(layoutNoOp.json()).toMatchObject({ code: "RESUME_LAYOUT_UNCHANGED" });

    const layoutPage = ListResumeDocumentLayoutRevisionsResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/resume-documents/${baseDocument.id}/layout-revisions`,
          headers,
        })
      ).json(),
    );
    expect(layoutPage.items).toHaveLength(3);
    expect(layoutPage.currentLayoutRevisionId).toBe(layoutWriteBody.layoutRevision.id);

    const duplicateBaseResponse = await app.inject({
      method: "POST",
      url: "/v1/resume-documents",
      headers: { ...headers, "idempotency-key": `duplicate-legacy-base-${randomUUID()}` },
      payload: { kind: "base", title: "不得成为第二个旧版真源" },
    });
    const duplicateBase = CreateResumeDocumentResponseSchema.parse(
      duplicateBaseResponse.json(),
    ).resumeDocument;
    const duplicateLegacy = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${duplicateBase.id}/revisions`,
      headers: { ...headers, "idempotency-key": `duplicate-legacy-${randomUUID()}` },
      payload: {
        expectedRevision: 0,
        legacySourceRevisionId: mainResume.legacyRevisionId,
        content: conversion.content,
      },
    });
    expect(duplicateLegacy.statusCode).toBe(409);
    expect(duplicateLegacy.json()).toMatchObject({
      code: "LEGACY_RESUME_SOURCE_ALREADY_MIGRATED",
    });

    const crossOwnerHistory = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${baseDocument.id}/revisions`,
      headers: sessionHeaders(otherSession),
    });
    expect(crossOwnerHistory.statusCode).toBe(404);

    const laterLegacySectionId = randomUUID();
    const laterLegacyBlockId = randomUUID();
    const laterLegacyWrite = await app.inject({
      method: "PUT",
      url: "/v1/profile/evidence",
      headers,
      payload: {
        expectedRevision: 1,
        resumeAnalysisId: null,
        document: {
          schemaVersion: "resume-document-v1",
          sections: [
            {
              id: laterLegacySectionId,
              ordinal: 0,
              title: "兼容旧页面",
              blocks: [
                {
                  id: laterLegacyBlockId,
                  ordinal: 0,
                  text: "Synthetic legacy write after V2 revisions.",
                },
              ],
            },
          ],
        },
        evidence: [],
      },
    });
    expect(laterLegacyWrite.statusCode, JSON.stringify(laterLegacyWrite.json())).toBe(200);
    const latestLegacyAfterV2 = CurrentResumeDocumentSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/v1/profile/document",
          headers,
        })
      ).json(),
    );
    expect(latestLegacyAfterV2.document).toMatchObject({
      schemaVersion: "resume-document-v1",
      baseRevision: 1,
      sections: [
        expect.objectContaining({
          id: laterLegacySectionId,
          blocks: [expect.objectContaining({ id: laterLegacyBlockId })],
        }),
      ],
    });
    expect(latestLegacyAfterV2.document?.id).not.toBe(mainResume.legacyRevisionId);

    const tombstonedResponse = await app.inject({
      method: "POST",
      url: "/v1/resume-documents",
      headers: { ...headers, "idempotency-key": `tombstoned-revision-base-${randomUUID()}` },
      payload: { kind: "base", title: "修订墓碑回归" },
    });
    const tombstoned = CreateResumeDocumentResponseSchema.parse(
      tombstonedResponse.json(),
    ).resumeDocument;
    const deletedAt = new Date(Date.now() + 120_000);
    await db
      .updateTable("profile.resume_documents")
      .set({ deleted_at: deletedAt, updated_at: deletedAt })
      .where("id", "=", tombstoned.id)
      .executeTakeFirstOrThrow();
    const tombstonedHistory = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${tombstoned.id}/revisions`,
      headers,
    });
    expect(tombstonedHistory.statusCode).toBe(404);

    await expect(
      db
        .updateTable("profile.resume_document_revisions")
        .set({ content_hash: "f".repeat(64) })
        .where("id", "=", structuralWriteBody.contentRevision.id)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_PROFILE_REVISION");
    await expect(
      db
        .updateTable("profile.resume_layout_revisions")
        .set({ content_hash: "e".repeat(64) })
        .where("id", "=", layoutWriteBody.layoutRevision.id)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_PROFILE_REVISION");
  });
});
