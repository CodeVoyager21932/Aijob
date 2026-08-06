import { randomUUID } from "node:crypto";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../index.js";
import { migrateToForTesting } from "../migrate.js";
import { applyApplicationCaseForwardContract } from "./023f_application_case_long_lived.js";
import { applyResumeDocumentReviewForwardContract } from "./024f_resume_document_review.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const unknown = JSON.stringify({ state: "unknown", reason: "source_not_stated" });
const known = (value: unknown, evidenceRef: string) =>
  JSON.stringify({ state: "known", value, evidenceRefs: [evidenceRef] });

describeWithDatabase("Phase 2A forward contract prototype", () => {
  const ids = {
    organization: randomUUID(),
    source: randomUUID(),
    sourceRecord: randomUUID(),
    sourceRevision: randomUUID(),
    publishedJob: randomUUID(),
    publishedVersion: randomUUID(),
    requirementSet: randomUUID(),
    owner: randomUUID(),
    otherOwner: randomUUID(),
    evidenceRevision: randomUUID(),
    otherEvidenceRevision: randomUUID(),
    legacyCase: randomUUID(),
    legacyEvent: randomUUID(),
    baseDocument: randomUUID(),
    legacyContentRevision: randomUUID(),
    legacyLayoutRevision: randomUUID(),
    privateSnapshot: randomUUID(),
    privateSnapshotRevision: randomUUID(),
    privateCase: randomUUID(),
    privateEvent: randomUUID(),
    semanticBaseRevision: randomUUID(),
    strictLayoutRevision: randomUUID(),
    derivedDocument: randomUUID(),
    derivedContentRevision: randomUUID(),
    resultContentRevision: randomUUID(),
    reviewRun: randomUUID(),
    finding: randomUUID(),
    suggestion: randomUUID(),
    decision: randomUUID(),
  };
  const databaseName = `aijob_test_phase2a_forward_${randomUUID().replaceAll("-", "")}`;
  let adminDb: Kysely<Database>;
  let db: Kysely<Database>;

  beforeAll(async () => {
    const adminUrl = new URL(databaseUrl as string);
    adminDb = createDatabase(adminUrl.toString());
    await sql.raw(`CREATE DATABASE "${databaseName}"`).execute(adminDb);
    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${databaseName}`;
    db = createDatabase(testUrl.toString());
    await migrateToForTesting(db, "024_resume_document_v2_expand");

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
          evidence: JSON.stringify([]),
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

    await applyApplicationCaseForwardContract(db);
    await applyResumeDocumentReviewForwardContract(db);
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    if (adminDb) {
      await sql.raw(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).execute(adminDb);
      await adminDb.destroy();
    }
  }, 120_000);

  it("keeps 024 as the registered migration and preserves legacy rows", async () => {
    const migration = await sql<{ name: string }>`
      SELECT name FROM kysely_migration ORDER BY timestamp DESC LIMIT 1
    `.execute(db);
    expect(migration.rows[0]?.name).toBe("024_resume_document_v2_expand");

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
          2,
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
          2,
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
          schema_version,
          idempotency_scope,
          idempotency_key,
          request_hash
        ) VALUES (
          ${ids.owner},
          1,
          ${ids.privateCase},
          2,
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
    const sectionId = randomUUID();
    const blockId = randomUUID();
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
        2,
        1,
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
          3,
          2,
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
    ).rejects.toMatchObject({ code: "23514" });

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

  it("keeps Review decisions evidence-bound and separate from Resume content", async () => {
    const resultSectionId = randomUUID();
    const resultBlockId = randomUUID();
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
        ${randomUUID()},
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
        ${JSON.stringify([randomUUID()])}::jsonb,
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
          ${JSON.stringify([randomUUID()])}::jsonb,
          'rewrite_block',
          'Unsupported rewrite',
          '[]'::jsonb,
          'pending',
          1
        )
      `.execute(db),
    ).rejects.toMatchObject({ code: "23514" });

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
        4,
        3,
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
          1,
          ${"6".repeat(64)},
          'rejected',
          NULL,
          ${ids.resultContentRevision},
          'USER_REJECTED'
        )
      `.execute(db),
    ).rejects.toMatchObject({ code: "23514" });
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
    await sql`
      DELETE FROM application.application_cases
      WHERE id = ${ids.privateCase}
    `.execute(db);

    const retained = await sql<{
      documentCaseId: string | null;
      documentDetachedId: string | null;
      reviewCaseId: string | null;
      reviewDetachedId: string | null;
    }>`
      SELECT
        documents.case_id AS "documentCaseId",
        documents.detached_from_case_id AS "documentDetachedId",
        reviews.case_id AS "reviewCaseId",
        reviews.detached_from_case_id AS "reviewDetachedId"
      FROM profile.resume_documents AS documents
      JOIN profile.resume_review_runs AS reviews
        ON reviews.document_id = documents.id
      WHERE documents.id = ${ids.derivedDocument}
        AND reviews.id = ${ids.reviewRun}
    `.execute(db);
    expect(retained.rows[0]).toEqual({
      documentCaseId: null,
      documentDetachedId: ids.privateCase,
      reviewCaseId: null,
      reviewDetachedId: ids.privateCase,
    });
    const deletedCase = await sql<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM application.application_cases
      WHERE id = ${ids.privateCase}
    `.execute(db);
    expect(deletedCase.rows[0]?.count).toBe(0);
  });

  it("keeps private and Review tables outside collector and aggregate creation outside match", async () => {
    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_collector_worker`.execute(transaction);
        await sql`SELECT id FROM application.private_job_snapshots LIMIT 1`.execute(transaction);
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
});
