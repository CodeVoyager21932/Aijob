import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";

const db = createDatabase(process.env.DATABASE_URL!);
try {
  // Restore into an empty database first. Migrating before restoring an older dump
  // leaves newer objects that the older dump cannot remove in dependency order.
  for (const group of [
    "aijob_web_api",
    "aijob_collector_worker",
    "aijob_match_worker",
    "aijob_ops_cli",
    "aijob_migrator",
  ]) {
    if (!(await sql`SELECT 1 FROM pg_roles WHERE rolname=${group}`.execute(db)).rows.length)
      await sql.raw(`CREATE ROLE ${group} NOLOGIN`).execute(db);
  }
  if (process.env.AIJOB_PREPARE_ROLES_ONLY !== "1") await migrateToLatest(db);
  // Each service receives only its own LOGIN. The random passwords live in DPAPI.
  const roles = [
    ["desktop_web", "aijob_web_api"],
    ["desktop_collector", "aijob_collector_worker"],
    ["desktop_match", "aijob_match_worker"],
    ["desktop_ops", "aijob_ops_cli"],
  ] as const;
  const credentials = JSON.parse(process.env.AIJOB_ROLE_PASSWORDS!) as Record<string, string>;
  for (const [login, group] of roles) {
    const password = credentials[login];
    if (!password || !/^[a-f0-9]{64}$/.test(password)) throw Error("INVALID_ROLE_SECRET");
    const exists = (await sql`SELECT 1 FROM pg_roles WHERE rolname=${login}`.execute(db)).rows
      .length;
    if (!exists) await sql.raw(`CREATE ROLE ${login} LOGIN PASSWORD '${password}'`).execute(db);
    else await sql.raw(`ALTER ROLE ${login} PASSWORD '${password}'`).execute(db);
    await sql.raw(`GRANT ${group} TO ${login}`).execute(db);
  }
  process.send?.({ type: "prepared" });
} finally {
  await db.destroy();
  process.disconnect?.();
}
