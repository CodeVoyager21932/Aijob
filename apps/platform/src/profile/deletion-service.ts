import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { DeletionStatus } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { ApiProblem } from "../identity/http.js";
import type { OwnerContext } from "../identity/session-repository.js";
import { sha256 } from "../lib/canonical-json.js";
import type { OwnerTaskLease } from "../workers/owner-task-lease.js";
import { assertOwnerTaskLease, withOwnerTaskLease } from "../workers/owner-task-lease.js";

export const DELETION_RECEIPT_TTL_SECONDS = 24 * 60 * 60;
const DELETION_RECEIPT_TTL_MS = DELETION_RECEIPT_TTL_SECONDS * 1_000;

export interface OwnerDeletionStatus {
  id: string;
  status: DeletionStatus;
  requestedAt: string;
  updatedAt: string;
  completedAt: string | null;
  failureCode: string | null;
}

interface DeletionReceiptPayload {
  deletionId: string;
  ownerId: string;
  requestedOwnerEpoch: number;
  expiresAt: string;
}

export type OwnerDeletionTrigger = "owner_request" | "retention_expiry";

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapDeletion(row: {
  id: string;
  status: string;
  requested_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
  failure_code: string | null;
}): OwnerDeletionStatus {
  return {
    id: row.id,
    status: row.status as DeletionStatus,
    requestedAt: iso(row.requested_at),
    updatedAt: iso(row.updated_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    failureCode: row.failure_code,
  };
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update(encodedPayload)
    .digest("base64url");
}

export function createDeletionReceipt(
  payload: Omit<DeletionReceiptPayload, "expiresAt">,
  secret: string,
  now = new Date(),
): string {
  const encodedPayload = Buffer.from(
    JSON.stringify({
      ...payload,
      expiresAt: new Date(now.getTime() + DELETION_RECEIPT_TTL_MS).toISOString(),
    } satisfies DeletionReceiptPayload),
    "utf8",
  ).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifyDeletionReceipt(
  receipt: string,
  secret: string,
  now = new Date(),
): DeletionReceiptPayload | null {
  const [encodedPayload, suppliedSignature, extra] = receipt.split(".");
  if (!encodedPayload || !suppliedSignature || extra) return null;
  const expectedSignature = sign(encodedPayload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as DeletionReceiptPayload;
    if (
      typeof payload.deletionId !== "string" ||
      typeof payload.ownerId !== "string" ||
      !Number.isInteger(payload.requestedOwnerEpoch) ||
      typeof payload.expiresAt !== "string" ||
      new Date(payload.expiresAt).getTime() <= now.getTime()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function beginOwnerDeletion(
  transaction: Transaction<Database>,
  input: {
    ownerId: string;
    ownerEpoch: number;
    trigger: OwnerDeletionTrigger;
    now: Date;
  },
): Promise<{ deletion: OwnerDeletionStatus; requestedOwnerEpoch: number }> {
  const deletionId = randomUUID();
  await transaction
    .insertInto("decision.owner_deletions")
    .values({
      id: deletionId,
      owner_id: input.ownerId,
      requested_owner_epoch: input.ownerEpoch,
      status: "queued",
      failure_code: null,
      requested_at: input.now,
      updated_at: input.now,
      completed_at: null,
    })
    .execute();
  await transaction
    .insertInto("task_queue.tasks")
    .values({
      id: randomUUID(),
      task_type: "owner_deletion",
      owner_id: input.ownerId,
      owner_epoch: input.ownerEpoch,
      payload: JSON.stringify({ deletionId }),
      idempotency_key: `owner-deletion:${sha256(`${input.ownerId}:${input.ownerEpoch}`)}`,
      status: "queued",
      attempt: 0,
      max_attempts: 3,
      available_at: input.now,
      backoff_policy: JSON.stringify({
        baseMilliseconds: 500,
        maximumMilliseconds: 5_000,
        jitter: "full",
      }),
      lease_owner: null,
      lease_until: null,
      heartbeat_at: null,
      last_error_code: null,
      last_error_summary: null,
      completed_at: null,
    })
    .execute();
  await transaction
    .updateTable("task_queue.tasks")
    .set((expression) => ({
      status: "dead",
      lease_owner: null,
      lease_until: null,
      heartbeat_at: input.now,
      last_error_code: "OWNER_EPOCH_STALE",
      last_error_summary: null,
      completed_at: input.now,
      fencing_token: expression("fencing_token", "+", 1),
    }))
    .where("owner_id", "=", input.ownerId)
    .where("task_type", "!=", "owner_deletion")
    .where("status", "in", ["queued", "running"])
    .execute();
  await transaction
    .updateTable("identity.owners")
    .set({
      status: "deletion_pending",
      epoch: input.ownerEpoch + 1,
      last_seen_at: input.now,
    })
    .where("id", "=", input.ownerId)
    .where("epoch", "=", input.ownerEpoch)
    .where("status", "=", "active")
    .executeTakeFirstOrThrow();
  await transaction
    .updateTable("identity.owner_sessions")
    .set({ revoked_at: input.now })
    .where("owner_id", "=", input.ownerId)
    .where("revoked_at", "is", null)
    .execute();
  await transaction
    .insertInto("decision_feedback_audit.audit_events")
    .values({
      id: randomUUID(),
      event_type:
        input.trigger === "retention_expiry"
          ? "owner_retention_expired"
          : "owner_deletion_requested",
      actor_type: input.trigger === "retention_expiry" ? "system" : "owner",
      subject_type: "owner_deletion",
      subject_id: deletionId,
      metadata: JSON.stringify({
        requestedOwnerEpoch: input.ownerEpoch,
        trigger: input.trigger,
        contentIncluded: false,
      }),
      created_at: input.now,
    })
    .execute();

  return {
    requestedOwnerEpoch: input.ownerEpoch,
    deletion: {
      id: deletionId,
      status: "queued",
      requestedAt: input.now.toISOString(),
      updatedAt: input.now.toISOString(),
      completedAt: null,
      failureCode: null,
    },
  };
}

export async function requestOwnerDeletion(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  now?: Date;
}): Promise<{ deletion: OwnerDeletionStatus; requestedOwnerEpoch: number }> {
  const now = input.now ?? new Date();
  return input.db.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`owner-delete:${input.owner.ownerId}`}, 0))`.execute(
      transaction,
    );
    const owner = await transaction
      .selectFrom("identity.owners")
      .select(["status", "epoch"])
      .where("id", "=", input.owner.ownerId)
      .forUpdate()
      .executeTakeFirst();
    if (!owner || owner.status !== "active" || Number(owner.epoch) !== input.owner.ownerEpoch) {
      throw new ApiProblem(
        409,
        "OWNER_ALREADY_REVOKED",
        "个人数据访问已撤销",
        "该匿名资料已进入删除流程，不能再次修改。",
      );
    }

    return beginOwnerDeletion(transaction, {
      ownerId: input.owner.ownerId,
      ownerEpoch: input.owner.ownerEpoch,
      trigger: "owner_request",
      now,
    });
  });
}

export async function getOwnerDeletionByReceipt(input: {
  db: Kysely<Database>;
  receipt: string;
  receiptSecret: string;
  now?: Date;
}): Promise<OwnerDeletionStatus | null> {
  const receipt = verifyDeletionReceipt(
    input.receipt,
    input.receiptSecret,
    input.now ?? new Date(),
  );
  if (!receipt) return null;
  const row = await input.db
    .selectFrom("decision.owner_deletions")
    .selectAll()
    .where("id", "=", receipt.deletionId)
    .where("owner_id", "=", receipt.ownerId)
    .where("requested_owner_epoch", "=", receipt.requestedOwnerEpoch)
    .executeTakeFirst();
  return row ? mapDeletion(row) : null;
}

export async function processOwnerDeletion(input: {
  db: Kysely<Database>;
  deletionId: string;
  ownerId: string;
  requestedOwnerEpoch: number;
  lease: OwnerTaskLease;
  now?: Date;
}): Promise<OwnerDeletionStatus> {
  const now = input.now ?? new Date();
  try {
    return await input.db.transaction().execute(async (transaction) => {
      await assertOwnerTaskLease(transaction, input.lease);
      const deletion = await transaction
        .selectFrom("decision.owner_deletions")
        .selectAll()
        .where("id", "=", input.deletionId)
        .where("owner_id", "=", input.ownerId)
        .where("requested_owner_epoch", "=", input.requestedOwnerEpoch)
        .forUpdate()
        .executeTakeFirst();
      if (deletion?.status === "succeeded") return mapDeletion(deletion);
      if (
        !deletion ||
        (deletion.status !== "queued" &&
          deletion.status !== "failed" &&
          deletion.status !== "processing")
      ) {
        throw new Error("OWNER_DELETION_NOT_CLAIMABLE");
      }
      await transaction
        .updateTable("decision.owner_deletions")
        .set({ status: "processing", updated_at: now, failure_code: null })
        .where("id", "=", deletion.id)
        .executeTakeFirstOrThrow();

      const owner = await transaction
        .selectFrom("identity.owners")
        .select(["status", "epoch"])
        .where("id", "=", input.ownerId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !owner ||
        owner.status !== "deletion_pending" ||
        Number(owner.epoch) !== input.requestedOwnerEpoch + 1
      ) {
        throw new Error("OWNER_DELETION_EPOCH_MISMATCH");
      }

      await transaction
        .deleteFrom("matching.resume_exports")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("matching.recommendation_items")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("matching.resume_tailoring_runs")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("matching.recommendation_runs")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("matching.match_runs")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("matching.job_insight_runs")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("decision.job_decisions")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("application.case_requirement_evidence_links")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("application.case_questions")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("application.case_requirement_states")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("application.case_events")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("application.application_cases")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("application.private_job_snapshots")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("profile.resume_evidence_revisions")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("profile.resume_document_revisions")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("profile.job_preference_revisions")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("profile.profile_fact_revisions")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("profile.resume_analyses")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await transaction
        .deleteFrom("task_queue.tasks")
        .where("owner_id", "=", input.ownerId)
        .where("task_type", "!=", "owner_deletion")
        .execute();
      await transaction
        .deleteFrom("identity.owner_sessions")
        .where("owner_id", "=", input.ownerId)
        .execute();
      await sql`
        SELECT identity.purge_account_identity_for_owner(
          ${input.ownerId}::uuid,
          ${input.requestedOwnerEpoch}::bigint
        )
      `.execute(transaction);

      await transaction
        .updateTable("identity.owners")
        .set({
          status: "deleted",
          deleted_at: now,
          retention_mode: "anonymous_ttl",
          retention_expires_at: now,
          last_seen_at: now,
        })
        .where("id", "=", input.ownerId)
        .where("status", "=", "deletion_pending")
        .where("epoch", "=", input.requestedOwnerEpoch + 1)
        .executeTakeFirstOrThrow();
      const completed = await transaction
        .updateTable("decision.owner_deletions")
        .set({
          status: "succeeded",
          updated_at: now,
          completed_at: now,
          failure_code: null,
        })
        .where("id", "=", input.deletionId)
        .returningAll()
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("decision_feedback_audit.audit_events")
        .values({
          id: randomUUID(),
          event_type: "owner_deletion_succeeded",
          actor_type: "system",
          subject_type: "owner_deletion",
          subject_id: input.deletionId,
          metadata: JSON.stringify({ contentIncluded: false }),
          created_at: now,
        })
        .execute();
      return mapDeletion(completed);
    });
  } catch (error) {
    await withOwnerTaskLease(input.db, input.lease, async (transaction) => {
      await transaction
        .updateTable("decision.owner_deletions")
        .set({
          status: "failed",
          updated_at: now,
          failure_code: "OWNER_DELETION_FAILED",
        })
        .where("id", "=", input.deletionId)
        .where("status", "=", "processing")
        .execute();
    });
    throw error;
  }
}
