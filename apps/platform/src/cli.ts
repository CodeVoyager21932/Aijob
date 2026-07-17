import { appConfig } from "@aijob/config";
import { createDatabase } from "@aijob/database";
import { Command } from "commander";
import { runSourceProbe } from "./ingestion/probe.js";
import { assessSource, loadSourceConfig } from "./sources/source-config.js";
import { registerSourceConfig } from "./sources/source-registry.js";

const program = new Command();
program.name("aijob").description("Aijob internal operations CLI").showHelpAfterError();

program
  .command("source-assess")
  .description("登记并计算来源候选评分；评分不会自动批准来源")
  .argument("[source-key]", "来源配置键", "tencent-campus")
  .action(async (sourceKey: string) => {
    const db = createDatabase(appConfig.databaseUrl);
    try {
      const config = await loadSourceConfig(sourceKey);
      const registered = await registerSourceConfig(db, config);
      const assessment = assessSource(config);
      console.info(
        JSON.stringify(
          {
            sourceKey,
            ...assessment,
            policyStatus: config.policy.status,
            localProbeOnly: config.localProbe.enabled,
            registered,
          },
          null,
          2,
        ),
      );
    } finally {
      await db.destroy();
    }
  });

program
  .command("source-probe")
  .description("执行受限本地来源探测；不发布岗位")
  .argument("[source-key]", "来源配置键", "tencent-campus")
  .option("--limit <number>", "最多处理岗位数（上限 20）", "20")
  .action(async (sourceKey: string, options: { limit: string }) => {
    const limit = Number(options.limit);
    if (!Number.isInteger(limit)) throw new Error("PROBE_LIMIT_MUST_BE_INTEGER");
    const db = createDatabase(appConfig.databaseUrl);
    try {
      const result = await runSourceProbe({
        db,
        runtime: {
          appEnv: appConfig.appEnv,
          enableSourceProbe: appConfig.enableSourceProbe,
          snapshotDir: appConfig.snapshotDirectory,
          probeRequestIntervalMs: appConfig.probeRequestIntervalMs,
        },
        sourceKey,
        limit,
      });
      console.info(JSON.stringify(result, null, 2));
      if (result.completion === "failed") process.exitCode = 1;
    } finally {
      await db.destroy();
    }
  });

await program.parseAsync(process.argv);
