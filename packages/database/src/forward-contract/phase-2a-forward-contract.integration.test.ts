import { randomUUID } from "node:crypto";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../index.js";
import { migrateToForTesting, migrateToLatest } from "../migrate.js";
import { applicationCaseLongLivedForwardRepairMigration } from "../migrations/026_application_case_long_lived_forward_repair.js";
import { privateRequirementContextForwardRepairMigration } from "../migrations/026b_private_requirement_context_forward_repair.js";
import { resumeDocumentReviewForwardRepairMigration } from "../migrations/027_resume_document_review_forward_repair.js";
import { interviewDebriefKnowledgeExpandMigration } from "../migrations/028_interview_debrief_knowledge_expand.js";
import { caseMutationEventV2ForwardRepairMigration } from "../migrations/029_case_mutation_event_v2_forward_repair.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const unknown = JSON.stringify({ state: "unknown", reason: "source_not_stated" });
const known = (value: unknown, evidenceRef: string) =>
  JSON.stringify({ state: "known", value, evidenceRefs: [evidenceRef] });

describeWithDatabase("migrations 026B through 030 Phase 2A/2B forward repairs", () => {
  const ids = {
    organization: randomUUID(),
    source: randomUUID(),
    sourceRecord: randomUUID(),
    sourceRevision: randomUUID(),
    publishedJob: randomUUID(),
    publishedVersion: randomUUID(),
    requirementSet: randomUUID(),
    owner: randomUUID(),
    account: randomUUID(),
    otherOwner: randomUUID(),
    evidenceRevision: randomUUID(),
    otherEvidenceRevision: randomUUID(),
    legacyCase: randomUUID(),
    legacyEvent: randomUUID(),
    legacyRequirementState: randomUUID(),
    legacyEvidenceLink: randomUUID(),
    legacyQuestion: randomUUID(),
    baseDocument: randomUUID(),
    legacyContentRevision: randomUUID(),
    legacyLayoutRevision: randomUUID(),
    legacyDerivedDocument: randomUUID(),
    legacyDerivedContentRevision: randomUUID(),
    privateSnapshot: randomUUID(),
    privateSnapshotRevision: randomUUID(),
    privateSnapshotRevision2: randomUUID(),
    privateCase: randomUUID(),
    privateEvent: randomUUID(),
    privateRequirementState: randomUUID(),
    privateEvidenceLink: randomUUID(),
    privateQuestion: randomUUID(),
    privateUnscopedQuestion: randomUUID(),
    semanticBaseRevision: randomUUID(),
    semanticSection: randomUUID(),
    semanticBlock: randomUUID(),
    strictLayoutRevision: randomUUID(),
    derivedDocument: randomUUID(),
    derivedContentRevision: randomUUID(),
    resultContentRevision: randomUUID(),
    reviewRun: randomUUID(),
    finding: randomUUID(),
    suggestion: randomUUID(),
    decision: randomUUID(),
    interviewSession: randomUUID(),
    interviewQuestionTurn: randomUUID(),
    interviewAnswerTurn: randomUUID(),
    interviewFeedback: randomUUID(),
    interviewFeedbackItem: randomUUID(),
    debrief: randomUUID(),
    debriefIssue: randomUUID(),
    debriefGap: randomUUID(),
    debriefPractice: randomUUID(),
    debriefConfirmation: randomUUID(),
    knowledgeClip: randomUUID(),
    knowledgeClipLink: randomUUID(),
  };
  const databaseName = `aijob_test_phase2a_forward_${randomUUID().replaceAll("-", "")}`;
  const emptyDatabaseName = `aijob_test_phase2a_026_empty_${randomUUID().replaceAll("-", "")}`;
  let adminDb: Kysely<Database>;
  let emptyDb: Kysely<Database>;
  let db: Kysely<Database>;

  beforeAll(async () => {
    const adminUrl = new URL(databaseUrl as string);
    adminDb = createDatabase(adminUrl.toString());
    await sql.raw(`CREATE DATABASE "${databaseName}"`).execute(adminDb);
    await sql.raw(`CREATE DATABASE "${emptyDatabaseName}"`).execute(adminDb);

    const emptyUrl = new URL(adminUrl);
    emptyUrl.pathname = `/${emptyDatabaseName}`;
    emptyDb = createDatabase(emptyUrl.toString());
    await migrateToLatest(emptyDb);

    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${databaseName}`;
    db = createDatabase(testUrl.toString());
    await migrateToForTesting(db, "025_identity_account_email_expand");

    const now = new Date("2026-08-06T00:00:00.000Z");
    await db
      .insertInto("source_control.organizations")
      .values({
        id: ids.organization,
        slug: `phase2a-forward-${ids.organization}`,
        name: "Phase 2A forward fixture",
        official_domain: "phase2a-forward.example.test",
      })
      .execute();
    await db
      .insertInto("source_control.sources")
      .values({
        id: ids.source,
        organization_id: ids.organization,
        source_candidate_id: null,
        source_key: `phase2a-forward-${ids.source}`,
        source_type: "organization_career_site",
        name: "Phase 2A forward fixture source",
        current_policy_version: 1,
      })
      .execute();
    await db
      .insertInto("source_control.source_policy_versions")
      .values({
        source_id: ids.source,
        version: 1,
        policy_status: "pending_review",
        config_registered: true,
        catalog_role: "canonical",
        runtime_scope: "local",
        provenance_level: "organization_owned",
        acquisition_mode: "deterministic_html",
        adapter_key: "phase2a-forward-fixture",
        adapter_version: "1",
        entrypoints: JSON.stringify(["https://phase2a-forward.example.test/jobs"]),
        crawl_interval: "24h",
        policy_notes: "Offline forward-contract fixture.",
        reviewed_at: null,
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_records")
      .values({
        id: ids.sourceRecord,
        source_id: ids.source,
        source_job_id: `phase2a-forward-${ids.sourceRecord}`,
        canonical_source_url: `https://phase2a-forward.example.test/jobs/${ids.sourceRecord}`,
        first_seen_at: now,
        last_seen_at: now,
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_revisions")
      .values({
        id: ids.sourceRevision,
        source_job_record_id: ids.sourceRecord,
        revision_content_hash: "a".repeat(64),
        import_mode: "manual",
        adapter_version: "1",
        normalizer_version: "1",
        company_name: "Phase 2A forward fixture",
        title: "Product intern",
        job_family: known("product", `${ids.sourceRevision}#family`),
        locations: known(["Shanghai"], `${ids.sourceRevision}#locations`),
        business_groups: JSON.stringify([]),
        entry_scope: "internship",
        source_project_name: null,
        recruit_label_name: "internship",
        recruitment_type: known("internship", `${ids.sourceRevision}#type`),
        responsibilities: "Synthetic product discovery",
        requirements: "Synthetic confirmed evidence",
        structured_fields: JSON.stringify({}),
        ingestion_state: "parsed",
        publication_state: "review",
        activity_state: "active",
        source_url: `https://phase2a-forward.example.test/jobs/${ids.sourceRecord}`,
        apply_url: `https://phase2a-forward.example.test/jobs/${ids.sourceRecord}/apply`,
        quality_flags: JSON.stringify([]),
      })
      .execute();
    await db
      .insertInto("catalog.published_jobs")
      .values({ id: ids.publishedJob, current_version_id: null })
      .execute();
    await db
      .insertInto("catalog.published_job_versions")
      .values({
        id: ids.publishedVersion,
        published_job_id: ids.publishedJob,
        source_job_revision_id: ids.sourceRevision,
        content_hash: "b".repeat(64),
        company_name: "Phase 2A forward fixture",
        title: "Product intern",
        job_family: known("product", `${ids.sourceRevision}#family`),
        locations: known(["Shanghai"], `${ids.sourceRevision}#locations`),
        department: unknown,
        job_code: unknown,
        recruitment_type: known("internship", `${ids.sourceRevision}#type`),
        employment_type: known("internship", `${ids.sourceRevision}#employment`),
        recruitment_batch: unknown,
        weekly_attendance_days: unknown,
        duration_months: unknown,
        earliest_start_date: unknown,
        graduation_years: unknown,
        education_levels: unknown,
        majors: unknown,
        languages: unknown,
        salary: unknown,
        work_mode: unknown,
        posted_at: unknown,
        deadline_at: unknown,
        responsibilities: "Synthetic product discovery",
        requirements: "Synthetic confirmed evidence",
        structured_fields: JSON.stringify({}),
        activity_state: "active",
        source_url: `https://phase2a-forward.example.test/jobs/${ids.sourceRecord}`,
        apply_url: `https://phase2a-forward.example.test/jobs/${ids.sourceRecord}/apply`,
        effective_at: now,
      })
      .execute();
    await db
      .insertInto("catalog.job_requirement_sets")
      .values({
        id: ids.requirementSet,
        published_job_version_id: ids.publishedVersion,
        schema_version: "phase2a-forward-v1",
        requirements: JSON.stringify([]),
        content_hash: "c".repeat(64),
      })
      .execute();
    await db
      .updateTable("catalog.published_jobs")
      .set({ current_version_id: ids.publishedVersion })
      .where("id", "=", ids.publishedJob)
      .execute();
    await db
      .updateTable("catalog.published_job_versions")
      .set({ active_requirement_set_id: ids.requirementSet })
      .where("id", "=", ids.publishedVersion)
      .execute();

    await db
      .insertInto("identity.owners")
      .values([
        {
          id: ids.owner,
          status: "active",
          epoch: 1,
          retention_expires_at: new Date("2026-09-05T00:00:00.000Z"),
          last_seen_at: now,
          deleted_at: null,
        },
        {
          id: ids.otherOwner,
          status: "active",
          epoch: 1,
          retention_expires_at: new Date("2026-09-05T00:00:00.000Z"),
          last_seen_at: now,
          deleted_at: null,
        },
      ])
      .execute();
    await db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("identity.accounts")
        .values({ id: ids.account, owner_id: ids.owner, deleted_at: null })
        .execute();
      await transaction
        .updateTable("identity.owners")
        .set({ retention_mode: "account_managed", retention_expires_at: null })
        .where("id", "=", ids.owner)
        .executeTakeFirstOrThrow();
    });
    await db
      .insertInto("profile.resume_evidence_revisions")
      .values([
        {
          id: ids.evidenceRevision,
          owner_id: ids.owner,
          owner_epoch: 1,
          resume_analysis_id: null,
          revision: 1,
          base_revision: null,
          evidence: JSON.stringify([{ id: "evidence-1", confirmed: true }]),
          content_hash: "d".repeat(64),
          confirmed_at: now,
          schema_version: "resume-evidence-v1",
          document_revision_id: null,
        },
        {
          id: ids.otherEvidenceRevision,
          owner_id: ids.otherOwner,
          owner_epoch: 1,
          resume_analysis_id: null,
          revision: 1,
          base_revision: null,
          evidence: JSON.stringify([]),
          content_hash: "e".repeat(64),
          confirmed_at: now,
          schema_version: "resume-evidence-v1",
          document_revision_id: null,
        },
      ])
      .execute();

    await db
      .insertInto("application.application_cases")
      .values({
        id: ids.legacyCase,
        owner_id: ids.owner,
        owner_epoch: 1,
        published_job_id: ids.publishedJob,
        published_job_version_id: ids.publishedVersion,
        requirement_set_id: ids.requirementSet,
        stage: "interested",
        outcome: null,
        creation_idempotency_key: `legacy-case-${ids.legacyCase}`,
        creation_request_hash: "f".repeat(64),
        expires_at: new Date("2026-08-20T00:00:00.000Z"),
        ended_at: null,
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("application.case_events")
      .values({
        id: ids.legacyEvent,
        owner_id: ids.owner,
        owner_epoch: 1,
        case_id: ids.legacyCase,
        sequence: 1,
        event_type: "case_created",
        actor_type: "system",
        event_data: JSON.stringify({ stage: "interested" }),
        idempotency_scope: "legacy-case:create",
        idempotency_key: `legacy-event-${ids.legacyEvent}`,
        request_hash: "1".repeat(64),
      })
      .execute();
    await sql`
      INSERT INTO application.case_requirement_states (
        id,
        owner_id,
        owner_epoch,
        case_id,
        requirement_set_id,
        requirement_id,
        state,
        user_note,
        revision,
        created_at,
        updated_at
      ) VALUES (
        ${ids.legacyRequirementState},
        ${ids.owner},
        1,
        ${ids.legacyCase},
        ${ids.requirementSet},
        'legacy-requirement',
        'needs_work',
        'Preserve this synthetic note.',
        3,
        ${now},
        ${now}
      )
    `.execute(db);
    await sql`
      INSERT INTO application.case_requirement_evidence_links (
        id,
        owner_id,
        owner_epoch,
        case_id,
        requirement_set_id,
        requirement_id,
        evidence_revision_id,
        evidence_id,
        revision,
        linked_at,
        removed_at
      ) VALUES (
        ${ids.legacyEvidenceLink},
        ${ids.owner},
        1,
        ${ids.legacyCase},
        ${ids.requirementSet},
        'legacy-requirement',
        ${ids.evidenceRevision},
        'legacy-evidence',
        2,
        ${now},
        NULL
      )
    `.execute(db);
    await sql`
      INSERT INTO application.case_questions (
        id,
        owner_id,
        owner_epoch,
        case_id,
        requirement_set_id,
        requirement_id,
        question,
        answer,
        status,
        revision,
        created_at,
        updated_at
      ) VALUES (
        ${ids.legacyQuestion},
        ${ids.owner},
        1,
        ${ids.legacyCase},
        ${ids.requirementSet},
        'legacy-requirement',
        'Synthetic legacy question?',
        NULL,
        'open',
        4,
        ${now},
        ${now}
      )
    `.execute(db);
    await db
      .insertInto("profile.resume_documents")
      .values({
        id: ids.baseDocument,
        owner_id: ids.owner,
        owner_epoch: 1,
        kind: "base",
        title: "Synthetic base resume",
        case_id: null,
        published_job_id: null,
        published_job_version_id: null,
        requirement_set_id: null,
        base_document_id: null,
        base_document_revision_id: null,
        evidence_revision_id: null,
        current_content_revision_id: null,
        current_layout_revision_id: null,
        revision: 1,
        creation_idempotency_key: `base-document-${ids.baseDocument}`,
        creation_request_hash: "2".repeat(64),
        expires_at: new Date("2026-08-20T00:00:00.000Z"),
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("profile.resume_document_revisions")
      .values({
        id: ids.legacyContentRevision,
        owner_id: ids.owner,
        owner_epoch: 1,
        resume_analysis_id: null,
        revision: 1,
        base_revision: null,
        schema_version: "resume-document-v2",
        sections: JSON.stringify([
          {
            id: randomUUID(),
            blocks: [{ id: randomUUID(), suggestionDecision: "pending" }],
          },
        ]),
        content_hash: "3".repeat(64),
        confirmed_at: now,
        document_id: ids.baseDocument,
        document_revision: 1,
        base_document_revision_id: null,
      })
      .execute();
    await db
      .insertInto("profile.resume_layout_revisions")
      .values({
        id: ids.legacyLayoutRevision,
        owner_id: ids.owner,
        owner_epoch: 1,
        document_id: ids.baseDocument,
        layout_revision: 1,
        base_layout_revision: null,
        schema_version: "resume-layout-v1",
        template_key: "cn_classic_single_column",
        section_order: JSON.stringify([]),
        settings: JSON.stringify({}),
        content_hash: "4".repeat(64),
      })
      .execute();
    await db
      .updateTable("profile.resume_documents")
      .set({
        current_content_revision_id: ids.legacyContentRevision,
        current_layout_revision_id: ids.legacyLayoutRevision,
      })
      .where("id", "=", ids.baseDocument)
      .execute();

    await db
      .insertInto("profile.resume_documents")
      .values({
        id: ids.legacyDerivedDocument,
        owner_id: ids.owner,
        owner_epoch: 1,
        kind: "case_derived",
        title: "Synthetic legacy public tailored resume",
        case_id: ids.legacyCase,
        published_job_id: ids.publishedJob,
        published_job_version_id: ids.publishedVersion,
        requirement_set_id: ids.requirementSet,
        base_document_id: ids.baseDocument,
        base_document_revision_id: ids.legacyContentRevision,
        evidence_revision_id: ids.evidenceRevision,
        current_content_revision_id: null,
        current_layout_revision_id: null,
        revision: 1,
        creation_idempotency_key: `legacy-derived-${ids.legacyDerivedDocument}`,
        creation_request_hash: "a".repeat(64),
        expires_at: new Date("2026-08-20T00:00:00.000Z"),
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("profile.resume_document_revisions")
      .values({
        id: ids.legacyDerivedContentRevision,
        owner_id: ids.owner,
        owner_epoch: 1,
        resume_analysis_id: null,
        revision: 2,
        base_revision: 1,
        schema_version: "resume-document-v2",
        sections: JSON.stringify([
          {
            id: randomUUID(),
            blocks: [{ id: randomUUID(), suggestionDecision: "accepted" }],
          },
        ]),
        content_hash: "b".repeat(64),
        confirmed_at: now,
        document_id: ids.legacyDerivedDocument,
        document_revision: 1,
        base_document_revision_id: null,
      })
      .execute();
    await db
      .updateTable("profile.resume_documents")
      .set({ current_content_revision_id: ids.legacyDerivedContentRevision })
      .where("id", "=", ids.legacyDerivedDocument)
      .execute();

    await migrateToLatest(db);
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    if (emptyDb) await emptyDb.destroy();
    if (adminDb) {
      await sql.raw(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).execute(adminDb);
      await sql.raw(`DROP DATABASE IF EXISTS "${emptyDatabaseName}" WITH (FORCE)`).execute(adminDb);
      await adminDb.destroy();
    }
  }, 120_000);

  it("migrates empty and populated 025 databases through 026 without expiring accounts", async () => {
    const [migration, emptyMigration] = await Promise.all([
      sql<{ name: string }>`
        SELECT name FROM kysely_migration ORDER BY timestamp DESC LIMIT 1
      `.execute(db),
      sql<{ name: string }>`
        SELECT name FROM kysely_migration ORDER BY timestamp DESC LIMIT 1
      `.execute(emptyDb),
    ]);
    expect(migration.rows[0]?.name).toBe("030_resume_revision_mutation_receipts");
    expect(emptyMigration.rows[0]?.name).toBe("030_resume_revision_mutation_receipts");

    const accountOwner = await db
      .selectFrom("identity.owners")
      .select(["retention_mode", "retention_expires_at"])
      .where("id", "=", ids.owner)
      .executeTakeFirstOrThrow();
    expect(accountOwner).toEqual({
      retention_mode: "account_managed",
      retention_expires_at: null,
    });

    const legacyCase = await sql<{
      kind: string;
      jobVersionId: string;
      requirementSetId: string;
      expiresAt: Date | null;
    }>`
      SELECT
        job_context_kind AS kind,
        published_job_version_id AS "jobVersionId",
        requirement_set_id AS "requirementSetId",
        expires_at AS "expiresAt"
      FROM application.application_cases
      WHERE id = ${ids.legacyCase}
    `.execute(db);
    expect(legacyCase.rows[0]).toMatchObject({
      kind: "public",
      jobVersionId: ids.publishedVersion,
      requirementSetId: ids.requirementSet,
    });
    expect(legacyCase.rows[0]?.expiresAt).not.toBeNull();

    const legacyEvent = await sql<{ schemaVersion: string; eventData: unknown }>`
      SELECT
        schema_version AS "schemaVersion",
        event_data AS "eventData"
      FROM application.case_events
      WHERE id = ${ids.legacyEvent}
    `.execute(db);
    expect(legacyEvent.rows[0]).toEqual({
      schemaVersion: "legacy-case-event-v0",
      eventData: { stage: "interested" },
    });

    const legacyRequirementGraph = await sql<{
      kind: string;
      requirementSetRevision: number | null;
      stateRevision: number;
      userNote: string | null;
      evidenceStateId: string;
      evidenceRevision: number;
      questionStateId: string;
      questionRevision: number;
    }>`
      SELECT
        requirement_state.requirement_context_kind AS kind,
        requirement_state.requirement_set_revision AS "requirementSetRevision",
        requirement_state.revision AS "stateRevision",
        requirement_state.user_note AS "userNote",
        evidence_link.requirement_state_id AS "evidenceStateId",
        evidence_link.revision AS "evidenceRevision",
        question.requirement_state_id AS "questionStateId",
        question.revision AS "questionRevision"
      FROM application.case_requirement_states AS requirement_state
      JOIN application.case_requirement_evidence_links AS evidence_link
        ON evidence_link.id = ${ids.legacyEvidenceLink}
      JOIN application.case_questions AS question
        ON question.id = ${ids.legacyQuestion}
      WHERE requirement_state.id = ${ids.legacyRequirementState}
    `.execute(db);
    expect(legacyRequirementGraph.rows[0]).toEqual({
      kind: "public",
      requirementSetRevision: null,
      stateRevision: 3,
      userNote: "Preserve this synthetic note.",
      evidenceStateId: ids.legacyRequirementState,
      evidenceRevision: 2,
      questionStateId: ids.legacyRequirementState,
      questionRevision: 4,
    });

    const legacyResume = await sql<{ contentSchema: string; layoutSchema: string }>`
      SELECT
        revision.schema_version AS "contentSchema",
        layout.schema_version AS "layoutSchema"
      FROM profile.resume_document_revisions AS revision
      CROSS JOIN profile.resume_layout_revisions AS layout
      WHERE revision.id = ${ids.legacyContentRevision}
        AND layout.id = ${ids.legacyLayoutRevision}
    `.execute(db);
    expect(legacyResume.rows[0]).toEqual({
      contentSchema: "resume-document-v2",
      layoutSchema: "resume-layout-v1",
    });

    const legacyDerived = await sql<{
      contextKind: string;
      contextRevision: number;
      expiresAt: Date | null;
      suggestionDecision: string;
    }>`
      SELECT
        document.job_context_kind AS "contextKind",
        document.job_context_revision AS "contextRevision",
        document.expires_at AS "expiresAt",
        revision.sections -> 0 -> 'blocks' -> 0 ->> 'suggestionDecision'
          AS "suggestionDecision"
      FROM profile.resume_documents AS document
      JOIN profile.resume_document_revisions AS revision
        ON revision.id = document.current_content_revision_id
      WHERE document.id = ${ids.legacyDerivedDocument}
    `.execute(db);
    expect(legacyDerived.rows[0]).toMatchObject({
      contextKind: "public",
      contextRevision: 1,
      suggestionDecision: "accepted",
    });
    expect(legacyDerived.rows[0]?.expiresAt).not.toBeNull();
  });

  it("keeps migrations 026 through 029 rollback forward-only", async () => {
    await applicationCaseLongLivedForwardRepairMigration.down?.(db);
    await privateRequirementContextForwardRepairMigration.down?.(db);
    await resumeDocumentReviewForwardRepairMigration.down?.(db);
    await interviewDebriefKnowledgeExpandMigration.down?.(db);
    await caseMutationEventV2ForwardRepairMigration.down?.(db);
    const privateTable = await sql<{ name: string }>`
      SELECT to_regclass('application.private_job_snapshots')::text AS name
    `.execute(db);
    expect(privateTable.rows[0]?.name).toBe("application.private_job_snapshots");
  });

  it("accepts strict atomic Case mutation v2 events while rejecting empty changes", async () => {
    const result = await sql<{
      stateValid: boolean;
      evidenceValid: boolean;
      emptyEvidenceInvalid: boolean;
      questionInvalid: boolean;
    }>`
      SELECT
        application.is_valid_case_event_data(
          'requirement_state_changed',
          'case-event-v2',
          ${JSON.stringify({
            schemaVersion: "case-event-v2",
            requirementSetId: ids.requirementSet,
            requirementId: "requirement-sql",
            fromState: "confirmed",
            toState: "confirmed",
            noteChanged: true,
            reasonCode: "USER_UPDATED",
          })}::jsonb
        ) AS "stateValid",
        application.is_valid_case_event_data(
          'requirement_evidence_changed',
          'case-event-v2',
          ${JSON.stringify({
            schemaVersion: "case-event-v2",
            requirementContextKind: "private",
            requirementSetRevision: 1,
            requirementId: "requirement-sql",
            evidenceRevisionId: ids.evidenceRevision,
            linkedEvidenceIds: ["evidence-new"],
            removedEvidenceIds: ["evidence-old"],
          })}::jsonb
        ) AS "evidenceValid",
        NOT application.is_valid_case_event_data(
          'requirement_evidence_changed',
          'case-event-v2',
          ${JSON.stringify({
            schemaVersion: "case-event-v2",
            requirementSetId: ids.requirementSet,
            requirementId: "requirement-sql",
            evidenceRevisionId: ids.evidenceRevision,
            linkedEvidenceIds: [],
            removedEvidenceIds: [],
          })}::jsonb
        ) AS "emptyEvidenceInvalid",
        NOT application.is_valid_case_event_data(
          'question_updated',
          'case-event-v2',
          ${JSON.stringify({
            schemaVersion: "case-event-v2",
            questionId: ids.privateQuestion,
            fromStatus: "open",
            toStatus: "open",
            answerChanged: false,
          })}::jsonb
        ) AS "questionInvalid"
    `.execute(db);
    expect(result.rows[0]).toEqual({
      stateValid: true,
      evidenceValid: true,
      emptyEvidenceInvalid: true,
      questionInvalid: true,
    });
  });

  it("supports owner-only private JD cases without a TTL or official URL", async () => {
    await sql`
      INSERT INTO application.private_job_snapshots (
        id,
        owner_id,
        owner_epoch,
        creation_idempotency_key,
        creation_request_hash
      ) VALUES (
        ${ids.privateSnapshot},
        ${ids.owner},
        1,
        ${`private-snapshot-${ids.privateSnapshot}`},
        ${"5".repeat(64)}
      )
    `.execute(db);
    await sql`
      INSERT INTO application.private_job_snapshot_revisions (
        id,
        owner_id,
        owner_epoch,
        snapshot_id,
        content_revision,
        requirement_set_revision,
        title,
        company_name,
        source_label,
        official_url,
        source_provided,
        content_text,
        requirements,
        content_hash
      ) VALUES (
        ${ids.privateSnapshotRevision},
        ${ids.owner},
        1,
        ${ids.privateSnapshot},
        1,
        1,
        'Synthetic private internship',
        NULL,
        'user_pasted',
        NULL,
        false,
        'Synthetic private JD for isolated tests only.',
        '[]'::jsonb,
        ${"6".repeat(64)}
      )
    `.execute(db);
    await sql`
      UPDATE application.private_job_snapshots
      SET
        current_content_revision = 1,
        current_requirement_set_revision = 1,
        updated_at = now()
      WHERE id = ${ids.privateSnapshot}
    `.execute(db);
    await sql`
      INSERT INTO application.application_cases (
        id,
        owner_id,
        owner_epoch,
        published_job_id,
        published_job_version_id,
        requirement_set_id,
        job_context_kind,
        private_job_snapshot_id,
        job_context_revision,
        stage,
        outcome,
        creation_idempotency_key,
        creation_request_hash,
        expires_at,
        ended_at,
        deleted_at
      ) VALUES (
        ${ids.privateCase},
        ${ids.owner},
        1,
        NULL,
        NULL,
        NULL,
        'private',
        ${ids.privateSnapshot},
        1,
        'interested',
        NULL,
        ${`private-case-${ids.privateCase}`},
        ${"7".repeat(64)},
        NULL,
        NULL,
        NULL
      )
    `.execute(db);

    const privateCase = await sql<{ expiresAt: Date | null; officialUrl: string | null }>`
      SELECT
        cases.expires_at AS "expiresAt",
        revisions.official_url AS "officialUrl"
      FROM application.application_cases AS cases
      JOIN application.private_job_snapshot_revisions AS revisions
        ON revisions.owner_id = cases.owner_id
        AND revisions.snapshot_id = cases.private_job_snapshot_id
        AND revisions.content_revision = cases.job_context_revision
      WHERE cases.id = ${ids.privateCase}
    `.execute(db);
    expect(privateCase.rows[0]).toEqual({ expiresAt: null, officialUrl: null });

    await expect(
      sql`
        INSERT INTO application.application_cases (
          owner_id,
          owner_epoch,
          published_job_id,
          published_job_version_id,
          requirement_set_id,
          job_context_kind,
          private_job_snapshot_id,
          job_context_revision,
          creation_idempotency_key,
          creation_request_hash,
          expires_at,
          outcome,
          ended_at,
          deleted_at
        ) VALUES (
          ${ids.otherOwner},
          1,
          NULL,
          NULL,
          NULL,
          'private',
          ${ids.privateSnapshot},
          1,
          ${`cross-owner-private-${randomUUID()}`},
          ${"8".repeat(64)},
          NULL,
          NULL,
          NULL,
          NULL
        )
      `.execute(db),
    ).rejects.toMatchObject({ code: "23503" });

    await expect(
      sql`
        INSERT INTO application.application_cases (
          owner_id,
          owner_epoch,
          published_job_id,
          published_job_version_id,
          requirement_set_id,
          job_context_kind,
          private_job_snapshot_id,
          job_context_revision,
          creation_idempotency_key,
          creation_request_hash,
          expires_at,
          outcome,
          ended_at,
          deleted_at
        ) VALUES (
          ${ids.owner},
          1,
          ${ids.publishedJob},
          ${ids.publishedVersion},
          ${ids.requirementSet},
          'private',
          ${ids.privateSnapshot},
          1,
          ${`mixed-private-${randomUUID()}`},
          ${"9".repeat(64)},
          NULL,
          NULL,
          NULL,
          NULL
        )
      `.execute(db),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("supports private requirement states, evidence links and questions by state ID", async () => {
    await sql`
      INSERT INTO application.case_requirement_states (
        id,
        owner_id,
        owner_epoch,
        case_id,
        requirement_context_kind,
        requirement_set_id,
        requirement_set_revision,
        requirement_id,
        state,
        user_note,
        revision
      ) VALUES (
        ${ids.privateRequirementState},
        ${ids.owner},
        1,
        ${ids.privateCase},
        'private',
        NULL,
        1,
        'private-requirement',
        'confirmed',
        NULL,
        1
      )
    `.execute(db);
    await sql`
      INSERT INTO application.case_requirement_evidence_links (
        id,
        owner_id,
        owner_epoch,
        case_id,
        requirement_state_id,
        requirement_set_id,
        requirement_id,
        evidence_revision_id,
        evidence_id,
        revision,
        removed_at
      ) VALUES (
        ${ids.privateEvidenceLink},
        ${ids.owner},
        1,
        ${ids.privateCase},
        ${ids.privateRequirementState},
        NULL,
        'private-requirement',
        ${ids.evidenceRevision},
        'evidence-1',
        1,
        NULL
      )
    `.execute(db);
    await sql`
      INSERT INTO application.case_questions (
        id,
        owner_id,
        owner_epoch,
        case_id,
        requirement_state_id,
        requirement_set_id,
        requirement_id,
        question,
        answer,
        status,
        revision
      ) VALUES (
        ${ids.privateQuestion},
        ${ids.owner},
        1,
        ${ids.privateCase},
        ${ids.privateRequirementState},
        NULL,
        'private-requirement',
        'What evidence is still needed?',
        NULL,
        'open',
        1
      )
    `.execute(db);
    await sql`
      INSERT INTO application.case_questions (
        id,
        owner_id,
        owner_epoch,
        case_id,
        requirement_state_id,
        requirement_set_id,
        requirement_id,
        question,
        answer,
        status,
        revision
      ) VALUES (
        ${ids.privateUnscopedQuestion},
        ${ids.owner},
        1,
        ${ids.privateCase},
        NULL,
        NULL,
        NULL,
        'Unscoped synthetic question?',
        NULL,
        'open',
        1
      )
    `.execute(db);

    const graph = await sql<{
      requirementStateId: string;
      evidenceSetId: string | null;
      questionSetId: string | null;
    }>`
      SELECT
        requirement_state.id AS "requirementStateId",
        evidence_link.requirement_set_id AS "evidenceSetId",
        question.requirement_set_id AS "questionSetId"
      FROM application.case_requirement_states AS requirement_state
      JOIN application.case_requirement_evidence_links AS evidence_link
        ON evidence_link.requirement_state_id = requirement_state.id
      JOIN application.case_questions AS question
        ON question.requirement_state_id = requirement_state.id
      WHERE requirement_state.id = ${ids.privateRequirementState}
    `.execute(db);
    expect(graph.rows[0]).toEqual({
      requirementStateId: ids.privateRequirementState,
      evidenceSetId: null,
      questionSetId: null,
    });

    await expect(
      sql`
        INSERT INTO application.case_requirement_states (
          owner_id,
          owner_epoch,
          case_id,
          requirement_context_kind,
          requirement_set_id,
          requirement_set_revision,
          requirement_id,
          state,
          revision
        ) VALUES (
          ${ids.owner},
          1,
          ${ids.privateCase},
          'private',
          NULL,
          2,
          'wrong-private-revision',
          'unconfirmed',
          1
        )
      `.execute(db),
    ).rejects.toThrow(/PRIVATE_REQUIREMENT_STATE_CONTEXT_MISMATCH/);

    await expect(
      sql`
        INSERT INTO application.case_requirement_states (
          owner_id,
          owner_epoch,
          case_id,
          requirement_context_kind,
          requirement_set_id,
          requirement_set_revision,
          requirement_id,
          state,
          revision
        ) VALUES (
          ${ids.owner},
          1,
          ${ids.privateCase},
          'public',
          ${ids.requirementSet},
          NULL,
          'wrong-context-kind',
          'unconfirmed',
          1
        )
      `.execute(db),
    ).rejects.toThrow(/REQUIREMENT_STATE_CONTEXT_KIND_MISMATCH/);

    await expect(
      sql`
        INSERT INTO application.case_requirement_evidence_links (
          owner_id,
          owner_epoch,
          case_id,
          requirement_state_id,
          requirement_set_id,
          requirement_id,
          evidence_revision_id,
          evidence_id,
          revision
        ) VALUES (
          ${ids.otherOwner},
          1,
          ${ids.privateCase},
          ${ids.privateRequirementState},
          NULL,
          'private-requirement',
          ${ids.otherEvidenceRevision},
          'cross-owner-evidence',
          1
        )
      `.execute(db),
    ).rejects.toThrow(/REQUIREMENT_STATE_REFERENCE_NOT_FOUND/);

    await expect(
      sql`
        UPDATE application.case_requirement_states
        SET requirement_id = 'mutated-requirement'
        WHERE id = ${ids.privateRequirementState}
      `.execute(db),
    ).rejects.toThrow(/IMMUTABLE_REQUIREMENT_STATE_CONTEXT/);

    await privateRequirementContextForwardRepairMigration.down?.(db);
    const retained = await sql<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM application.case_requirement_states
      WHERE id = ${ids.privateRequirementState}
    `.execute(db);
    expect(retained.rows[0]?.count).toBe(1);
  });

  it("accepts only strict new Case events and keeps legacy events read-only", async () => {
    const validData = {
      schemaVersion: "case-event-v1",
      initialStage: "interested",
      jobContextKind: "private",
      jobContextRevision: 1,
    };
    await sql`
      INSERT INTO application.case_events (
        id,
        owner_id,
        owner_epoch,
        case_id,
        sequence,
        event_type,
        actor_type,
        event_data,
        idempotency_scope,
        idempotency_key,
        request_hash
      ) VALUES (
        ${ids.privateEvent},
        ${ids.owner},
        1,
        ${ids.privateCase},
        1,
        'case_created',
        'owner',
        ${JSON.stringify(validData)}::jsonb,
        'private-case:create',
        ${`private-event-${ids.privateEvent}`},
        ${"a".repeat(64)}
      )
    `.execute(db);

    await sql`
      INSERT INTO application.case_events (
        owner_id,
        owner_epoch,
        case_id,
        sequence,
        event_type,
        actor_type,
        event_data,
        idempotency_scope,
        idempotency_key,
        request_hash
      ) VALUES (
        ${ids.owner},
        1,
        ${ids.privateCase},
        2,
        'requirement_state_changed',
        'owner',
        ${JSON.stringify({
          schemaVersion: "case-event-v1",
          requirementContextKind: "private",
          requirementSetRevision: 1,
          requirementId: "private-requirement",
          fromState: null,
          toState: "confirmed",
          reasonCode: null,
        })}::jsonb,
        'private-requirement:state',
        ${`private-requirement-event-${randomUUID()}`},
        ${"b".repeat(64)}
      )
    `.execute(db);

    await sql`
      INSERT INTO application.case_events (
        owner_id,
        owner_epoch,
        case_id,
        sequence,
        event_type,
        actor_type,
        event_data,
        idempotency_scope,
        idempotency_key,
        request_hash
      ) VALUES (
        ${ids.owner},
        1,
        ${ids.legacyCase},
        2,
        'requirement_evidence_changed',
        'owner',
        ${JSON.stringify({
          schemaVersion: "case-event-v1",
          requirementSetId: ids.requirementSet,
          requirementId: "legacy-requirement",
          evidenceRevisionId: ids.evidenceRevision,
          evidenceIds: ["legacy-evidence"],
          action: "linked",
        })}::jsonb,
        'public-requirement:evidence',
        ${`public-requirement-event-${randomUUID()}`},
        ${"c".repeat(64)}
      )
    `.execute(db);

    await expect(
      sql`
        INSERT INTO application.case_events (
          owner_id,
          owner_epoch,
          case_id,
          sequence,
          event_type,
          actor_type,
          event_data,
          idempotency_scope,
          idempotency_key,
          request_hash
        ) VALUES (
          ${ids.owner},
          1,
          ${ids.privateCase},
          3,
          'case_created',
          'owner',
          ${JSON.stringify({ ...validData, jdText: "must not enter events" })}::jsonb,
          'private-case:invalid',
          ${`invalid-event-${randomUUID()}`},
          ${"b".repeat(64)}
        )
      `.execute(db),
    ).rejects.toThrow(/INVALID_CASE_EVENT_DATA/);

    await expect(
      sql`
        INSERT INTO application.case_events (
          owner_id,
          owner_epoch,
          case_id,
          sequence,
          event_type,
          actor_type,
          event_data,
          idempotency_scope,
          idempotency_key,
          request_hash
        ) VALUES (
          ${ids.owner},
          1,
          ${ids.privateCase},
          3,
          'case_created',
          'owner',
          ${JSON.stringify({ ...validData, jobContextRevision: "not-an-integer" })}::jsonb,
          'private-case:invalid-type',
          ${`invalid-type-event-${randomUUID()}`},
          ${"b".repeat(64)}
        )
      `.execute(db),
    ).rejects.toThrow(/INVALID_CASE_EVENT_DATA/);

    await expect(
      sql`
        INSERT INTO application.case_events (
          owner_id,
          owner_epoch,
          case_id,
          sequence,
          event_type,
          actor_type,
          event_data,
          idempotency_scope,
          idempotency_key,
          request_hash
        ) VALUES (
          ${ids.owner},
          1,
          ${ids.privateCase},
          3,
          'requirement_state_changed',
          'owner',
          ${JSON.stringify({
            schemaVersion: "case-event-v1",
            requirementContextKind: "private",
            requirementSetRevision: 1,
            requirementSetId: ids.requirementSet,
            requirementId: "private-requirement",
            fromState: null,
            toState: "confirmed",
            reasonCode: null,
          })}::jsonb,
          'private-requirement:invalid',
          ${`invalid-private-requirement-event-${randomUUID()}`},
          ${"d".repeat(64)}
        )
      `.execute(db),
    ).rejects.toThrow(/INVALID_CASE_EVENT_DATA/);

    await expect(
      sql`
        INSERT INTO application.case_events (
          owner_id,
          owner_epoch,
          case_id,
          sequence,
          event_type,
          actor_type,
          event_data,
          schema_version,
          idempotency_scope,
          idempotency_key,
          request_hash
        ) VALUES (
          ${ids.owner},
          1,
          ${ids.privateCase},
          3,
          'case_created',
          'system',
          '{}'::jsonb,
          'legacy-case-event-v0',
          'private-case:legacy',
          ${`legacy-event-${randomUUID()}`},
          ${"c".repeat(64)}
        )
      `.execute(db),
    ).rejects.toThrow(/LEGACY_CASE_EVENT_READ_ONLY/);

    await expect(
      sql`
        UPDATE application.case_events
        SET event_data = ${JSON.stringify({ ...validData, initialStage: "preparing" })}::jsonb
        WHERE id = ${ids.privateEvent}
      `.execute(db),
    ).rejects.toThrow(/IMMUTABLE_CASE_EVENT/);
  });

  it("separates long-lived Resume content, strict layout and private Case references", async () => {
    const sectionId = ids.semanticSection;
    const blockId = ids.semanticBlock;
    await sql`
      INSERT INTO profile.resume_document_revisions (
        id,
        owner_id,
        owner_epoch,
        resume_analysis_id,
        revision,
        base_revision,
        schema_version,
        sections,
        content_hash,
        confirmed_at,
        document_id,
        document_revision,
        base_document_revision_id
      ) VALUES (
        ${ids.semanticBaseRevision},
        ${ids.owner},
        1,
        NULL,
        3,
        2,
        'resume-content-v1',
        ${JSON.stringify([
          {
            id: sectionId,
            ordinal: 0,
            title: "Synthetic project",
            blocks: [
              {
                id: blockId,
                ordinal: 0,
                text: "Synthetic confirmed statement",
                evidenceIds: ["evidence-1"],
              },
            ],
          },
        ])}::jsonb,
        ${"d".repeat(64)},
        now(),
        ${ids.baseDocument},
        2,
        ${ids.legacyContentRevision}
      )
    `.execute(db);

    await expect(
      sql`
        INSERT INTO profile.resume_document_revisions (
          owner_id,
          owner_epoch,
          resume_analysis_id,
          revision,
          base_revision,
          schema_version,
          sections,
          content_hash,
          confirmed_at,
          document_id,
          document_revision,
          base_document_revision_id
        ) VALUES (
          ${ids.owner},
          1,
          NULL,
          4,
          3,
          'resume-content-v1',
          ${JSON.stringify([
            {
              id: sectionId,
              blocks: [{ id: blockId, suggestionDecision: "accepted" }],
            },
          ])}::jsonb,
          ${"e".repeat(64)},
          now(),
          ${ids.baseDocument},
          3,
          ${ids.semanticBaseRevision}
        )
      `.execute(db),
    ).rejects.toThrow(/INVALID_RESUME_SEMANTIC_CONTENT/);

    const layoutSettings = {
      schemaVersion: "resume-layout-settings-v1",
      fontSizeToken: "standard",
      lineSpacingToken: "standard",
      sectionSpacingToken: "tight",
      colorToken: "charcoal",
      pageBreakPolicy: "keep_sections",
    };
    await sql`
      INSERT INTO profile.resume_layout_revisions (
        id,
        owner_id,
        owner_epoch,
        document_id,
        layout_revision,
        base_layout_revision,
        schema_version,
        template_key,
        section_order,
        settings,
        content_hash
      ) VALUES (
        ${ids.strictLayoutRevision},
        ${ids.owner},
        1,
        ${ids.baseDocument},
        2,
        1,
        'resume-layout-v2',
        'cn_classic_single_column',
        ${JSON.stringify([sectionId])}::jsonb,
        ${JSON.stringify(layoutSettings)}::jsonb,
        ${"f".repeat(64)}
      )
    `.execute(db);

    await expect(
      sql`
        INSERT INTO profile.resume_layout_revisions (
          owner_id,
          owner_epoch,
          document_id,
          layout_revision,
          base_layout_revision,
          schema_version,
          template_key,
          section_order,
          settings,
          content_hash
        ) VALUES (
          ${ids.owner},
          1,
          ${ids.baseDocument},
          3,
          2,
          'resume-layout-v2',
          'cn_classic_single_column',
          ${JSON.stringify([sectionId])}::jsonb,
          ${JSON.stringify({ ...layoutSettings, css: "body{}" })}::jsonb,
          ${"0".repeat(64)}
        )
      `.execute(db),
    ).rejects.toThrow(/INVALID_RESUME_LAYOUT_SETTINGS/);

    await sql`
      INSERT INTO profile.resume_documents (
        id,
        owner_id,
        owner_epoch,
        kind,
        title,
        case_id,
        detached_from_case_id,
        published_job_id,
        published_job_version_id,
        requirement_set_id,
        private_job_snapshot_id,
        job_context_kind,
        job_context_revision,
        base_document_id,
        base_document_revision_id,
        evidence_revision_id,
        current_content_revision_id,
        current_layout_revision_id,
        revision,
        creation_idempotency_key,
        creation_request_hash,
        expires_at,
        deleted_at
      ) VALUES (
        ${ids.derivedDocument},
        ${ids.owner},
        1,
        'case_derived',
        'Synthetic private tailored resume',
        ${ids.privateCase},
        NULL,
        NULL,
        NULL,
        NULL,
        ${ids.privateSnapshot},
        'private',
        1,
        ${ids.baseDocument},
        ${ids.semanticBaseRevision},
        ${ids.evidenceRevision},
        NULL,
        NULL,
        1,
        ${`derived-document-${ids.derivedDocument}`},
        ${"1".repeat(64)},
        NULL,
        NULL
      )
    `.execute(db);

    await sql`
      INSERT INTO profile.resume_document_revisions (
        id,
        owner_id,
        owner_epoch,
        resume_analysis_id,
        revision,
        base_revision,
        schema_version,
        sections,
        content_hash,
        confirmed_at,
        document_id,
        document_revision,
        base_document_revision_id
      ) VALUES (
        ${ids.derivedContentRevision},
        ${ids.owner},
        1,
        NULL,
        4,
        3,
        'resume-content-v1',
        ${JSON.stringify([
          {
            id: sectionId,
            ordinal: 0,
            title: "Synthetic project",
            blocks: [
              {
                id: blockId,
                ordinal: 0,
                text: "Synthetic tailored statement",
                evidenceIds: ["evidence-1"],
              },
            ],
          },
        ])}::jsonb,
        ${"2".repeat(64)},
        now(),
        ${ids.derivedDocument},
        1,
        NULL
      )
    `.execute(db);
    await sql`
      UPDATE profile.resume_documents
      SET current_content_revision_id = ${ids.derivedContentRevision}, updated_at = now()
      WHERE id = ${ids.derivedDocument}
    `.execute(db);

    const derived = await sql<{ expiresAt: Date | null; kind: string }>`
      SELECT expires_at AS "expiresAt", job_context_kind AS kind
      FROM profile.resume_documents
      WHERE id = ${ids.derivedDocument}
    `.execute(db);
    expect(derived.rows[0]).toEqual({ expiresAt: null, kind: "private" });
  });

  it("keeps Interview, Debrief and Knowledge evidence-bound and owner-private", async () => {
    await db
      .insertInto("application.interview_sessions")
      .values({
        id: ids.interviewSession,
        owner_id: ids.owner,
        owner_epoch: 1,
        case_id: ids.privateCase,
        detached_from_case_id: null,
        job_context_kind: "private",
        published_job_id: null,
        published_job_version_id: null,
        requirement_set_id: null,
        private_job_snapshot_id: ids.privateSnapshot,
        job_context_revision: 1,
        evidence_revision_id: ids.evidenceRevision,
        resume_document_id: ids.derivedDocument,
        resume_content_revision_id: ids.derivedContentRevision,
        mode: "template",
        status: "active",
        template_version: "template-v1",
        prompt_version: null,
        provider_adapter: null,
        model: null,
        creation_idempotency_key: `interview-${ids.interviewSession}`,
        creation_request_hash: "3".repeat(64),
        completed_at: null,
        deleted_at: null,
      })
      .execute();

    await db
      .insertInto("application.interview_turns")
      .values([
        {
          id: ids.interviewQuestionTurn,
          owner_id: ids.owner,
          owner_epoch: 1,
          interview_session_id: ids.interviewSession,
          sequence: 1,
          kind: "question",
          content: "Describe the confirmed product example.",
          requirement_ids: JSON.stringify(["private-requirement"]),
          evidence_ids: JSON.stringify([]),
        },
        {
          id: ids.interviewAnswerTurn,
          owner_id: ids.owner,
          owner_epoch: 1,
          interview_session_id: ids.interviewSession,
          sequence: 2,
          kind: "answer",
          content: "Synthetic answer grounded in the confirmed example.",
          requirement_ids: JSON.stringify(["private-requirement"]),
          evidence_ids: JSON.stringify(["evidence-1"]),
        },
      ])
      .execute();

    await expect(
      db
        .insertInto("application.interview_turns")
        .values({
          owner_id: ids.owner,
          owner_epoch: 1,
          interview_session_id: ids.interviewSession,
          sequence: 3,
          kind: "follow_up",
          content: "Synthetic unsupported follow-up.",
          requirement_ids: JSON.stringify(["private-requirement"]),
          evidence_ids: JSON.stringify(["invented-evidence"]),
        })
        .execute(),
    ).rejects.toThrow(/INTERVIEW_EVIDENCE_NOT_CONFIRMED/);

    await db
      .updateTable("application.interview_sessions")
      .set({
        status: "completed",
        revision: 2,
        completed_at: sql<Date>`GREATEST(created_at, clock_timestamp())`,
        updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
      })
      .where("id", "=", ids.interviewSession)
      .executeTakeFirstOrThrow();

    const feedback = {
      schemaVersion: "interview-feedback-v1",
      summary: "The answer needs a clearer evidence chain.",
      strengths: ["Direct response"],
      items: [
        {
          id: ids.interviewFeedbackItem,
          category: "evidence",
          severity: "warning",
          message: "The result is not connected clearly enough.",
          improvement: "State the action and cite the confirmed result.",
          turnIds: [ids.interviewAnswerTurn],
          requirementIds: ["private-requirement"],
          evidenceIds: ["evidence-1"],
        },
      ],
      practicePriorities: ["Evidence-first STAR answer"],
    };
    await expect(
      sql`
        INSERT INTO application.interview_feedback (
          owner_id,
          owner_epoch,
          interview_session_id,
          revision,
          generator_mode,
          feedback
        ) VALUES (
          ${ids.owner},
          1,
          ${ids.interviewSession},
          1,
          'template',
          ${JSON.stringify({ ...feedback, atsScore: 98 })}::jsonb
        )
      `.execute(db),
    ).rejects.toMatchObject({ code: "23514" });

    await db
      .insertInto("application.interview_feedback")
      .values({
        id: ids.interviewFeedback,
        owner_id: ids.owner,
        owner_epoch: 1,
        interview_session_id: ids.interviewSession,
        revision: 1,
        generator_mode: "template",
        feedback: JSON.stringify(feedback),
      })
      .execute();

    await db
      .insertInto("application.debriefs")
      .values({
        id: ids.debrief,
        owner_id: ids.owner,
        owner_epoch: 1,
        case_id: ids.privateCase,
        detached_from_case_id: null,
        interview_session_id: ids.interviewSession,
        job_context_kind: "private",
        published_job_id: null,
        published_job_version_id: null,
        requirement_set_id: null,
        private_job_snapshot_id: ids.privateSnapshot,
        job_context_revision: 1,
        evidence_revision_id: ids.evidenceRevision,
        expression_issues: JSON.stringify([
          {
            id: ids.debriefIssue,
            description: "The answer was too broad.",
            turnIds: [ids.interviewAnswerTurn],
          },
        ]),
        evidence_gaps: JSON.stringify([
          {
            id: ids.debriefGap,
            description: "The confirmed result needs a clearer explanation.",
            requirementIds: ["private-requirement"],
          },
        ]),
        practice_plan: JSON.stringify([
          {
            id: ids.debriefPractice,
            action: "Practice a concise evidence-first STAR answer.",
            targetDate: null,
          },
        ]),
        status: "draft",
        creation_idempotency_key: `debrief-${ids.debrief}`,
        creation_request_hash: "4".repeat(64),
        confirmed_at: null,
        deleted_at: null,
      })
      .execute();

    await db
      .insertInto("application.debrief_confirmations")
      .values({
        id: ids.debriefConfirmation,
        owner_id: ids.owner,
        owner_epoch: 1,
        debrief_id: ids.debrief,
        based_on_debrief_revision: 1,
        idempotency_key_hash: "5".repeat(64),
      })
      .execute();
    expect(
      await db
        .selectFrom("application.debriefs")
        .select(["status", "revision", "confirmed_at"])
        .where("id", "=", ids.debrief)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ status: "confirmed", revision: 2 });

    await expect(
      db
        .updateTable("application.debriefs")
        .set({
          expression_issues: JSON.stringify([]),
          revision: 3,
          updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
        })
        .where("id", "=", ids.debrief)
        .execute(),
    ).rejects.toThrow(/CONFIRMED_DEBRIEF_IMMUTABLE/);

    await db
      .insertInto("application.knowledge_clips")
      .values({
        id: ids.knowledgeClip,
        owner_id: ids.owner,
        owner_epoch: 1,
        url: "https://example.test/interview-guide",
        title: "Synthetic interview guide",
        summary: "A short owner-saved summary.",
        use_cases: JSON.stringify(["Product interview"]),
        user_notes: null,
        verified_at: new Date(),
        creation_idempotency_key: `knowledge-${ids.knowledgeClip}`,
        creation_request_hash: "6".repeat(64),
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("application.knowledge_clip_case_links")
      .values({
        id: ids.knowledgeClipLink,
        owner_id: ids.owner,
        owner_epoch: 1,
        knowledge_clip_id: ids.knowledgeClip,
        case_id: ids.privateCase,
      })
      .execute();
    await expect(
      db
        .insertInto("application.knowledge_clip_case_links")
        .values({
          owner_id: ids.otherOwner,
          owner_epoch: 1,
          knowledge_clip_id: ids.knowledgeClip,
          case_id: ids.privateCase,
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("keeps Review decisions evidence-bound and separate from Resume content", async () => {
    const resultSectionId = randomUUID();
    const resultBlockId = randomUUID();
    await db
      .insertInto("application.private_job_snapshot_revisions")
      .values({
        id: ids.privateSnapshotRevision2,
        owner_id: ids.owner,
        owner_epoch: 1,
        snapshot_id: ids.privateSnapshot,
        content_revision: 2,
        requirement_set_revision: 2,
        title: "Synthetic private product intern v2",
        company_name: "Synthetic private company",
        source_label: "owner_pasted",
        official_url: null,
        source_provided: false,
        content_text: "Synthetic private JD revision two.",
        requirements: JSON.stringify([]),
        content_hash: "c".repeat(64),
      })
      .execute();
    await db
      .updateTable("application.private_job_snapshots")
      .set({ current_content_revision: 2, current_requirement_set_revision: 2 })
      .where("id", "=", ids.privateSnapshot)
      .executeTakeFirstOrThrow();
    await db
      .updateTable("application.application_cases")
      .set({ job_context_revision: 2, revision: sql`revision + 1`, updated_at: sql`now()` })
      .where("id", "=", ids.privateCase)
      .executeTakeFirstOrThrow();

    await sql`
      INSERT INTO profile.resume_review_runs (
        id,
        owner_id,
        owner_epoch,
        case_id,
        detached_from_case_id,
        document_id,
        content_revision_id,
        job_context_kind,
        published_job_id,
        published_job_version_id,
        requirement_set_id,
        private_job_snapshot_id,
        job_context_revision,
        evidence_revision_id,
        mode,
        status,
        revision,
        creation_idempotency_key,
        creation_request_hash,
        completed_at,
        deleted_at
      ) VALUES (
        ${ids.reviewRun},
        ${ids.owner},
        1,
        ${ids.privateCase},
        NULL,
        ${ids.derivedDocument},
        ${ids.derivedContentRevision},
        'private',
        NULL,
        NULL,
        NULL,
        ${ids.privateSnapshot},
        1,
        ${ids.evidenceRevision},
        'template',
        'pending',
        1,
        ${`review-run-${ids.reviewRun}`},
        ${"3".repeat(64)},
        NULL,
        NULL
      )
    `.execute(db);
    const pinnedVersions = await sql<{ caseRevision: number; reviewRevision: number }>`
      SELECT
        application_case.job_context_revision AS "caseRevision",
        review.job_context_revision AS "reviewRevision"
      FROM application.application_cases AS application_case
      JOIN profile.resume_review_runs AS review ON review.case_id = application_case.id
      WHERE review.id = ${ids.reviewRun}
    `.execute(db);
    expect(pinnedVersions.rows[0]).toEqual({ caseRevision: 2, reviewRevision: 1 });
    await expect(
      db
        .updateTable("profile.resume_review_runs")
        .set({
          status: "superseded",
          revision: 2,
          completed_at: sql<Date>`GREATEST(created_at, clock_timestamp())`,
          updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
        })
        .where("id", "=", ids.reviewRun)
        .execute(),
    ).rejects.toThrow(/INVALID_REVIEW_RUN_TRANSITION/);
    await sql`
      INSERT INTO profile.resume_review_findings (
        id,
        owner_id,
        owner_epoch,
        review_run_id,
        category,
        severity,
        source_block_id,
        evidence_ids,
        reason_code
      ) VALUES (
        ${ids.finding},
        ${ids.owner},
        1,
        ${ids.reviewRun},
        'expression_clarity',
        'warning',
        ${ids.semanticBlock},
        ${JSON.stringify(["evidence-1"])}::jsonb,
        'EXPRESSION_TOO_VAGUE'
      )
    `.execute(db);
    await sql`
      INSERT INTO profile.resume_review_suggestions (
        id,
        owner_id,
        owner_epoch,
        review_run_id,
        finding_id,
        target_type,
        target_ids,
        change_type,
        suggested_text,
        evidence_ids,
        decision,
        revision
      ) VALUES (
        ${ids.suggestion},
        ${ids.owner},
        1,
        ${ids.reviewRun},
        ${ids.finding},
        'block',
        ${JSON.stringify([ids.semanticBlock])}::jsonb,
        'rewrite_block',
        'Synthetic evidence-backed rewrite',
        ${JSON.stringify(["evidence-1"])}::jsonb,
        'pending',
        1
      )
    `.execute(db);

    await expect(
      sql`
        INSERT INTO profile.resume_review_suggestions (
          owner_id,
          owner_epoch,
          review_run_id,
          finding_id,
          target_type,
          target_ids,
          change_type,
          suggested_text,
          evidence_ids,
          decision,
          revision
        ) VALUES (
          ${ids.owner},
          1,
          ${ids.reviewRun},
          ${ids.finding},
          'block',
          ${JSON.stringify([ids.semanticBlock])}::jsonb,
          'rewrite_block',
          'Unsupported rewrite',
          ${JSON.stringify(["not-confirmed"])}::jsonb,
          'pending',
          1
        )
      `.execute(db),
    ).rejects.toThrow(/REVIEW_EVIDENCE_NOT_CONFIRMED/);

    await sql`
      INSERT INTO profile.resume_document_revisions (
        id,
        owner_id,
        owner_epoch,
        resume_analysis_id,
        revision,
        base_revision,
        schema_version,
        sections,
        content_hash,
        confirmed_at,
        document_id,
        document_revision,
        base_document_revision_id
      ) VALUES (
        ${ids.resultContentRevision},
        ${ids.owner},
        1,
        NULL,
        5,
        4,
        'resume-content-v1',
        ${JSON.stringify([
          {
            id: resultSectionId,
            ordinal: 0,
            title: "Synthetic project",
            blocks: [
              {
                id: resultBlockId,
                ordinal: 0,
                text: "Synthetic accepted statement",
                evidenceIds: ["evidence-1"],
              },
            ],
          },
        ])}::jsonb,
        ${"4".repeat(64)},
        now(),
        ${ids.derivedDocument},
        2,
        ${ids.derivedContentRevision}
      )
    `.execute(db);
    await expect(
      db
        .insertInto("profile.resume_review_decisions")
        .values({
          owner_id: ids.owner,
          owner_epoch: 1,
          review_run_id: ids.reviewRun,
          suggestion_id: ids.suggestion,
          document_id: ids.derivedDocument,
          based_on_suggestion_revision: 1,
          idempotency_key_hash: "7".repeat(64),
          decision: "accepted",
          edited_text: null,
          result_content_revision_id: ids.derivedContentRevision,
          reason_code: null,
        })
        .execute(),
    ).rejects.toThrow(/REVIEW_DECISION_REQUIRES_NEW_CONTENT_REVISION/);
    await sql`
      INSERT INTO profile.resume_review_decisions (
        id,
        owner_id,
        owner_epoch,
        review_run_id,
        suggestion_id,
        document_id,
        based_on_suggestion_revision,
        idempotency_key_hash,
        decision,
        edited_text,
        result_content_revision_id,
        reason_code
      ) VALUES (
        ${ids.decision},
        ${ids.owner},
        1,
        ${ids.reviewRun},
        ${ids.suggestion},
        ${ids.derivedDocument},
        1,
        ${"5".repeat(64)},
        'accepted',
        NULL,
        ${ids.resultContentRevision},
        NULL
      )
    `.execute(db);
    expect(
      await db
        .selectFrom("profile.resume_review_suggestions")
        .select(["decision", "revision"])
        .where("id", "=", ids.suggestion)
        .executeTakeFirstOrThrow(),
    ).toEqual({ decision: "accepted", revision: 2 });

    const document = await sql<{ currentContentRevisionId: string | null }>`
      SELECT current_content_revision_id AS "currentContentRevisionId"
      FROM profile.resume_documents
      WHERE id = ${ids.derivedDocument}
    `.execute(db);
    expect(document.rows[0]?.currentContentRevisionId).toBe(ids.derivedContentRevision);

    await expect(
      sql`
        INSERT INTO profile.resume_review_decisions (
          owner_id,
          owner_epoch,
          review_run_id,
          suggestion_id,
          document_id,
          based_on_suggestion_revision,
          idempotency_key_hash,
          decision,
          edited_text,
          result_content_revision_id,
          reason_code
        ) VALUES (
          ${ids.owner},
          1,
          ${ids.reviewRun},
          ${ids.suggestion},
          ${ids.derivedDocument},
          2,
          ${"6".repeat(64)},
          'rejected',
          NULL,
          ${ids.resultContentRevision},
          'USER_REJECTED'
        )
      `.execute(db),
    ).rejects.toMatchObject({ code: "23514" });
    await db
      .updateTable("profile.resume_review_runs")
      .set({
        status: "completed",
        revision: 2,
        completed_at: sql<Date>`GREATEST(created_at, clock_timestamp())`,
        updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
      })
      .where("id", "=", ids.reviewRun)
      .executeTakeFirstOrThrow();
  });

  it("preserves selected assets after detaching and deleting a Case", async () => {
    await sql`
      UPDATE profile.resume_documents
      SET case_id = NULL, detached_from_case_id = ${ids.privateCase}, updated_at = now()
      WHERE id = ${ids.derivedDocument}
    `.execute(db);
    await sql`
      UPDATE profile.resume_review_runs
      SET
        case_id = NULL,
        detached_from_case_id = ${ids.privateCase},
        revision = revision + 1,
        updated_at = now()
      WHERE id = ${ids.reviewRun}
    `.execute(db);
    await db
      .updateTable("application.interview_sessions")
      .set({
        case_id: null,
        detached_from_case_id: ids.privateCase,
        revision: 3,
        updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
      })
      .where("id", "=", ids.interviewSession)
      .executeTakeFirstOrThrow();
    await db
      .updateTable("application.debriefs")
      .set({
        case_id: null,
        detached_from_case_id: ids.privateCase,
        revision: 3,
        updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
      })
      .where("id", "=", ids.debrief)
      .executeTakeFirstOrThrow();
    await sql`
      DELETE FROM application.application_cases
      WHERE id = ${ids.privateCase}
    `.execute(db);

    const retained = await sql<{
      documentCaseId: string | null;
      documentDetachedId: string | null;
      reviewCaseId: string | null;
      reviewDetachedId: string | null;
      interviewCaseId: string | null;
      interviewDetachedId: string | null;
      debriefCaseId: string | null;
      debriefDetachedId: string | null;
    }>`
      SELECT
        documents.case_id AS "documentCaseId",
        documents.detached_from_case_id AS "documentDetachedId",
        reviews.case_id AS "reviewCaseId",
        reviews.detached_from_case_id AS "reviewDetachedId",
        interview.case_id AS "interviewCaseId",
        interview.detached_from_case_id AS "interviewDetachedId",
        debrief.case_id AS "debriefCaseId",
        debrief.detached_from_case_id AS "debriefDetachedId"
      FROM profile.resume_documents AS documents
      JOIN profile.resume_review_runs AS reviews
        ON reviews.document_id = documents.id
      JOIN application.interview_sessions AS interview
        ON interview.resume_document_id = documents.id
      JOIN application.debriefs AS debrief
        ON debrief.interview_session_id = interview.id
      WHERE documents.id = ${ids.derivedDocument}
        AND reviews.id = ${ids.reviewRun}
    `.execute(db);
    expect(retained.rows[0]).toEqual({
      documentCaseId: null,
      documentDetachedId: ids.privateCase,
      reviewCaseId: null,
      reviewDetachedId: ids.privateCase,
      interviewCaseId: null,
      interviewDetachedId: ids.privateCase,
      debriefCaseId: null,
      debriefDetachedId: ids.privateCase,
    });
    const deletedCase = await sql<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM application.application_cases
      WHERE id = ${ids.privateCase}
    `.execute(db);
    expect(deletedCase.rows[0]?.count).toBe(0);
    expect(
      await db
        .selectFrom("application.knowledge_clips")
        .select("id")
        .where("id", "=", ids.knowledgeClip)
        .executeTakeFirst(),
    ).toEqual({ id: ids.knowledgeClip });
    expect(
      await db
        .selectFrom("application.knowledge_clip_case_links")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("id", "=", ids.knowledgeClipLink)
        .executeTakeFirstOrThrow(),
    ).toEqual({ count: 0 });
  });

  it("keeps private and Review tables outside collector and aggregate creation outside match", async () => {
    const privileges = await sql<{
      collectorCanReadReview: boolean;
      webCanInsertFinding: boolean;
      matchCanInsertRun: boolean;
      matchCanInsertFinding: boolean;
      matchCanInsertSuggestion: boolean;
      matchCanInsertDecision: boolean;
      collectorCanReadInterview: boolean;
      matchCanInsertInterviewSession: boolean;
      matchCanInsertInterviewTurn: boolean;
      matchCanInsertInterviewFeedback: boolean;
      matchCanInsertDebrief: boolean;
      matchCanInsertDebriefConfirmation: boolean;
      matchCanInsertKnowledge: boolean;
      webCanInsertDebriefConfirmation: boolean;
    }>`
      SELECT
        has_table_privilege(
          'aijob_collector_worker',
          'profile.resume_review_runs',
          'SELECT'
        ) AS "collectorCanReadReview",
        has_table_privilege(
          'aijob_web_api',
          'profile.resume_review_findings',
          'INSERT'
        ) AS "webCanInsertFinding",
        has_table_privilege(
          'aijob_match_worker',
          'profile.resume_review_runs',
          'INSERT'
        ) AS "matchCanInsertRun",
        has_table_privilege(
          'aijob_match_worker',
          'profile.resume_review_findings',
          'INSERT'
        ) AS "matchCanInsertFinding",
        has_table_privilege(
          'aijob_match_worker',
          'profile.resume_review_suggestions',
          'INSERT'
        ) AS "matchCanInsertSuggestion",
        has_table_privilege(
          'aijob_match_worker',
          'profile.resume_review_decisions',
          'INSERT'
        ) AS "matchCanInsertDecision",
        has_table_privilege(
          'aijob_collector_worker',
          'application.interview_sessions',
          'SELECT'
        ) AS "collectorCanReadInterview",
        has_table_privilege(
          'aijob_match_worker',
          'application.interview_sessions',
          'INSERT'
        ) AS "matchCanInsertInterviewSession",
        has_table_privilege(
          'aijob_match_worker',
          'application.interview_turns',
          'INSERT'
        ) AS "matchCanInsertInterviewTurn",
        has_table_privilege(
          'aijob_match_worker',
          'application.interview_feedback',
          'INSERT'
        ) AS "matchCanInsertInterviewFeedback",
        has_table_privilege(
          'aijob_match_worker',
          'application.debriefs',
          'INSERT'
        ) AS "matchCanInsertDebrief",
        has_table_privilege(
          'aijob_match_worker',
          'application.debrief_confirmations',
          'INSERT'
        ) AS "matchCanInsertDebriefConfirmation",
        has_table_privilege(
          'aijob_match_worker',
          'application.knowledge_clips',
          'INSERT'
        ) AS "matchCanInsertKnowledge",
        has_table_privilege(
          'aijob_web_api',
          'application.debrief_confirmations',
          'INSERT'
        ) AS "webCanInsertDebriefConfirmation"
    `.execute(db);
    expect(privileges.rows[0]).toEqual({
      collectorCanReadReview: false,
      webCanInsertFinding: false,
      matchCanInsertRun: false,
      matchCanInsertFinding: true,
      matchCanInsertSuggestion: true,
      matchCanInsertDecision: false,
      collectorCanReadInterview: false,
      matchCanInsertInterviewSession: false,
      matchCanInsertInterviewTurn: true,
      matchCanInsertInterviewFeedback: true,
      matchCanInsertDebrief: false,
      matchCanInsertDebriefConfirmation: false,
      matchCanInsertKnowledge: false,
      webCanInsertDebriefConfirmation: true,
    });

    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_collector_worker`.execute(transaction);
        await sql`SELECT id FROM application.private_job_snapshots LIMIT 1`.execute(transaction);
      }),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_collector_worker`.execute(transaction);
        await sql`SELECT id FROM application.case_requirement_states LIMIT 1`.execute(transaction);
      }),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_collector_worker`.execute(transaction);
        await sql`SELECT id FROM application.interview_sessions LIMIT 1`.execute(transaction);
      }),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_match_worker`.execute(transaction);
        await sql`
          INSERT INTO profile.resume_review_runs (
            owner_id,
            owner_epoch,
            case_id,
            detached_from_case_id,
            document_id,
            content_revision_id,
            job_context_kind,
            published_job_id,
            published_job_version_id,
            requirement_set_id,
            private_job_snapshot_id,
            job_context_revision,
            evidence_revision_id,
            mode,
            status,
            creation_idempotency_key,
            creation_request_hash,
            completed_at,
            deleted_at
          ) VALUES (
            ${ids.owner},
            1,
            NULL,
            ${ids.privateCase},
            ${ids.derivedDocument},
            ${ids.derivedContentRevision},
            'private',
            NULL,
            NULL,
            NULL,
            ${ids.privateSnapshot},
            1,
            ${ids.evidenceRevision},
            'template',
            'pending',
            ${`match-created-review-${randomUUID()}`},
            ${"7".repeat(64)},
            NULL,
            NULL
          )
        `.execute(transaction);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps a Resume until its Review and Interview references are explicitly handled", async () => {
    await expect(
      db.deleteFrom("profile.resume_documents").where("id", "=", ids.derivedDocument).execute(),
    ).rejects.toMatchObject({ code: "23503" });

    await db
      .deleteFrom("profile.resume_review_decisions")
      .where("review_run_id", "=", ids.reviewRun)
      .execute();
    await db
      .deleteFrom("profile.resume_review_suggestions")
      .where("review_run_id", "=", ids.reviewRun)
      .execute();
    await db
      .deleteFrom("profile.resume_review_findings")
      .where("review_run_id", "=", ids.reviewRun)
      .execute();
    await db.deleteFrom("profile.resume_review_runs").where("id", "=", ids.reviewRun).execute();

    expect(
      await db
        .selectFrom("profile.resume_documents")
        .select("id")
        .where("id", "=", ids.derivedDocument)
        .executeTakeFirst(),
    ).toEqual({ id: ids.derivedDocument });

    await expect(
      db.deleteFrom("profile.resume_documents").where("id", "=", ids.derivedDocument).execute(),
    ).rejects.toMatchObject({ code: "23503" });

    await db.deleteFrom("application.debriefs").where("id", "=", ids.debrief).execute();
    await db
      .deleteFrom("application.interview_sessions")
      .where("id", "=", ids.interviewSession)
      .execute();

    await db.deleteFrom("profile.resume_documents").where("id", "=", ids.derivedDocument).execute();
    expect(
      await db
        .selectFrom("profile.resume_document_revisions")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("document_id", "=", ids.derivedDocument)
        .executeTakeFirstOrThrow(),
    ).toEqual({ count: 0 });
    expect(
      await db
        .selectFrom("profile.resume_documents")
        .select("id")
        .where("id", "=", ids.baseDocument)
        .executeTakeFirst(),
    ).toEqual({ id: ids.baseDocument });
  });

  it("lets the match-worker deletion path remove one owner private Case graph", async () => {
    const snapshotId = randomUUID();
    const snapshotRevisionId = randomUUID();
    const caseId = randomUUID();
    const eventId = randomUUID();
    const requirementStateId = randomUUID();
    const evidenceLinkId = randomUUID();
    const questionId = randomUUID();
    await db
      .insertInto("application.private_job_snapshots")
      .values({
        id: snapshotId,
        owner_id: ids.otherOwner,
        owner_epoch: 1,
        current_content_revision: null,
        current_requirement_set_revision: null,
        creation_idempotency_key: `deletion-snapshot-${snapshotId}`,
        creation_request_hash: "8".repeat(64),
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("application.private_job_snapshot_revisions")
      .values({
        id: snapshotRevisionId,
        owner_id: ids.otherOwner,
        owner_epoch: 1,
        snapshot_id: snapshotId,
        content_revision: 1,
        requirement_set_revision: 1,
        title: "Deletion fixture",
        company_name: null,
        source_label: "isolated_test",
        official_url: null,
        source_provided: false,
        content_text: "Synthetic private JD deletion fixture.",
        requirements: JSON.stringify([]),
        content_hash: "9".repeat(64),
      })
      .execute();
    await db
      .updateTable("application.private_job_snapshots")
      .set({ current_content_revision: 1, current_requirement_set_revision: 1 })
      .where("id", "=", snapshotId)
      .executeTakeFirstOrThrow();
    await db
      .insertInto("application.application_cases")
      .values({
        id: caseId,
        owner_id: ids.otherOwner,
        owner_epoch: 1,
        published_job_id: null,
        published_job_version_id: null,
        requirement_set_id: null,
        job_context_kind: "private",
        private_job_snapshot_id: snapshotId,
        job_context_revision: 1,
        stage: "interested",
        outcome: null,
        creation_idempotency_key: `deletion-case-${caseId}`,
        creation_request_hash: "a".repeat(64),
        expires_at: null,
        ended_at: null,
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("application.case_events")
      .values({
        id: eventId,
        owner_id: ids.otherOwner,
        owner_epoch: 1,
        case_id: caseId,
        sequence: 1,
        event_type: "case_created",
        actor_type: "owner",
        event_data: JSON.stringify({
          schemaVersion: "case-event-v1",
          initialStage: "interested",
          jobContextKind: "private",
          jobContextRevision: 1,
        }),
        schema_version: "case-event-v1",
        idempotency_scope: "deletion-case:create",
        idempotency_key: `deletion-event-${eventId}`,
        request_hash: "b".repeat(64),
      })
      .execute();
    await sql`
      INSERT INTO application.case_requirement_states (
        id,
        owner_id,
        owner_epoch,
        case_id,
        requirement_context_kind,
        requirement_set_id,
        requirement_set_revision,
        requirement_id,
        state,
        revision
      ) VALUES (
        ${requirementStateId},
        ${ids.otherOwner},
        1,
        ${caseId},
        'private',
        NULL,
        1,
        'deletion-requirement',
        'unconfirmed',
        1
      )
    `.execute(db);
    await sql`
      INSERT INTO application.case_requirement_evidence_links (
        id,
        owner_id,
        owner_epoch,
        case_id,
        requirement_state_id,
        requirement_set_id,
        requirement_id,
        evidence_revision_id,
        evidence_id,
        revision
      ) VALUES (
        ${evidenceLinkId},
        ${ids.otherOwner},
        1,
        ${caseId},
        ${requirementStateId},
        NULL,
        'deletion-requirement',
        ${ids.otherEvidenceRevision},
        'deletion-evidence',
        1
      )
    `.execute(db);
    await sql`
      INSERT INTO application.case_questions (
        id,
        owner_id,
        owner_epoch,
        case_id,
        requirement_state_id,
        requirement_set_id,
        requirement_id,
        question,
        status,
        revision
      ) VALUES (
        ${questionId},
        ${ids.otherOwner},
        1,
        ${caseId},
        ${requirementStateId},
        NULL,
        'deletion-requirement',
        'Deletion fixture question?',
        'open',
        1
      )
    `.execute(db);

    await db.transaction().execute(async (transaction) => {
      await sql`SET LOCAL ROLE aijob_match_worker`.execute(transaction);
      await transaction
        .deleteFrom("application.case_requirement_evidence_links")
        .where("owner_id", "=", ids.otherOwner)
        .execute();
      await transaction
        .deleteFrom("application.case_questions")
        .where("owner_id", "=", ids.otherOwner)
        .execute();
      await transaction
        .deleteFrom("application.case_requirement_states")
        .where("owner_id", "=", ids.otherOwner)
        .execute();
      await transaction
        .deleteFrom("application.case_events")
        .where("owner_id", "=", ids.otherOwner)
        .execute();
      await transaction
        .deleteFrom("application.application_cases")
        .where("owner_id", "=", ids.otherOwner)
        .execute();
      await transaction
        .deleteFrom("application.private_job_snapshots")
        .where("owner_id", "=", ids.otherOwner)
        .execute();
    });

    const remaining = await Promise.all([
      db
        .selectFrom("application.application_cases")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("id", "=", caseId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("application.private_job_snapshots")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("id", "=", snapshotId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("application.private_job_snapshot_revisions")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("id", "=", snapshotRevisionId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("application.case_requirement_states")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("id", "=", requirementStateId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("application.case_requirement_evidence_links")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("id", "=", evidenceLinkId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("application.case_questions")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("id", "=", questionId)
        .executeTakeFirstOrThrow(),
    ]);
    expect(remaining).toEqual([
      { count: 0 },
      { count: 0 },
      { count: 0 },
      { count: 0 },
      { count: 0 },
      { count: 0 },
    ]);
  });
});
