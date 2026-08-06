import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listJobDecisions, putJobDecision } from "../decisions/service.js";
import {
  assertActiveOwnerEpoch,
  createAnonymousSession,
  findActiveSession,
  type OwnerContext,
} from "../identity/session-repository.js";
import { enqueueMatchRun } from "../matching/service.js";
import { encryptResumePayload } from "../resume/crypto.js";
import { purgeExpiredResumeExports } from "../tailoring/export-retention.js";
import {
  getResumeExport,
  processResumeExport,
  updateTailoringSegment,
} from "../tailoring/service.js";
import { type OwnerTaskLease, withOwnerTaskLease } from "../workers/owner-task-lease.js";
import { processOwnerDeletion, requestOwnerDeletion } from "./deletion-service.js";
import {
  AUDIT_AND_TOMBSTONE_RETENTION_MS,
  enqueueExpiredOwnerDeletions,
  runOwnerRetentionMaintenance,
} from "./retention-service.js";

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
    identity: { acceptedOrigins: [], alphaInviteCodeHashes: [] },
    workspaceRoot: ".",
  };
}

const unknown = JSON.stringify({ state: "unknown", reason: "source_not_stated" });
const known = (value: unknown, evidenceRef: string) =>
  JSON.stringify({ state: "known", value, evidenceRefs: [evidenceRef] });

describeWithDatabase("owner, export and tombstone retention", () => {
  let db: Kysely<Database>;
  const ownerIds = new Set<string>();
  const auditIds = new Set<string>();
  const fixture = {
    organizationId: randomUUID(),
    sourceId: randomUUID(),
    sourceRecordId: randomUUID(),
    sourceRevisionId: randomUUID(),
    publishedJobId: randomUUID(),
    publishedVersionId: randomUUID(),
    requirementSetId: randomUUID(),
  };

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
    const now = new Date();
    await db
      .insertInto("source_control.organizations")
      .values({
        id: fixture.organizationId,
        slug: `retention-${fixture.organizationId}`,
        name: "Retention fixture",
        official_domain: "retention.example.test",
      })
      .execute();
    await db
      .insertInto("source_control.sources")
      .values({
        id: fixture.sourceId,
        organization_id: fixture.organizationId,
        source_candidate_id: null,
        source_key: `retention-${fixture.sourceId}`,
        source_type: "organization_career_site",
        name: "Retention fixture source",
        current_policy_version: 1,
      })
      .execute();
    await db
      .insertInto("source_control.source_policy_versions")
      .values({
        source_id: fixture.sourceId,
        version: 1,
        policy_status: "pending_review",
        config_registered: true,
        catalog_role: "canonical",
        runtime_scope: "local",
        provenance_level: "organization_owned",
        acquisition_mode: "deterministic_html",
        adapter_key: "retention-fixture",
        adapter_version: "1",
        entrypoints: JSON.stringify(["https://retention.example.test/jobs"]),
        crawl_interval: "24h",
        policy_notes: "Offline retention integration fixture.",
        reviewed_at: null,
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_records")
      .values({
        id: fixture.sourceRecordId,
        source_id: fixture.sourceId,
        source_job_id: `retention-${fixture.sourceRecordId}`,
        canonical_source_url: `https://retention.example.test/jobs/${fixture.sourceRecordId}`,
        first_seen_at: now,
        last_seen_at: now,
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_revisions")
      .values({
        id: fixture.sourceRevisionId,
        source_job_record_id: fixture.sourceRecordId,
        revision_content_hash: "a".repeat(64),
        import_mode: "manual",
        adapter_version: "1",
        normalizer_version: "1",
        company_name: "Retention fixture",
        title: "Product intern",
        job_family: known("product", `${fixture.sourceRevisionId}#family`),
        locations: known(["Shanghai"], `${fixture.sourceRevisionId}#locations`),
        business_groups: JSON.stringify([]),
        entry_scope: "internship",
        source_project_name: null,
        recruit_label_name: "internship",
        recruitment_type: known("internship", `${fixture.sourceRevisionId}#type`),
        responsibilities: "Product discovery",
        requirements: "Confirmed evidence",
        structured_fields: JSON.stringify({}),
        ingestion_state: "parsed",
        publication_state: "review",
        activity_state: "active",
        source_url: `https://retention.example.test/jobs/${fixture.sourceRecordId}`,
        apply_url: `https://retention.example.test/jobs/${fixture.sourceRecordId}/apply`,
        quality_flags: JSON.stringify([]),
      })
      .execute();
    await db
      .insertInto("catalog.published_jobs")
      .values({ id: fixture.publishedJobId, current_version_id: null })
      .execute();
    await db
      .insertInto("catalog.published_job_versions")
      .values({
        id: fixture.publishedVersionId,
        published_job_id: fixture.publishedJobId,
        source_job_revision_id: fixture.sourceRevisionId,
        content_hash: "b".repeat(64),
        company_name: "Retention fixture",
        title: "Product intern",
        job_family: known("product", `${fixture.sourceRevisionId}#family`),
        locations: known(["Shanghai"], `${fixture.sourceRevisionId}#locations`),
        department: unknown,
        job_code: unknown,
        recruitment_type: known("internship", `${fixture.sourceRevisionId}#type`),
        employment_type: known("internship", `${fixture.sourceRevisionId}#employment`),
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
        source_url: `https://retention.example.test/jobs/${fixture.sourceRecordId}`,
        apply_url: `https://retention.example.test/jobs/${fixture.sourceRecordId}/apply`,
        effective_at: now,
      })
      .execute();
    await db
      .updateTable("catalog.published_jobs")
      .set({ current_version_id: fixture.publishedVersionId })
      .where("id", "=", fixture.publishedJobId)
      .execute();
    await db
      .insertInto("catalog.job_requirement_sets")
      .values({
        id: fixture.requirementSetId,
        published_job_version_id: fixture.publishedVersionId,
        schema_version: "retention-v1",
        requirements: JSON.stringify([]),
        content_hash: "c".repeat(64),
      })
      .execute();
  });

  async function deleteOwnerFixture(ownerId: string): Promise<void> {
    const deletions = await db
      .selectFrom("decision.owner_deletions")
      .select("id")
      .where("owner_id", "=", ownerId)
      .execute();
    if (deletions.length > 0) {
      await db
        .deleteFrom("decision_feedback_audit.audit_events")
        .where(
          "subject_id",
          "in",
          deletions.map((item) => item.id),
        )
        .execute();
    }
    await db.deleteFrom("matching.resume_exports").where("owner_id", "=", ownerId).execute();
    await db.deleteFrom("matching.recommendation_items").where("owner_id", "=", ownerId).execute();
    await db.deleteFrom("matching.resume_tailoring_runs").where("owner_id", "=", ownerId).execute();
    await db.deleteFrom("matching.recommendation_runs").where("owner_id", "=", ownerId).execute();
    await db.deleteFrom("matching.match_runs").where("owner_id", "=", ownerId).execute();
    await db.deleteFrom("decision.job_decisions").where("owner_id", "=", ownerId).execute();
    await db
      .deleteFrom("application.case_requirement_evidence_links")
      .where("owner_id", "=", ownerId)
      .execute();
    await db
      .deleteFrom("application.case_questions")
      .where("owner_id", "=", ownerId)
      .execute();
    await db
      .deleteFrom("application.case_requirement_states")
      .where("owner_id", "=", ownerId)
      .execute();
    await db.deleteFrom("application.case_events").where("owner_id", "=", ownerId).execute();
    await db
      .deleteFrom("application.application_cases")
      .where("owner_id", "=", ownerId)
      .execute();
    await db
      .deleteFrom("application.private_job_snapshots")
      .where("owner_id", "=", ownerId)
      .execute();
    await db
      .deleteFrom("profile.resume_evidence_revisions")
      .where("owner_id", "=", ownerId)
      .execute();
    await db
      .deleteFrom("profile.resume_document_revisions")
      .where("owner_id", "=", ownerId)
      .execute();
    await db
      .deleteFrom("profile.job_preference_revisions")
      .where("owner_id", "=", ownerId)
      .execute();
    await db.deleteFrom("profile.profile_fact_revisions").where("owner_id", "=", ownerId).execute();
    await db.deleteFrom("profile.resume_analyses").where("owner_id", "=", ownerId).execute();
    await db.deleteFrom("task_queue.tasks").where("owner_id", "=", ownerId).execute();
    await db.deleteFrom("decision.owner_deletions").where("owner_id", "=", ownerId).execute();
    await db.deleteFrom("identity.owner_sessions").where("owner_id", "=", ownerId).execute();
    await db.deleteFrom("identity.owners").where("id", "=", ownerId).execute();
  }

  afterAll(async () => {
    for (const ownerId of ownerIds) await deleteOwnerFixture(ownerId);
    if (auditIds.size > 0) {
      await db
        .deleteFrom("decision_feedback_audit.audit_events")
        .where("id", "in", [...auditIds])
        .execute();
    }
    await db
      .deleteFrom("catalog.job_requirement_sets")
      .where("published_job_version_id", "=", fixture.publishedVersionId)
      .execute();
    await db
      .updateTable("catalog.published_jobs")
      .set({ current_version_id: null })
      .where("id", "=", fixture.publishedJobId)
      .execute();
    await db
      .deleteFrom("catalog.published_job_versions")
      .where("id", "=", fixture.publishedVersionId)
      .execute();
    await db
      .deleteFrom("catalog.published_jobs")
      .where("id", "=", fixture.publishedJobId)
      .execute();
    await db
      .deleteFrom("ingestion.source_job_revisions")
      .where("id", "=", fixture.sourceRevisionId)
      .execute();
    await db
      .deleteFrom("ingestion.source_job_records")
      .where("id", "=", fixture.sourceRecordId)
      .execute();
    await db
      .deleteFrom("source_control.source_policy_versions")
      .where("source_id", "=", fixture.sourceId)
      .execute();
    await db.deleteFrom("source_control.sources").where("id", "=", fixture.sourceId).execute();
    await db
      .deleteFrom("source_control.organizations")
      .where("id", "=", fixture.organizationId)
      .execute();
    await db.destroy();
  });

  async function insertOwnerGraph(owner: OwnerContext, suffix: string) {
    const now = new Date();
    const ids = {
      analysis: randomUUID(),
      facts: randomUUID(),
      preferences: randomUUID(),
      document: randomUUID(),
      documentSection: randomUUID(),
      documentBlock: randomUUID(),
      evidence: randomUUID(),
      match: randomUUID(),
      recommendation: randomUUID(),
      tailoring: randomUUID(),
      segment: randomUUID(),
      privateSnapshot: randomUUID(),
      privateSnapshotRevision: randomUUID(),
      applicationCase: randomUUID(),
      caseEvent: randomUUID(),
      staleTask: randomUUID(),
    };
    await db
      .insertInto("profile.resume_analyses")
      .values({
        id: ids.analysis,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        input_kind: "pasted_text",
        status: "succeeded",
        original_filename: null,
        media_type: "text/plain",
        byte_size: 1,
        content_sha256: "d".repeat(64),
        encryption_key_version: "test-v1",
        raw_ciphertext: null,
        raw_nonce: null,
        raw_auth_tag: null,
        extracted_text_ciphertext: null,
        extracted_text_nonce: null,
        extracted_text_auth_tag: null,
        pii_summary: JSON.stringify([]),
        analysis_result: null,
        privacy_confirmed_at: now,
        purge_after: now,
        purged_at: now,
        failure_code: null,
        updated_at: now,
      })
      .execute();
    await db
      .insertInto("profile.profile_fact_revisions")
      .values({
        id: ids.facts,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        revision: 1,
        base_revision: null,
        facts: JSON.stringify([]),
        content_hash: "e".repeat(64),
        confirmed_at: now,
      })
      .execute();
    await db
      .insertInto("profile.job_preference_revisions")
      .values({
        id: ids.preferences,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        revision: 1,
        base_revision: null,
        preferences: JSON.stringify({ cities: [] }),
        content_hash: "f".repeat(64),
        confirmed_at: now,
      })
      .execute();
    await db
      .insertInto("profile.resume_document_revisions")
      .values({
        id: ids.document,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        resume_analysis_id: ids.analysis,
        revision: 1,
        base_revision: null,
        schema_version: "resume-document-v1",
        sections: JSON.stringify([
          {
            id: ids.documentSection,
            ordinal: 0,
            title: "项目经历",
            blocks: [{ id: ids.documentBlock, ordinal: 0, text: "confirmed original" }],
          },
        ]),
        content_hash: "0".repeat(64),
        confirmed_at: now,
      })
      .execute();
    await db
      .insertInto("profile.resume_evidence_revisions")
      .values({
        id: ids.evidence,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        resume_analysis_id: ids.analysis,
        schema_version: "resume-evidence-v2",
        document_revision_id: ids.document,
        revision: 1,
        base_revision: null,
        evidence: JSON.stringify([]),
        content_hash: "1".repeat(64),
        confirmed_at: now,
      })
      .execute();
    await db
      .insertInto("matching.match_runs")
      .values({
        id: ids.match,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        published_job_version_id: fixture.publishedVersionId,
        requirement_set_id: fixture.requirementSetId,
        profile_fact_revision_id: ids.facts,
        preference_revision_id: ids.preferences,
        evidence_revision_id: ids.evidence,
        rule_version: "retention-v1",
        dictionary_version: "retention-v1",
        template_version: "retention-v1",
        status: "succeeded",
        request_hash: "2".repeat(64),
        idempotency_key: `retention-match-${suffix}`,
        result: JSON.stringify({}),
        failure_code: null,
        completed_at: now,
      })
      .execute();
    await db
      .insertInto("matching.recommendation_runs")
      .values({
        id: ids.recommendation,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        profile_fact_revision_id: ids.facts,
        preference_revision_id: ids.preferences,
        evidence_revision_id: ids.evidence,
        candidate_job_version_ids: JSON.stringify([fixture.publishedVersionId]),
        candidate_freshness_snapshots: JSON.stringify([
          { publishedJobVersionId: fixture.publishedVersionId, lastVerifiedAt: now.toISOString() },
        ]),
        candidate_requirement_set_ids: JSON.stringify([
          {
            publishedJobVersionId: fixture.publishedVersionId,
            requirementSetId: fixture.requirementSetId,
          },
        ]),
        resume_document_revision_id: ids.document,
        candidate_set_hash: "3".repeat(64),
        strategy_version: "retention-v1",
        status: "succeeded",
        request_hash: "4".repeat(64),
        idempotency_key: `retention-recommendation-${suffix}`,
        failure_code: null,
        completed_at: now,
      })
      .execute();
    await db
      .insertInto("matching.recommendation_items")
      .values({
        owner_id: owner.ownerId,
        recommendation_run_id: ids.recommendation,
        ordinal: 0,
        published_job_version_id: fixture.publishedVersionId,
        match_run_id: ids.match,
        reason_codes: JSON.stringify([]),
        unknown_requirement_ids: JSON.stringify([]),
      })
      .execute();
    await db
      .insertInto("matching.resume_tailoring_runs")
      .values({
        id: ids.tailoring,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        resume_analysis_id: ids.analysis,
        published_job_version_id: fixture.publishedVersionId,
        requirement_set_id: fixture.requirementSetId,
        evidence_revision_id: ids.evidence,
        resume_document_revision_id: ids.document,
        provider_adapter: "template",
        model: "template",
        prompt_version: "retention-v1",
        schema_version: "retention-v1",
        template_version: "retention-v1",
        privacy_consent_at: now,
        used_template_fallback: true,
        status: "succeeded",
        request_hash: "5".repeat(64),
        idempotency_key: `retention-tailoring-${suffix}`,
        failure_code: null,
        completed_at: now,
      })
      .execute();
    await db
      .insertInto("matching.resume_tailoring_segments")
      .values({
        id: ids.segment,
        tailoring_run_id: ids.tailoring,
        ordinal: 0,
        source_block_id: ids.documentBlock,
        section_id: ids.documentSection,
        section_title: "项目经历",
        original_text: "confirmed original",
        suggested_text: "confirmed suggestion",
        reason: "fixture",
        requirement_ids: JSON.stringify([]),
        evidence_ids: JSON.stringify([]),
        decision: "pending",
        edited_text: null,
        updated_at: now,
      })
      .execute();
    await db
      .insertInto("decision.job_decisions")
      .values({
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        published_job_id: fixture.publishedJobId,
        status: "saved",
        reason: "fixture",
        revision: 1,
        official_link_opened_at: null,
        updated_at: now,
      })
      .execute();
    await db
      .insertInto("application.private_job_snapshots")
      .values({
        id: ids.privateSnapshot,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        current_content_revision: null,
        current_requirement_set_revision: null,
        creation_idempotency_key: `retention-private-job-${suffix}`,
        creation_request_hash: "6".repeat(64),
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("application.private_job_snapshot_revisions")
      .values({
        id: ids.privateSnapshotRevision,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        snapshot_id: ids.privateSnapshot,
        content_revision: 1,
        requirement_set_revision: 1,
        title: "Synthetic private internship",
        company_name: null,
        source_label: "retention_fixture",
        official_url: null,
        source_provided: false,
        content_text: "Synthetic private JD used only for owner deletion verification.",
        requirements: JSON.stringify([]),
        content_hash: "7".repeat(64),
      })
      .execute();
    await db
      .updateTable("application.private_job_snapshots")
      .set({
        current_content_revision: 1,
        current_requirement_set_revision: 1,
        updated_at: sql`now()`,
      })
      .where("id", "=", ids.privateSnapshot)
      .executeTakeFirstOrThrow();
    await db
      .insertInto("application.application_cases")
      .values({
        id: ids.applicationCase,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        published_job_id: null,
        published_job_version_id: null,
        requirement_set_id: null,
        job_context_kind: "private",
        private_job_snapshot_id: ids.privateSnapshot,
        job_context_revision: 1,
        stage: "interested",
        outcome: null,
        creation_idempotency_key: `retention-private-case-${suffix}`,
        creation_request_hash: "8".repeat(64),
        expires_at: null,
        ended_at: null,
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("application.case_events")
      .values({
        id: ids.caseEvent,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        case_id: ids.applicationCase,
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
        idempotency_scope: "retention-private-case:create",
        idempotency_key: `retention-private-event-${suffix}`,
        request_hash: "9".repeat(64),
      })
      .execute();
    const leaseOwner = `retention-stale-worker-${suffix}`;
    await db
      .insertInto("task_queue.tasks")
      .values({
        id: ids.staleTask,
        task_type: "match_run",
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        payload: JSON.stringify({ runId: ids.match }),
        idempotency_key: `retention-stale-task-${suffix}`,
        status: "running",
        attempt: 1,
        max_attempts: 3,
        available_at: now,
        backoff_policy: JSON.stringify({ kind: "fixed", seconds: 1 }),
        lease_owner: leaseOwner,
        lease_until: new Date(now.getTime() + 60_000),
        heartbeat_at: now,
        fencing_token: 1,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();
    return {
      ...ids,
      staleLease: {
        taskId: ids.staleTask,
        taskType: "match_run",
        ownerId: owner.ownerId,
        ownerEpoch: owner.ownerEpoch,
        leaseOwner,
        fencingToken: 1,
      } satisfies OwnerTaskLease,
    };
  }

  async function createDeletedTombstone(deletedAt: Date, suffix: string) {
    const session = await createAnonymousSession({ db });
    ownerIds.add(session.context.ownerId);
    const deletionId = randomUUID();
    await db
      .updateTable("identity.owners")
      .set({
        status: "deleted",
        epoch: session.context.ownerEpoch + 1,
        retention_expires_at: deletedAt,
        deleted_at: deletedAt,
        last_seen_at: deletedAt,
      })
      .where("id", "=", session.context.ownerId)
      .execute();
    await db
      .updateTable("identity.owner_sessions")
      .set({ revoked_at: deletedAt })
      .where("owner_id", "=", session.context.ownerId)
      .execute();
    await db
      .insertInto("decision.owner_deletions")
      .values({
        id: deletionId,
        owner_id: session.context.ownerId,
        requested_owner_epoch: session.context.ownerEpoch,
        status: "succeeded",
        failure_code: null,
        requested_at: deletedAt,
        updated_at: deletedAt,
        completed_at: deletedAt,
      })
      .execute();
    await db
      .insertInto("task_queue.tasks")
      .values({
        id: randomUUID(),
        task_type: "owner_deletion",
        owner_id: session.context.ownerId,
        owner_epoch: session.context.ownerEpoch,
        payload: JSON.stringify({ deletionId }),
        idempotency_key: `retention-tombstone-${suffix}`,
        status: "succeeded",
        attempt: 1,
        max_attempts: 3,
        available_at: deletedAt,
        backoff_policy: JSON.stringify({ kind: "fixed", seconds: 1 }),
        lease_owner: null,
        lease_until: null,
        heartbeat_at: deletedAt,
        fencing_token: 1,
        last_error_code: null,
        last_error_summary: null,
        created_at: deletedAt,
        completed_at: deletedAt,
      })
      .execute();
    const auditId = randomUUID();
    auditIds.add(auditId);
    await db
      .insertInto("decision_feedback_audit.audit_events")
      .values({
        id: auditId,
        event_type: "owner_deletion_succeeded",
        actor_type: "system",
        subject_type: "owner_deletion",
        subject_id: deletionId,
        metadata: JSON.stringify({ contentIncluded: false }),
        created_at: deletedAt,
      })
      .execute();
    return { ownerId: session.context.ownerId, deletionId, auditId };
  }

  it("keeps account-managed owners active and purges their identity on deletion", async () => {
    const now = new Date();
    const session = await createAnonymousSession({ db, now });
    ownerIds.add(session.context.ownerId);
    const accountId = randomUUID();
    const emailIdentityId = randomUUID();
    const taskId = randomUUID();
    const leaseOwner = `account-owner-lease-${randomUUID()}`;

    await db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("identity.accounts")
        .values({
          id: accountId,
          owner_id: session.context.ownerId,
          status: "active",
          revision: 1,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        })
        .execute();
      await transaction
        .updateTable("identity.owners")
        .set({ retention_mode: "account_managed", retention_expires_at: null })
        .where("id", "=", session.context.ownerId)
        .executeTakeFirstOrThrow();
    });
    await db
      .insertInto("identity.email_identities")
      .values({
        id: emailIdentityId,
        account_id: accountId,
        status: "active",
        email_lookup_hash: "a".repeat(64),
        email_ciphertext: Buffer.from("encrypted-email"),
        email_nonce: Buffer.alloc(12, 1),
        email_auth_tag: Buffer.alloc(16, 2),
        encryption_key_version: "identity-test-v1",
        verified_at: now,
        revoked_at: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await db
      .insertInto("task_queue.tasks")
      .values({
        id: taskId,
        task_type: "match_run",
        owner_id: session.context.ownerId,
        owner_epoch: session.context.ownerEpoch,
        payload: JSON.stringify({ runId: randomUUID() }),
        idempotency_key: `account-owner-task-${taskId}`,
        status: "running",
        attempt: 1,
        max_attempts: 3,
        available_at: now,
        backoff_policy: JSON.stringify({ kind: "fixed", seconds: 1 }),
        lease_owner: leaseOwner,
        lease_until: new Date(now.getTime() + 60_000),
        heartbeat_at: now,
        fencing_token: 1,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();

    expect(await findActiveSession({ db, sessionToken: session.sessionToken, now })).toMatchObject({
      ownerId: session.context.ownerId,
      ownerEpoch: session.context.ownerEpoch,
    });
    await expect(
      assertActiveOwnerEpoch(db, session.context.ownerId, session.context.ownerEpoch, now),
    ).resolves.toBeUndefined();
    await expect(
      withOwnerTaskLease(
        db,
        {
          taskId,
          taskType: "match_run",
          ownerId: session.context.ownerId,
          ownerEpoch: session.context.ownerEpoch,
          leaseOwner,
          fencingToken: 1,
        },
        async () => "active",
      ),
    ).resolves.toBe("active");
    await enqueueExpiredOwnerDeletions({ db, now });
    expect(
      await db
        .selectFrom("decision.owner_deletions")
        .select("id")
        .where("owner_id", "=", session.context.ownerId)
        .executeTakeFirst(),
    ).toBeUndefined();

    const requested = await requestOwnerDeletion({
      db,
      owner: session.context,
      now: new Date(now.getTime() + 1),
    });
    const deletionTask = await db
      .updateTable("task_queue.tasks")
      .set({
        status: "running",
        attempt: 1,
        lease_owner: leaseOwner,
        lease_until: new Date(now.getTime() + 60_000),
        heartbeat_at: now,
        fencing_token: 1,
      })
      .where("task_type", "=", "owner_deletion")
      .where("owner_id", "=", session.context.ownerId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await processOwnerDeletion({
      db,
      deletionId: requested.deletion.id,
      ownerId: session.context.ownerId,
      requestedOwnerEpoch: session.context.ownerEpoch,
      lease: {
        taskId: deletionTask.id,
        taskType: "owner_deletion",
        ownerId: session.context.ownerId,
        ownerEpoch: session.context.ownerEpoch,
        leaseOwner,
        fencingToken: 1,
      },
      now: new Date(now.getTime() + 2),
    });

    expect(
      await db
        .selectFrom("identity.accounts")
        .select("id")
        .where("id", "=", accountId)
        .executeTakeFirst(),
    ).toBeUndefined();
    expect(
      await db
        .selectFrom("identity.email_identities")
        .select("id")
        .where("id", "=", emailIdentityId)
        .executeTakeFirst(),
    ).toBeUndefined();
    expect(
      await db
        .selectFrom("identity.owners")
        .select(["status", "retention_mode", "retention_expires_at"])
        .where("id", "=", session.context.ownerId)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({
      status: "deleted",
      retention_mode: "anonymous_ttl",
      retention_expires_at: new Date(now.getTime() + 2),
    });
  });

  it("enforces 24h, 30d and 90d retention without crossing owners", async () => {
    const now = new Date();
    const expiredSession = await createAnonymousSession({ db });
    const survivorSession = await createAnonymousSession({ db });
    ownerIds.add(expiredSession.context.ownerId);
    ownerIds.add(survivorSession.context.ownerId);
    const expiredGraph = await insertOwnerGraph(expiredSession.context, "expired");
    const survivorGraph = await insertOwnerGraph(survivorSession.context, "survivor");

    const expiredStatuses = ["queued", "processing", "failed", "succeeded"] as const;
    const expiredExportIds = new Map<(typeof expiredStatuses)[number], string>();
    for (const [index, status] of expiredStatuses.entries()) {
      const exportId = randomUUID();
      expiredExportIds.set(status, exportId);
      await db
        .insertInto("matching.resume_exports")
        .values({
          id: exportId,
          owner_id: survivorSession.context.ownerId,
          owner_epoch: survivorSession.context.ownerEpoch,
          tailoring_run_id: survivorGraph.tailoring,
          status,
          file_name: `expired-${status}.docx`,
          media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          byte_size: status === "succeeded" ? 32 : null,
          encryption_key_version: "test-v1",
          ciphertext: Buffer.from(`ciphertext-${status}`),
          nonce: Buffer.alloc(12, index + 1),
          auth_tag: Buffer.alloc(16, index + 1),
          expires_at: new Date(now.getTime() - 1_000),
          failure_code: status === "failed" ? "FIXTURE_FAILURE" : null,
          completed_at: status === "failed" || status === "succeeded" ? now : null,
        })
        .execute();
    }
    const freshExportId = randomUUID();
    await db
      .insertInto("matching.resume_exports")
      .values({
        id: freshExportId,
        owner_id: survivorSession.context.ownerId,
        owner_epoch: survivorSession.context.ownerEpoch,
        tailoring_run_id: survivorGraph.tailoring,
        status: "succeeded",
        file_name: "fresh.docx",
        media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byte_size: 32,
        encryption_key_version: "test-v1",
        ciphertext: Buffer.from("fresh-ciphertext"),
        nonce: Buffer.alloc(12, 9),
        auth_tag: Buffer.alloc(16, 9),
        expires_at: new Date(now.getTime() + 60_000),
        failure_code: null,
        completed_at: now,
      })
      .execute();

    const processingExportId = expiredExportIds.get("processing") as string;
    const exportTaskId = randomUUID();
    const exportLeaseOwner = "expired-export-worker";
    await db
      .insertInto("task_queue.tasks")
      .values({
        id: exportTaskId,
        task_type: "resume_export",
        owner_id: survivorSession.context.ownerId,
        owner_epoch: survivorSession.context.ownerEpoch,
        payload: JSON.stringify({ exportId: processingExportId }),
        idempotency_key: `retention-export-task-${exportTaskId}`,
        status: "running",
        attempt: 1,
        max_attempts: 2,
        available_at: now,
        backoff_policy: JSON.stringify({ kind: "fixed", seconds: 1 }),
        lease_owner: exportLeaseOwner,
        lease_until: new Date(now.getTime() + 60_000),
        heartbeat_at: now,
        fencing_token: 1,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();
    const exportLease: OwnerTaskLease = {
      taskId: exportTaskId,
      taskType: "resume_export",
      ownerId: survivorSession.context.ownerId,
      ownerEpoch: survivorSession.context.ownerEpoch,
      leaseOwner: exportLeaseOwner,
      fencingToken: 1,
    };

    await db
      .updateTable("identity.owners")
      .set({ retention_expires_at: new Date(now.getTime() - 1) })
      .where("id", "=", expiredSession.context.ownerId)
      .execute();
    expect(
      await findActiveSession({
        db,
        sessionToken: expiredSession.sessionToken,
        now,
      }),
    ).toBeNull();
    await expect(
      assertActiveOwnerEpoch(
        db,
        expiredSession.context.ownerId,
        expiredSession.context.ownerEpoch,
        now,
      ),
    ).rejects.toThrow("OWNER_EPOCH_STALE");
    expect(await listJobDecisions(db, expiredSession.context)).toEqual([]);
    await expect(
      putJobDecision(db, expiredSession.context, fixture.publishedJobId, {
        expectedRevision: 1,
        status: "applied",
        reason: null,
      }),
    ).rejects.toMatchObject({ code: "OWNER_EPOCH_STALE" });
    await expect(
      enqueueMatchRun(
        db,
        expiredSession.context,
        {
          publishedJobVersionId: fixture.publishedVersionId,
          profileFactRevisionId: expiredGraph.facts,
          preferenceRevisionId: expiredGraph.preferences,
          evidenceRevisionId: expiredGraph.evidence,
        },
        "expired-owner-match-mutation",
      ),
    ).rejects.toThrow("OWNER_EPOCH_STALE");
    await expect(
      updateTailoringSegment(
        db,
        expiredSession.context,
        expiredGraph.tailoring,
        expiredGraph.segment,
        { decision: "accepted" },
      ),
    ).rejects.toThrow("OWNER_EPOCH_STALE");
    const staleAuditId = randomUUID();
    auditIds.add(staleAuditId);
    await expect(
      withOwnerTaskLease(db, expiredGraph.staleLease, async (transaction) => {
        await transaction
          .insertInto("decision_feedback_audit.audit_events")
          .values({
            id: staleAuditId,
            event_type: "expired_owner_stale_write",
            actor_type: "system",
            subject_type: "task",
            subject_id: expiredGraph.staleTask,
            metadata: JSON.stringify({ contentIncluded: false }),
          })
          .execute();
      }),
    ).rejects.toThrow("OWNER_TASK_LEASE_LOST");

    const statusExportId = expiredExportIds.get("succeeded") as string;
    expect(await getResumeExport(db, survivorSession.context, statusExportId)).toMatchObject({
      status: "deleted",
      byteSize: null,
      failureCode: "RESUME_EXPORT_EXPIRED",
    });
    expect(await purgeExpiredResumeExports({ db, now })).toBe(3);
    const purgedExports = await db
      .selectFrom("matching.resume_exports")
      .select(["id", "status", "byte_size", "ciphertext", "nonce", "auth_tag"])
      .where("id", "in", [...expiredExportIds.values()])
      .execute();
    expect(purgedExports).toHaveLength(4);
    for (const item of purgedExports) {
      expect(item).toMatchObject({
        status: "deleted",
        byte_size: null,
        ciphertext: null,
        nonce: null,
        auth_tag: null,
      });
    }
    const expiredExportTask = await db
      .selectFrom("task_queue.tasks")
      .select(["status", "fencing_token", "lease_owner"])
      .where("id", "=", exportTaskId)
      .executeTakeFirstOrThrow();
    expect(expiredExportTask).toMatchObject({ status: "dead", lease_owner: null });
    expect(Number(expiredExportTask.fencing_token)).toBe(1);
    await expect(
      processResumeExport(db, config(), survivorSession.context, processingExportId, exportLease),
    ).rejects.toThrow("OWNER_TASK_LEASE_LOST");
    expect(
      await db
        .selectFrom("matching.resume_exports")
        .select(["status", "ciphertext"])
        .where("id", "=", processingExportId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: "deleted", ciphertext: null });

    const crossingExportId = randomUUID();
    const crossingTaskId = randomUUID();
    const crossingLeaseOwner = "crossing-expiry-worker";
    const frozenInput = encryptResumePayload(
      Buffer.from(
        JSON.stringify({
          version: "resume-export-input-v2",
          sections: [
            {
              id: "retention-section",
              heading: "Confirmed resume",
              paragraphs: ["confirmed paragraph"],
            },
          ],
        }),
        "utf8",
      ),
      encryptionKey,
    );
    await db
      .insertInto("matching.resume_exports")
      .values({
        id: crossingExportId,
        owner_id: survivorSession.context.ownerId,
        owner_epoch: survivorSession.context.ownerEpoch,
        tailoring_run_id: survivorGraph.tailoring,
        status: "queued",
        file_name: "crossing-expiry.docx",
        media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byte_size: null,
        encryption_key_version: "test-v1",
        ciphertext: frozenInput.ciphertext,
        nonce: frozenInput.initializationVector,
        auth_tag: frozenInput.authenticationTag,
        expires_at: new Date(now.getTime() + 10_000),
        failure_code: null,
        completed_at: null,
      })
      .execute();
    await db
      .insertInto("task_queue.tasks")
      .values({
        id: crossingTaskId,
        task_type: "resume_export",
        owner_id: survivorSession.context.ownerId,
        owner_epoch: survivorSession.context.ownerEpoch,
        payload: JSON.stringify({ exportId: crossingExportId }),
        idempotency_key: `retention-crossing-export-${crossingTaskId}`,
        status: "running",
        attempt: 1,
        max_attempts: 2,
        available_at: now,
        backoff_policy: JSON.stringify({ kind: "fixed", seconds: 1 }),
        lease_owner: crossingLeaseOwner,
        lease_until: new Date(Date.now() + 60_000),
        heartbeat_at: now,
        fencing_token: 1,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();
    const crossingTimes = [now, new Date(now.getTime() + 20_000)];
    await processResumeExport(
      db,
      config(),
      survivorSession.context,
      crossingExportId,
      {
        taskId: crossingTaskId,
        taskType: "resume_export",
        ownerId: survivorSession.context.ownerId,
        ownerEpoch: survivorSession.context.ownerEpoch,
        leaseOwner: crossingLeaseOwner,
        fencingToken: 1,
      },
      () => crossingTimes.shift() ?? new Date(now.getTime() + 20_000),
    );
    expect(
      await db
        .selectFrom("matching.resume_exports")
        .select(["status", "byte_size", "ciphertext", "nonce", "auth_tag"])
        .where("id", "=", crossingExportId)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      status: "deleted",
      byte_size: null,
      ciphertext: null,
      nonce: null,
      auth_tag: null,
    });
    expect(
      await db
        .selectFrom("task_queue.tasks")
        .select(["status", "last_error_code"])
        .where("id", "=", crossingTaskId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: "dead", last_error_code: "RESUME_EXPORT_EXPIRED" });

    const oldAuditId = randomUUID();
    const recentAuditId = randomUUID();
    auditIds.add(oldAuditId);
    auditIds.add(recentAuditId);
    const oldTime = new Date(now.getTime() - AUDIT_AND_TOMBSTONE_RETENTION_MS - 1_000);
    const recentTime = new Date(now.getTime() - AUDIT_AND_TOMBSTONE_RETENTION_MS + 60_000);
    await db
      .insertInto("decision_feedback_audit.audit_events")
      .values([
        {
          id: oldAuditId,
          event_type: "retention_old_audit",
          actor_type: "system",
          subject_type: "retention_test",
          subject_id: oldAuditId,
          metadata: JSON.stringify({ contentIncluded: false }),
          created_at: oldTime,
        },
        {
          id: recentAuditId,
          event_type: "retention_recent_audit",
          actor_type: "system",
          subject_type: "retention_test",
          subject_id: recentAuditId,
          metadata: JSON.stringify({ contentIncluded: false }),
          created_at: recentTime,
        },
      ])
      .execute();
    const oldTombstone = await createDeletedTombstone(oldTime, "old");
    const recentTombstone = await createDeletedTombstone(recentTime, "recent");

    const concurrentExpiryResults = await Promise.all([
      enqueueExpiredOwnerDeletions({ db, now }),
      enqueueExpiredOwnerDeletions({ db, now }),
    ]);
    expect(concurrentExpiryResults.reduce((total, count) => total + count, 0)).toBe(1);
    expect(
      await db
        .selectFrom("decision.owner_deletions")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("owner_id", "=", expiredSession.context.ownerId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ count: 1 });
    expect(
      await db
        .selectFrom("task_queue.tasks")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("owner_id", "=", expiredSession.context.ownerId)
        .where("task_type", "=", "owner_deletion")
        .executeTakeFirstOrThrow(),
    ).toEqual({ count: 1 });

    const maintenance = await runOwnerRetentionMaintenance({ db, now });
    expect(maintenance.expiredOwnersQueued).toBe(0);
    expect(maintenance.expiredAuditEventsDeleted).toBeGreaterThanOrEqual(2);
    expect(maintenance.expiredDeletionTombstonesDeleted).toBe(1);
    expect(
      await db
        .selectFrom("identity.owners")
        .select("id")
        .where("id", "=", oldTombstone.ownerId)
        .executeTakeFirst(),
    ).toBeUndefined();
    expect(
      await db
        .selectFrom("decision.owner_deletions")
        .select("id")
        .where("id", "=", oldTombstone.deletionId)
        .executeTakeFirst(),
    ).toBeUndefined();
    const recentTombstoneOwner = await db
      .selectFrom("identity.owners")
      .select(["status", "epoch"])
      .where("id", "=", recentTombstone.ownerId)
      .executeTakeFirstOrThrow();
    expect(recentTombstoneOwner.status).toBe("deleted");
    expect(Number(recentTombstoneOwner.epoch)).toBe(2);
    expect(
      await db
        .selectFrom("decision_feedback_audit.audit_events")
        .select("id")
        .where("id", "=", recentAuditId)
        .executeTakeFirst(),
    ).toBeTruthy();

    const queuedDeletion = await db
      .selectFrom("decision.owner_deletions")
      .selectAll()
      .where("owner_id", "=", expiredSession.context.ownerId)
      .executeTakeFirstOrThrow();
    const deletionTask = await db
      .selectFrom("task_queue.tasks")
      .selectAll()
      .where("owner_id", "=", expiredSession.context.ownerId)
      .where("task_type", "=", "owner_deletion")
      .executeTakeFirstOrThrow();
    const deletionWorker = "retention-deletion-worker";
    const claimedDeletionTask = await db
      .updateTable("task_queue.tasks")
      .set((expression) => ({
        status: "running",
        attempt: expression("attempt", "+", 1),
        lease_owner: deletionWorker,
        lease_until: new Date(now.getTime() + 60_000),
        heartbeat_at: now,
        fencing_token: expression("fencing_token", "+", 1),
      }))
      .where("id", "=", deletionTask.id)
      .where("status", "=", "queued")
      .returningAll()
      .executeTakeFirstOrThrow();
    const deletionLease: OwnerTaskLease = {
      taskId: claimedDeletionTask.id,
      taskType: "owner_deletion",
      ownerId: expiredSession.context.ownerId,
      ownerEpoch: expiredSession.context.ownerEpoch,
      leaseOwner: deletionWorker,
      fencingToken: Number(claimedDeletionTask.fencing_token),
    };
    await processOwnerDeletion({
      db,
      deletionId: queuedDeletion.id,
      ownerId: expiredSession.context.ownerId,
      requestedOwnerEpoch: expiredSession.context.ownerEpoch,
      lease: deletionLease,
      now,
    });
    await db
      .updateTable("task_queue.tasks")
      .set({
        status: "succeeded",
        lease_owner: null,
        lease_until: null,
        heartbeat_at: now,
        completed_at: now,
      })
      .where("id", "=", claimedDeletionTask.id)
      .where("lease_owner", "=", deletionWorker)
      .where("fencing_token", "=", claimedDeletionTask.fencing_token)
      .execute();

    const deletedExpiredOwner = await db
      .selectFrom("identity.owners")
      .select(["status", "epoch"])
      .where("id", "=", expiredSession.context.ownerId)
      .executeTakeFirstOrThrow();
    expect(deletedExpiredOwner.status).toBe("deleted");
    expect(Number(deletedExpiredOwner.epoch)).toBe(2);
    const ownerTables = [
      "application.case_requirement_evidence_links",
      "application.case_questions",
      "application.case_requirement_states",
      "application.case_events",
      "application.application_cases",
      "application.private_job_snapshot_revisions",
      "application.private_job_snapshots",
      "matching.resume_exports",
      "matching.recommendation_items",
      "matching.resume_tailoring_runs",
      "matching.recommendation_runs",
      "matching.match_runs",
      "decision.job_decisions",
      "profile.resume_evidence_revisions",
      "profile.resume_document_revisions",
      "profile.job_preference_revisions",
      "profile.profile_fact_revisions",
      "profile.resume_analyses",
      "identity.owner_sessions",
    ] as const;
    for (const table of ownerTables) {
      const count = await db
        .selectFrom(table)
        .select(sql<number>`count(*)::int`.as("count"))
        .where("owner_id", "=", expiredSession.context.ownerId)
        .executeTakeFirstOrThrow();
      expect(count.count, table).toBe(0);
    }
    expect(
      await db
        .selectFrom("task_queue.tasks")
        .select(["task_type", "status"])
        .where("owner_id", "=", expiredSession.context.ownerId)
        .execute(),
    ).toEqual([{ task_type: "owner_deletion", status: "succeeded" }]);
    expect(
      await db
        .selectFrom("decision.owner_deletions")
        .select("status")
        .where("owner_id", "=", expiredSession.context.ownerId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: "succeeded" });

    expect(
      await findActiveSession({ db, sessionToken: survivorSession.sessionToken, now }),
    ).toMatchObject({
      ownerId: survivorSession.context.ownerId,
      ownerEpoch: survivorSession.context.ownerEpoch,
    });
    expect(await listJobDecisions(db, survivorSession.context)).toHaveLength(1);
    expect(
      await db
        .selectFrom("matching.match_runs")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("owner_id", "=", survivorSession.context.ownerId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ count: 1 });
    expect(
      await db
        .selectFrom("matching.resume_exports")
        .select(["status", "ciphertext"])
        .where("id", "=", freshExportId)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ status: "succeeded", ciphertext: Buffer.from("fresh-ciphertext") });

    expect(await runOwnerRetentionMaintenance({ db, now })).toEqual({
      expiredOwnersQueued: 0,
      expiredAuditEventsDeleted: 0,
      expiredDeletionTombstonesDeleted: 0,
    });
    expect(
      await db
        .selectFrom("identity.owners")
        .select("id")
        .where("id", "=", recentTombstone.ownerId)
        .executeTakeFirst(),
    ).toBeTruthy();
  });
});
