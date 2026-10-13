import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const [container, source, target] = process.argv.slice(2);
if (
  !["aijob-core-test-20260906", "aijob-studio-test-20260907"].includes(container) ||
  ![source, target].every((name) => /^aijob_[a-z0-9_]*test[a-z0-9_]*$/.test(name ?? "")) ||
  source === target
)
  throw Error("Dedicated synthetic test container and two distinct test databases required");
const run = (args) =>
  execFileSync("docker", ["exec", container, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
const query = (database, statement) =>
  run([
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "aijob_test",
    "-d",
    database,
    "-Atc",
    statement,
  ]).trim();
if (query("postgres", `SELECT count(*) FROM pg_database WHERE datname='${target}'`) !== "0")
  throw Error("Restore target must not already exist");
const started = Date.now();
const backup = `/tmp/aijob-synthetic-${randomUUID()}.dump`;
run(["pg_dump", "-U", "aijob_test", "-Fc", "-f", backup, source]);
query("postgres", `CREATE DATABASE "${target}"`);
run(["pg_restore", "-U", "aijob_test", "--exit-on-error", "-d", target, backup]);
const tables = query(
  source,
  "SELECT format('%I.%I',schemaname,tablename) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1",
)
  .split("\n")
  .filter(Boolean);
const checks = [];
for (const table of tables) {
  const statement = `SELECT count(*)::text||':'||md5(COALESCE(string_agg(h,'' ORDER BY h),'')) FROM (SELECT md5(row_to_json(t)::text) h FROM ${table} t) hashes`;
  const before = query(source, statement),
    after = query(target, statement);
  if (before !== after) throw Error(`RESTORE_CONTENT_MISMATCH:${table}`);
  checks.push({ table, rows: Number(before.split(":")[0]), contentHash: before.split(":")[1] });
}
const root = resolve(import.meta.dirname, "../..");
await mkdir(resolve(root, ".data/runtime-smoke"), { recursive: true });
const localBackup = resolve(root, `.data/runtime-smoke/${source}-recovery.dump`);
execFileSync("docker", ["cp", `${container}:${backup}`, localBackup], { stdio: "pipe" });
const report = {
  verifiedAt: new Date().toISOString(),
  sourceDatabase: source,
  restoredDatabase: target,
  elapsedMs: Date.now() - started,
  backupSha256: createHash("sha256")
    .update(await readFile(localBackup))
    .digest("hex"),
  tables: checks,
  scope:
    "Synthetic database only; not a business backup or production RPO/RTO claim. Roles already exist in this dedicated cluster.",
};
const file = resolve(root, container === "aijob-studio-test-20260907" ? "docs/evidence/experience-upgrade-2026-09-07/database-restore.json" : "docs/evidence/product-core-upgrade-2026-09-06/database-restore.json");
await writeFile(file, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    file,
    tables: checks.length,
    elapsedMs: report.elapsedMs,
    contentMatches: true,
  }),
);
