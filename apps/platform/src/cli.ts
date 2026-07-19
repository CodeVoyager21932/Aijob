import { appConfig } from "@aijob/config";
import { createDatabase } from "@aijob/database";
import { Command } from "commander";
import { materializeLocalCatalog } from "./catalog/materialize.js";
import { runSourceProbe } from "./ingestion/probe.js";
import {
  controlledLocalSourceKeys,
  isControlledLocalSourceKey,
} from "./sources/official-source-adapters.js";
import { assessSource, loadSourceConfig } from "./sources/source-config.js";
import { registerSourceConfig } from "./sources/source-registry.js";

const program = new Command();
program.name("aijob").description("Aijob internal operations CLI").showHelpAfterError();

function selectedSourceKeys(sourceKey: string | undefined): string[] {
  if (!sourceKey) return [...controlledLocalSourceKeys];
  if (!isControlledLocalSourceKey(sourceKey)) throw new Error("ADAPTER_NOT_IMPLEMENTED");
  return [sourceKey];
}

program
  .command("catalog-materialize")
  .description("为本地 MVP 建立不可变岗位版本和可追溯要求集；不会批准或公开来源")
  .action(async () => {
    if (!appConfig.enableLocalMvp) {
      throw new Error("LOCAL_MVP_DISABLED");
    }
    const db = createDatabase(appConfig.databaseUrl);
    try {
      console.info(JSON.stringify(await materializeLocalCatalog(db), null, 2));
    } finally {
      await db.destroy();
    }
  });

program
  .command("source-assess")
  .description("登记并计算来源候选评分；评分不会自动批准来源")
  .argument("[source-key]", "来源配置键；省略时处理全部三条本地来源")
  .action(async (sourceKey: string | undefined) => {
    const db = createDatabase(appConfig.databaseUrl);
    try {
      const results = [];
      for (const selectedSourceKey of selectedSourceKeys(sourceKey)) {
        const config = await loadSourceConfig(selectedSourceKey);
        const registered = await registerSourceConfig(db, config);
        const assessment = assessSource(config);
        results.push({
          sourceKey: selectedSourceKey,
          ...assessment,
          policyStatus: config.policy.status,
          localProbeOnly: config.localProbe.enabled,
          registered,
        });
      }
      console.info(JSON.stringify(sourceKey ? results[0] : { sources: results }, null, 2));
    } finally {
      await db.destroy();
    }
  });

program
  .command("source-probe")
  .description("执行受限本地来源探测；不发布岗位")
  .argument("[source-key]", "来源配置键；省略时依次探测全部三条本地来源")
  .option("--limit <number>", "最多处理岗位数（上限 20）", "20")
  .action(async (sourceKey: string | undefined, options: { limit: string }) => {
    const limit = Number(options.limit);
    if (!Number.isInteger(limit)) throw new Error("PROBE_LIMIT_MUST_BE_INTEGER");
    const db = createDatabase(appConfig.databaseUrl);
    try {
      const results = [];
      for (const selectedSourceKey of selectedSourceKeys(sourceKey)) {
        try {
          const selectedConfig = await loadSourceConfig(selectedSourceKey);
          const result = await runSourceProbe({
            db,
            runtime: {
              appEnv: appConfig.appEnv,
              enableSourceProbe: appConfig.enableSourceProbe,
              snapshotDir: appConfig.snapshotDirectory,
              probeRequestIntervalMs: appConfig.probeRequestIntervalMs,
            },
            sourceKey: selectedSourceKey,
            limit: Math.min(limit, selectedConfig.localProbe.maxItems),
          });
          results.push({ sourceKey: selectedSourceKey, ...result });
          if (result.completion === "failed") process.exitCode = 1;
        } catch (error) {
          process.exitCode = 1;
          results.push({
            sourceKey: selectedSourceKey,
            completion: "failed" as const,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      console.info(JSON.stringify(sourceKey ? results[0] : { sources: results }, null, 2));
    } finally {
      await db.destroy();
    }
  });

await program.parseAsync(process.argv);
