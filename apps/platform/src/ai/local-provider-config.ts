import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const LOCAL_AI_PROVIDER_CONFIG_RELATIVE_PATH = ".data/ai-provider.local.json";

export const AiProviderBaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .url()
  .superRefine((value, context) => {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "AI provider URL must be a credential-free HTTPS base URL",
      });
    }
  });

export const AiProviderModelSchema = z.string().trim().min(1).max(256);
export const AiProviderApiKeySchema = z.string().trim().min(1).max(8_192);

const LocalAiProviderConfigSchema = z.object({
  version: z.literal(1),
  enabled: z.literal(true),
  baseUrl: AiProviderBaseUrlSchema,
  model: AiProviderModelSchema,
  apiKey: AiProviderApiKeySchema,
  updatedAt: z.string().datetime(),
});

export type LocalAiProviderConfig = z.infer<typeof LocalAiProviderConfigSchema>;

function configPath(rootDirectory: string): string {
  return resolve(rootDirectory, LOCAL_AI_PROVIDER_CONFIG_RELATIVE_PATH);
}

export function localAiProviderConfigExists(rootDirectory: string): boolean {
  return existsSync(configPath(rootDirectory));
}

export function readLocalAiProviderConfig(rootDirectory: string): LocalAiProviderConfig | null {
  const path = configPath(rootDirectory);
  if (!existsSync(path)) return null;
  try {
    return LocalAiProviderConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new Error("LOCAL_AI_PROVIDER_CONFIG_INVALID");
  }
}

export function saveLocalAiProviderConfig(input: {
  rootDirectory: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  now?: Date;
}): LocalAiProviderConfig {
  const config = LocalAiProviderConfigSchema.parse({
    version: 1,
    enabled: true,
    baseUrl: input.baseUrl,
    model: input.model,
    apiKey: input.apiKey,
    updatedAt: (input.now ?? new Date()).toISOString(),
  });
  const path = configPath(input.rootDirectory);
  mkdirSync(resolve(input.rootDirectory, ".data"), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return config;
}
