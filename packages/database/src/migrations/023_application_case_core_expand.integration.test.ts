import { randomUUID } from "node:crypto";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../index.js";
import { migrateToForTesting } from "../migrate.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migration022 = "022_match_worker_owner_deletion_privileges";

const unknown = JSON.stringify({ state: "unknown", reason: "source_not_stated" });
const known = (value: unknown, evidenceRef: string) =>
  JSON.stringify({ state: "known", value, evidenceRefs: [evidenceRef] });

describeWithDatabase("application case core expand migration", () => {
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
    ownerTask: randomUUID(),
    documentRevision: randomUUID(),
    evidenceRevision: randomUUID(),
    otherEvidenceRevision: randomUUID(),
    applicationCase: randomUUID(),
    caseEvent: randomUUID(),
    requirementState: randomUUID(),
    evidenceLink: randomUUID(),
    question: randomUUID(),
  };
  const emptyDatabaseName = `aijob_phase2a1_test_empty_${randomUUID().replaceAll("-", "")}`;
  const upgradeDatabaseName = `aijob_phase2a1_test_upgrade_${randomUUID().replaceAll("-", "")}`;
  let adminDb: Kysely<Database>;
  let emptyDb: Kysely<Database>;
  let db: Kysely<Database>;

  beforeAll(async () => {
    const adminUrl = new URL(databaseUrl as string);
    adminDb = createDatabase(adminUrl.toString());
    await sql.raw(`CREATE DATABASE "${emptyDatabaseName}"`).execute(adminDb);
    await sql.raw(`CREATE DATABASE "${upgradeDatabaseName}"`).execute(adminDb);

    const emptyUrl = new URL(adminUrl);
    emptyUrl.pathname = `/${emptyDatabaseName}`;
    emptyDb = createDatabase(emptyUrl.toString());
    await migrateToForTesting(emptyDb, "023_application_case_core_expand");

    const upgradeUrl = new URL(adminUrl);
    upgradeUrl.pathname = `/${upgradeDatabaseName}`;
    db = createDatabase(upgradeUrl.toString());
    await migrateToForTesting(db, migration022);

    const now = new Date();
    await db
      .insertInto("source_control.organizations")
      .values({
        id: ids.organization,
        slug: `phase2a1-${ids.organization}`,
        name: "Phase 2A-1 fixture",
        official_domain: "phase2a1.example.test",
      })
      .execute();
    await db
      .insertInto("source_control.sources")
      .values({
        id: ids.source,
        organization_id: ids.organization,
        source_candidate_id: null,
        source_key: `phase2a1-${ids.source}`,
        source_type: "organization_career_site",
        name: "Phase 2A-1 fixture source",
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
        adapter_key: "phase2a1-fixture",
        adapter_version: "1",
        entrypoints: JSON.stringify(["https://phase2a1.example.test/jobs"]),
        crawl_interval: "24h",
        policy_notes: "Offline migration fixture.",
        reviewed_at: null,
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_records")
      .values({
        id: ids.sourceRecord,
        source_id: ids.source,
        source_job_id: `phase2a1-${ids.sourceRecord}`,
        canonical_source_url: `https://phase2a1.example.test/jobs/${ids.sourceRecord}`,
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
        company_name: "Phase 2A-1 fixture",
        title: "Product intern",
        job_family: known("product", `${ids.sourceRevision}#family`),
        locations: known(["Shanghai"], `${ids.sourceRevision}#locations`),
        business_groups: JSON.stringify([]),
        entry_scope: "internship",
        source_project_name: null,
        recruit_label_name: "internship",
        recruitment_type: known("internship", `${ids.sourceRevision}#type`),
        responsibilities: "Product discovery",
        requirements: "Confirmed evidence",
        structured_fields: JSON.stringify({}),
        ingestion_state: "parsed",
        publication_state: "review",
        activity_state: "active",
        source_url: `https://phase2a1.example.test/jobs/${ids.sourceRecord}`,
        apply_url: `https://phase2a1.example.test/jobs/${ids.sourceRecord}/apply`,
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
        company_name: "Phase 2A-1 fixture",
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
        responsibilities: "Product discovery",
        requirements: "Confirmed evidence",
        structured_fields: JSON.stringify({}),
        activity_state: "active",
        source_url: `https://phase2a1.example.test/jobs/${ids.sourceRecord}`,
        apply_url: `https://phase2a1.example.test/jobs/${ids.sourceRecord}/apply`,
        effective_at: now,
      })
      .execute();
    await db
      .insertInto("catalog.job_requirement_sets")
      .values({
        id: ids.requirementSet,
        published_job_version_id: ids.publishedVersion,
        schema_version: "phase2a1-v1",
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
          retention_expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
          last_seen_at: now,
          deleted_at: null,
        },
        {
          id: ids.otherOwner,
          status: "active",
          epoch: 1,
          retention_expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
          last_seen_at: now,
          deleted_at: null,
        },
      ])
      .execute();
    await db
      .insertInto("decision.job_decisions")
      .values({
        owner_id: ids.owner,
        owner_epoch: 1,
        published_job_id: ids.publishedJob,
        status: "saved",
        reason: "022 compatibility fixture",
        official_link_opened_at: null,
      })
      .execute();
    await db
      .insertInto("task_queue.tasks")
      .values({
        id: ids.ownerTask,
        task_type: "match_run",
        source_id: null,
        policy_version: null,
        adapter_version: null,
        run_mode: null,
        owner_id: ids.owner,
        owner_epoch: 1,
        payload: JSON.stringify({ fixture: "022" }),
        idempotency_key: `phase2a1-task-${ids.ownerTask}`,
        status: "queued",
        attempt: 0,
        max_attempts: 3,
        available_at: now,
        backoff_policy: JSON.stringify({ kind: "fixed", seconds: 1 }),
        lease_owner: null,
        lease_until: null,
        heartbeat_at: null,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();
    await db
      .insertInto("profile.resume_document_revisions")
      .values({
        id: ids.documentRevision,
        owner_id: ids.owner,
        owner_epoch: 1,
        resume_analysis_id: null,
        revision: 1,
        base_revision: null,
        schema_version: "resume-document-v1",
        sections: JSON.stringify([]),
        content_hash: "d".repeat(64),
        confirmed_at: now,
      })
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
          content_hash: "e".repeat(64),
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
          content_hash: "f".repeat(64),
          confirmed_at: now,
          schema_version: "resume-evidence-v1",
          document_revision_id: null,
        },
      ])
      .execute();

    await migrateToForTesting(db, "023_application_case_core_expand");
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    if (emptyDb) await emptyDb.destroy();
    if (adminDb) {
      await sql
        .raw(`DROP DATABASE IF EXISTS "${upgradeDatabaseName}" WITH (FORCE)`)
        .execute(adminDb);
      await sql
        .raw(`DROP DATABASE IF EXISTS "${emptyDatabaseName}" WITH (FORCE)`)
        .execute(adminDb);
      await adminDb.destroy();
    }
  }, 120_000);

  it("migrates an empty database from 001 through 023", async () => {
    const migrations = await sql<{ name: string }>`
      SELECT name
      FROM kysely_migration
      ORDER BY timestamp
    `.execute(emptyDb);
    expect(migrations.rows.at(-1)?.name).toBe("023_application_case_core_expand");

    const count = await emptyDb
      .selectFrom("application.application_cases")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();
    expect(Number(count.count)).toBe(0);
  });

  it("upgrades a populated 022 fixture without changing old rows", async () => {
    const [decision, task, document] = await Promise.all([
      db
        .selectFrom("decision.job_decisions")
        .select(["status", "revision"])
        .where("owner_id", "=", ids.owner)
        .where("published_job_id", "=", ids.publishedJob)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("task_queue.tasks")
        .select(["task_type", "status", "payload"])
        .where("id", "=", ids.ownerTask)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("profile.resume_document_revisions")
        .select(["schema_version", "content_hash"])
        .where("id", "=", ids.documentRevision)
        .executeTakeFirstOrThrow(),
    ]);

    expect(decision).toMatchObject({ status: "saved", revision: 1 });
    expect(task).toMatchObject({ task_type: "match_run", status: "queued" });
    expect(task.payload).toEqual({ fixture: "022" });
    expect(document).toEqual({
      schema_version: "resume-document-v1",
      content_hash: "d".repeat(64),
    });

    const tables = await sql<{ table_name: string }>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'application'
      ORDER BY table_name
    `.execute(db);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "application_cases",
      "case_events",
      "case_questions",
      "case_requirement_evidence_links",
      "case_requirement_states",
    ]);
  });

  it("enforces fixed job ownership, owner isolation, active uniqueness and TTL", async () => {
    const now = new Date();
    await db
      .insertInto("application.application_cases")
      .values({
        id: ids.applicationCase,
        owner_id: ids.owner,
        owner_epoch: 1,
        published_job_id: ids.publishedJob,
        published_job_version_id: ids.publishedVersion,
        requirement_set_id: ids.requirementSet,
        stage: "interested",
        outcome: null,
        creation_idempotency_key: `case-${ids.applicationCase}`,
        creation_request_hash: "1".repeat(64),
        expires_at: new Date(now.getTime() + 29 * 24 * 60 * 60 * 1_000),
        ended_at: null,
        deleted_at: null,
      })
      .execute();

    await expect(
      db
        .insertInto("application.application_cases")
        .values({
          owner_id: ids.owner,
          owner_epoch: 1,
          published_job_id: ids.publishedJob,
          published_job_version_id: ids.publishedVersion,
          requirement_set_id: ids.requirementSet,
          creation_idempotency_key: `duplicate-${ids.applicationCase}`,
          creation_request_hash: "2".repeat(64),
          expires_at: new Date(now.getTime() + 29 * 24 * 60 * 60 * 1_000),
          outcome: null,
          ended_at: null,
          deleted_at: null,
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      db
        .insertInto("application.application_cases")
        .values({
          owner_id: ids.otherOwner,
          owner_epoch: 1,
          published_job_id: randomUUID(),
          published_job_version_id: ids.publishedVersion,
          requirement_set_id: ids.requirementSet,
          creation_idempotency_key: `wrong-version-${ids.applicationCase}`,
          creation_request_hash: "3".repeat(64),
          expires_at: new Date(now.getTime() + 29 * 24 * 60 * 60 * 1_000),
          outcome: null,
          ended_at: null,
          deleted_at: null,
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23503" });

    await expect(
      db
        .insertInto("application.application_cases")
        .values({
          owner_id: ids.otherOwner,
          owner_epoch: 1,
          published_job_id: ids.publishedJob,
          published_job_version_id: ids.publishedVersion,
          requirement_set_id: ids.requirementSet,
          creation_idempotency_key: `expired-${ids.applicationCase}`,
          creation_request_hash: "4".repeat(64),
          expires_at: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1_000),
          outcome: null,
          ended_at: null,
          deleted_at: null,
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      db
        .insertInto("application.case_events")
        .values({
          owner_id: ids.otherOwner,
          owner_epoch: 1,
          case_id: ids.applicationCase,
          sequence: 1,
          event_type: "case_created",
          actor_type: "owner",
          event_data: JSON.stringify({}),
          idempotency_scope: "case:create",
          idempotency_key: `cross-owner-${ids.caseEvent}`,
          request_hash: "5".repeat(64),
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("keeps case events immutable and rejects cross-owner evidence links", async () => {
    await db
      .insertInto("application.case_events")
      .values({
        id: ids.caseEvent,
        owner_id: ids.owner,
        owner_epoch: 1,
        case_id: ids.applicationCase,
        sequence: 1,
        event_type: "case_created",
        actor_type: "owner",
        event_data: JSON.stringify({ stage: "interested" }),
        idempotency_scope: "case:create",
        idempotency_key: `case-event-${ids.caseEvent}`,
        request_hash: "6".repeat(64),
      })
      .execute();
    await db
      .insertInto("application.case_requirement_states")
      .values({
        id: ids.requirementState,
        owner_id: ids.owner,
        owner_epoch: 1,
        case_id: ids.applicationCase,
        requirement_set_id: ids.requirementSet,
        requirement_id: "requirement-1",
        state: "confirmed",
        user_note: null,
        revision: 2,
      })
      .execute();

    await expect(
      db
        .updateTable("application.case_events")
        .set({ event_data: JSON.stringify({ stage: "preparing" }) })
        .where("id", "=", ids.caseEvent)
        .execute(),
    ).rejects.toThrow(/IMMUTABLE_CASE_EVENT/);

    await expect(
      db
        .insertInto("application.case_requirement_evidence_links")
        .values({
          owner_id: ids.owner,
          owner_epoch: 1,
          case_id: ids.applicationCase,
          requirement_set_id: ids.requirementSet,
          requirement_id: "requirement-1",
          evidence_revision_id: ids.otherEvidenceRevision,
          evidence_id: "evidence-1",
          revision: 3,
          removed_at: null,
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23503" });

    await db
      .insertInto("application.case_requirement_evidence_links")
      .values({
        id: ids.evidenceLink,
        owner_id: ids.owner,
        owner_epoch: 1,
        case_id: ids.applicationCase,
        requirement_set_id: ids.requirementSet,
        requirement_id: "requirement-1",
        evidence_revision_id: ids.evidenceRevision,
        evidence_id: "evidence-1",
        revision: 3,
        removed_at: null,
      })
      .execute();
    await db
      .insertInto("application.case_questions")
      .values({
        id: ids.question,
        owner_id: ids.owner,
        owner_epoch: 1,
        case_id: ids.applicationCase,
        requirement_set_id: ids.requirementSet,
        requirement_id: "requirement-1",
        question: "Is this requirement mandatory?",
        answer: null,
        status: "open",
        revision: 4,
      })
      .execute();
  });

  it("grants only the intended runtime role capabilities", async () => {
    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_collector_worker`.execute(transaction);
        await transaction.selectFrom("application.application_cases").select("id").execute();
      }),
    ).rejects.toMatchObject({ code: "42501" });

    const matchVisible = await db.transaction().execute(async (transaction) => {
      await sql`SET LOCAL ROLE aijob_match_worker`.execute(transaction);
      return transaction
        .selectFrom("application.application_cases")
        .select("id")
        .where("id", "=", ids.applicationCase)
        .executeTakeFirstOrThrow();
    });
    expect(matchVisible.id).toBe(ids.applicationCase);

    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_match_worker`.execute(transaction);
        await transaction
          .insertInto("application.case_questions")
          .values({
            owner_id: ids.owner,
            owner_epoch: 1,
            case_id: ids.applicationCase,
            requirement_set_id: null,
            requirement_id: null,
            question: "Disallowed worker write",
            answer: null,
            revision: 5,
          })
          .execute();
      }),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_web_api`.execute(transaction);
        await transaction
          .updateTable("application.case_events")
          .set({ event_data: JSON.stringify({}) })
          .where("id", "=", ids.caseEvent)
          .execute();
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("creates the keyset, active, expiry and foreign-key support indexes", async () => {
    const indexes = await sql<{ indexname: string }>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'application'
    `.execute(db);
    const names = new Set(indexes.rows.map((row) => row.indexname));
    expect([...names]).toEqual(
      expect.arrayContaining([
          "application_cases_one_active_job_per_owner_idx",
          "application_cases_owner_updated_idx",
          "application_cases_expiry_idx",
          "application_cases_job_version_idx",
          "application_cases_requirement_set_idx",
          "case_requirement_states_requirement_set_idx",
          "case_requirement_evidence_links_owner_evidence_idx",
          "case_questions_owner_case_idx",
          "case_questions_requirement_set_idx",
        ]),
    );
  });
});
