import { createInterface } from "node:readline/promises";
import { DEFAULT_WORKSPACE_ROOT, loadAppConfig } from "@aijob/config";
import { createDatabase } from "@aijob/database";
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
import { loadPlatformConfig } from "./config/platform-config.js";
import { runSourceProbe } from "./ingestion/probe.js";
import { loadSourceCandidateRegistry } from "./sources/source-candidates.js";
import { assessSource, listSourceKeys, loadSourceConfig } from "./sources/source-config.js";
import { registerSourceConfig } from "./sources/source-registry.js";

const program = new Command();
program.name("aijob").description("Aijob internal operations CLI").showHelpAfterError();

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

program
  .command("catalog-materialize")
  .description("为本地 MVP 建立不可变岗位版本和可追溯要求集；不会批准或公开来源")
  .action(async () => {
    const appConfig = loadAppConfig();
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
  .command("source-candidates")
  .description("只读列出扩容候选批次；不会访问招聘站或登记来源")
  .action(async () => {
    console.info(JSON.stringify(await loadSourceCandidateRegistry(), null, 2));
  });

program
  .command("source-assess")
  .description("登记并计算来源候选评分；评分不会自动批准来源")
  .argument("[source-key]", "来源配置键；省略时处理 config/sources 中的全部来源")
  .action(async (sourceKey: string | undefined) => {
    const appConfig = loadAppConfig();
    const db = createDatabase(appConfig.databaseUrl);
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
  .argument("[source-key]", "来源配置键；省略时依次探测 config/sources 中的全部来源")
  .option("--limit <number>", "最多处理岗位数（不得超过来源配置预算）")
  .action(async (sourceKey: string | undefined, options: { limit?: string }) => {
    const appConfig = loadAppConfig();
    const requestedLimit = options.limit === undefined ? undefined : Number(options.limit);
    if (requestedLimit !== undefined && !Number.isInteger(requestedLimit)) {
      throw new Error("PROBE_LIMIT_MUST_BE_INTEGER");
    }
    const db = createDatabase(appConfig.databaseUrl);
    try {
      const results = [];
      for (const selectedSourceKey of await selectedSourceKeys(sourceKey)) {
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
