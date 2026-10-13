import { toSafeConfigLog } from "@aijob/config";
import { assertDatabaseRoleMembership, createDatabase, DatabaseRuntimeRole } from "@aijob/database";
import { trimExpiredProjectionCache } from "./catalog/projection-cache.js";
import { runSemanticEnrichmentBatch } from "./catalog/semantic-enrichment.js";
import { databaseUrlForRuntime, loadPlatformConfig } from "./config/platform-config.js";
import { readOpportunitySettings } from "./opportunities/local-settings.js";
import { runCollectorWorker } from "./workers/collector-worker.js";

const appConfig = loadPlatformConfig();
const db = createDatabase(databaseUrlForRuntime(appConfig, "collectorWorker"));
const controller = new AbortController();

async function shutdown(signal: string): Promise<void> {
  console.info({ signal }, "Aijob collector worker stopping");
  controller.abort();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
if (process.send)
  process.on("message", (message: unknown) => {
    if ((message as { type: string }).type === "shutdown") void shutdown("IPC");
  });

try {
  await assertDatabaseRoleMembership({
    db,
    role: DatabaseRuntimeRole.collectorWorker,
    required: appConfig.appEnv === "alpha" || appConfig.appEnv === "production",
  });
  console.info({ config: toSafeConfigLog(appConfig) }, "Aijob collector worker started");
  await runCollectorWorker({
    db,
    localSettings: () => readOpportunitySettings(appConfig),
    config: {
      appEnv: appConfig.appEnv,
      enableSourceProbe: appConfig.enableSourceProbe,
      ...(appConfig.collectorAutomationEnabled ? { controlledAutomation: true } : {}),
      ...(appConfig.collectorIsolation ? { collectorIsolation: appConfig.collectorIsolation } : {}),
      snapshotDir: appConfig.snapshotDirectory,
      probeRequestIntervalMs: appConfig.probeRequestIntervalMs,
      ...(appConfig.browserExecutablePath
        ? { browserExecutablePath: appConfig.browserExecutablePath }
        : {}),
      workspaceRoot: appConfig.workspaceRoot,
      ...(appConfig.opportunityDiscovery
        ? { opportunityDiscovery: appConfig.opportunityDiscovery }
        : {}),
    },
    signal: controller.signal,
    afterCycle: async () => {
      await trimExpiredProjectionCache(db);
      return runSemanticEnrichmentBatch({ db, config: appConfig, signal: controller.signal });
    },
    onCycle: (result) => {
      if (result.manualSnapshotSourceKeys?.length) {
        console.info(
          { sourceKeys: result.manualSnapshotSourceKeys },
          "Aijob manual source snapshot refresh required",
        );
      }
      if (result.state === "source_paused") {
        console.warn(result, "Aijob scheduled source refresh paused before network access");
      }
      if (result.state === "ran") console.info(result, "Aijob scheduled source refresh finished");
    },
    onError: (error) => console.error(error),
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.destroy();
  if (process.connected) process.disconnect?.();
}
