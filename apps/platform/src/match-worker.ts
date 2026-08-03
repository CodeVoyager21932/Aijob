import { toSafeConfigLog } from "@aijob/config";
import {
  assertDatabaseRoleMembership,
  createDatabase,
  DatabaseRuntimeRole,
} from "@aijob/database";
import { databaseUrlForRuntime, loadPlatformConfig } from "./config/platform-config.js";
import { runOwnerTaskWorker } from "./workers/owner-task-worker.js";

const appConfig = loadPlatformConfig();
const db = createDatabase(databaseUrlForRuntime(appConfig, "matchWorker"));
const controller = new AbortController();

async function shutdown(signal: string): Promise<void> {
  console.info({ signal }, "Aijob match worker stopping");
  controller.abort();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await assertDatabaseRoleMembership({
    db,
    role: DatabaseRuntimeRole.matchWorker,
    required: appConfig.appEnv === "alpha" || appConfig.appEnv === "production",
  });
  console.info({ config: toSafeConfigLog(appConfig) }, "Aijob match worker started");
  await runOwnerTaskWorker({ db, config: appConfig, signal: controller.signal });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
