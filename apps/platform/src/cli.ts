import { createInterface } from "node:readline/promises";
import { type AppConfig, DEFAULT_WORKSPACE_ROOT, loadAppConfig } from "@aijob/config";
import {
  assertDatabaseRoleMembership,
  createDatabase,
  DatabaseRuntimeRole,
} from "@aijob/database";
import { Command } from "commander";
import {
  AiProviderApiKeySchema,
  AiProviderBaseUrlSchema,
  AiProviderModelSchema,
  localAiProviderConfigExists,
  saveLocalAiProviderConfig,
} from "./ai/local-provider-config.js";
import { runAiProviderSmoke } from "./ai/smoke.js";
import { materializeLocalCatalog } from "./catalog/materialize.js";
import {
  reconcilePublication,
  releaseJobPublicationSuppression,
  suppressJobPublication,
} from "./catalog/publication-reconciliation.js";
import { databaseUrlForRuntime, loadPlatformConfig } from "./config/platform-config.js";
import { runAccessPolicyProbe } from "./ingestion/access-policy-probe.js";
import { runBatchImport } from "./ingestion/batch-import.js";
import { importManualBrowserSnapshot } from "./ingestion/manual-browser-import.js";
import { runSourceProbe } from "./ingestion/probe.js";
import { runLocalBootstrap } from "./local-bootstrap.js";
import {
  buildSourceBatchPlan,
  buildSourceCandidateAudit,
  type SourceScaleMilestone,
} from "./sources/source-batch-planner.js";
import { loadSourceCandidateRegistry } from "./sources/source-candidates.js";
import { assessSource, listSourceKeys, loadSourceConfig } from "./sources/source-config.js";
import {
  disableLocalSourceRefresh,
  enableLocalSourceRefresh,
  getLocalSourceRefreshStatus,
  requestLocalSourceRefresh,
  runLocalSourceRefreshOnce,
} from "./sources/source-refresh-operations.js";
import { registerSourceConfig } from "./sources/source-registry.js";

const program = new Command();
program.name("aijob").description("Aijob internal operations CLI").showHelpAfterError();

async function createOperationsDatabase(appConfig: AppConfig) {
  const db = createDatabase(databaseUrlForRuntime(appConfig, "opsCli"));
  try {
    await assertDatabaseRoleMembership({
      db,
      role: DatabaseRuntimeRole.opsCli,
      required: appConfig.appEnv === "alpha" || appConfig.appEnv === "production",
    });
    return db;
  } catch (error) {
    await db.destroy();
    throw error;
  }
}

program
  .command("local-bootstrap")
  .description("按 Git 忽略清单恢复本地目录；快照缺失或统计不一致时 fail-closed")
  .option("--manifest <path>", "Git 忽略的恢复清单", ".data/local-bootstrap.json")
  .option("--confirm-live", "确认恢复清单中的确定性来源会访问真实官方站点")
  .action(async (options: { manifest: string; confirmLive?: boolean }) => {
    console.info(
      JSON.stringify(
        await runLocalBootstrap({
          appConfig: loadAppConfig(),
          manifestPath: options.manifest,
          liveProbeApproved: options.confirmLive === true,
        }),
        null,
        2,
      ),
    );
  });

async function promptValue(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("AI_CONFIGURATION_INPUT_REQUIRES_TTY");
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question(label)).trim();
  } finally {
    terminal.close();
  }
}

async function confirm(label: string): Promise<boolean> {
  const answer = (await promptValue(`${label} [y/N] `)).toLowerCase();
  return answer === "y" || answer === "yes";
}

async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("AI_CONFIGURATION_INPUT_REQUIRES_TTY");
  }
  return new Promise<string>((resolve, reject) => {
    const input = process.stdin;
    const previousRawMode = input.isRaw;
    let value = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      input.off("data", onData);
      input.setRawMode(Boolean(previousRawMode));
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          finish(new Error("AI_CONFIGURATION_CANCELLED"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0008" || character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " " && value.length < 8_192) value += character;
      }
    };
    process.stdout.write(label);
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    input.on("data", onData);
  });
}

async function providerMetadata(options: {
  baseUrl?: string;
  model?: string;
}): Promise<{ baseUrl: string; model: string }> {
  return {
    baseUrl: AiProviderBaseUrlSchema.parse(
      options.baseUrl ?? (await promptValue("OpenAI-compatible HTTPS base URL: ")),
    ),
    model: AiProviderModelSchema.parse(options.model ?? (await promptValue("Model name: "))),
  };
}

async function selectedSourceKeys(sourceKey: string | undefined): Promise<string[]> {
  if (!sourceKey) return listSourceKeys();
  await loadSourceConfig(sourceKey);
  return [sourceKey];
}

async function selectedProbeSourceKeys(sourceKey: string | undefined): Promise<string[]> {
  if (sourceKey) return selectedSourceKeys(sourceKey);
  const sourceKeys = await listSourceKeys();
  const enabled: string[] = [];
  for (const selectedSourceKey of sourceKeys) {
    if ((await loadSourceConfig(selectedSourceKey)).localProbe.enabled) {
      enabled.push(selectedSourceKey);
    }
  }
  return enabled;
}

program
  .command("catalog-materialize")
  .description("为本地 MVP 建立不可变岗位版本和可追溯要求集；不会批准或公开来源")
  .action(async () => {
    const appConfig = loadAppConfig();
    if (!appConfig.enableLocalMvp) {
      throw new Error("LOCAL_MVP_DISABLED");
    }
    const db = await createOperationsDatabase(appConfig);
    try {
      console.info(JSON.stringify(await materializeLocalCatalog(db), null, 2));
    } finally {
      await db.destroy();
    }
  });

// ADR-0034 第二条：发布由双向资格对账驱动。合格即发布、失格即撤回、出现更新的合格版本即前移。
// 只写 public_version_id，不改写任何修订。不会批准来源，也不会提升 runtime_scope。
program
  .command("catalog-reconcile-publication")
  .description("按资格对账公开指针：合格即发布、失格即撤回；不批准来源、不改写修订")
  .option(
    "--published-job-id <id...>",
    "只对账这些岗位；省略即全量。周期运行应当全量，否则撤回不及时",
  )
  .action(async (options: { publishedJobId?: string[] }) => {
    const appConfig = loadAppConfig();
    const db = await createOperationsDatabase(appConfig);
    try {
      console.info(
        JSON.stringify(
          await reconcilePublication({
            db,
            ...(options.publishedJobId ? { publishedJobIds: options.publishedJobId } : {}),
          }),
          null,
          2,
        ),
      );
    } finally {
      await db.destroy();
    }
  });

// ADR-0033 的「异议即停」：立即压制某岗位而不等下一轮对账，且不会被对账自动恢复。
program
  .command("catalog-suppress-job")
  .description("强制下架某岗位并立即清空公开指针；须显式解除，对账不会自动恢复")
  .requiredOption("--published-job-id <id>", "catalog.published_jobs 的岗位 ID")
  .requiredOption("--reason <reason>", "下架依据，会写入发布事件记录")
  .action(async (options: { publishedJobId: string; reason: string }) => {
    const appConfig = loadAppConfig();
    const db = await createOperationsDatabase(appConfig);
    try {
      console.info(
        JSON.stringify(
          await suppressJobPublication({
            db,
            publishedJobId: options.publishedJobId,
            reason: options.reason,
          }),
          null,
          2,
        ),
      );
    } finally {
      await db.destroy();
    }
  });

program
  .command("catalog-release-job-suppression")
  .description("解除强制下架；是否重新发布由下一轮对账按资格判定")
  .requiredOption("--published-job-id <id>", "catalog.published_jobs 的岗位 ID")
  .action(async (options: { publishedJobId: string }) => {
    const appConfig = loadAppConfig();
    const db = await createOperationsDatabase(appConfig);
    try {
      console.info(
        JSON.stringify(
          await releaseJobPublicationSuppression({ db, publishedJobId: options.publishedJobId }),
          null,
          2,
        ),
      );
    } finally {
      await db.destroy();
    }
  });

program
  .command("source-candidates")
  .description("只读列出扩容候选批次；不会访问招聘站或登记来源")
  .action(async () => {
    console.info(JSON.stringify(await loadSourceCandidateRegistry(), null, 2));
  });

program
  .command("source-batch-plan")
  .description("只读计算规模里程碑缺口并稳定选择下一批来源；不会访问招聘站")
  .requiredOption("--milestone <companies>", "企业检查点：40、70 或 100")
  .option("--limit <companies>", "本批最多企业数，默认使用注册表上限")
  .action(async (options: { milestone: string; limit?: string }) => {
    const milestone = Number(options.milestone);
    if (milestone !== 40 && milestone !== 70 && milestone !== 100) {
      throw new Error("SOURCE_BATCH_PLAN_MILESTONE_INVALID");
    }
    const appConfig = loadAppConfig();
    const db = await createOperationsDatabase(appConfig);
    try {
      console.info(
        JSON.stringify(
          await buildSourceBatchPlan({
            db,
            milestone: milestone as SourceScaleMilestone,
            ...(options.limit ? { limit: Number(options.limit) } : {}),
          }),
          null,
          2,
        ),
      );
    } finally {
      await db.destroy();
    }
  });

program
  .command("source-candidate-audit")
  .description("零网络审计扩容候选容量、来源族和证据缺口；不会修改配置")
  .requiredOption("--milestone <companies>", "企业检查点：40、70 或 100")
  .option("--limit <candidates>", "每个来源族最多展示的候选数", "20")
  .action(async (options: { milestone: string; limit: string }) => {
    const milestone = Number(options.milestone);
    const candidateSampleLimit = Number(options.limit);
    if (milestone !== 40 && milestone !== 70 && milestone !== 100) {
      throw new Error("SOURCE_CANDIDATE_AUDIT_MILESTONE_INVALID");
    }
    if (
      !Number.isInteger(candidateSampleLimit) ||
      candidateSampleLimit < 1 ||
      candidateSampleLimit > 100
    ) {
      throw new Error("SOURCE_CANDIDATE_AUDIT_LIMIT_OUT_OF_RANGE");
    }
    const appConfig = loadAppConfig();
    const db = await createOperationsDatabase(appConfig);
    try {
      console.info(
        JSON.stringify(
          await buildSourceCandidateAudit({
            db,
            milestone: milestone as SourceScaleMilestone,
            candidateSampleLimit,
          }),
          null,
          2,
        ),
      );
    } finally {
      await db.destroy();
    }
  });

program
  .command("source-assess")
  .description("登记并计算来源候选评分；评分不会自动批准来源")
  .argument("[source-key]", "来源配置键；省略时处理 config/sources 中的全部来源")
  .action(async (sourceKey: string | undefined) => {
    const appConfig = loadAppConfig();
    const db = await createOperationsDatabase(appConfig);
    try {
      const results = [];
      for (const selectedSourceKey of await selectedSourceKeys(sourceKey)) {
        const config = await loadSourceConfig(selectedSourceKey);
        const registered = await registerSourceConfig(db, config);
        const assessment = assessSource(config);
        results.push({
          sourceKey: selectedSourceKey,
          ...assessment,
          policyStatus: config.policy.status,
          localOnly: config.policy.status === "pending_review",
          liveProbeEnabled: config.localProbe.enabled,
          manualBrowserImport: config.policy.adapterKey === "bytedance-manual-browser-snapshot",
          registered,
        });
      }
      console.info(JSON.stringify(sourceKey ? results[0] : { sources: results }, null, 2));
    } finally {
      await db.destroy();
    }
  });

program
  .command("source-import-browser-snapshot")
  .description("离线导入已人工核对的浏览器可见 DOM 快照；命令本身不会访问招聘站")
  .argument("<source-key>", "browser_required 来源配置键")
  .requiredOption("--file <path>", "位于 .data/browser-imports/ 下的 JSON 快照")
  .action(async (sourceKey: string, options: { file: string }) => {
    const appConfig = loadAppConfig();
    const db = await createOperationsDatabase(appConfig);
    try {
      console.info(
        JSON.stringify(
          await importManualBrowserSnapshot({
            db,
            appEnv: appConfig.appEnv,
            enableLocalMvp: appConfig.enableLocalMvp,
            workspaceRoot: appConfig.workspaceRoot,
            snapshotDirectory: appConfig.snapshotDirectory,
            sourceKey,
            filePath: options.file,
          }),
          null,
          2,
        ),
      );
    } finally {
      await db.destroy();
    }
  });

program
  .command("source-refresh-enable")
  .description("Enable explicitly configured local source refresh schedules")
  .option(
    "--stagger-hours <hours>",
    "Spread currently due deterministic sources across a stable 1-24 hour window",
    "0",
  )
  .action(async (options: { staggerHours: string }) => {
    const appConfig = loadAppConfig();
    const db = await createOperationsDatabase(appConfig);
    try {
      console.info(
        JSON.stringify(
          await enableLocalSourceRefresh({
            db,
            appEnv: appConfig.appEnv,
            workspaceRoot: appConfig.workspaceRoot,
            staggerHours: Number(options.staggerHours),
          }),
          null,
          2,
        ),
      );
    } finally {
      await db.destroy();
    }
  });

program
  .command("source-refresh-disable")
  .description("Disable new local scheduled source refresh work")
  .action(async () => {
    const appConfig = loadAppConfig();
    const db = await createOperationsDatabase(appConfig);
    try {
      const control = await disableLocalSourceRefresh({
        db,
        appEnv: appConfig.appEnv,
        workspaceRoot: appConfig.workspaceRoot,
      });
      console.info(JSON.stringify(control, null, 2));
    } finally {
      await db.destroy();
    }
  });

program
  .command("source-refresh-status")
  .description("Show read-only local source refresh state and snapshot reminders")
  .action(async () => {
    const appConfig = loadAppConfig();
    const db = await createOperationsDatabase(appConfig);
    try {
      console.info(
        JSON.stringify(
          await getLocalSourceRefreshStatus({
            db,
            appEnv: appConfig.appEnv,
            workspaceRoot: appConfig.workspaceRoot,
          }),
          null,
          2,
        ),
      );
    } finally {
      await db.destroy();
    }
  });

program
  .command("source-refresh-now")
  .description("Mark one or all configured sources due for the scheduled collector")
  .argument("[source-key]", "Configured source key; omit to request every enabled source")
  .option("--wait", "Run exactly this source through one collector cycle before returning")
  .option("--confirm-live", "Confirm that --wait may access the configured official source")
  .action(
    async (
      sourceKey: string | undefined,
      options: { wait?: boolean; confirmLive?: boolean },
    ) => {
      const appConfig = loadAppConfig();
      const db = await createOperationsDatabase(appConfig);
      try {
        if (options.wait) {
          if (!sourceKey) throw new Error("SOURCE_REFRESH_WAIT_REQUIRES_SOURCE_KEY");
          const result = await runLocalSourceRefreshOnce({
            db,
            appEnv: appConfig.appEnv,
            workspaceRoot: appConfig.workspaceRoot,
            sourceKey,
            liveProbeApproved: options.confirmLive === true,
            workerConfig: {
              appEnv: appConfig.appEnv,
              enableSourceProbe: appConfig.enableSourceProbe,
              snapshotDir: appConfig.snapshotDirectory,
              probeRequestIntervalMs: appConfig.probeRequestIntervalMs,
              workspaceRoot: appConfig.workspaceRoot,
            },
          });
          if (result.state !== "ran" || result.result?.completion === "failed") {
            process.exitCode = 1;
          }
          console.info(JSON.stringify(result, null, 2));
          return;
        }
        const result = await requestLocalSourceRefresh({
          db,
          appEnv: appConfig.appEnv,
          workspaceRoot: appConfig.workspaceRoot,
          ...(sourceKey ? { sourceKey } : {}),
        });
        if (
          result &&
          "sources" in result &&
          result.sources.some((source) => "error" in source && source.error)
        ) {
          process.exitCode = 1;
        }
        console.info(JSON.stringify(result, null, 2));
      } finally {
        await db.destroy();
      }
    },
  );

program
  .command("source-probe")
  .description("执行受限本地来源探测；不发布岗位")
  .argument("[source-key]", "来源配置键；省略时依次探测 config/sources 中的全部来源")
  .option("--limit <number>", "最多处理岗位数（不得超过来源配置预算）")
  .option("--confirm-live", "确认本次会访问已授权的真实官方来源")
  .action(async (
    sourceKey: string | undefined,
    options: { limit?: string; confirmLive?: boolean },
  ) => {
    const appConfig = loadAppConfig();
    const requestedLimit = options.limit === undefined ? undefined : Number(options.limit);
    if (requestedLimit !== undefined && !Number.isInteger(requestedLimit)) {
      throw new Error("PROBE_LIMIT_MUST_BE_INTEGER");
    }
    const db = await createOperationsDatabase(appConfig);
    try {
      const results = [];
      for (const selectedSourceKey of await selectedProbeSourceKeys(sourceKey)) {
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
            limit: requestedLimit ?? selectedConfig.localProbe.requestBudget.maxItems,
            liveProbeApproved: options.confirmLive === true,
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

program
  .command("source-access-policy-probe")
  .description(
    "ADR-0033 首次取证：逐主机取回 robots.txt 并按已登记 fetchTargets 判定；只产出证据草稿，不写配置",
  )
  .argument("[source-key]", "来源配置键；省略时处理 config/sources 中的全部来源")
  .option("--confirm-live", "确认本次会对已登记主机各发起一次 GET /robots.txt")
  .action(async (sourceKey: string | undefined, options: { confirmLive?: boolean }) => {
    const appConfig = loadAppConfig();
    console.info(
      JSON.stringify(
        await runAccessPolicyProbe({
          runtime: {
            appEnv: appConfig.appEnv,
            enableSourceProbe: appConfig.enableSourceProbe,
            workspaceRoot: appConfig.workspaceRoot,
            requestIntervalMs: appConfig.probeRequestIntervalMs,
          },
          ...(sourceKey ? { sourceKeys: [sourceKey] } : {}),
          liveProbeApproved: options.confirmLive === true,
        }),
        null,
        2,
      ),
    );
  });

program
  .command("source-batch-import")
  .description("按来源批量执行受限本地自动化导入；失败来源隔离，浏览器来源只进入兜底队列")
  .requiredOption("--source-keys <keys>", "逗号分隔的来源键；不会默认触碰全部来源")
  .option("--limit <number>", "每个来源最多导入的岗位数，受来源预算限制", "5")
  .option("--confirm-live", "确认本次会访问已授权的真实官方来源")
  .action(async (options: { sourceKeys: string; limit: string; confirmLive?: boolean }) => {
    const requestedLimit = Number(options.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw new Error("SOURCE_BATCH_LIMIT_INVALID");
    }
    const sourceKeys = options.sourceKeys
      .split(",")
      .map((sourceKey) => sourceKey.trim())
      .filter(Boolean);
    const appConfig = loadAppConfig();
    const db = await createOperationsDatabase(appConfig);
    try {
      const result = await runBatchImport({
        db,
        runtime: {
          appEnv: appConfig.appEnv,
          enableSourceProbe: appConfig.enableSourceProbe,
          snapshotDir: appConfig.snapshotDirectory,
          probeRequestIntervalMs: appConfig.probeRequestIntervalMs,
        },
        enableLocalMvp: appConfig.enableLocalMvp,
        sourceKeys,
        limit: requestedLimit,
        liveProbeApproved: options.confirmLive === true,
      });
      if (
        result.stoppedByTransportCircuit ||
        result.materializationError ||
        result.items.some((item) => item.state === "failed")
      ) {
        process.exitCode = 1;
      }
      console.info(JSON.stringify(result, null, 2));
    } finally {
      await db.destroy();
    }
    },
  );

program
  .command("ai-configure")
  .description("填写本地 MVP 后端使用的 AI 接口配置")
  .option("--base-url <url>", "OpenAI-compatible HTTPS base URL（非密钥）")
  .option("--model <name>", "模型名称（非密钥）")
  .option("--replace", "替换已有本机凭据")
  .action(async (options: { baseUrl?: string; model?: string; replace?: boolean }) => {
    const configured = localAiProviderConfigExists(DEFAULT_WORKSPACE_ROOT);
    if (configured && !options.replace) {
      const approved = await confirm("本机已经存在 AI 凭据，是否替换？");
      if (!approved) {
        console.info(JSON.stringify({ configured: true, changed: false }));
        return;
      }
    }
    const selected = await providerMetadata(options);
    const apiKey = AiProviderApiKeySchema.parse(await promptSecret("API Key (input hidden): "));
    const saved = saveLocalAiProviderConfig({
      rootDirectory: DEFAULT_WORKSPACE_ROOT,
      ...selected,
      apiKey,
    });
    console.info(
      JSON.stringify({
        configured: true,
        changed: true,
        effectiveEnabled: loadPlatformConfig().ai.enabled,
        updatedAt: saved.updatedAt,
      }),
    );
  });

program
  .command("ai-smoke")
  .description("使用合成、去标识化证据验证真实 OpenAI-compatible 接口")
  .action(async () => {
    const config = loadPlatformConfig();
    if (!config.ai.enabled || !config.ai.baseUrl || !config.ai.model || !config.ai.apiKey) {
      throw new Error("AI_PROVIDER_NOT_CONFIGURED");
    }
    console.info(
      JSON.stringify(
        await runAiProviderSmoke({
          enabled: true,
          baseUrl: config.ai.baseUrl,
          model: config.ai.model,
          apiKey: config.ai.apiKey,
          requestTimeoutMs: config.ai.requestTimeoutMs,
        }),
        null,
        2,
      ),
    );
  });

await program.parseAsync(process.argv);
