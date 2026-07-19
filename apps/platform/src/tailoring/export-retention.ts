import type { Database } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";

const DEFAULT_EXPORT_PURGE_BATCH_SIZE = 100;

async function purgeExpiredResumeExportsInTransaction(
  transaction: Transaction<Database>,
  input: {
    now: Date;
    batchSize: number;
    ownerId?: string;
    exportId?: string;
  },
): Promise<number> {
  let query = transaction
    .selectFrom("matching.resume_exports")
    .select(["id", "owner_id"])
    .where("expires_at", "<=", input.now)
    .where((expression) =>
      expression.or([
        expression("status", "!=", "deleted"),
        expression("ciphertext", "is not", null),
        expression("nonce", "is not", null),
        expression("auth_tag", "is not", null),
        expression("byte_size", "is not", null),
      ]),
    )
    .orderBy("expires_at", "asc")
    .orderBy("id", "asc")
    .limit(input.batchSize);
  if (input.ownerId) query = query.where("owner_id", "=", input.ownerId);
  if (input.exportId) query = query.where("id", "=", input.exportId);
  const exportsToPurge = await query.execute();

  for (const item of exportsToPurge) {
    // Match the worker's task -> business-row lock order so an in-flight export
    // either finishes before this purge or loses its fencing lease afterwards.
    await transaction
      .updateTable("task_queue.tasks")
      .set({
        status: "dead",
        lease_owner: null,
        lease_until: null,
        heartbeat_at: input.now,
        last_error_code: "RESUME_EXPORT_EXPIRED",
        last_error_summary: null,
        completed_at: input.now,
      })
      .where("task_type", "=", "resume_export")
      .where("owner_id", "=", item.owner_id)
      .where("status", "in", ["queued", "running"])
      .where(sql<boolean>`payload ->> 'exportId' = ${item.id}`)
      .execute();
    await transaction
      .updateTable("matching.resume_exports")
      .set({
        status: "deleted",
        byte_size: null,
        ciphertext: null,
        nonce: null,
        auth_tag: null,
        failure_code: "RESUME_EXPORT_EXPIRED",
        completed_at: input.now,
      })
      .where("id", "=", item.id)
      .where("owner_id", "=", item.owner_id)
      .where("expires_at", "<=", input.now)
      .executeTakeFirstOrThrow();
  }
  return exportsToPurge.length;
}

async function purgeExpiredResumeExportsScoped(input: {
  db: Kysely<Database>;
  now: Date;
  batchSize: number;
  ownerId?: string;
  exportId?: string;
}): Promise<number> {
  return input.db.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(hashtextextended('resume-export-retention-v1', 0))`.execute(
      transaction,
    );
    return purgeExpiredResumeExportsInTransaction(transaction, input);
  });
}

export async function purgeExpiredResumeExports(input: {
  db: Kysely<Database>;
  now?: Date;
  batchSize?: number;
}): Promise<number> {
  return purgeExpiredResumeExportsScoped({
    db: input.db,
    now: input.now ?? new Date(),
    batchSize: input.batchSize ?? DEFAULT_EXPORT_PURGE_BATCH_SIZE,
  });
}

export async function purgeExpiredResumeExport(input: {
  db: Kysely<Database>;
  ownerId: string;
  exportId: string;
  now?: Date;
}): Promise<boolean> {
  const count = await purgeExpiredResumeExportsScoped({
    db: input.db,
    now: input.now ?? new Date(),
    batchSize: 1,
    ownerId: input.ownerId,
    exportId: input.exportId,
  });
  return count === 1;
}
