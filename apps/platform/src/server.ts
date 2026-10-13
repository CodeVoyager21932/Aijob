import { toSafeConfigLog } from "@aijob/config";
import { assertDatabaseRoleMembership, createDatabase, DatabaseRuntimeRole } from "@aijob/database";
import { buildApp } from "./app.js";
import { databaseUrlForRuntime, loadPlatformConfig } from "./config/platform-config.js";
import { restoreDeviceSession } from "./identity/device-binding.js";
import { registerStaticWeb } from "./static-web.js";

const appConfig = loadPlatformConfig();
const db = createDatabase(databaseUrlForRuntime(appConfig, "webApi"));
const app = buildApp({ config: appConfig, db });
if (process.env.AIJOB_WEB_DIST) registerStaticWeb(app, process.env.AIJOB_WEB_DIST);
if (process.env.AIJOB_DESKTOP_CHILD === "1" && process.send)
  process.on("message", async (message: unknown) => {
    const input = message as {
      type: string;
      id: string;
      credential?: string;
      sessionToken?: string;
    };
    if (input.type === "shutdown") {
      await shutdown("IPC");
      process.disconnect?.();
    }
    if (input.type === "identity") {
      try {
        process.send?.({
          type: "identity",
          id: input.id,
          result: await restoreDeviceSession(db, input),
        });
      } catch {
        process.send?.({ type: "identity", id: input.id, error: "DEVICE_BINDING_INVALID" });
      }
    }
  });

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
  process.send?.({ type: "ready" });
  app.log.info({ config: toSafeConfigLog(appConfig) }, "Aijob platform started");
} catch (error) {
  app.log.error(error);
  await db.destroy();
  process.exitCode = 1;
}
