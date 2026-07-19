import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "./index.js";
import { migrateToLatest } from "./migrate.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("local complete MVP persistence contracts", () => {
  const ownerId = randomUUID();
  const taskId = randomUUID();
  const resumeAnalysisId = randomUUID();
  const fileResumeAnalysisId = randomUUID();
  const profileRevisionId = randomUUID();
  const db = createDatabase(databaseUrl ?? "postgresql://unused");

  beforeAll(async () => {
    await migrateToLatest(db);
    await db
      .insertInto("identity.owners")
      .values({
        id: ownerId,
        deleted_at: null,
      })
      .execute();
  });

  afterAll(async () => {
    await db.deleteFrom("task_queue.tasks").where("id", "=", taskId).execute();
    await db
      .deleteFrom("profile.profile_fact_revisions")
      .where("id", "=", profileRevisionId)
      .execute();
    await db.deleteFrom("profile.resume_analyses").where("id", "=", resumeAnalysisId).execute();
    await db.deleteFrom("profile.resume_analyses").where("id", "=", fileResumeAnalysisId).execute();
    await db.deleteFrom("identity.owners").where("id", "=", ownerId).execute();
    await db.destroy();
  });

  it("accepts an owner task and rejects a user task without owner context", async () => {
    await db
      .insertInto("task_queue.tasks")
      .values({
        id: taskId,
        task_type: "resume_analysis",
        owner_id: ownerId,
        owner_epoch: 1,
        idempotency_key: `resume-${taskId}`,
        status: "queued",
        attempt: 0,
        max_attempts: 3,
        available_at: new Date(),
        backoff_policy: {},
        lease_owner: null,
        lease_until: null,
        heartbeat_at: null,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();

    await expect(
      db
        .insertInto("task_queue.tasks")
        .values({
          id: randomUUID(),
          task_type: "resume_analysis",
          idempotency_key: `missing-owner-${randomUUID()}`,
          status: "queued",
          attempt: 0,
          max_attempts: 3,
          available_at: new Date(),
          backoff_policy: {},
          lease_owner: null,
          lease_until: null,
          heartbeat_at: null,
          last_error_code: null,
          last_error_summary: null,
          completed_at: null,
        })
        .execute(),
    ).rejects.toThrow();

    await expect(
      db
        .updateTable("task_queue.tasks")
        .set({ payload: JSON.stringify({ changed: true }) })
        .where("id", "=", taskId)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_TASK_CONTEXT");
  });

  it("stores only complete AES-GCM tuples for temporary resume content", async () => {
    await db
      .insertInto("profile.resume_analyses")
      .values({
        id: resumeAnalysisId,
        owner_id: ownerId,
        owner_epoch: 1,
        input_kind: "pasted_text",
        status: "queued",
        original_filename: null,
        media_type: "text/plain",
        byte_size: 16,
        content_sha256: "a".repeat(64),
        encryption_key_version: "local-test-v1",
        raw_ciphertext: new Uint8Array(16),
        raw_nonce: new Uint8Array(12),
        raw_auth_tag: new Uint8Array(16),
        extracted_text_ciphertext: null,
        extracted_text_nonce: null,
        extracted_text_auth_tag: null,
        analysis_result: null,
        privacy_confirmed_at: null,
        purged_at: null,
        failure_code: null,
      })
      .execute();

    await expect(
      db
        .insertInto("profile.resume_analyses")
        .values({
          id: randomUUID(),
          owner_id: ownerId,
          owner_epoch: 1,
          input_kind: "pasted_text",
          status: "queued",
          original_filename: null,
          media_type: "text/plain",
          byte_size: 16,
          content_sha256: "b".repeat(64),
          encryption_key_version: "local-test-v1",
          raw_ciphertext: new Uint8Array(16),
          raw_nonce: new Uint8Array(8),
          raw_auth_tag: new Uint8Array(16),
          extracted_text_ciphertext: null,
          extracted_text_nonce: null,
          extracted_text_auth_tag: null,
          analysis_result: null,
          privacy_confirmed_at: null,
          purged_at: null,
          failure_code: null,
        })
        .execute(),
    ).rejects.toThrow();
  });

  it("forbids resume plaintext in analysis JSON and filename residue after purge", async () => {
    await expect(
      db
        .updateTable("profile.resume_analyses")
        .set({
          analysis_result: JSON.stringify({
            version: "resume-analysis-v1",
            redactedText: "synthetic resume body must not persist",
            candidateEvidence: [{ originalText: "synthetic evidence body" }],
          }),
        })
        .where("id", "=", resumeAnalysisId)
        .execute(),
    ).rejects.toThrow();

    await db
      .updateTable("profile.resume_analyses")
      .set({
        analysis_result: JSON.stringify({
          version: "resume-analysis-storage-v1",
          candidateEvidenceCount: 1,
        }),
      })
      .where("id", "=", resumeAnalysisId)
      .execute();

    await db
      .insertInto("profile.resume_analyses")
      .values({
        id: fileResumeAnalysisId,
        owner_id: ownerId,
        owner_epoch: 1,
        input_kind: "pdf",
        status: "queued",
        original_filename: "synthetic-private-name.pdf",
        media_type: "application/pdf",
        byte_size: 16,
        content_sha256: "d".repeat(64),
        encryption_key_version: "local-test-v1",
        raw_ciphertext: new Uint8Array(16),
        raw_nonce: new Uint8Array(12),
        raw_auth_tag: new Uint8Array(16),
        extracted_text_ciphertext: null,
        extracted_text_nonce: null,
        extracted_text_auth_tag: null,
        analysis_result: null,
        privacy_confirmed_at: null,
        purged_at: null,
        failure_code: null,
      })
      .execute();

    await expect(
      db
        .updateTable("profile.resume_analyses")
        .set({ purged_at: new Date() })
        .where("id", "=", fileResumeAnalysisId)
        .execute(),
    ).rejects.toThrow();

    await db
      .updateTable("profile.resume_analyses")
      .set({
        raw_ciphertext: null,
        raw_nonce: null,
        raw_auth_tag: null,
        original_filename: null,
        purged_at: new Date(),
      })
      .where("id", "=", fileResumeAnalysisId)
      .execute();
    const purged = await db
      .selectFrom("profile.resume_analyses")
      .select(["original_filename", "analysis_result"])
      .where("id", "=", fileResumeAnalysisId)
      .executeTakeFirstOrThrow();
    expect(purged.original_filename).toBeNull();
    expect(purged.analysis_result).toBeNull();
  });

  it("persists confirmed profile facts as an append-only revision", async () => {
    await db
      .insertInto("profile.profile_fact_revisions")
      .values({
        id: profileRevisionId,
        owner_id: ownerId,
        owner_epoch: 1,
        revision: 1,
        base_revision: null,
        facts: JSON.stringify([{ key: "graduation_year", value: 2027 }]),
        content_hash: "c".repeat(64),
        confirmed_at: new Date(),
      })
      .execute();

    const revision = await db
      .selectFrom("profile.profile_fact_revisions")
      .select(["revision", "facts"])
      .where("id", "=", profileRevisionId)
      .executeTakeFirstOrThrow();

    expect(revision.revision).toBe(1);
    expect(revision.facts).toEqual([{ key: "graduation_year", value: 2027 }]);

    await expect(
      db
        .updateTable("profile.profile_fact_revisions")
        .set({ facts: JSON.stringify([]) })
        .where("id", "=", profileRevisionId)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_PROFILE_REVISION");
  });

  it("installs explicit job fields and immutable run guards", async () => {
    const columns = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'catalog'
        AND table_name = 'published_job_versions'
        AND column_name IN (
          'weekly_attendance_days',
          'duration_months',
          'graduation_years',
          'education_levels',
          'salary',
          'work_mode'
        )
    `.execute(db);
    expect(new Set(columns.rows.map((row) => row.column_name))).toEqual(
      new Set([
        "weekly_attendance_days",
        "duration_months",
        "graduation_years",
        "education_levels",
        "salary",
        "work_mode",
      ]),
    );

    const triggers = await sql<{ trigger_name: string }>`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE trigger_schema = 'matching'
    `.execute(db);
    expect(new Set(triggers.rows.map((row) => row.trigger_name))).toEqual(
      new Set([
        "match_runs_immutable_context",
        "recommendation_runs_immutable_context",
        "tailoring_runs_immutable_context",
        "tailoring_segments_immutable_evidence",
      ]),
    );
  });
});
