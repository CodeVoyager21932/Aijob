import { toSafeConfigLog } from "@aijob/config";
import {
  assertDatabaseRoleMembership,
  createDatabase,
  DatabaseRuntimeRole,
} from "@aijob/database";
import { buildApp } from "./app.js";
import { databaseUrlForRuntime, loadPlatformConfig } from "./config/platform-config.js";

const appConfig = loadPlatformConfig();
const db = createDatabase(databaseUrlForRuntime(appConfig, "webApi"));
const app = buildApp({ config: appConfig, db });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await db.destroy();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await assertDatabaseRoleMembership({
    db,
    role: DatabaseRuntimeRole.webApi,
    required: appConfig.appEnv === "alpha" || appConfig.appEnv === "production",
  });
  await app.listen({ host: appConfig.host, port: appConfig.port });
  app.log.info({ config: toSafeConfigLog(appConfig) }, "Aijob platform started");
} catch (error) {
  app.log.error(error);
  await db.destroy();
  process.exitCode = 1;
}
