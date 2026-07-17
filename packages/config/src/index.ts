import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

export const AppEnvironmentSchema = z.enum(["local", "test", "alpha", "production"]);
export type AppEnvironment = z.infer<typeof AppEnvironmentSchema>;

export const LogLevelSchema = z.enum([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export function isLoopbackHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase();
  if (normalizedHost === "::1" || normalizedHost === "0:0:0:0:0:0:0:1") {
    return true;
  }

  return isIP(normalizedHost) === 4 && normalizedHost.split(".")[0] === "127";
}

const PostgreSqlUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "postgres:" || protocol === "postgresql:";
      } catch {
        return false;
      }
    },
    { message: "DATABASE_URL must use postgres:// or postgresql://" },
  );

const BooleanEnvironmentValueSchema = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => value === "true");

const RawEnvironmentSchema = z
  .object({
    APP_ENV: AppEnvironmentSchema.default("local"),
    DATABASE_URL: PostgreSqlUrlSchema.optional(),
    SNAPSHOT_DIR: z.string().trim().min(1).default(".data/job-snapshots"),
    HOST: z.string().trim().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
    PROBE_REQUEST_INTERVAL_MS: z.coerce.number().int().min(250).max(10_000).default(750),
    LOG_LEVEL: LogLevelSchema.default("info"),
    ENABLE_INTERNAL_PREVIEW: BooleanEnvironmentValueSchema,
    ENABLE_SOURCE_PROBE: BooleanEnvironmentValueSchema,
  })
  .superRefine((environment, context) => {
    const permitsLocalCapabilities =
      environment.APP_ENV === "local" || environment.APP_ENV === "test";

    if (!permitsLocalCapabilities && environment.ENABLE_INTERNAL_PREVIEW) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ENABLE_INTERNAL_PREVIEW"],
        message: "Internal preview is forbidden outside local and test environments",
      });
    }

    if (!permitsLocalCapabilities && environment.ENABLE_SOURCE_PROBE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ENABLE_SOURCE_PROBE"],
        message: "Source probing is forbidden outside local and test environments",
      });
    }

    if (!permitsLocalCapabilities && environment.DATABASE_URL === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required in alpha and production",
      });
    }
  });

export const AppConfigSchema = z
  .object({
    appEnv: AppEnvironmentSchema,
    databaseUrl: PostgreSqlUrlSchema,
    snapshotDirectory: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65_535),
    probeRequestIntervalMs: z.number().int().min(250).max(10_000),
    logLevel: LogLevelSchema,
    enableInternalPreview: z.boolean(),
    enableSourceProbe: z.boolean(),
    workspaceRoot: z.string().min(1),
  })
  .superRefine((config, context) => {
    if (
      (config.enableInternalPreview || config.enableSourceProbe) &&
      !isLoopbackHost(config.host)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["host"],
        message:
          "HOST must be a numeric loopback address when internal preview or source probing is enabled",
      });
    }
  });
export type AppConfig = Readonly<z.infer<typeof AppConfigSchema>>;

export type EnvironmentInput = Readonly<Record<string, string | undefined>>;

export interface ParseAppConfigOptions {
  rootDirectory?: string;
}

export interface LoadAppConfigOptions extends ParseAppConfigOptions {
  envFile?: string;
}

export const DEFAULT_WORKSPACE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const LOCAL_DATABASE_URL = "postgresql://aijob:aijob@127.0.0.1:5432/aijob";

export const parseAppConfig = (
  environment: EnvironmentInput,
  options: ParseAppConfigOptions = {},
): AppConfig => {
  const rootDirectory = resolve(options.rootDirectory ?? DEFAULT_WORKSPACE_ROOT);
  const parsed = RawEnvironmentSchema.parse(environment);
  const localCapabilitiesDefault = parsed.APP_ENV === "local" || parsed.APP_ENV === "test";

  const config = AppConfigSchema.parse({
    appEnv: parsed.APP_ENV,
    databaseUrl: parsed.DATABASE_URL ?? LOCAL_DATABASE_URL,
    snapshotDirectory: resolve(rootDirectory, parsed.SNAPSHOT_DIR),
    host: parsed.HOST,
    port: parsed.PORT,
    probeRequestIntervalMs: parsed.PROBE_REQUEST_INTERVAL_MS,
    logLevel: parsed.LOG_LEVEL,
    enableInternalPreview:
      environment.ENABLE_INTERNAL_PREVIEW === undefined
        ? localCapabilitiesDefault
        : parsed.ENABLE_INTERNAL_PREVIEW,
    enableSourceProbe:
      environment.ENABLE_SOURCE_PROBE === undefined
        ? localCapabilitiesDefault
        : parsed.ENABLE_SOURCE_PROBE,
    workspaceRoot: rootDirectory,
  });

  return Object.freeze(config);
};

export const loadAppConfig = (options: LoadAppConfigOptions = {}): AppConfig => {
  const rootDirectory = resolve(options.rootDirectory ?? DEFAULT_WORKSPACE_ROOT);
  const envFile = resolve(rootDirectory, options.envFile ?? ".env");

  loadDotEnv({ path: envFile, override: false });

  return parseAppConfig(process.env, { rootDirectory });
};

export const toSafeConfigLog = (
  config: AppConfig,
): Omit<AppConfig, "databaseUrl"> & { databaseUrl: "[redacted]" } => ({
  ...config,
  databaseUrl: "[redacted]",
});

export const appConfig = loadAppConfig();
