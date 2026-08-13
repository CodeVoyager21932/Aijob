import { resolve } from "node:path";
import { parseAppConfig } from "@aijob/config";
import { createDatabase } from "@aijob/database";
import { runOneOwnerTask } from "../src/workers/owner-task-worker.js";

function safeDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("OS2_DATABASE_URL is required");
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    !/^aijob_.+_test(?:_|$)/.test(databaseName)
  ) {
    throw new Error("isolated owner task runner requires a loopback aijob_*_test_* database");
  }
  return value;
}

const databaseUrl = safeDatabaseUrl(process.env.OS2_DATABASE_URL);
const workspaceRoot = resolve(process.env.OS2_RUNTIME_ROOT ?? process.cwd());
const db = createDatabase(databaseUrl);
const config = parseAppConfig(
  {
    APP_ENV: "test",
    DATABASE_URL: databaseUrl,
    HOST: "127.0.0.1",
    PORT: "3000",
    LOG_LEVEL: "warn",
    ENABLE_INTERNAL_PREVIEW: "false",
    ENABLE_SOURCE_PROBE: "false",
    ENABLE_LOCAL_MVP: "false",
    ENABLE_AI: "false",
    RESUME_ENCRYPTION_KEY: "ab".repeat(32),
    RESUME_PARSER_MODE: "process",
    ACCEPTED_ORIGINS: "http://127.0.0.1:5173,http://127.0.0.1:5174",
    IDENTITY_EMAIL_DELIVERY_MODE: "disabled",
    SNAPSHOT_DIR: resolve(workspaceRoot, "synthetic-snapshots"),
  },
  { rootDirectory: workspaceRoot },
);

let processed = 0;
try {
  while (await runOneOwnerTask({ db, config, workerId: "os2-isolated-owner-task-runner" })) {
    processed += 1;
    if (processed > 100) throw new Error("OS2_OWNER_TASK_LIMIT_EXCEEDED");
  }
  process.stdout.write(`OS2_OWNER_TASKS_PROCESSED:${processed}\n`);
} finally {
  await db.destroy();
}
