import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { beginOwnerDeletion } from "./deletion-service.js";

export const OWNER_RETENTION_MAINTENANCE_INTERVAL_MS = 60_000;
export const AUDIT_AND_TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

const DEFAULT_BATCH_SIZE = 100;

export interface OwnerRetentionMaintenanceResult {
  expiredOwnersQueued: number;
  expiredAuditEventsDeleted: number;
  expiredDeletionTombstonesDeleted: number;
}

export async function enqueueExpiredOwnerDeletions(input: {
  db: Kysely<Database>;
  now?: Date;
  batchSize?: number;
}): Promise<number> {
  const now = input.now ?? new Date();
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  return input.db.transaction().execute(async (transaction) => {
    const owners = await transaction
      .selectFrom("identity.owners")
      .select(["id", "epoch"])
      .where("status", "=", "active")
      .where("retention_expires_at", "<=", now)
      .orderBy("retention_expires_at", "asc")
      .orderBy("id", "asc")
      .limit(batchSize)
      .forUpdate()
      .skipLocked()
      .execute();

    for (const owner of owners) {
      await beginOwnerDeletion(transaction, {
        ownerId: owner.id,
        ownerEpoch: Number(owner.epoch),
        trigger: "retention_expiry",
        now,
      });
    }
    return owners.length;
  });
}

export async function purgeExpiredAuditEvents(input: {
  db: Kysely<Database>;
  now?: Date;
}): Promise<number> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - AUDIT_AND_TOMBSTONE_RETENTION_MS);
  const deleted = await input.db
    .deleteFrom("decision_feedback_audit.audit_events")
    .where("created_at", "<=", cutoff)
    .returning("id")
    .execute();
  return deleted.length;
}

export async function purgeExpiredDeletionTombstones(input: {
  db: Kysely<Database>;
  now?: Date;
  batchSize?: number;
}): Promise<number> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - AUDIT_AND_TOMBSTONE_RETENTION_MS);
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  return input.db.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(hashtextextended('owner-tombstone-retention-v1', 0))`.execute(
      transaction,
    );
    const owners = await transaction
      .selectFrom("identity.owners as owner")
      .innerJoin("decision.owner_deletions as deletion", "deletion.owner_id", "owner.id")
      .select("owner.id")
      .where("owner.status", "=", "deleted")
      .where("owner.deleted_at", "<=", cutoff)
      .where("deletion.status", "=", "succeeded")
      .where("deletion.completed_at", "<=", cutoff)
      .orderBy("owner.id", "asc")
      .distinct()
      .limit(batchSize)
      .execute();

    for (const owner of owners) {
      await transaction.deleteFrom("task_queue.tasks").where("owner_id", "=", owner.id).execute();
      await transaction
        .deleteFrom("identity.owner_sessions")
        .where("owner_id", "=", owner.id)
        .execute();
      await transaction
        .deleteFrom("decision.owner_deletions")
        .where("owner_id", "=", owner.id)
        .execute();
      await transaction.deleteFrom("identity.owners").where("id", "=", owner.id).execute();
    }
    return owners.length;
  });
}

export async function runOwnerRetentionMaintenance(input: {
  db: Kysely<Database>;
  now?: Date;
  batchSize?: number;
}): Promise<OwnerRetentionMaintenanceResult> {
  const now = input.now ?? new Date();
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const expiredOwnersQueued = await enqueueExpiredOwnerDeletions({
    db: input.db,
    now,
    batchSize,
  });
  const expiredAuditEventsDeleted = await purgeExpiredAuditEvents({ db: input.db, now });
  const expiredDeletionTombstonesDeleted = await purgeExpiredDeletionTombstones({
    db: input.db,
    now,
    batchSize,
  });
  return {
    expiredOwnersQueued,
    expiredAuditEventsDeleted,
    expiredDeletionTombstonesDeleted,
  };
}
