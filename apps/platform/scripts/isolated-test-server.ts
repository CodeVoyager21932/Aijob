import { resolve } from "node:path";
import { parseAppConfig } from "@aijob/config";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { buildApp } from "../src/app.js";

function safeDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("OS1_DATABASE_URL is required");
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    !/^aijob_.+_test(?:_|$)/.test(databaseName)
  ) {
    throw new Error("isolated test server requires a loopback aijob_*_test_* database");
  }
  return value;
}

const databaseUrl = safeDatabaseUrl(process.env.OS1_DATABASE_URL);
const port = Number(process.env.OS1_PLATFORM_PORT ?? "3000");
const workspaceRoot = resolve(process.env.OS1_RUNTIME_ROOT ?? process.cwd());
const db = createDatabase(databaseUrl);
const config = parseAppConfig(
  {
    APP_ENV: "test",
    DATABASE_URL: databaseUrl,
    HOST: "127.0.0.1",
    PORT: String(port),
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
const app = buildApp({ config, db });

async function shutdown() {
  await app.close();
  await db.destroy();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await migrateToLatest(db);
  await app.listen({ host: config.host, port: config.port });
  process.stdout.write(`OS1_ISOLATED_SERVER_READY:${config.port}\n`);
} catch (error) {
  console.error(error);
  await db.destroy();
  process.exitCode = 1;
}
