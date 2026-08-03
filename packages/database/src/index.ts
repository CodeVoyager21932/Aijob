import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { Database } from "./types.js";

export * from "./migrate.js";
export * from "./types.js";

const LOOPBACK_TEST_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const ISOLATED_TEST_DATABASE_NAME = /^aijob_(?:(?:test|audit)(?:_|$)|p\d+_audit$|.+_test(?:_|$))/;

export function assertIsolatedTestDatabaseUrl(connectionString: string): void {
  if (connectionString === "postgresql://unused") return;

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("AIJOB_TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!LOOPBACK_TEST_HOSTS.has(parsed.hostname) || !ISOLATED_TEST_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      "Integration tests require a loopback PostgreSQL database named aijob_test*, aijob_audit*, aijob_pN_audit, or aijob_*_test; refusing to use a development or remote database",
    );
  }
}

export function createDatabase(connectionString: string): Kysely<Database> {
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    assertIsolatedTestDatabaseUrl(connectionString);
  }

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

export const DatabaseRuntimeRole = {
  webApi: "aijob_web_api",
  collectorWorker: "aijob_collector_worker",
  matchWorker: "aijob_match_worker",
  opsCli: "aijob_ops_cli",
  migrator: "aijob_migrator",
} as const;

export type DatabaseRuntimeRoleName =
  (typeof DatabaseRuntimeRole)[keyof typeof DatabaseRuntimeRole];

export async function assertDatabaseRoleMembership(input: {
  db: Kysely<Database>;
  role: DatabaseRuntimeRoleName;
  required: boolean;
}): Promise<void> {
  if (!input.required) return;
  const result = await sql<{ currentUser: string; hasRole: boolean }>`
    SELECT
      current_user::text AS "currentUser",
      pg_has_role(current_user, ${input.role}, 'member') AS "hasRole"
  `.execute(input.db);
  const row = result.rows[0];
  if (!row?.hasRole) {
    throw new Error(`DATABASE_RUNTIME_ROLE_REQUIRED:${input.role}`);
  }
}
