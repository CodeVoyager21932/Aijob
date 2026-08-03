import { resolve } from "node:path";
import {
  type AppConfig,
  DEFAULT_WORKSPACE_ROOT,
  type LoadAppConfigOptions,
  loadAppConfig,
} from "@aijob/config";
import { readLocalAiProviderConfig } from "../ai/local-provider-config.js";

export type PlatformDatabaseRuntime =
  | "webApi"
  | "collectorWorker"
  | "matchWorker"
  | "opsCli"
  | "migrator";

const databaseEnvironmentKey: Record<PlatformDatabaseRuntime, string> = {
  webApi: "WEB_API_DATABASE_URL",
  collectorWorker: "COLLECTOR_DATABASE_URL",
  matchWorker: "MATCH_DATABASE_URL",
  opsCli: "OPS_DATABASE_URL",
  migrator: "MIGRATOR_DATABASE_URL",
};

export function databaseUrlForRuntime(
  config: AppConfig,
  runtime: PlatformDatabaseRuntime,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const environmentKey = databaseEnvironmentKey[runtime];
  const explicit = environment[environmentKey]?.trim();
  if (!explicit && (config.appEnv === "alpha" || config.appEnv === "production")) {
    throw new Error(`DATABASE_RUNTIME_URL_REQUIRED:${environmentKey}`);
  }
  const selected = explicit || config.databaseUrl;
  let parsed: URL;
  try {
    parsed = new URL(selected);
  } catch {
    throw new Error(`DATABASE_RUNTIME_URL_INVALID:${environmentKey}`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`DATABASE_RUNTIME_URL_INVALID:${environmentKey}`);
  }
  return selected;
}

export function loadPlatformConfig(options: LoadAppConfigOptions = {}) {
  const rootDirectory = resolve(options.rootDirectory ?? DEFAULT_WORKSPACE_ROOT);
  const environmentProbe = loadAppConfig({
    ...options,
    rootDirectory,
    overrideEnvironment: { ...options.overrideEnvironment, ENABLE_AI: "false" },
  });
  if (environmentProbe.appEnv !== "local" && environmentProbe.appEnv !== "test") {
    return loadAppConfig({ ...options, rootDirectory });
  }
  const localProvider = readLocalAiProviderConfig(rootDirectory);
  if (!localProvider) return loadAppConfig({ ...options, rootDirectory });
  return loadAppConfig({
    ...options,
    rootDirectory,
    overrideEnvironment: {
      ...options.overrideEnvironment,
      ENABLE_AI: "true",
      AI_BASE_URL: localProvider.baseUrl,
      AI_MODEL: localProvider.model,
      AI_API_KEY: localProvider.apiKey,
    },
  });
}
