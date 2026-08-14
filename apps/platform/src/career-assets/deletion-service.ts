import {
  type DeleteApplicationCaseRequest,
  type DeleteApplicationCaseResponse,
  DeleteApplicationCaseResponseSchema,
  type DeleteDebriefRequest,
  type DeleteDebriefResponse,
  DeleteDebriefResponseSchema,
  type DeleteInterviewSessionRequest,
  type DeleteInterviewSessionResponse,
  DeleteInterviewSessionResponseSchema,
  type DeleteResumeDocumentRequest,
  type DeleteResumeDocumentResponse,
  DeleteResumeDocumentResponseSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";

interface CaseDeletionRow {
  id: string;
  owner_epoch: number;
  private_job_snapshot_id: string | null;
  revision: number;
  deleted_at: Date | null;
}

interface DeletableAssetRow {
  id: string;
  private_job_snapshot_id: string | null;
  revision: number;
  deleted_at: Date | null;
}

interface CaseAssetProjectionRow {
  id: string;
  detached_from_case_id: string | null;
  deleted_at: Date | null;
}

interface CaseAssetProjection {
  deletedIds: string[];
  detachedIds: string[];
}

function caseNotFound(): ServiceError {
  return new ServiceError(
    404,
    "APPLICATION_CASE_NOT_FOUND",
    "求职项目不存在、已删除或不属于当前用户。",
  );
}

function caseRevisionConflict(): ServiceError {
  return new ServiceError(
    409,
    "APPLICATION_CASE_REVISION_CONFLICT",
    "求职项目已在其他页面更新，请刷新并核对后重试。",
  );
}

function resumeDocumentNotFound(): ServiceError {
  return new ServiceError(
    404,
    "RESUME_DOCUMENT_NOT_FOUND",
    "简历文档不存在、已删除或不属于当前用户。",
  );
}

function resumeDocumentRevisionConflict(): ServiceError {
  return new ServiceError(
    409,
    "RESUME_DOCUMENT_REVISION_CONFLICT",
    "简历文档已在其他页面更新，请刷新并核对后重试。",
  );
}

function interviewSessionNotFound(): ServiceError {
  return new ServiceError(
    404,
    "INTERVIEW_SESSION_NOT_FOUND",
    "面试练习不存在、已删除或不属于当前用户。",
  );
}

function interviewSessionRevisionConflict(): ServiceError {
  return new ServiceError(
    409,
    "INTERVIEW_SESSION_REVISION_CONFLICT",
    "面试练习已在其他页面更新，请刷新并核对后重试。",
  );
}

function debriefNotFound(): ServiceError {
  return new ServiceError(404, "DEBRIEF_NOT_FOUND", "复盘不存在、已删除或不属于当前用户。");
}

function debriefRevisionConflict(): ServiceError {
  return new ServiceError(
    409,
    "DEBRIEF_REVISION_CONFLICT",
    "复盘已在其他页面更新，请刷新并核对后重试。",
  );
}

function toIso(value: Date): string {
  return value.toISOString();
}

async function deletionTimestamp(
  transaction: Transaction<Database>,
  requested?: Date,
): Promise<Date> {
  if (requested) return requested;
  // Created timestamps come from PostgreSQL, so deletion must use the same clock.
  const row = await transaction
    .selectNoFrom(sql<Date>`clock_timestamp()`.as("deleted_at"))
    .executeTakeFirstOrThrow();
  return row.deleted_at;
}

function classifyCaseAssets(rows: CaseAssetProjectionRow[]): CaseAssetProjection {
  const deletedIds: string[] = [];
  const detachedIds: string[] = [];
  for (const row of rows) {
    if (row.deleted_at) deletedIds.push(row.id);
    else if (row.detached_from_case_id) detachedIds.push(row.id);
  }
  return {
    deletedIds: deletedIds.sort(),
    detachedIds: detachedIds.sort(),
  };
}

async function projectCaseRelatedAssets(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  caseId: string,
): Promise<DeleteApplicationCaseResponse["relatedAssets"]> {
  const resumeDocuments = await transaction
    .selectFrom("profile.resume_documents")
    .select(["id", "detached_from_case_id", "deleted_at"])
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where((expression) =>
      expression.or([
        expression("case_id", "=", caseId),
        expression("detached_from_case_id", "=", caseId),
      ]),
    )
    .execute();
  const interviewSessions = await transaction
    .selectFrom("application.interview_sessions")
    .select(["id", "detached_from_case_id", "deleted_at"])
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where((expression) =>
      expression.or([
        expression("case_id", "=", caseId),
        expression("detached_from_case_id", "=", caseId),
      ]),
    )
    .execute();
  const debriefs = await transaction
    .selectFrom("application.debriefs")
    .select(["id", "detached_from_case_id", "deleted_at"])
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where((expression) =>
      expression.or([
        expression("case_id", "=", caseId),
        expression("detached_from_case_id", "=", caseId),
      ]),
    )
    .execute();
  return {
    resumeDocuments: classifyCaseAssets(resumeDocuments),
    interviewSessions: classifyCaseAssets(interviewSessions),
    debriefs: classifyCaseAssets(debriefs),
  };
}

function replayMatchesCaseDeletionRequest(
  relatedAssets: DeleteApplicationCaseResponse["relatedAssets"],
  request: DeleteApplicationCaseRequest,
): boolean {
  const choices = [
    [relatedAssets.resumeDocuments, request.resumeDocuments],
    [relatedAssets.interviewSessions, request.interviewSessions],
    [relatedAssets.debriefs, request.debriefs],
  ] as const;
  return choices.every(([projection, disposition]) =>
    disposition === "delete"
      ? projection.detachedIds.length === 0
      : projection.deletedIds.length === 0,
  );
}

async function deleteResumeReviewRuns(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  documentIds: string[],
  now: Date,
): Promise<string[]> {
  if (documentIds.length === 0) return [];
  const rows = await transaction
    .updateTable("profile.resume_review_runs")
    .set({
      status: "deleted",
      deleted_at: now,
      revision: sql<number>`revision + 1`,
      updated_at: now,
    })
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("document_id", "in", documentIds)
    .where("deleted_at", "is", null)
    .returning("id")
    .execute();
  return rows.map((row) => row.id).sort();
}

async function deleteResumeDocumentsForCase(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  documentIds: string[],
  now: Date,
): Promise<void> {
  if (documentIds.length === 0) return;
  await deleteResumeReviewRuns(transaction, owner, documentIds, now);
  await transaction
    .updateTable("profile.resume_documents")
    .set({
      deleted_at: now,
      revision: sql<number>`revision + 1`,
      updated_at: now,
    })
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("id", "in", documentIds)
    .where("deleted_at", "is", null)
    .execute();
}

async function detachResumeDocumentsFromCase(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  caseId: string,
  documentIds: string[],
  now: Date,
): Promise<void> {
  if (documentIds.length === 0) return;
  await transaction
    .updateTable("profile.resume_documents")
    .set({
      case_id: null,
      detached_from_case_id: caseId,
      revision: sql<number>`revision + 1`,
      updated_at: now,
    })
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("id", "in", documentIds)
    .where("case_id", "=", caseId)
    .where("deleted_at", "is", null)
    .execute();
  await transaction
    .updateTable("profile.resume_review_runs")
    .set({
      case_id: null,
      detached_from_case_id: caseId,
      revision: sql<number>`revision + 1`,
      updated_at: now,
    })
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("document_id", "in", documentIds)
    .where("case_id", "=", caseId)
    .where("deleted_at", "is", null)
    .execute();
}

async function privateSnapshotHasActiveReference(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  snapshotId: string,
): Promise<boolean> {
  const caseReference = await transaction
    .selectFrom("application.application_cases")
    .select("id")
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("private_job_snapshot_id", "=", snapshotId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (caseReference) return true;

  const resumeReference = await transaction
    .selectFrom("profile.resume_documents")
    .select("id")
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("private_job_snapshot_id", "=", snapshotId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (resumeReference) return true;

  const interviewReference = await transaction
    .selectFrom("application.interview_sessions")
    .select("id")
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("private_job_snapshot_id", "=", snapshotId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (interviewReference) return true;

  const debriefReference = await transaction
    .selectFrom("application.debriefs")
    .select("id")
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("private_job_snapshot_id", "=", snapshotId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return Boolean(debriefReference);
}

async function updatePrivateSnapshotRetention(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  snapshotId: string | null,
  now: Date,
): Promise<boolean> {
  if (!snapshotId) return false;
  if (await privateSnapshotHasActiveReference(transaction, owner, snapshotId)) return true;
  await transaction
    .updateTable("application.private_job_snapshots")
    .set({ deleted_at: now, updated_at: now })
    .where("id", "=", snapshotId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("deleted_at", "is", null)
    .execute();
  return false;
}

export async function deleteApplicationCase(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  request: DeleteApplicationCaseRequest;
  now?: Date;
}): Promise<DeleteApplicationCaseResponse> {
  return input.db.transaction().execute(async (transaction) => {
    const now = await deletionTimestamp(transaction, input.now);
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch, now);
    const applicationCase = (await transaction
      .selectFrom("application.application_cases")
      .select(["id", "owner_epoch", "private_job_snapshot_id", "revision", "deleted_at"])
      .where("id", "=", input.caseId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .forUpdate()
      .executeTakeFirst()) as CaseDeletionRow | undefined;
    if (!applicationCase) throw caseNotFound();

    if (applicationCase.deleted_at) {
      if (Number(applicationCase.revision) !== input.request.expectedRevision + 1) {
        throw caseNotFound();
      }
      const relatedAssets = await projectCaseRelatedAssets(transaction, input.owner, input.caseId);
      if (!replayMatchesCaseDeletionRequest(relatedAssets, input.request)) {
        throw new ServiceError(
          409,
          "APPLICATION_CASE_DELETION_REPLAY_CONFLICT",
          "该求职项目已经按另一组关联资产选择删除。",
        );
      }
      const snapshotRetained = applicationCase.private_job_snapshot_id
        ? Boolean(
            await transaction
              .selectFrom("application.private_job_snapshots")
              .select("id")
              .where("id", "=", applicationCase.private_job_snapshot_id)
              .where("owner_id", "=", input.owner.ownerId)
              .where("owner_epoch", "=", input.owner.ownerEpoch)
              .where("deleted_at", "is", null)
              .executeTakeFirst(),
          )
        : false;
      return DeleteApplicationCaseResponseSchema.parse({
        caseId: applicationCase.id,
        revision: Number(applicationCase.revision),
        deletedAt: toIso(applicationCase.deleted_at),
        relatedAssets,
        privateJobSnapshotRetained: snapshotRetained,
      });
    }
    if (Number(applicationCase.revision) !== input.request.expectedRevision) {
      throw caseRevisionConflict();
    }

    const resumeDocuments = await transaction
      .selectFrom("profile.resume_documents")
      .select(["id", "revision"])
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("case_id", "=", input.caseId)
      .where("deleted_at", "is", null)
      .forUpdate()
      .execute();
    const resumeDocumentIds = resumeDocuments.map((row) => row.id);
    if (input.request.resumeDocuments === "delete") {
      await deleteResumeDocumentsForCase(transaction, input.owner, resumeDocumentIds, now);
    } else {
      await detachResumeDocumentsFromCase(
        transaction,
        input.owner,
        input.caseId,
        resumeDocumentIds,
        now,
      );
    }

    const interviewSessions = await transaction
      .selectFrom("application.interview_sessions")
      .select(["id", "revision"])
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("case_id", "=", input.caseId)
      .where("deleted_at", "is", null)
      .forUpdate()
      .execute();
    const interviewSessionIds = interviewSessions.map((row) => row.id);
    if (interviewSessionIds.length > 0) {
      await transaction
        .updateTable("application.interview_sessions")
        .set(
          input.request.interviewSessions === "delete"
            ? {
                status: "deleted",
                deleted_at: now,
                revision: sql<number>`revision + 1`,
                updated_at: now,
              }
            : {
                case_id: null,
                detached_from_case_id: input.caseId,
                revision: sql<number>`revision + 1`,
                updated_at: now,
              },
        )
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .where("id", "in", interviewSessionIds)
        .where("deleted_at", "is", null)
        .execute();
    }

    const debriefs = await transaction
      .selectFrom("application.debriefs")
      .select(["id", "revision"])
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("case_id", "=", input.caseId)
      .where("deleted_at", "is", null)
      .forUpdate()
      .execute();
    const debriefIds = debriefs.map((row) => row.id);
    if (debriefIds.length > 0) {
      await transaction
        .updateTable("application.debriefs")
        .set(
          input.request.debriefs === "delete"
            ? {
                deleted_at: now,
                revision: sql<number>`revision + 1`,
                updated_at: now,
              }
            : {
                case_id: null,
                detached_from_case_id: input.caseId,
                revision: sql<number>`revision + 1`,
                updated_at: now,
              },
        )
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .where("id", "in", debriefIds)
        .where("deleted_at", "is", null)
        .execute();
    }

    await transaction
      .deleteFrom("application.knowledge_clip_case_links")
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("case_id", "=", input.caseId)
      .execute();
    await transaction
      .deleteFrom("application.case_questions")
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("case_id", "=", input.caseId)
      .execute();
    await transaction
      .deleteFrom("application.case_requirement_evidence_links")
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("case_id", "=", input.caseId)
      .execute();
    await transaction
      .deleteFrom("application.case_requirement_states")
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("case_id", "=", input.caseId)
      .execute();

    const deletedCase = await transaction
      .updateTable("application.application_cases")
      .set({
        deleted_at: now,
        revision: input.request.expectedRevision + 1,
        updated_at: now,
      })
      .where("id", "=", input.caseId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("revision", "=", input.request.expectedRevision)
      .where("deleted_at", "is", null)
      .returning(["revision", "deleted_at"])
      .executeTakeFirst();
    if (!deletedCase?.deleted_at) throw caseRevisionConflict();

    const privateJobSnapshotRetained = await updatePrivateSnapshotRetention(
      transaction,
      input.owner,
      applicationCase.private_job_snapshot_id,
      now,
    );
    const relatedAssets = await projectCaseRelatedAssets(transaction, input.owner, input.caseId);
    return DeleteApplicationCaseResponseSchema.parse({
      caseId: input.caseId,
      revision: Number(deletedCase.revision),
      deletedAt: toIso(deletedCase.deleted_at),
      relatedAssets,
      privateJobSnapshotRetained,
    });
  });
}

export async function deleteResumeDocument(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  documentId: string;
  request: DeleteResumeDocumentRequest;
  now?: Date;
}): Promise<DeleteResumeDocumentResponse> {
  return input.db.transaction().execute(async (transaction) => {
    const now = await deletionTimestamp(transaction, input.now);
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch, now);
    const document = (await transaction
      .selectFrom("profile.resume_documents")
      .select(["id", "private_job_snapshot_id", "revision", "deleted_at"])
      .where("id", "=", input.documentId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .forUpdate()
      .executeTakeFirst()) as DeletableAssetRow | undefined;
    if (!document) throw resumeDocumentNotFound();

    if (document.deleted_at) {
      if (Number(document.revision) !== input.request.expectedRevision + 1) {
        throw resumeDocumentNotFound();
      }
      const deletedReviewRuns = await transaction
        .selectFrom("profile.resume_review_runs")
        .select("id")
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .where("document_id", "=", input.documentId)
        .where("deleted_at", "is not", null)
        .execute();
      return DeleteResumeDocumentResponseSchema.parse({
        documentId: document.id,
        revision: Number(document.revision),
        deletedAt: toIso(document.deleted_at),
        deletedReviewRunIds: deletedReviewRuns.map((row) => row.id).sort(),
      });
    }
    if (Number(document.revision) !== input.request.expectedRevision) {
      throw resumeDocumentRevisionConflict();
    }

    const deletedReviewRunIds = await deleteResumeReviewRuns(
      transaction,
      input.owner,
      [input.documentId],
      now,
    );
    const deletedDocument = await transaction
      .updateTable("profile.resume_documents")
      .set({
        deleted_at: now,
        revision: input.request.expectedRevision + 1,
        updated_at: now,
      })
      .where("id", "=", input.documentId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("revision", "=", input.request.expectedRevision)
      .where("deleted_at", "is", null)
      .returning(["revision", "deleted_at"])
      .executeTakeFirst();
    if (!deletedDocument?.deleted_at) throw resumeDocumentRevisionConflict();
    await updatePrivateSnapshotRetention(
      transaction,
      input.owner,
      document.private_job_snapshot_id,
      now,
    );
    return DeleteResumeDocumentResponseSchema.parse({
      documentId: input.documentId,
      revision: Number(deletedDocument.revision),
      deletedAt: toIso(deletedDocument.deleted_at),
      deletedReviewRunIds,
    });
  });
}

export async function deleteInterviewSession(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  sessionId: string;
  request: DeleteInterviewSessionRequest;
  now?: Date;
}): Promise<DeleteInterviewSessionResponse> {
  return input.db.transaction().execute(async (transaction) => {
    const now = await deletionTimestamp(transaction, input.now);
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch, now);
    const session = (await transaction
      .selectFrom("application.interview_sessions")
      .select(["id", "private_job_snapshot_id", "revision", "deleted_at"])
      .where("id", "=", input.sessionId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .forUpdate()
      .executeTakeFirst()) as DeletableAssetRow | undefined;
    if (!session) throw interviewSessionNotFound();
    if (session.deleted_at) {
      if (Number(session.revision) !== input.request.expectedRevision + 1) {
        throw interviewSessionNotFound();
      }
      return DeleteInterviewSessionResponseSchema.parse({
        sessionId: session.id,
        revision: Number(session.revision),
        deletedAt: toIso(session.deleted_at),
      });
    }
    if (Number(session.revision) !== input.request.expectedRevision) {
      throw interviewSessionRevisionConflict();
    }
    const deletedSession = await transaction
      .updateTable("application.interview_sessions")
      .set({
        status: "deleted",
        deleted_at: now,
        revision: input.request.expectedRevision + 1,
        updated_at: now,
      })
      .where("id", "=", input.sessionId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("revision", "=", input.request.expectedRevision)
      .where("deleted_at", "is", null)
      .returning(["revision", "deleted_at"])
      .executeTakeFirst();
    if (!deletedSession?.deleted_at) throw interviewSessionRevisionConflict();
    await updatePrivateSnapshotRetention(
      transaction,
      input.owner,
      session.private_job_snapshot_id,
      now,
    );
    return DeleteInterviewSessionResponseSchema.parse({
      sessionId: input.sessionId,
      revision: Number(deletedSession.revision),
      deletedAt: toIso(deletedSession.deleted_at),
    });
  });
}

export async function deleteDebrief(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  debriefId: string;
  request: DeleteDebriefRequest;
  now?: Date;
}): Promise<DeleteDebriefResponse> {
  return input.db.transaction().execute(async (transaction) => {
    const now = await deletionTimestamp(transaction, input.now);
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch, now);
    const debrief = (await transaction
      .selectFrom("application.debriefs")
      .select(["id", "private_job_snapshot_id", "revision", "deleted_at"])
      .where("id", "=", input.debriefId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .forUpdate()
      .executeTakeFirst()) as DeletableAssetRow | undefined;
    if (!debrief) throw debriefNotFound();
    if (debrief.deleted_at) {
      if (Number(debrief.revision) !== input.request.expectedRevision + 1) {
        throw debriefNotFound();
      }
      return DeleteDebriefResponseSchema.parse({
        debriefId: debrief.id,
        revision: Number(debrief.revision),
        deletedAt: toIso(debrief.deleted_at),
      });
    }
    if (Number(debrief.revision) !== input.request.expectedRevision) {
      throw debriefRevisionConflict();
    }
    const deletedDebrief = await transaction
      .updateTable("application.debriefs")
      .set({
        deleted_at: now,
        revision: input.request.expectedRevision + 1,
        updated_at: now,
      })
      .where("id", "=", input.debriefId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("revision", "=", input.request.expectedRevision)
      .where("deleted_at", "is", null)
      .returning(["revision", "deleted_at"])
      .executeTakeFirst();
    if (!deletedDebrief?.deleted_at) throw debriefRevisionConflict();
    await updatePrivateSnapshotRetention(
      transaction,
      input.owner,
      debrief.private_job_snapshot_id,
      now,
    );
    return DeleteDebriefResponseSchema.parse({
      debriefId: input.debriefId,
      revision: Number(deletedDebrief.revision),
      deletedAt: toIso(deletedDebrief.deleted_at),
    });
  });
}
