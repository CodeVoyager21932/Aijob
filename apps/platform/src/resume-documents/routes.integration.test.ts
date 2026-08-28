import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  ApplicationCaseCommandResponseSchema,
  ApplicationCaseMutationResponseSchema,
  ApplicationCaseRequirementsSchema,
  ApplicationCaseWithJobContextSchema,
  CareerDataScopeResponseSchema,
  ConfirmCaseDebriefResponseSchema,
  CreateApplicationCaseResponseSchema,
  CreateInterviewSessionResponseSchema,
  CreateResumeDocumentResponseSchema,
  CreateResumeReviewResponseSchema,
  CurrentResumeDocumentSchema,
  CurrentResumeReviewResponseSchema,
  DeleteApplicationCaseResponseSchema,
  DecideResumeReviewSuggestionResponseSchema,
  DeleteResumeDocumentResponseSchema,
  GetCaseDebriefResponseSchema,
  PrepareCaseDebriefResponseSchema,
  ProfileDeletionSchema,
  LegacyResumeContentConversionSchema,
  ListResumeDocumentContentRevisionsResponseSchema,
  ListResumeDocumentLayoutRevisionsResponseSchema,
  ListResumeDocumentsResponseSchema,
  PutResumeDocumentContentRevisionResponseSchema,
  PutResumeDocumentLayoutRevisionResponseSchema,
  ResumeDocumentSchema,
  ResumeEvidenceRevisionSchema,
  SubmitInterviewAnswerResponseSchema,
} from "@aijob/contracts";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from "../identity/fastify.js";
import {
  createAnonymousSession,
  findActiveSession,
  type OwnerContext,
} from "../identity/session-repository.js";
import { DELETION_RECEIPT_COOKIE_NAME } from "../profile/routes.js";
import { runOneOwnerTask } from "../workers/owner-task-worker.js";

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
    resumeReviewV2WriteEnabled: true,
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

interface M4CompleteFlowCandidate {
  caseId: string;
  resumeDocumentId: string;
  resumeDocumentRevision: number;
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
  let publicCaseId = "";
  let m4Candidate: M4CompleteFlowCandidate | null = null;
  let ownerDeletionId: string | null = null;
  const publicRequirementItemV1Id = "m4-public-requirement-research";
  const privateRequirementItemId = "m4-private-requirement-evidence";
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
            requirements: JSON.stringify(
              version.id === publicVersionV1Id
                ? [
                    {
                      id: publicRequirementItemV1Id,
                      kind: "experience",
                      operator: "contains",
                      expectedValue: ["user research"],
                      sourceText: "Complete a synthetic user-research project.",
                      evidenceRefs: [`${version.sourceRevisionId}#requirements`],
                      sourceSpan: { start: 0, end: 43, excerptHash: "1".repeat(64) },
                      necessity: "required",
                    },
                  ]
                : [
                    {
                      id: "m4-public-requirement-delivery",
                      kind: "experience",
                      operator: "contains",
                      expectedValue: ["product delivery"],
                      sourceText: "Complete a synthetic product-delivery project.",
                      evidenceRefs: [`${version.sourceRevisionId}#requirements`],
                      sourceSpan: { start: 0, end: 46, excerptHash: "2".repeat(64) },
                      necessity: "required",
                    },
                  ],
            ),
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
        .set({ current_version_id: publicVersionV1Id, public_version_id: publicVersionV1Id })
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
          requirements: JSON.stringify([
            {
              id: privateRequirementItemId,
              kind: "experience",
              operator: "contains",
              expectedValue: ["Synthetic confirmed evidence"],
              sourceText: "Synthetic confirmed evidence is required.",
              evidenceRefs: [`${privateSnapshotRevisionId}#requirements`],
              sourceSpan: null,
              necessity: "required",
            },
          ]),
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
      await db.deleteFrom("task_queue.tasks").where("owner_id", "in", ownerIds).execute();
      await db
        .deleteFrom("application.debrief_item_decisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db
        .deleteFrom("application.debrief_confirmations")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db.deleteFrom("application.debriefs").where("owner_id", "in", ownerIds).execute();
      await db
        .deleteFrom("application.interview_feedback")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db
        .deleteFrom("application.interview_turns")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db
        .deleteFrom("application.interview_sessions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db
        .deleteFrom("profile.resume_review_decisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db
        .deleteFrom("profile.resume_review_suggestions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db
        .deleteFrom("profile.resume_review_findings")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db.deleteFrom("profile.resume_review_runs").where("owner_id", "in", ownerIds).execute();
      await db
        .deleteFrom("profile.resume_documents")
        .where("owner_id", "in", ownerIds)
        .where("kind", "=", "case_derived")
        .execute();
      await db.deleteFrom("profile.resume_documents").where("owner_id", "in", ownerIds).execute();
      await db
        .deleteFrom("application.case_requirement_evidence_links")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db.deleteFrom("application.case_questions").where("owner_id", "in", ownerIds).execute();
      await db
        .deleteFrom("application.case_requirement_states")
        .where("owner_id", "in", ownerIds)
        .execute();
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
      await db.deleteFrom("decision.job_decisions").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owner_sessions").where("owner_id", "in", ownerIds).execute();
      if (ownerDeletionId) {
        await db
          .deleteFrom("decision_feedback_audit.audit_events")
          .where("subject_id", "=", ownerDeletionId)
          .execute();
      }
      await db.deleteFrom("decision.owner_deletions").where("owner_id", "in", ownerIds).execute();
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
    const createPublicCaseRequest = {
      jobContext: {
        kind: "public" as const,
        publishedJobId: publicJobId,
        publishedJobVersionId: publicVersionV1Id,
      },
    };
    const createdPublicCaseResponse = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...mainHeaders, "idempotency-key": `m4-public-case-${randomUUID()}` },
      payload: createPublicCaseRequest,
    });
    expect(
      createdPublicCaseResponse.statusCode,
      JSON.stringify(createdPublicCaseResponse.json()),
    ).toBe(201);
    const createdPublicCase = CreateApplicationCaseResponseSchema.parse(
      createdPublicCaseResponse.json(),
    );
    expect(createdPublicCase.created).toBe(true);
    publicCaseId = createdPublicCase.applicationCase.id;
    expect(createdPublicCase.applicationCase).toMatchObject({
      revision: 1,
      jobContext: {
        kind: "public",
        publishedJobId: publicJobId,
        publishedJobVersionId: publicVersionV1Id,
        requirementSetId: publicRequirementV1Id,
      },
      jobDisplay: { title: "Synthetic product internship v1" },
    });

    const reopenedPublicCaseResponse = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...mainHeaders, "idempotency-key": `m4-public-case-reopen-${randomUUID()}` },
      payload: createPublicCaseRequest,
    });
    expect(reopenedPublicCaseResponse.statusCode).toBe(200);
    expect(CreateApplicationCaseResponseSchema.parse(reopenedPublicCaseResponse.json())).toEqual({
      applicationCase: createdPublicCase.applicationCase,
      created: false,
    });

    await db
      .updateTable("catalog.published_jobs")
      .set({ current_version_id: publicVersionV2Id, public_version_id: publicVersionV2Id })
      .where("id", "=", publicJobId)
      .executeTakeFirstOrThrow();
    const pinnedPublicCase = ApplicationCaseWithJobContextSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/application-cases/${publicCaseId}`,
          headers: mainHeaders,
        })
      ).json(),
    );
    expect(pinnedPublicCase).toMatchObject({
      id: publicCaseId,
      jobContext: { publishedJobVersionId: publicVersionV1Id },
      jobDisplay: { title: "Synthetic product internship v1" },
    });

    const pinnedEvidenceResponse = await app.inject({
      method: "GET",
      url: `/v1/profile/evidence/${mainResume.evidenceRevisionId}`,
      headers: mainHeaders,
    });
    expect(pinnedEvidenceResponse.statusCode).toBe(200);
    expect(pinnedEvidenceResponse.headers["cache-control"]).toBe("no-store");
    expect(ResumeEvidenceRevisionSchema.parse(pinnedEvidenceResponse.json())).toMatchObject({
      id: mainResume.evidenceRevisionId,
      ownerId: mainSession.context.ownerId,
    });

    const crossOwnerPinnedEvidence = await app.inject({
      method: "GET",
      url: `/v1/profile/evidence/${mainResume.evidenceRevisionId}`,
      headers: sessionHeaders(otherSession),
    });
    expect(crossOwnerPinnedEvidence.statusCode).toBe(404);
    expect(crossOwnerPinnedEvidence.json()).toMatchObject({
      code: "RESUME_EVIDENCE_REVISION_NOT_FOUND",
    });

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
    if (!initializedDerivedDocument.currentLayoutRevisionId) {
      throw new Error("DERIVED_CURRENT_LAYOUT_MISSING");
    }
    const docxExportUrl =
      `/v1/resume-documents/${publicCreated.resumeDocument.id}/docx?` +
      new URLSearchParams({
        contentRevisionId: initializedDerivedBody.contentRevision.id,
        layoutRevisionId: initializedDerivedDocument.currentLayoutRevisionId,
      }).toString();
    const docxExport = await app.inject({
      method: "GET",
      url: docxExportUrl,
      headers: mainHeaders,
    });
    expect(docxExport.statusCode).toBe(200);
    expect(docxExport.headers["cache-control"]).toBe("no-store");
    expect(docxExport.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(docxExport.headers["content-disposition"]).toContain("Aijob-");
    expect(docxExport.rawPayload.subarray(0, 2).toString()).toBe("PK");

    const staleDocxExport = await app.inject({
      method: "GET",
      url:
        `/v1/resume-documents/${publicCreated.resumeDocument.id}/docx?` +
        new URLSearchParams({
          contentRevisionId: initialContent.current.id,
          layoutRevisionId: initializedDerivedDocument.currentLayoutRevisionId,
        }).toString(),
      headers: mainHeaders,
    });
    expect(staleDocxExport.statusCode).toBe(409);
    expect(staleDocxExport.json()).toMatchObject({
      code: "RESUME_DOCUMENT_EXPORT_REVISION_STALE",
    });

    const crossOwnerDocxExport = await app.inject({
      method: "GET",
      url: docxExportUrl,
      headers: sessionHeaders(otherSession),
    });
    expect(crossOwnerDocxExport.statusCode).toBe(404);

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

    const emptyReviewResponse = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/review`,
      headers: mainHeaders,
    });
    expect(emptyReviewResponse.statusCode).toBe(200);
    const emptyReview = CurrentResumeReviewResponseSchema.parse(emptyReviewResponse.json());
    expect(emptyReview.review).toBeNull();
    expect(emptyReview.requirements.map(({ id }) => id)).toEqual([publicRequirementItemV1Id]);

    const publicReviewKey = `public-review-${randomUUID()}`;
    const publicReviewRequest = {
      method: "POST" as const,
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/reviews`,
      headers: { ...mainHeaders, "idempotency-key": publicReviewKey },
      payload: { expectedRevision: 2, mode: "template" },
    };
    const publicReviewCreatedResponse = await app.inject(publicReviewRequest);
    expect(
      publicReviewCreatedResponse.statusCode,
      JSON.stringify(publicReviewCreatedResponse.json()),
    ).toBe(202);
    expect(publicReviewCreatedResponse.headers["cache-control"]).toBe("no-store");
    const publicReviewCreated = CreateResumeReviewResponseSchema.parse(
      publicReviewCreatedResponse.json(),
    );
    expect(publicReviewCreated).toMatchObject({
      created: true,
      review: {
        reviewRun: {
          schemaVersion: "resume-review-run-v2",
          documentId: publicCreated.resumeDocument.id,
          contentRevisionId: initializedDerivedBody.contentRevision.id,
          evidenceRevisionId: mainResume.evidenceRevisionId,
          status: "pending",
          mode: "template",
          jobContext: { kind: "public", publishedJobVersionId: publicVersionV1Id },
          promptVersion: null,
          outputSchemaVersion: null,
          safetyPolicyVersion: null,
          parametersVersion: null,
        },
        findings: [],
        suggestions: [],
        decisions: [],
      },
    });
    const publicReviewReplayResponse = await app.inject(publicReviewRequest);
    expect(publicReviewReplayResponse.statusCode).toBe(200);
    expect(CreateResumeReviewResponseSchema.parse(publicReviewReplayResponse.json())).toMatchObject(
      {
        created: false,
        review: { reviewRun: { id: publicReviewCreated.review.reviewRun.id } },
      },
    );
    const queuedReviewTask = await db
      .selectFrom("task_queue.tasks")
      .select(["task_type", "status", "payload"])
      .where("owner_id", "=", mainSession.context.ownerId)
      .where("task_type", "=", "resume_review_v2")
      .where("payload", "@>", JSON.stringify({ runId: publicReviewCreated.review.reviewRun.id }))
      .executeTakeFirstOrThrow();
    expect(queuedReviewTask).toMatchObject({ task_type: "resume_review_v2", status: "queued" });
    expect(await runOneOwnerTask({ db, config: config(), workerId: "review-worker-public" })).toBe(
      true,
    );

    const publicReviewCompleted = CurrentResumeReviewResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/review`,
          headers: mainHeaders,
        })
      ).json(),
    );
    expect(publicReviewCompleted.review?.reviewRun.status).toBe("completed");
    expect(publicReviewCompleted.review?.reviewRun).toMatchObject({
      schemaVersion: "resume-review-run-v2",
      mode: "template",
      providerAdapter: null,
      model: null,
      usedTemplateFallback: false,
      fallbackReasonCode: null,
      failureCode: null,
    });
    expect(publicReviewCompleted.requirements.map(({ id }) => id)).toEqual([
      publicRequirementItemV1Id,
    ]);
    expect(publicReviewCompleted.review?.findings).toHaveLength(1);
    expect(publicReviewCompleted.review?.suggestions).toHaveLength(1);
    const publicSuggestion = publicReviewCompleted.review?.suggestions[0];
    if (!publicSuggestion) throw new Error("PUBLIC_REVIEW_SUGGESTION_MISSING");
    expect(publicSuggestion).toMatchObject({
      targetIds: [mainResume.blockId],
      changeType: "rewrite_block",
      evidenceIds: [mainResume.evidenceId],
      requirementIds: [publicRequirementItemV1Id],
      decision: "pending",
      revision: 1,
    });

    const acceptDecisionId = randomUUID();
    const acceptDecisionRequest = {
      method: "POST" as const,
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/reviews/${publicReviewCreated.review.reviewRun.id}/suggestions/${publicSuggestion.id}/decisions`,
      headers: mainHeaders,
      payload: {
        expectedRevision: publicSuggestion.revision,
        idempotencyKey: acceptDecisionId,
        decision: "accepted",
      },
    };
    const acceptedResponse = await app.inject(acceptDecisionRequest);
    expect(acceptedResponse.statusCode, JSON.stringify(acceptedResponse.json())).toBe(200);
    const accepted = DecideResumeReviewSuggestionResponseSchema.parse(acceptedResponse.json());
    expect(accepted).toMatchObject({
      decision: {
        decision: "accepted",
        resultContentRevisionId: expect.any(String),
      },
      suggestion: { decision: "accepted", revision: 2 },
      documentRevision: 3,
      contentRevision: {
        documentRevision: 3,
        content: {
          sections: [
            {
              blocks: [
                {
                  id: mainResume.blockId,
                  text: publicSuggestion.suggestedText,
                  evidenceIds: [mainResume.evidenceId],
                },
              ],
            },
          ],
        },
      },
    });
    const acceptedReplay = await app.inject(acceptDecisionRequest);
    expect(acceptedReplay.statusCode).toBe(200);
    expect(DecideResumeReviewSuggestionResponseSchema.parse(acceptedReplay.json())).toEqual(
      accepted,
    );
    const changedDecisionReplay = await app.inject({
      ...acceptDecisionRequest,
      payload: {
        expectedRevision: publicSuggestion.revision,
        idempotencyKey: acceptDecisionId,
        decision: "rejected",
        reasonCode: "USER_KEPT_ORIGINAL",
      },
    });
    expect(changedDecisionReplay.statusCode).toBe(409);
    expect(changedDecisionReplay.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const privateReviewCreatedResponse = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${privateCreated.resumeDocument.id}/reviews`,
      headers: { ...mainHeaders, "idempotency-key": `private-review-${randomUUID()}` },
      payload: { expectedRevision: 1, mode: "template" },
    });
    expect(privateReviewCreatedResponse.statusCode).toBe(202);
    const privateReviewCreated = CreateResumeReviewResponseSchema.parse(
      privateReviewCreatedResponse.json(),
    );
    expect(await runOneOwnerTask({ db, config: config(), workerId: "review-worker-private" })).toBe(
      true,
    );
    const privateReviewCompleted = CurrentResumeReviewResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/resume-documents/${privateCreated.resumeDocument.id}/review`,
          headers: mainHeaders,
        })
      ).json(),
    );
    expect(privateReviewCompleted.requirements.map(({ id }) => id)).toEqual([
      privateRequirementItemId,
    ]);
    const privateSuggestion = privateReviewCompleted.review?.suggestions[0];
    if (!privateSuggestion) throw new Error("PRIVATE_REVIEW_SUGGESTION_MISSING");
    if (privateSuggestion.schemaVersion !== "resume-review-suggestion-v2") {
      throw new Error("PRIVATE_REVIEW_SUGGESTION_NOT_V2");
    }
    expect(privateSuggestion.requirementIds).toEqual([privateRequirementItemId]);
    const editedResponse = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${privateCreated.resumeDocument.id}/reviews/${privateReviewCreated.review.reviewRun.id}/suggestions/${privateSuggestion.id}/decisions`,
      headers: mainHeaders,
      payload: {
        expectedRevision: privateSuggestion.revision,
        idempotencyKey: randomUUID(),
        decision: "edited",
        editedText: "用户确认后的岗位表达",
        evidenceIds: [mainResume.evidenceId],
      },
    });
    expect(editedResponse.statusCode, JSON.stringify(editedResponse.json())).toBe(200);
    const edited = DecideResumeReviewSuggestionResponseSchema.parse(editedResponse.json());
    expect(edited).toMatchObject({
      decision: { decision: "edited", editedText: "用户确认后的岗位表达" },
      suggestion: { decision: "edited", revision: 2 },
      contentRevision: {
        content: {
          sections: [{ blocks: [{ text: "用户确认后的岗位表达" }] }],
        },
      },
    });

    if (!accepted.contentRevision) throw new Error("ACCEPTED_CONTENT_REVISION_MISSING");
    const manuallyEditedPublic = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/revisions`,
      headers: { ...mainHeaders, "idempotency-key": `manual-public-${randomUUID()}` },
      payload: {
        expectedRevision: accepted.documentRevision,
        baseDocumentRevisionId: accepted.contentRevision.id,
        content: {
          ...accepted.contentRevision.content,
          sections: accepted.contentRevision.content.sections.map((section) => ({
            ...section,
            blocks: section.blocks.map((block) => ({
              ...block,
              text: "用户保留的原始表达",
            })),
          })),
        },
      },
    });
    expect(manuallyEditedPublic.statusCode).toBe(201);
    const manuallyEditedPublicBody = PutResumeDocumentContentRevisionResponseSchema.parse(
      manuallyEditedPublic.json(),
    );
    const rejectedReviewResponse = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/reviews`,
      headers: { ...mainHeaders, "idempotency-key": `reject-review-${randomUUID()}` },
      payload: { expectedRevision: manuallyEditedPublicBody.documentRevision, mode: "template" },
    });
    expect(rejectedReviewResponse.statusCode).toBe(202);
    const rejectedReview = CreateResumeReviewResponseSchema.parse(rejectedReviewResponse.json());
    expect(await runOneOwnerTask({ db, config: config(), workerId: "review-worker-reject" })).toBe(
      true,
    );
    const rejectableReview = CurrentResumeReviewResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/review`,
          headers: mainHeaders,
        })
      ).json(),
    );
    expect(rejectableReview.review?.reviewRun.id).toBe(rejectedReview.review.reviewRun.id);
    const rejectedSuggestion = rejectableReview.review?.suggestions[0];
    if (!rejectedSuggestion) throw new Error("REJECTABLE_SUGGESTION_MISSING");
    const rejectedResponse = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/reviews/${rejectedReview.review.reviewRun.id}/suggestions/${rejectedSuggestion.id}/decisions`,
      headers: mainHeaders,
      payload: {
        expectedRevision: rejectedSuggestion.revision,
        idempotencyKey: randomUUID(),
        decision: "rejected",
        reasonCode: "USER_KEPT_ORIGINAL",
      },
    });
    expect(rejectedResponse.statusCode).toBe(200);
    expect(DecideResumeReviewSuggestionResponseSchema.parse(rejectedResponse.json())).toMatchObject(
      {
        decision: {
          decision: "rejected",
          reasonCode: "USER_KEPT_ORIGINAL",
          resultContentRevisionId: null,
        },
        suggestion: { decision: "rejected", revision: 2 },
        contentRevision: null,
        documentRevision: manuallyEditedPublicBody.documentRevision,
      },
    );

    const editedPublicReviewResponse = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/reviews`,
      headers: { ...mainHeaders, "idempotency-key": `edited-public-review-${randomUUID()}` },
      payload: { expectedRevision: manuallyEditedPublicBody.documentRevision, mode: "template" },
    });
    expect(
      editedPublicReviewResponse.statusCode,
      JSON.stringify(editedPublicReviewResponse.json()),
    ).toBe(202);
    const editedPublicReview = CreateResumeReviewResponseSchema.parse(
      editedPublicReviewResponse.json(),
    );
    expect(
      await runOneOwnerTask({ db, config: config(), workerId: "review-worker-edited-public" }),
    ).toBe(true);
    const editablePublicReview = CurrentResumeReviewResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/review`,
          headers: mainHeaders,
        })
      ).json(),
    );
    expect(editablePublicReview.review?.reviewRun.id).toBe(editedPublicReview.review.reviewRun.id);
    const editablePublicSuggestion = editablePublicReview.review?.suggestions[0];
    if (!editablePublicSuggestion) throw new Error("EDITABLE_PUBLIC_SUGGESTION_MISSING");
    const editedPublicResponse = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/reviews/${editedPublicReview.review.reviewRun.id}/suggestions/${editablePublicSuggestion.id}/decisions`,
      headers: mainHeaders,
      payload: {
        expectedRevision: editablePublicSuggestion.revision,
        idempotencyKey: randomUUID(),
        decision: "edited",
        editedText: "Synthetic user-confirmed expression for the fixed public job version.",
        evidenceIds: [mainResume.evidenceId],
      },
    });
    expect(editedPublicResponse.statusCode, JSON.stringify(editedPublicResponse.json())).toBe(200);
    const editedPublic = DecideResumeReviewSuggestionResponseSchema.parse(
      editedPublicResponse.json(),
    );
    expect(editedPublic).toMatchObject({
      decision: {
        decision: "edited",
        editedText: "Synthetic user-confirmed expression for the fixed public job version.",
        resultContentRevisionId: expect.any(String),
      },
      suggestion: { decision: "edited", revision: 2 },
      documentRevision: manuallyEditedPublicBody.documentRevision + 1,
      contentRevision: {
        content: {
          sections: [
            {
              blocks: [
                {
                  id: mainResume.blockId,
                  text: "Synthetic user-confirmed expression for the fixed public job version.",
                  evidenceIds: [mainResume.evidenceId],
                },
              ],
            },
          ],
        },
      },
    });

    const crossOwnerReview = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${publicCreated.resumeDocument.id}/review`,
      headers: sessionHeaders(otherSession),
    });
    expect(crossOwnerReview.statusCode).toBe(404);

    const crossOwnerRead = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${privateCreated.resumeDocument.id}`,
      headers: sessionHeaders(otherSession),
    });
    expect(crossOwnerRead.statusCode).toBe(404);

    const crossOwnerDelete = await app.inject({
      method: "DELETE",
      url: `/v1/resume-documents/${privateCreated.resumeDocument.id}`,
      headers: sessionHeaders(otherSession),
      payload: { expectedRevision: edited.documentRevision },
    });
    expect(crossOwnerDelete.statusCode).toBe(404);
    expect(crossOwnerDelete.json()).toMatchObject({ code: "RESUME_DOCUMENT_NOT_FOUND" });

    const staleDelete = await app.inject({
      method: "DELETE",
      url: `/v1/resume-documents/${privateCreated.resumeDocument.id}`,
      headers: mainHeaders,
      payload: { expectedRevision: edited.documentRevision - 1 },
    });
    expect(staleDelete.statusCode).toBe(409);
    expect(staleDelete.json()).toMatchObject({ code: "RESUME_DOCUMENT_REVISION_CONFLICT" });

    const { [CSRF_HEADER_NAME]: _deleteCsrf, ...headersWithoutDeleteCsrf } = mainHeaders;
    const missingDeleteCsrf = await app.inject({
      method: "DELETE",
      url: `/v1/resume-documents/${privateCreated.resumeDocument.id}`,
      headers: headersWithoutDeleteCsrf,
      payload: { expectedRevision: edited.documentRevision },
    });
    expect(missingDeleteCsrf.statusCode).toBe(403);

    const deletedResponse = await app.inject({
      method: "DELETE",
      url: `/v1/resume-documents/${privateCreated.resumeDocument.id}`,
      headers: mainHeaders,
      payload: { expectedRevision: edited.documentRevision },
    });
    expect(deletedResponse.statusCode, JSON.stringify(deletedResponse.json())).toBe(200);
    expect(deletedResponse.headers["cache-control"]).toBe("no-store");
    const deleted = DeleteResumeDocumentResponseSchema.parse(deletedResponse.json());
    expect(deleted).toMatchObject({
      documentId: privateCreated.resumeDocument.id,
      revision: edited.documentRevision + 1,
      deletedReviewRunIds: [privateReviewCreated.review.reviewRun.id],
    });
    const deletedReplay = await app.inject({
      method: "DELETE",
      url: `/v1/resume-documents/${privateCreated.resumeDocument.id}`,
      headers: mainHeaders,
      payload: { expectedRevision: edited.documentRevision },
    });
    expect(deletedReplay.json()).toEqual(deleted);
    const deletedRead = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${privateCreated.resumeDocument.id}`,
      headers: mainHeaders,
    });
    expect(deletedRead.statusCode).toBe(404);
    const deletedReviewRow = await db
      .selectFrom("profile.resume_review_runs")
      .select(["status", "deleted_at"])
      .where("id", "=", privateReviewCreated.review.reviewRun.id)
      .where("owner_id", "=", mainSession.context.ownerId)
      .executeTakeFirstOrThrow();
    expect(deletedReviewRow.status).toBe("deleted");
    expect(deletedReviewRow.deleted_at).not.toBeNull();

    m4Candidate = {
      caseId: publicCaseId,
      resumeDocumentId: publicCreated.resumeDocument.id,
      resumeDocumentRevision: editedPublic.documentRevision,
    };
  });

  it("keeps Review v1 readable and processes controlled AI v2 only through offline providers", async () => {
    const candidate = m4Candidate;
    if (!candidate) throw new Error("OS5_REVIEW_CANDIDATE_MISSING");
    const headers = sessionHeaders(mainSession);
    const legacyConfig = { ...config(), resumeReviewV2WriteEnabled: false };
    const legacyApp = buildApp({ config: legacyConfig, db });
    try {
      const disabledControlledAi = await legacyApp.inject({
        method: "POST",
        url: `/v1/resume-documents/${candidate.resumeDocumentId}/reviews`,
        headers: { ...headers, "idempotency-key": `legacy-ai-disabled-${randomUUID()}` },
        payload: {
          expectedRevision: candidate.resumeDocumentRevision,
          mode: "controlled_ai",
          privacyConsent: true,
        },
      });
      expect(disabledControlledAi.statusCode).toBe(503);
      expect(disabledControlledAi.json()).toMatchObject({
        code: "RESUME_REVIEW_V2_WRITE_DISABLED",
      });

      const legacyResponse = await legacyApp.inject({
        method: "POST",
        url: `/v1/resume-documents/${candidate.resumeDocumentId}/reviews`,
        headers: { ...headers, "idempotency-key": `legacy-template-${randomUUID()}` },
        payload: { expectedRevision: candidate.resumeDocumentRevision, mode: "template" },
      });
      expect(legacyResponse.statusCode, JSON.stringify(legacyResponse.json())).toBe(202);
      const legacy = CreateResumeReviewResponseSchema.parse(legacyResponse.json());
      expect(legacy.review.reviewRun.schemaVersion).toBe("resume-review-run-v1");
      expect(await runOneOwnerTask({ db, config: legacyConfig, workerId: "review-v1-worker" })).toBe(
        true,
      );
      const legacyStored = await db
        .selectFrom("profile.resume_review_runs")
        .select([
          "schema_version",
          "generation_provenance_version",
          "template_version",
          "prompt_version",
          "failure_code",
        ])
        .where("id", "=", legacy.review.reviewRun.id)
        .executeTakeFirstOrThrow();
      expect(legacyStored).toEqual({
        schema_version: "resume-review-run-v1",
        generation_provenance_version: null,
        template_version: null,
        prompt_version: null,
        failure_code: null,
      });
      expect(
        CurrentResumeReviewResponseSchema.parse(
          (
            await app.inject({
              method: "GET",
              url: `/v1/resume-documents/${candidate.resumeDocumentId}/review`,
              headers,
            })
          ).json(),
        ).review?.reviewRun.schemaVersion,
      ).toBe("resume-review-run-v1");
    } finally {
      await legacyApp.close();
    }

    const consentRequired = await app.inject({
      method: "POST",
      url: `/v1/resume-documents/${candidate.resumeDocumentId}/reviews`,
      headers: { ...headers, "idempotency-key": `consent-required-${randomUUID()}` },
      payload: { expectedRevision: candidate.resumeDocumentRevision, mode: "controlled_ai" },
    });
    expect(consentRequired.statusCode).toBe(400);
    expect(consentRequired.json()).toMatchObject({ code: "CONTROLLED_AI_CONSENT_REQUIRED" });

    const aiConfig: AppConfig = {
      ...config(),
      ai: {
        enabled: true,
        baseUrl: "https://127.0.0.1/v1",
        model: "synthetic-review-model",
        apiKey: "synthetic-offline-key",
        requestTimeoutMs: 5_000,
      },
    };
    const createControlledAiReview = async (label: string) => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/resume-documents/${candidate.resumeDocumentId}/reviews`,
        headers: { ...headers, "idempotency-key": `${label}-${randomUUID()}` },
        payload: {
          expectedRevision: candidate.resumeDocumentRevision,
          mode: "controlled_ai",
          privacyConsent: true,
        },
      });
      expect(response.statusCode, JSON.stringify(response.json())).toBe(202);
      return CreateResumeReviewResponseSchema.parse(response.json());
    };
    const currentReview = async () =>
      CurrentResumeReviewResponseSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: `/v1/resume-documents/${candidate.resumeDocumentId}/review`,
            headers,
          })
        ).json(),
      );

    const successfulRun = await createControlledAiReview("controlled-ai-success");
    let providerCalls = 0;
    const successfulFetch: typeof fetch = async (url, init) => {
      providerCalls += 1;
      expect(new URL(String(url)).hostname).toBe("127.0.0.1");
      expect(init?.redirect).toBe("error");
      const requestBody = String(init?.body);
      expect(requestBody).toContain(publicRequirementItemV1Id);
      expect(requestBody).toContain(mainResume.evidenceId);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  rewrites: [
                    {
                      sourceBlockId: mainResume.blockId,
                      suggestedText: "Synthetic confirmed evidence claim.",
                      requirementIds: [publicRequirementItemV1Id],
                      evidenceIds: [mainResume.evidenceId],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    expect(
      await runOneOwnerTask({
        db,
        config: aiConfig,
        workerId: "review-v2-ai-success",
        fetchImpl: successfulFetch,
      }),
    ).toBe(true);
    expect(providerCalls).toBe(1);
    const successful = await currentReview();
    expect(successful.review?.reviewRun).toMatchObject({
      id: successfulRun.review.reviewRun.id,
      schemaVersion: "resume-review-run-v2",
      mode: "controlled_ai",
      status: "completed",
      providerAdapter: "openai-compatible-v1",
      model: "synthetic-review-model",
      usedTemplateFallback: false,
      fallbackReasonCode: null,
      failureCode: null,
    });
    expect(successful.review?.suggestions[0]).toMatchObject({
      schemaVersion: "resume-review-suggestion-v2",
      suggestedText: "Synthetic confirmed evidence claim.",
      requirementIds: [publicRequirementItemV1Id],
      evidenceIds: [mainResume.evidenceId],
    });
    const successfulFindingId = successful.review?.findings.find(
      (finding) =>
        finding.schemaVersion === "resume-review-finding-v2" && finding.requirementIds.length > 0,
    )?.id;
    const successfulSuggestionId = successful.review?.suggestions.find(
      (suggestion) =>
        suggestion.schemaVersion === "resume-review-suggestion-v2" &&
        suggestion.requirementIds.length > 0,
    )?.id;
    expect(successfulFindingId).toBeTruthy();
    expect(successfulSuggestionId).toBeTruthy();
    await expect(
      db
        .updateTable("profile.resume_review_findings")
        .set({ requirement_ids: JSON.stringify([]) })
        .where("id", "=", successfulFindingId as string)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_PROFILE_REVISION");
    await expect(
      db
        .updateTable("profile.resume_review_suggestions")
        .set({ requirement_ids: JSON.stringify([]) })
        .where("id", "=", successfulSuggestionId as string)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_REVIEW_SUGGESTION");
    await expect(
      db
        .updateTable("profile.resume_review_runs")
        .set({
          template_version: "mutated-template-version",
          revision: successful.review?.reviewRun.revision
            ? successful.review.reviewRun.revision + 1
            : 3,
        })
        .where("id", "=", successfulRun.review.reviewRun.id)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_REVIEW_GENERATION_PROVENANCE");

    await expect(
      db
        .insertInto("profile.resume_review_findings")
        .values({
          id: randomUUID(),
          owner_id: mainSession.context.ownerId,
          owner_epoch: mainSession.context.ownerEpoch,
          review_run_id: successfulRun.review.reviewRun.id,
          schema_version: "resume-review-finding-v2",
          category: "content_relevance",
          severity: "warning",
          source_block_id: mainResume.blockId,
          evidence_ids: JSON.stringify([]),
          requirement_ids: JSON.stringify(["not-in-the-fixed-requirement-set"]),
          reason_code: "INVALID_REFERENCE_TEST",
        })
        .execute(),
    ).rejects.toThrow("RESUME_REVIEW_REQUIREMENT_REFERENCE_INVALID");

    const disabledFallbackRun = await createControlledAiReview("controlled-ai-disabled-fallback");
    expect(
      await runOneOwnerTask({ db, config: config(), workerId: "review-v2-ai-disabled" }),
    ).toBe(true);
    expect((await currentReview()).review?.reviewRun).toMatchObject({
      id: disabledFallbackRun.review.reviewRun.id,
      status: "completed",
      providerAdapter: null,
      model: null,
      usedTemplateFallback: true,
      fallbackReasonCode: "AI_DISABLED",
    });

    const schemaFallbackRun = await createControlledAiReview("controlled-ai-schema-fallback");
    const invalidSchemaFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ rewrites: [] }) } }] }),
        { status: 200 },
      );
    expect(
      await runOneOwnerTask({
        db,
        config: aiConfig,
        workerId: "review-v2-ai-schema",
        fetchImpl: invalidSchemaFetch,
      }),
    ).toBe(true);
    expect((await currentReview()).review?.reviewRun).toMatchObject({
      id: schemaFallbackRun.review.reviewRun.id,
      status: "completed",
      usedTemplateFallback: true,
      fallbackReasonCode: "AI_RESPONSE_INVALID",
    });

    const referenceFallbackRun = await createControlledAiReview("controlled-ai-reference-fallback");
    const invalidReferenceFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  rewrites: [
                    {
                      sourceBlockId: mainResume.blockId,
                      suggestedText: "Synthetic confirmed evidence claim.",
                      requirementIds: ["invalid-requirement-reference"],
                      evidenceIds: [mainResume.evidenceId],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    expect(
      await runOneOwnerTask({
        db,
        config: aiConfig,
        workerId: "review-v2-ai-reference",
        fetchImpl: invalidReferenceFetch,
      }),
    ).toBe(true);
    expect((await currentReview()).review?.reviewRun).toMatchObject({
      id: referenceFallbackRun.review.reviewRun.id,
      status: "completed",
      usedTemplateFallback: true,
      fallbackReasonCode: "AI_REQUIREMENT_REFERENCE_INVALID",
    });
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

  it("completes one synthetic public Case through confirmed backflow and owner deletion", async () => {
    const candidate = m4Candidate;
    if (!candidate) throw new Error("M4_COMPLETE_FLOW_CANDIDATE_MISSING");
    const headers = sessionHeaders(mainSession);

    const initialCaseResponse = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${candidate.caseId}`,
      headers,
    });
    expect(initialCaseResponse.statusCode).toBe(200);
    const initialCase = ApplicationCaseWithJobContextSchema.parse(initialCaseResponse.json());
    expect(initialCase).toMatchObject({
      id: candidate.caseId,
      revision: 2,
      stage: "interested",
      jobContext: {
        kind: "public",
        publishedJobId: publicJobId,
        publishedJobVersionId: publicVersionV1Id,
        requirementSetId: publicRequirementV1Id,
      },
      jobDisplay: { title: "Synthetic product internship v1" },
    });
    if (initialCase.jobContext.kind !== "public") {
      throw new Error("M4_PUBLIC_CASE_CONTEXT_EXPECTED");
    }

    const requirementsResponse = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${candidate.caseId}/requirements`,
      headers,
    });
    expect(requirementsResponse.statusCode, JSON.stringify(requirementsResponse.json())).toBe(200);
    const requirements = ApplicationCaseRequirementsSchema.parse(requirementsResponse.json());
    expect(requirements).toMatchObject({
      caseId: candidate.caseId,
      revision: 2,
      requirementContext: { kind: "public", requirementSetId: publicRequirementV1Id },
    });
    expect(requirements.requirements.map(({ id }) => id)).toEqual([publicRequirementItemV1Id]);

    const stateResponse = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${candidate.caseId}/requirements/${publicRequirementItemV1Id}`,
      headers,
      payload: {
        expectedRevision: 2,
        state: "confirmed",
        userNote: "Confirmed only against the synthetic evidence fixture.",
      },
    });
    expect(stateResponse.statusCode, JSON.stringify(stateResponse.json())).toBe(200);
    expect(ApplicationCaseMutationResponseSchema.parse(stateResponse.json())).toMatchObject({
      caseRevision: 3,
      event: { sequence: 3, eventType: "requirement_state_changed" },
    });

    const evidenceLinkResponse = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${candidate.caseId}/requirements/${publicRequirementItemV1Id}/evidence-links`,
      headers,
      payload: {
        expectedRevision: 3,
        evidenceRevisionId: mainResume.evidenceRevisionId,
        evidenceIds: [mainResume.evidenceId],
      },
    });
    expect(evidenceLinkResponse.statusCode, JSON.stringify(evidenceLinkResponse.json())).toBe(200);
    expect(ApplicationCaseMutationResponseSchema.parse(evidenceLinkResponse.json())).toMatchObject({
      caseRevision: 4,
      event: {
        sequence: 4,
        eventType: "requirement_evidence_changed",
        eventData: { linkedEvidenceIds: [mainResume.evidenceId], removedEvidenceIds: [] },
      },
    });

    const requirementsAfterConfirmation = ApplicationCaseRequirementsSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/application-cases/${candidate.caseId}/requirements`,
          headers,
        })
      ).json(),
    );
    expect(requirementsAfterConfirmation).toMatchObject({
      revision: 4,
      states: [
        {
          requirementId: publicRequirementItemV1Id,
          state: "confirmed",
          userNote: "Confirmed only against the synthetic evidence fixture.",
          persisted: true,
        },
      ],
      evidenceLinks: [
        {
          requirementId: publicRequirementItemV1Id,
          evidenceRevisionId: mainResume.evidenceRevisionId,
          evidenceId: mainResume.evidenceId,
          removedAt: null,
        },
      ],
    });

    const eventCountBeforeExternalLink = await db
      .selectFrom("application.case_events")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("case_id", "=", candidate.caseId)
      .executeTakeFirstOrThrow();
    expect(initialCase.jobContext.officialUrl).toContain(".example.test/jobs/1/apply");
    const externalLinkRead = ApplicationCaseWithJobContextSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/application-cases/${candidate.caseId}`,
          headers,
        })
      ).json(),
    );
    expect(externalLinkRead).toMatchObject({ revision: 4, stage: "interested" });
    const eventCountAfterExternalLink = await db
      .selectFrom("application.case_events")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("case_id", "=", candidate.caseId)
      .executeTakeFirstOrThrow();
    expect(Number(eventCountAfterExternalLink.count)).toBe(
      Number(eventCountBeforeExternalLink.count),
    );

    const manualApplicationResponse = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${candidate.caseId}/manual-applications`,
      headers: { ...headers, "idempotency-key": `m4-manual-application-${randomUUID()}` },
      payload: { expectedRevision: 4 },
    });
    expect(
      manualApplicationResponse.statusCode,
      JSON.stringify(manualApplicationResponse.json()),
    ).toBe(200);
    expect(
      ApplicationCaseCommandResponseSchema.parse(manualApplicationResponse.json()),
    ).toMatchObject({
      event: {
        sequence: 5,
        eventType: "manual_application_recorded",
        eventData: { fromStage: "interested", toStage: "applied" },
      },
    });
    expect(
      ApplicationCaseWithJobContextSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: `/v1/application-cases/${candidate.caseId}`,
            headers,
          })
        ).json(),
      ),
    ).toMatchObject({ revision: 5, stage: "applied" });

    const interviewResponse = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${candidate.caseId}/interview-sessions`,
      headers: { ...headers, "idempotency-key": `m4-interview-${randomUUID()}` },
      payload: { expectedCaseRevision: 5 },
    });
    expect(interviewResponse.statusCode, JSON.stringify(interviewResponse.json())).toBe(201);
    const interview = CreateInterviewSessionResponseSchema.parse(interviewResponse.json());
    expect(interview.firstQuestion.requirementIds).toContain(publicRequirementItemV1Id);
    expect(interview.firstQuestion.evidenceIds).toEqual([]);

    let interviewRevision = 1;
    let interviewCompleted = false;
    for (let answerIndex = 0; answerIndex < 10 && !interviewCompleted; answerIndex += 1) {
      const answerResponse = await app.inject({
        method: "POST",
        url: `/v1/application-cases/${candidate.caseId}/interview-sessions/${interview.sessionId}/answers`,
        headers: { ...headers, "idempotency-key": `m4-answer-${answerIndex}-${randomUUID()}` },
        payload: {
          expectedRevision: interviewRevision,
          answer: `Synthetic answer ${answerIndex + 1}, limited to confirmed fixture facts.`,
        },
      });
      expect(answerResponse.statusCode, JSON.stringify(answerResponse.json())).toBe(200);
      const answer = SubmitInterviewAnswerResponseSchema.parse(answerResponse.json());
      interviewRevision = answer.appliedRevision;
      interviewCompleted = answer.completed;
    }
    expect(interviewCompleted).toBe(true);

    const debriefResponse = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${candidate.caseId}/debrief`,
      headers: { ...headers, "idempotency-key": `m4-debrief-${randomUUID()}` },
      payload: {
        interviewSessionId: interview.sessionId,
        expectedSessionRevision: interviewRevision,
      },
    });
    expect(debriefResponse.statusCode, JSON.stringify(debriefResponse.json())).toBe(201);
    const preparedDebrief = PrepareCaseDebriefResponseSchema.parse(debriefResponse.json());
    expect(preparedDebrief).toMatchObject({
      debrief: {
        caseId: candidate.caseId,
        interviewSessionId: interview.sessionId,
        evidenceRevisionId: mainResume.evidenceRevisionId,
        status: "draft",
        revision: 1,
      },
      feedback: { generatorMode: "template" },
    });
    expect(preparedDebrief.debrief.expressionIssues.length).toBeGreaterThan(0);

    const itemDecisions = [
      ...preparedDebrief.debrief.expressionIssues.map((item) => ({
        itemKind: "expression_issue" as const,
        itemId: item.id,
        decision: "accepted" as const,
        editedText: null,
      })),
      ...preparedDebrief.debrief.evidenceGaps.map((item) => ({
        itemKind: "evidence_gap" as const,
        itemId: item.id,
        decision: "accepted" as const,
        editedText: null,
      })),
    ];
    const confirmationResponse = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${candidate.caseId}/debrief/confirmations`,
      headers: { ...headers, "idempotency-key": `m4-confirmation-${randomUUID()}` },
      payload: { expectedDebriefRevision: 1, itemDecisions },
    });
    expect(confirmationResponse.statusCode, JSON.stringify(confirmationResponse.json())).toBe(201);
    const confirmedDebrief = ConfirmCaseDebriefResponseSchema.parse(confirmationResponse.json());
    expect(confirmedDebrief).toMatchObject({
      debrief: { caseId: candidate.caseId, status: "confirmed", revision: 2 },
      confirmation: { basedOnDebriefRevision: 1 },
    });
    expect(confirmedDebrief.itemDecisions).toHaveLength(itemDecisions.length);

    const confirmedDebriefRead = GetCaseDebriefResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/application-cases/${candidate.caseId}/debrief`,
          headers,
        })
      ).json(),
    );
    expect(confirmedDebriefRead.debrief).toEqual(confirmedDebrief.debrief);
    expect(confirmedDebriefRead.itemDecisions).toEqual(confirmedDebrief.itemDecisions);

    const backflowRequirements = ApplicationCaseRequirementsSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/application-cases/${candidate.caseId}/requirements`,
          headers,
        })
      ).json(),
    );
    expect(backflowRequirements).toMatchObject({
      revision: 7,
      states: [{ requirementId: publicRequirementItemV1Id, state: "confirmed" }],
      evidenceLinks: [{ evidenceId: mainResume.evidenceId, removedAt: null }],
    });
    const backflowResumeResponse = await app.inject({
      method: "GET",
      url: `/v1/resume-documents/${candidate.resumeDocumentId}`,
      headers,
    });
    expect(backflowResumeResponse.statusCode).toBe(200);
    const backflowResume = ResumeDocumentSchema.parse(backflowResumeResponse.json());
    expect(backflowResume).toMatchObject({
      id: candidate.resumeDocumentId,
      caseId: candidate.caseId,
      revision: candidate.resumeDocumentRevision,
      currentContentRevisionId: expect.any(String),
      currentLayoutRevisionId: expect.any(String),
    });
    if (!backflowResume.currentContentRevisionId || !backflowResume.currentLayoutRevisionId) {
      throw new Error("M4_BACKFLOW_RESUME_REVISIONS_MISSING");
    }
    const finalDocxResponse = await app.inject({
      method: "GET",
      url:
        `/v1/resume-documents/${candidate.resumeDocumentId}/docx?` +
        new URLSearchParams({
          contentRevisionId: backflowResume.currentContentRevisionId,
          layoutRevisionId: backflowResume.currentLayoutRevisionId,
        }).toString(),
      headers,
    });
    expect(finalDocxResponse.statusCode).toBe(200);
    expect(finalDocxResponse.headers["cache-control"]).toBe("no-store");
    expect(finalDocxResponse.rawPayload.subarray(0, 2).toString()).toBe("PK");

    const caseDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/v1/application-cases/${candidate.caseId}`,
      headers,
      payload: {
        expectedRevision: 7,
        resumeDocuments: "detach",
        interviewSessions: "detach",
        debriefs: "detach",
      },
    });
    expect(caseDeleteResponse.statusCode, JSON.stringify(caseDeleteResponse.json())).toBe(200);
    const deletedCase = DeleteApplicationCaseResponseSchema.parse(caseDeleteResponse.json());
    expect(deletedCase).toMatchObject({
      caseId: candidate.caseId,
      revision: 8,
      relatedAssets: {
        resumeDocuments: { deletedIds: [], detachedIds: [candidate.resumeDocumentId] },
        interviewSessions: { deletedIds: [], detachedIds: [interview.sessionId] },
        debriefs: { deletedIds: [], detachedIds: [preparedDebrief.debrief.id] },
      },
      privateJobSnapshotRetained: false,
    });

    const detachedScopeResponse = await app.inject({
      method: "GET",
      url: "/v1/profile/data-scope",
      headers,
    });
    expect(detachedScopeResponse.statusCode).toBe(200);
    const detachedScope = CareerDataScopeResponseSchema.parse(detachedScopeResponse.json());
    expect(detachedScope.counts.detachedResumeDocuments).toBeGreaterThanOrEqual(1);
    expect(detachedScope.detachedAssets.map(({ id }) => id)).toEqual(
      expect.arrayContaining([interview.sessionId, preparedDebrief.debrief.id]),
    );
    expect(
      await db
        .selectFrom("profile.resume_documents")
        .select(["case_id", "detached_from_case_id", "deleted_at"])
        .where("id", "=", candidate.resumeDocumentId)
        .where("owner_id", "=", mainSession.context.ownerId)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ case_id: null, detached_from_case_id: candidate.caseId, deleted_at: null });

    const lateTaskId = randomUUID();
    await db
      .insertInto("task_queue.tasks")
      .values({
        id: lateTaskId,
        task_type: "match_run",
        owner_id: mainSession.context.ownerId,
        owner_epoch: mainSession.context.ownerEpoch,
        payload: JSON.stringify({ runId: randomUUID() }),
        idempotency_key: `m4-owner-delete-late-task:${lateTaskId}`,
        status: "queued",
        attempt: 0,
        max_attempts: 3,
        available_at: new Date(),
        backoff_policy: JSON.stringify({ kind: "fixed", seconds: 1 }),
        lease_owner: null,
        lease_until: null,
        heartbeat_at: null,
        fencing_token: 0,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();

    const ownerDeletionResponse = await app.inject({
      method: "DELETE",
      url: "/v1/profile",
      headers,
    });
    expect(ownerDeletionResponse.statusCode, JSON.stringify(ownerDeletionResponse.json())).toBe(
      202,
    );
    expect(ownerDeletionResponse.headers["cache-control"]).toBe("no-store");
    const ownerDeletion = ProfileDeletionSchema.parse(ownerDeletionResponse.json());
    ownerDeletionId = ownerDeletion.id;
    expect(ownerDeletion.status).toBe("queued");
    const deletionReceiptCookie = [ownerDeletionResponse.headers["set-cookie"]]
      .flat()
      .filter((value): value is string => typeof value === "string")
      // flatMap keeps this a string[]; indexing [0] tripped noUncheckedIndexedAccess
      // even though split(";", 1) always yields exactly one element.
      .flatMap((value) => value.split(";", 1))
      .find((value) => value.startsWith(`${DELETION_RECEIPT_COOKIE_NAME}=`));
    expect(deletionReceiptCookie).toBeDefined();
    expect(await findActiveSession({ db, sessionToken: mainSession.sessionToken })).toBeNull();
    expect(
      await db
        .selectFrom("task_queue.tasks")
        .select(["status", "last_error_code"])
        .where("id", "=", lateTaskId)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ status: "dead", last_error_code: "OWNER_EPOCH_STALE" });

    expect(
      await runOneOwnerTask({
        db,
        config: config(),
        workerId: `m4-owner-deletion-${mainSession.context.ownerId}`,
      }),
    ).toBe(true);
    expect(
      await db
        .selectFrom("decision.owner_deletions")
        .select(["status", "failure_code", "completed_at"])
        .where("id", "=", ownerDeletion.id)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ status: "succeeded", failure_code: null, completed_at: expect.any(Date) });

    for (let read = 0; read < 2; read += 1) {
      const deletionReceiptResponse = await app.inject({
        method: "GET",
        url: "/v1/profile/deletion",
        headers: { cookie: deletionReceiptCookie as string },
      });
      expect(
        deletionReceiptResponse.statusCode,
        JSON.stringify(deletionReceiptResponse.json()),
      ).toBe(200);
      expect(ProfileDeletionSchema.parse(deletionReceiptResponse.json())).toMatchObject({
        id: ownerDeletion.id,
        status: "succeeded",
      });
      expect(deletionReceiptResponse.headers["set-cookie"]).toBeUndefined();
    }

    const personalTableCounts = await Promise.all([
      db
        .selectFrom("application.application_cases")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("owner_id", "=", mainSession.context.ownerId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("profile.resume_documents")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("owner_id", "=", mainSession.context.ownerId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("application.interview_sessions")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("owner_id", "=", mainSession.context.ownerId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("application.debriefs")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("owner_id", "=", mainSession.context.ownerId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("decision.job_decisions")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("owner_id", "=", mainSession.context.ownerId)
        .executeTakeFirstOrThrow(),
    ]);
    expect(personalTableCounts.map(({ count }) => Number(count))).toEqual([0, 0, 0, 0, 0]);
    const deletedOwner = await db
      .selectFrom("identity.owners")
      .select(["status", "epoch", "deleted_at"])
      .where("id", "=", mainSession.context.ownerId)
      .executeTakeFirstOrThrow();
    expect(deletedOwner).toMatchObject({ status: "deleted", deleted_at: expect.any(Date) });
    expect(Number(deletedOwner.epoch)).toBe(mainSession.context.ownerEpoch + 1);
    expect(
      await db
        .selectFrom("catalog.published_jobs")
        .select(["id", "current_version_id", "public_version_id"])
        .where("id", "=", publicJobId)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      id: publicJobId,
      current_version_id: publicVersionV2Id,
      public_version_id: publicVersionV2Id,
    });
  }, 30_000);
});
