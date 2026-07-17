import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { Database } from "./types.js";

export * from "./migrate.js";
export * from "./types.js";

export function createDatabase(connectionString: string): Kysely<Database> {
  const pool = new Pool({
    connectionString,
    max: 10,
    application_name: "aijob",
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

export async function checkDatabase(db: Kysely<Database>): Promise<void> {
  await sql`select 1`.execute(db);
}
