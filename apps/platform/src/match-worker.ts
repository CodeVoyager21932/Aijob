import { toSafeConfigLog } from "@aijob/config";
import { createDatabase } from "@aijob/database";
import { loadPlatformConfig } from "./config/platform-config.js";
import { runOwnerTaskWorker } from "./workers/owner-task-worker.js";

const appConfig = loadPlatformConfig();
const db = createDatabase(appConfig.databaseUrl);
const controller = new AbortController();

async function shutdown(signal: string): Promise<void> {
  console.info({ signal }, "Aijob match worker stopping");
  controller.abort();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  console.info({ config: toSafeConfigLog(appConfig) }, "Aijob match worker started");
  await runOwnerTaskWorker({ db, config: appConfig, signal: controller.signal });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
