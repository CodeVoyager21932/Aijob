import { assertIsolatedTestDatabaseUrl, type Database } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";

/** Test teardown only: immutable production history cannot be deleted via the runtime API. */
export async function deleteRequirementFixtures(
  db: Kysely<Database> | Transaction<Database>,
  versionIds: string[],
): Promise<void> {
  if (process.env.VITEST !== "true") throw new Error("TEST_TEARDOWN_ONLY");
  const url = process.env.AIJOB_TEST_DATABASE_URL;
  if (!url) throw new Error("ISOLATED_TEST_DATABASE_REQUIRED");
  assertIsolatedTestDatabaseUrl(url);
  if (versionIds.length === 0) return;
  const remove = async (transaction: Transaction<Database>) => {
    const result = await sql<{ name: string }>`select current_database() as name`.execute(
      transaction,
    );
    const actual = new URL(url);
    actual.pathname = `/${result.rows[0]?.name}`;
    assertIsolatedTestDatabaseUrl(actual.toString());
    // ALTER takes a table lock; the disable/delete/enable are atomic and rollback together.
    await sql`ALTER TABLE catalog.job_requirement_sets DISABLE TRIGGER job_requirement_sets_no_delete`.execute(
      transaction,
    );
    await transaction
      .deleteFrom("catalog.job_requirement_sets")
      .where("published_job_version_id", "in", versionIds)
      .execute();
    await sql`ALTER TABLE catalog.job_requirement_sets ENABLE TRIGGER job_requirement_sets_no_delete`.execute(
      transaction,
    );
  };
  if (db.isTransaction) await remove(db as Transaction<Database>);
  else await db.transaction().execute(remove);
}
