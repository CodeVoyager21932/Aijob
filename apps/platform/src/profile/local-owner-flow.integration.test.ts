import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import type { ResumeEvidence } from "@aijob/contracts";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession, findActiveSession } from "../identity/session-repository.js";
import { createJobInsightRun } from "../insights/service.js";
import type { ResumeAnalysisResult } from "../resume/analysis-service.js";
import { getResumeAnalysis, submitResumeAnalysis } from "../resume/repository.js";
import { runOneOwnerTask } from "../workers/owner-task-worker.js";
import {
  createDeletionReceipt,
  getOwnerDeletionByReceipt,
  requestOwnerDeletion,
} from "./deletion-service.js";
import {
  getCurrentResumeDocument,
  ProfileRevisionConflict,
  putJobPreferences,
  putProfileFacts,
  putResumeEvidence,
  putSavedResumeEvidenceSelection,
} from "./revision-repository.js";

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

describeWithDatabase("local owner resume, revisions and deletion flow", () => {
  let db: Kysely<Database>;
  let ownerId: string | undefined;

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
  });

  afterAll(async () => {
    if (ownerId) {
      await db.deleteFrom("matching.resume_exports").where("owner_id", "=", ownerId).execute();
      await db
        .deleteFrom("matching.recommendation_items")
        .where("owner_id", "=", ownerId)
        .execute();
      await db
        .deleteFrom("matching.resume_tailoring_runs")
        .where("owner_id", "=", ownerId)
        .execute();
      await db.deleteFrom("matching.recommendation_runs").where("owner_id", "=", ownerId).execute();
      await db.deleteFrom("matching.match_runs").where("owner_id", "=", ownerId).execute();
      await db.deleteFrom("decision.job_decisions").where("owner_id", "=", ownerId).execute();
      await db
        .deleteFrom("profile.resume_evidence_revisions")
        .where("owner_id", "=", ownerId)
        .execute();
      await db
        .deleteFrom("profile.job_preference_revisions")
        .where("owner_id", "=", ownerId)
        .execute();
      await db
        .deleteFrom("profile.profile_fact_revisions")
        .where("owner_id", "=", ownerId)
        .execute();
      await db.deleteFrom("profile.resume_analyses").where("owner_id", "=", ownerId).execute();
      await db.deleteFrom("task_queue.tasks").where("owner_id", "=", ownerId).execute();
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
      await db.deleteFrom("decision.owner_deletions").where("owner_id", "=", ownerId).execute();
      await db.deleteFrom("identity.owner_sessions").where("owner_id", "=", ownerId).execute();
      await db.deleteFrom("identity.owners").where("id", "=", ownerId).execute();
    }
    await db.destroy();
  });

  it("keeps raw content encrypted, confirms immutable revisions and prevents restoration", async () => {
    const createdSession = await createAnonymousSession({ db });
    const owner = createdSession.context;
    ownerId = owner.ownerId;
    const resumeText =
      "产品实习经历\n负责用户研究与需求分析，使用 SQL 和 Excel 分析 1000 条反馈，推动转化率提升 12%。\n毕业年份 2027\n电话 13812345678，邮箱 coco@example.com";

    const first = await submitResumeAnalysis({
      db,
      owner,
      idempotencyKey: "resume-flow-1",
      inputKind: "pasted_text",
      filename: null,
      mediaType: "text/plain",
      plaintext: Buffer.from(resumeText),
      encryptionKey,
    });
    const repeated = await submitResumeAnalysis({
      db,
      owner,
      idempotencyKey: "resume-flow-1",
      inputKind: "pasted_text",
      filename: null,
      mediaType: "text/plain",
      plaintext: Buffer.from(resumeText),
      encryptionKey,
    });
    expect(first.created).toBe(true);
    expect(repeated.created).toBe(false);
    expect(repeated.analysis.id).toBe(first.analysis.id);
    await expect(
      submitResumeAnalysis({
        db,
        owner,
        idempotencyKey: "resume-flow-1",
        inputKind: "pasted_text",
        filename: null,
        mediaType: "text/plain",
        plaintext: Buffer.from(`${resumeText}\n不同内容`),
        encryptionKey,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const stored = await db
      .selectFrom("profile.resume_analyses")
      .select(["raw_ciphertext", "content_sha256"])
      .where("id", "=", first.analysis.id)
      .executeTakeFirstOrThrow();
    expect(Buffer.from(stored.raw_ciphertext ?? []).toString("utf8")).not.toContain("13812345678");
    expect(stored.content_sha256).toMatch(/^[a-f0-9]{64}$/);

    expect(
      await runOneOwnerTask({
        db,
        config: config(),
        workerId: `profile-flow-worker-${owner.ownerId}`,
      }),
    ).toBe(true);
    const processed = await getResumeAnalysis({
      db,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      analysisId: first.analysis.id,
      encryptionKey,
    });
    const result = processed?.result as ResumeAnalysisResult | null;
    if (!result) throw new Error("resume analysis fixture was not processed");
    expect(result.redactedText).toContain("[手机号已隐藏]");
    expect(result.redactedText).toContain("[邮箱已隐藏]");
    expect(result.candidateFacts).toContainEqual({
      key: "graduation_year",
      value: 2027,
      confirmed: false,
    });
    expect(result.candidateEvidence.length).toBeGreaterThan(0);

    const facts = await putProfileFacts({
      db,
      owner,
      expectedRevision: 0,
      facts: [
        { key: "current_student", value: true },
        { key: "graduation_year", value: 2027 },
      ],
    });
    expect(facts.revision).toBe(1);
    await expect(
      putProfileFacts({
        db,
        owner,
        expectedRevision: 0,
        facts: [{ key: "current_student", value: true }],
      }),
    ).rejects.toBeInstanceOf(ProfileRevisionConflict);

    await putJobPreferences({
      db,
      owner,
      expectedRevision: 0,
      preferences: {
        cities: ["深圳"],
        jobFamilies: ["product"],
        companyNames: [],
        workModes: [],
      },
    });
    const candidate = result.candidateEvidence[0];
    if (!candidate) throw new Error("candidate evidence fixture missing");
    const evidence: ResumeEvidence = {
      id: candidate.id,
      resumeAnalysisId: first.analysis.id,
      sourceBlockId: candidate.sourceBlockId,
      section: candidate.section,
      evidenceType: candidate.evidenceType,
      statement: candidate.statement,
      skills: candidate.skills,
      outcomes: candidate.outcomes,
      confirmed: true,
    };
    await putResumeEvidence({
      db,
      owner,
      expectedRevision: 0,
      resumeAnalysisId: first.analysis.id,
      document: result.document,
      evidence: [evidence],
    });
    const documentRevision = await db
      .selectFrom("profile.resume_document_revisions")
      .select(["id", "schema_version", "sections"])
      .where("owner_id", "=", owner.ownerId)
      .executeTakeFirstOrThrow();
    expect(documentRevision).toMatchObject({
      schema_version: "resume-document-v1",
      sections: result.document.sections,
    });
    await expect(
      db
        .updateTable("profile.resume_document_revisions")
        .set({ sections: JSON.stringify([]) })
        .where("id", "=", documentRevision.id)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_PROFILE_REVISION");
    const savedDocument = await getCurrentResumeDocument({ db, ownerId: owner.ownerId });
    expect(savedDocument?.id).toBe(documentRevision.id);
    const reusedEvidence = await putSavedResumeEvidenceSelection({
      db,
      owner,
      expectedRevision: 1,
      documentRevisionId: documentRevision.id,
      sourceBlockIds: [candidate.sourceBlockId],
    });
    expect(reusedEvidence).toMatchObject({
      revision: 2,
      documentRevisionId: documentRevision.id,
      schemaVersion: "resume-evidence-v2",
    });
    expect(reusedEvidence.evidence[0]).toMatchObject({
      sourceBlockId: candidate.sourceBlockId,
      statement: candidate.statement,
      confirmed: true,
    });
    const purged = await db
      .selectFrom("profile.resume_analyses")
      .select(["raw_ciphertext", "extracted_text_ciphertext", "analysis_result", "purged_at"])
      .where("id", "=", first.analysis.id)
      .executeTakeFirstOrThrow();
    expect(purged.raw_ciphertext).toBeNull();
    expect(purged.extracted_text_ciphertext).toBeNull();
    expect(purged.analysis_result).toBeNull();
    expect(purged.purged_at).not.toBeNull();

    await createJobInsightRun({
      db,
      owner,
      request: {
        scope: {
          jobFamily: "product",
          cities: [`deletion-test-${randomUUID()}`],
          companyScaleBands: [],
        },
        evidenceRevisionId: reusedEvidence.id,
      },
      idempotencyKey: `deletion-insight-${randomUUID()}`,
      enableLocalMvp: true,
    });
    expect(
      await db
        .selectFrom("matching.job_insight_runs")
        .select("id")
        .where("owner_id", "=", owner.ownerId)
        .execute(),
    ).toHaveLength(1);

    const cancelledTaskId = randomUUID();
    await db
      .insertInto("task_queue.tasks")
      .values({
        id: cancelledTaskId,
        task_type: "match_run",
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        payload: JSON.stringify({ runId: randomUUID() }),
        idempotency_key: `deletion-cancel-test:${cancelledTaskId}`,
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
    const deletionRequest = await requestOwnerDeletion({ db, owner });
    await expect(
      db
        .selectFrom("task_queue.tasks")
        .select(["status", "last_error_code", "completed_at"])
        .where("id", "=", cancelledTaskId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      status: "dead",
      last_error_code: "OWNER_EPOCH_STALE",
      completed_at: expect.any(Date),
    });
    expect(
      await findActiveSession({
        db,
        sessionToken: createdSession.sessionToken,
      }),
    ).toBeNull();
    const receipt = createDeletionReceipt(
      {
        deletionId: deletionRequest.deletion.id,
        ownerId: owner.ownerId,
        requestedOwnerEpoch: owner.ownerEpoch,
      },
      encryptionKey,
    );
    expect(
      await getOwnerDeletionByReceipt({
        db,
        receipt,
        receiptSecret: encryptionKey,
      }),
    ).toMatchObject({ status: "queued" });

    expect(
      await runOneOwnerTask({
        db,
        config: config(),
        workerId: `profile-deletion-worker-${owner.ownerId}`,
      }),
    ).toBe(true);
    expect(
      await getOwnerDeletionByReceipt({
        db,
        receipt,
        receiptSecret: encryptionKey,
      }),
    ).toMatchObject({ status: "succeeded" });
    expect(
      await db
        .selectFrom("profile.profile_fact_revisions")
        .select("id")
        .where("owner_id", "=", owner.ownerId)
        .execute(),
    ).toHaveLength(0);
    expect(
      await db
        .selectFrom("profile.resume_analyses")
        .select("id")
        .where("owner_id", "=", owner.ownerId)
        .execute(),
    ).toHaveLength(0);
    expect(
      await db
        .selectFrom("matching.job_insight_runs")
        .select("id")
        .where("owner_id", "=", owner.ownerId)
        .execute(),
    ).toHaveLength(0);
    const ownerTombstone = await db
      .selectFrom("identity.owners")
      .select(["status", "epoch", "deleted_at"])
      .where("id", "=", owner.ownerId)
      .executeTakeFirstOrThrow();
    expect(ownerTombstone.status).toBe("deleted");
    expect(Number(ownerTombstone.epoch)).toBe(owner.ownerEpoch + 1);
    expect(ownerTombstone.deleted_at).not.toBeNull();

    await expect(
      submitResumeAnalysis({
        db,
        owner,
        idempotencyKey: `late-${randomUUID()}`,
        inputKind: "pasted_text",
        filename: null,
        mediaType: "text/plain",
        plaintext: Buffer.from(resumeText),
        encryptionKey,
      }),
    ).rejects.toThrow("OWNER_EPOCH_STALE");
  });
});
