import { resolve } from "node:path";
import { DEFAULT_WORKSPACE_ROOT, type LoadAppConfigOptions, loadAppConfig } from "@aijob/config";
import { readLocalAiProviderConfig } from "../ai/local-provider-config.js";

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
