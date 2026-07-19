import type { Database } from "@aijob/database";
import type { Kysely, Transaction } from "kysely";

export interface OwnerTaskLease {
  taskId: string;
  taskType: string;
  ownerId: string;
  ownerEpoch: number;
  leaseOwner: string;
  fencingToken: number;
}

export class OwnerTaskLeaseLostError extends Error {
  readonly code = "OWNER_TASK_LEASE_LOST";

  constructor() {
    super("OWNER_TASK_LEASE_LOST");
    this.name = "OwnerTaskLeaseLostError";
  }
}

function timestamp(value: unknown): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(String(value));
}

export async function assertOwnerTaskLease(
  transaction: Transaction<Database>,
  lease: OwnerTaskLease,
  now = new Date(),
): Promise<void> {
  const task = await transaction
    .selectFrom("task_queue.tasks")
    .select([
      "task_type",
      "owner_id",
      "owner_epoch",
      "status",
      "lease_owner",
      "lease_until",
      "fencing_token",
    ])
    .where("id", "=", lease.taskId)
    .forUpdate()
    .executeTakeFirst();
  const leaseUntil = timestamp(task?.lease_until ?? null);
  if (
    !task ||
    task.task_type !== lease.taskType ||
    task.owner_id !== lease.ownerId ||
    Number(task.owner_epoch) !== lease.ownerEpoch ||
    task.status !== "running" ||
    task.lease_owner !== lease.leaseOwner ||
    Number(task.fencing_token) !== lease.fencingToken ||
    !leaseUntil ||
    leaseUntil.getTime() <= now.getTime()
  ) {
    throw new OwnerTaskLeaseLostError();
  }

  const owner = await transaction
    .selectFrom("identity.owners")
    .select(["status", "epoch", "retention_expires_at"])
    .where("id", "=", lease.ownerId)
    .forUpdate()
    .executeTakeFirst();
  const ownerIsValid =
    lease.taskType === "owner_deletion"
      ? owner !== undefined &&
        (owner.status === "deletion_pending" || owner.status === "deleted") &&
        Number(owner.epoch) === lease.ownerEpoch + 1
      : owner?.status === "active" &&
        Number(owner.epoch) === lease.ownerEpoch &&
        new Date(owner.retention_expires_at).getTime() > now.getTime();
  if (!ownerIsValid) {
    throw new OwnerTaskLeaseLostError();
  }
}

export async function withOwnerTaskLease<T>(
  db: Kysely<Database>,
  lease: OwnerTaskLease,
  callback: (transaction: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (transaction) => {
    await assertOwnerTaskLease(transaction, lease);
    return callback(transaction);
  });
}
