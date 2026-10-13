import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AppConfig } from "@aijob/config";
import { z } from "zod";
import { decryptResumePayload, encryptResumePayload } from "../resume/crypto.js";

const Settings = z.object({
  enabled: z.boolean(),
  apiKey: z.string().max(8192),
  sourceNetworkEnabled: z.boolean(),
});
type Settings = z.infer<typeof Settings>;
type Runtime = Pick<
  AppConfig,
  "appEnv" | "workspaceRoot" | "resumeEncryptionKey" | "opportunityDiscovery" | "enableSourceProbe"
>;
const filename = ".data/opportunity-discovery.local.json";
const key = (config: Runtime) =>
  createHash("sha256")
    .update(`aijob:discovery-settings:v1:${config.resumeEncryptionKey}`)
    .digest("hex");

/** Operator settings are local, encrypted, and read on each worker cycle. */
export function readOpportunitySettings(config: Runtime): Settings {
  const defaults: Settings = {
    enabled: config.opportunityDiscovery?.enabled ?? false,
    apiKey: config.opportunityDiscovery?.apiKey ?? "",
    sourceNetworkEnabled: config.enableSourceProbe,
  };
  const path = resolve(config.workspaceRoot, filename);
  if (config.appEnv !== "local" || !existsSync(path)) return defaults;
  try {
    const envelope = z
      .object({ version: z.literal(1), ciphertext: z.string(), iv: z.string(), tag: z.string() })
      .parse(JSON.parse(readFileSync(path, "utf8")));
    return Settings.parse(
      JSON.parse(
        decryptResumePayload(
          {
            ciphertext: Buffer.from(envelope.ciphertext, "base64"),
            initializationVector: Buffer.from(envelope.iv, "base64"),
            authenticationTag: Buffer.from(envelope.tag, "base64"),
          },
          key(config),
        ).toString("utf8"),
      ),
    );
  } catch {
    throw new Error("本机自动找岗位配置暂不可读取，请检查原加密密钥。");
  }
}

export function saveOpportunitySettings(config: Runtime, patch: Partial<Settings>): Settings {
  if (config.appEnv !== "local") throw new Error("自动找岗位配置仅限本机管理。");
  const settings = Settings.parse({ ...readOpportunitySettings(config), ...patch });
  if (settings.enabled && !settings.apiKey.trim()) throw new Error("请先填写搜索服务 API Key。");
  const encrypted = encryptResumePayload(Buffer.from(JSON.stringify(settings)), key(config));
  const path = resolve(config.workspaceRoot, filename),
    temporary = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(
      temporary,
      JSON.stringify({
        version: 1,
        ciphertext: encrypted.ciphertext.toString("base64"),
        iv: encrypted.initializationVector.toString("base64"),
        tag: encrypted.authenticationTag.toString("base64"),
      }),
      { flag: "wx", mode: 0o600 },
    );
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return settings;
}
