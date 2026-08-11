import { randomUUID } from "node:crypto";
import type { ResumeEvidence } from "@aijob/contracts";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession } from "../identity/session-repository.js";
import { putResumeEvidence } from "../profile/revision-repository.js";
import type { OwnerTaskLease } from "../workers/owner-task-lease.js";
import { processResumeAnalysis, purgeExpiredResumeContent } from "./analysis-service.js";
import { createAtsResumeDocx } from "./export-docx.js";
import { getResumeAnalysis, submitResumeAnalysis } from "./repository.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const encryptionKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const docxMediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function taskPayload(value: unknown): { analysisId?: string } {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return {};
  return "analysisId" in parsed && typeof parsed.analysisId === "string"
    ? { analysisId: parsed.analysisId }
    : {};
}

async function leaseAnalysisTask(input: {
  db: Kysely<Database>;
  ownerId: string;
  ownerEpoch: number;
  analysisId: string;
  workerId: string;
}): Promise<OwnerTaskLease> {
  const tasks = await input.db
    .selectFrom("task_queue.tasks")
    .select(["id", "task_type", "payload", "fencing_token"])
    .where("owner_id", "=", input.ownerId)
    .where("task_type", "=", "resume_analysis")
    .execute();
  const task = tasks.find((item) => taskPayload(item.payload).analysisId === input.analysisId);
  if (!task) throw new Error("resume analysis task fixture missing");
  const fencingToken = Number(task.fencing_token) + 1;
  await input.db
    .updateTable("task_queue.tasks")
    .set({
      status: "running",
      attempt: 1,
      lease_owner: input.workerId,
      lease_until: new Date(Date.now() + 60_000),
      heartbeat_at: new Date(),
      fencing_token: fencingToken,
      completed_at: null,
    })
    .where("id", "=", task.id)
    .executeTakeFirstOrThrow();
  return {
    taskId: task.id,
    taskType: task.task_type,
    ownerId: input.ownerId,
    ownerEpoch: input.ownerEpoch,
    leaseOwner: input.workerId,
    fencingToken,
  };
}

async function finishTask(
  db: Kysely<Database>,
  lease: OwnerTaskLease,
  status: "succeeded" | "dead",
): Promise<void> {
  await db
    .updateTable("task_queue.tasks")
    .set({
      status,
      lease_owner: null,
      lease_until: null,
      heartbeat_at: new Date(),
      completed_at: new Date(),
    })
    .where("id", "=", lease.taskId)
    .where("lease_owner", "=", lease.leaseOwner)
    .where("fencing_token", "=", lease.fencingToken)
    .execute();
}

async function syntheticDocx(paragraph: string): Promise<Buffer> {
  return createAtsResumeDocx({
    title: "Synthetic test resume",
    sections: [
      {
        id: "experience",
        heading: "产品实习经历",
        paragraphs: [paragraph],
      },
    ],
  });
}

describeWithDatabase("resume plaintext minimization", () => {
  let db: Kysely<Database>;
  const ownerIds: string[] = [];

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
  });

  afterAll(async () => {
    if (ownerIds.length > 0) {
      await db
        .deleteFrom("profile.resume_evidence_revisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db
        .deleteFrom("profile.resume_document_revisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db.deleteFrom("task_queue.tasks").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("profile.resume_analyses").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owner_sessions").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owners").where("id", "in", ownerIds).execute();
    }
    await db.destroy();
  });

  it("hydrates only for the active owner and erases plaintext on every terminal path", async () => {
    const session = await createAnonymousSession({ db });
    const owner = session.context;
    ownerIds.push(owner.ownerId);
    const bodyMarker = "SYNTHETIC_RESUME_BODY_DO_NOT_PERSIST";
    const evidenceParagraph = `${bodyMarker}，使用 SQL 分析 1000 条反馈并提升转化率 12%。电话 13800000000，邮箱 synthetic@example.test`;
    const mainFilename = "synthetic-private-filename.docx";
    const main = await submitResumeAnalysis({
      db,
      owner,
      idempotencyKey: "privacy-main",
      inputKind: "docx",
      filename: mainFilename,
      mediaType: docxMediaType,
      plaintext: await syntheticDocx(evidenceParagraph),
      encryptionKey,
    });
    const mainLease = await leaseAnalysisTask({
      db,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      analysisId: main.analysis.id,
      workerId: "privacy-main-worker",
    });
    const processed = await processResumeAnalysis({
      db,
      analysisId: main.analysis.id,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      encryptionKey,
      lease: mainLease,
    });
    await finishTask(db, mainLease, "succeeded");
    if (processed.version !== "resume-analysis-v2") {
      throw new Error("new resume analysis unexpectedly used the legacy schema");
    }
    expect(processed.version).toBe("resume-analysis-v2");

    const persisted = await db
      .selectFrom("profile.resume_analyses")
      .select(["analysis_result", "original_filename"])
      .where("id", "=", main.analysis.id)
      .executeTakeFirstOrThrow();
    expect(persisted.analysis_result).toEqual({
      version: "resume-analysis-storage-v2",
      candidateEvidenceCount: processed.candidateEvidence.length,
      documentBlockCount: processed.document.sections.flatMap((section) => section.blocks).length,
    });
    const persistedJson = JSON.stringify(persisted.analysis_result);
    expect(persistedJson).not.toContain(bodyMarker);
    expect(persistedJson).not.toContain("13800000000");
    expect(persistedJson).not.toContain("synthetic@example.test");
    expect(persistedJson).not.toContain("originalText");
    expect(persistedJson).not.toContain("redactedText");

    const firstRead = await getResumeAnalysis({
      db,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      analysisId: main.analysis.id,
      encryptionKey,
    });
    const secondRead = await getResumeAnalysis({
      db,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      analysisId: main.analysis.id,
      encryptionKey,
    });
    if (firstRead?.result?.version !== "resume-analysis-v2") {
      throw new Error("new resume analysis did not hydrate as v2");
    }
    const firstResult = firstRead.result;
    expect(firstRead?.result?.redactedText).toContain(bodyMarker);
    expect(firstRead?.result?.redactedText).toContain("[手机号已隐藏]");
    expect(firstRead?.result?.candidateEvidence.map((item) => item.id)).toEqual(
      secondRead?.result?.candidateEvidence.map((item) => item.id),
    );

    const reentryLease = await leaseAnalysisTask({
      db,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      analysisId: main.analysis.id,
      workerId: "privacy-reentry-worker",
    });
    const reentered = await processResumeAnalysis({
      db,
      analysisId: main.analysis.id,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      encryptionKey,
      lease: reentryLease,
    });
    await finishTask(db, reentryLease, "succeeded");
    expect(reentered).toEqual(firstRead?.result);

    const candidate = firstResult.candidateEvidence[0];
    if (!candidate) throw new Error("candidate evidence fixture missing");
    const confirmedEvidence: ResumeEvidence = {
      ...candidate,
      resumeAnalysisId: main.analysis.id,
      confirmed: true,
    };
    await expect(
      putResumeEvidence({
        db,
        owner,
        expectedRevision: 0,
        resumeAnalysisId: main.analysis.id,
        document: firstResult.document,
        evidence: [{ ...confirmedEvidence, id: randomUUID() }],
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_CANDIDATE_UNKNOWN" });
    await putResumeEvidence({
      db,
      owner,
      expectedRevision: 0,
      resumeAnalysisId: main.analysis.id,
      document: firstResult.document,
      evidence: [confirmedEvidence],
    });
    const confirmedRow = await db
      .selectFrom("profile.resume_analyses")
      .selectAll()
      .where("id", "=", main.analysis.id)
      .executeTakeFirstOrThrow();
    expect(confirmedRow.original_filename).toBeNull();
    expect(confirmedRow.raw_ciphertext).toBeNull();
    expect(confirmedRow.extracted_text_ciphertext).toBeNull();
    expect(confirmedRow.analysis_result).toBeNull();
    expect(JSON.stringify(confirmedRow)).not.toContain(mainFilename);
    expect(JSON.stringify(confirmedRow)).not.toContain(bodyMarker);

    const ttlFilename = "synthetic-expiring-filename.docx";
    const ttl = await submitResumeAnalysis({
      db,
      owner,
      idempotencyKey: "privacy-ttl",
      inputKind: "docx",
      filename: ttlFilename,
      mediaType: docxMediaType,
      plaintext: await syntheticDocx(`${bodyMarker}_TTL，使用 Excel 完成数据分析。`),
      encryptionKey,
    });
    const ttlLease = await leaseAnalysisTask({
      db,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      analysisId: ttl.analysis.id,
      workerId: "privacy-ttl-worker",
    });
    await processResumeAnalysis({
      db,
      analysisId: ttl.analysis.id,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      encryptionKey,
      lease: ttlLease,
    });
    await finishTask(db, ttlLease, "succeeded");
    const ttlRead = await getResumeAnalysis({
      db,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      analysisId: ttl.analysis.id,
      encryptionKey,
    });
    if (ttlRead?.result?.version !== "resume-analysis-v2") {
      throw new Error("new TTL resume analysis did not hydrate as v2");
    }
    const ttlResult = ttlRead.result;
    const ttlCandidate = ttlResult.candidateEvidence[0];
    if (!ttlCandidate) throw new Error("TTL candidate evidence fixture missing");
    const cachedTtlEvidence: ResumeEvidence = {
      ...ttlCandidate,
      resumeAnalysisId: ttl.analysis.id,
      confirmed: true,
    };
    const ttlMetadata = await db
      .selectFrom("profile.resume_analyses")
      .select("analysis_result")
      .where("id", "=", ttl.analysis.id)
      .executeTakeFirstOrThrow();
    await db
      .updateTable("profile.resume_analyses")
      .set({ analysis_result: null })
      .where("id", "=", ttl.analysis.id)
      .execute();
    await expect(
      putResumeEvidence({
        db,
        owner,
        expectedRevision: 1,
        resumeAnalysisId: ttl.analysis.id,
        document: ttlResult.document,
        evidence: [cachedTtlEvidence],
      }),
    ).rejects.toMatchObject({ code: "RESUME_ANALYSIS_NOT_CONFIRMABLE" });
    await db
      .updateTable("profile.resume_analyses")
      .set({ analysis_result: ttlMetadata.analysis_result })
      .where("id", "=", ttl.analysis.id)
      .execute();

    const expiredAt = new Date(new Date(ttl.analysis.purgeAfter).getTime() + 1);
    const expiredRead = await getResumeAnalysis({
      db,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      analysisId: ttl.analysis.id,
      encryptionKey,
      now: expiredAt,
    });
    expect(expiredRead?.result).toBeNull();
    await expect(
      putResumeEvidence({
        db,
        owner,
        expectedRevision: 1,
        resumeAnalysisId: ttl.analysis.id,
        document: ttlResult.document,
        evidence: [cachedTtlEvidence],
        now: expiredAt,
      }),
    ).rejects.toMatchObject({ code: "RESUME_ANALYSIS_NOT_CONFIRMABLE" });
    await purgeExpiredResumeContent({ db, now: expiredAt, ownerId: owner.ownerId });
    const ttlPurged = await db
      .selectFrom("profile.resume_analyses")
      .selectAll()
      .where("id", "=", ttl.analysis.id)
      .executeTakeFirstOrThrow();
    expect(ttlPurged.original_filename).toBeNull();
    expect(ttlPurged.raw_ciphertext).toBeNull();
    expect(ttlPurged.extracted_text_ciphertext).toBeNull();
    expect(ttlPurged.analysis_result).toBeNull();
    expect(JSON.stringify(ttlPurged)).not.toContain(ttlFilename);
    expect(JSON.stringify(ttlPurged)).not.toContain(`${bodyMarker}_TTL`);

    const failed = await submitResumeAnalysis({
      db,
      owner,
      idempotencyKey: "privacy-failed",
      inputKind: "pdf",
      filename: "synthetic-failed-filename.pdf",
      mediaType: "application/pdf",
      plaintext: Buffer.from("%PDF-1.7\ninvalid synthetic PDF"),
      encryptionKey,
    });
    const failedLease = await leaseAnalysisTask({
      db,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      analysisId: failed.analysis.id,
      workerId: "privacy-failed-worker",
    });
    await expect(
      processResumeAnalysis({
        db,
        analysisId: failed.analysis.id,
        ownerId: owner.ownerId,
        ownerEpoch: owner.ownerEpoch,
        encryptionKey,
        lease: failedLease,
      }),
    ).rejects.toBeTruthy();
    await finishTask(db, failedLease, "dead");
    const failedRow = await db
      .selectFrom("profile.resume_analyses")
      .select(["status", "original_filename", "purged_at"])
      .where("id", "=", failed.analysis.id)
      .executeTakeFirstOrThrow();
    expect(failedRow.status).toBe("failed");
    expect(failedRow.original_filename).toBeNull();
    expect(failedRow.purged_at).not.toBeNull();

    const needsInput = await submitResumeAnalysis({
      db,
      owner,
      idempotencyKey: "privacy-needs-input",
      inputKind: "docx",
      filename: "synthetic-needs-input-filename.docx",
      mediaType: docxMediaType,
      plaintext: await syntheticDocx("短文本"),
      encryptionKey,
    });
    const needsInputLease = await leaseAnalysisTask({
      db,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      analysisId: needsInput.analysis.id,
      workerId: "privacy-needs-input-worker",
    });
    await expect(
      processResumeAnalysis({
        db,
        analysisId: needsInput.analysis.id,
        ownerId: owner.ownerId,
        ownerEpoch: owner.ownerEpoch,
        encryptionKey,
        lease: needsInputLease,
      }),
    ).rejects.toBeTruthy();
    await finishTask(db, needsInputLease, "dead");
    const needsInputRow = await db
      .selectFrom("profile.resume_analyses")
      .select(["status", "original_filename", "purged_at"])
      .where("id", "=", needsInput.analysis.id)
      .executeTakeFirstOrThrow();
    expect(needsInputRow.status).toBe("needs_input");
    expect(needsInputRow.original_filename).toBeNull();
    expect(needsInputRow.purged_at).not.toBeNull();
  }, 30_000);

  it("does not let an in-flight analysis revive content after TTL purge", async () => {
    const session = await createAnonymousSession({ db });
    const owner = session.context;
    ownerIds.push(owner.ownerId);
    const submission = await submitResumeAnalysis({
      db,
      owner,
      idempotencyKey: "privacy-race",
      inputKind: "pasted_text",
      filename: null,
      mediaType: "text/plain",
      plaintext: Buffer.from(
        "Experience\nSYNTHETIC_RACE_BODY used SQL to analyze 100 feedback items.",
      ),
      encryptionKey,
    });
    const lease = await leaseAnalysisTask({
      db,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
      analysisId: submission.analysis.id,
      workerId: "privacy-race-worker",
    });
    const expiredAt = new Date(Date.now() - 1_000);
    await db
      .updateTable("profile.resume_analyses")
      .set({ purge_after: expiredAt })
      .where("id", "=", submission.analysis.id)
      .executeTakeFirstOrThrow();

    await expect(
      processResumeAnalysis({
        db,
        analysisId: submission.analysis.id,
        ownerId: owner.ownerId,
        ownerEpoch: owner.ownerEpoch,
        encryptionKey,
        lease,
      }),
    ).rejects.toThrow("RESUME_ANALYSIS_EXPIRED");

    const purged = await db
      .selectFrom("profile.resume_analyses")
      .selectAll()
      .where("id", "=", submission.analysis.id)
      .executeTakeFirstOrThrow();
    expect(purged.raw_ciphertext).toBeNull();
    expect(purged.extracted_text_ciphertext).toBeNull();
    expect(purged.analysis_result).toBeNull();
    expect(purged.original_filename).toBeNull();
    expect(purged.purged_at).not.toBeNull();

    await expect(
      db
        .updateTable("profile.resume_analyses")
        .set({
          status: "succeeded",
          extracted_text_ciphertext: Buffer.from("revived"),
          extracted_text_nonce: Buffer.alloc(12),
          extracted_text_auth_tag: Buffer.alloc(16),
          analysis_result: JSON.stringify({
            version: "resume-analysis-storage-v1",
            candidateEvidenceCount: 1,
          }),
        })
        .where("id", "=", submission.analysis.id)
        .executeTakeFirstOrThrow(),
    ).rejects.toBeTruthy();
  }, 15_000);
});
