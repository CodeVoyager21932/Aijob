import { appConfig, toSafeConfigLog } from "@aijob/config";
import { createDatabase } from "@aijob/database";
import { buildApp } from "./app.js";

const db = createDatabase(appConfig.databaseUrl);
const app = buildApp({ config: appConfig, db });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await db.destroy();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: appConfig.host, port: appConfig.port });
  app.log.info({ config: toSafeConfigLog(appConfig) }, "Aijob platform started");
} catch (error) {
  app.log.error(error);
  await db.destroy();
  process.exitCode = 1;
}
