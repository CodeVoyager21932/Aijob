import type { Database } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";

type DbExecutor = Kysely<Database> | Transaction<Database>;

/** Serializes concurrent creates for the same owner-scoped idempotency key. */
export async function lockOwnerIdempotencyKey(
  db: DbExecutor,
  input: { ownerId: string; scope: string; idempotencyKey: string },
): Promise<void> {
  const lockKey = `owner:${input.ownerId}:${input.scope}:${input.idempotencyKey}`;
  await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(db);
}
