import { createHash, randomBytes, randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDotEnv } from "dotenv";
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

const OptionalBooleanEnvironmentValueSchema = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true"));

const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "AI_BASE_URL must use https://",
  });

const EncryptionKeySchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "RESUME_ENCRYPTION_KEY must be a 32-byte hex key");

const IdentityMasterKeySchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "IDENTITY_MASTER_KEY must be a 32-byte hex key");

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hex digest");
const HttpOriginSchema = z.string().refine(
  (value) => {
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === value
      );
    } catch {
      return false;
    }
  },
  { message: "Expected an exact HTTP(S) origin without a path" },
);

function commaSeparatedValues(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

const LOCAL_ENCRYPTION_KEY_RELATIVE_PATH = ".data/resume-encryption.key";

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code
  );
}

function readLocalEncryptionKey(keyPath: string): string {
  const key = readFileSync(keyPath, "utf8").trim();
  const parsed = EncryptionKeySchema.safeParse(key);
  if (!parsed.success) {
    throw new Error(
      `LOCAL_RESUME_ENCRYPTION_KEY_INVALID: remove ${LOCAL_ENCRYPTION_KEY_RELATIVE_PATH} and restart`,
    );
  }
  return parsed.data;
}

/**
 * Persist a workspace-local key without embedding a shared development secret.
 * A hard-link publish makes concurrent first starts converge on one key.
 */
export function loadOrCreateLocalEncryptionKey(rootDirectory: string): string {
  const keyPath = resolve(rootDirectory, LOCAL_ENCRYPTION_KEY_RELATIVE_PATH);
  try {
    return readLocalEncryptionKey(keyPath);
  } catch (error) {
    if (!isFileSystemError(error, "ENOENT")) throw error;
  }

  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  const generatedKey = randomBytes(32).toString("hex");
  const temporaryPath = `${keyPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, generatedKey, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      linkSync(temporaryPath, keyPath);
      unlinkSync(temporaryPath);
      return generatedKey;
    } catch (error) {
      if (!isFileSystemError(error, "EEXIST")) throw error;
      const existingKey = readLocalEncryptionKey(keyPath);
      unlinkSync(temporaryPath);
      return existingKey;
    }
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Preserve the startup failure; the random-name temp file remains Git-ignored.
    }
    throw error;
  }
}

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
    ENABLE_LOCAL_MVP: BooleanEnvironmentValueSchema,
    RESUME_REVIEW_V2_WRITE_ENABLED: OptionalBooleanEnvironmentValueSchema,
    RESUME_ENCRYPTION_KEY: EncryptionKeySchema.optional(),
    RESUME_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024)
      .default(5 * 1024 * 1024),
    RESUME_PARSER_MODE: z.enum(["process", "container"]).optional(),
    RESUME_PARSER_CONTAINER_IMAGE: z.string().trim().min(1).optional(),
    ENABLE_AI: BooleanEnvironmentValueSchema,
    AI_BASE_URL: HttpsUrlSchema.optional(),
    AI_MODEL: z.string().trim().min(1).optional(),
    AI_API_KEY: z.string().trim().min(1).optional(),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    ACCEPTED_ORIGINS: z
      .string()
      .optional()
      .transform((value) => commaSeparatedValues(value)),
    IDENTITY_MASTER_KEY: IdentityMasterKeySchema.optional(),
    ALPHA_INVITED_EMAIL_HASHES: z
      .string()
      .optional()
      .transform((value) => commaSeparatedValues(value)),
    IDENTITY_EMAIL_DELIVERY_MODE: z.enum(["disabled", "fixture"]).default("disabled"),
    IDENTITY_FIXTURE_VERIFICATION_CODE: z.string().regex(/^\d{6}$/).optional(),
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

    if (!permitsLocalCapabilities && environment.ENABLE_LOCAL_MVP) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ENABLE_LOCAL_MVP"],
        message: "The local MVP catalog is forbidden outside local and test environments",
      });
    }

    if (!permitsLocalCapabilities && environment.DATABASE_URL === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required in alpha and production",
      });
    }

    if (!permitsLocalCapabilities && environment.RESUME_ENCRYPTION_KEY === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESUME_ENCRYPTION_KEY"],
        message: "RESUME_ENCRYPTION_KEY is required in alpha and production",
      });
    }

    if (
      environment.ENABLE_AI &&
      (!environment.AI_BASE_URL || !environment.AI_MODEL || !environment.AI_API_KEY)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ENABLE_AI"],
        message: "AI_BASE_URL, AI_MODEL and AI_API_KEY are required when ENABLE_AI=true",
      });
    }

    for (const [index, origin] of environment.ACCEPTED_ORIGINS.entries()) {
      const result = HttpOriginSchema.safeParse(origin);
      if (!result.success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ACCEPTED_ORIGINS", index],
          message: result.error.issues[0]?.message ?? "Invalid accepted origin",
        });
      } else if (environment.APP_ENV === "alpha" && new URL(origin).protocol !== "https:") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ACCEPTED_ORIGINS", index],
          message: "Alpha accepted origins must use HTTPS",
        });
      }
    }

    const parserMode =
      environment.RESUME_PARSER_MODE ?? (permitsLocalCapabilities ? "process" : "container");
    if (parserMode === "container") {
      if (
        !environment.RESUME_PARSER_CONTAINER_IMAGE ||
        !/^[^\s]+@sha256:[a-f0-9]{64}$/i.test(environment.RESUME_PARSER_CONTAINER_IMAGE)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["RESUME_PARSER_CONTAINER_IMAGE"],
          message: "Container resume parser requires an immutable image@sha256 digest",
        });
      }
    }
    if (!permitsLocalCapabilities && parserMode !== "container") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESUME_PARSER_MODE"],
        message: "Alpha and production require the container resume parser",
      });
    }

    for (const [index, digest] of environment.ALPHA_INVITED_EMAIL_HASHES.entries()) {
      if (!Sha256Schema.safeParse(digest).success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ALPHA_INVITED_EMAIL_HASHES", index],
          message: "Alpha invited emails must be configured as keyed SHA-256 hex digests",
        });
      }
    }

    if (environment.APP_ENV === "alpha" && environment.ACCEPTED_ORIGINS.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ACCEPTED_ORIGINS"],
        message: "ACCEPTED_ORIGINS is required in alpha",
      });
    }

    if (!permitsLocalCapabilities && environment.IDENTITY_MASTER_KEY === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["IDENTITY_MASTER_KEY"],
        message: "IDENTITY_MASTER_KEY is required in alpha and production",
      });
    }

    if (environment.APP_ENV === "alpha" && environment.ALPHA_INVITED_EMAIL_HASHES.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ALPHA_INVITED_EMAIL_HASHES"],
        message: "ALPHA_INVITED_EMAIL_HASHES is required in alpha",
      });
    }

    if (
      (environment.APP_ENV === "alpha" || environment.APP_ENV === "production") &&
      environment.IDENTITY_EMAIL_DELIVERY_MODE === "fixture"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["IDENTITY_EMAIL_DELIVERY_MODE"],
        message: "Fixture email delivery is forbidden in alpha and production",
      });
    }

    if (
      environment.IDENTITY_EMAIL_DELIVERY_MODE === "fixture" &&
      environment.IDENTITY_FIXTURE_VERIFICATION_CODE === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["IDENTITY_FIXTURE_VERIFICATION_CODE"],
        message: "IDENTITY_FIXTURE_VERIFICATION_CODE is required for fixture delivery",
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
    enableLocalMvp: z.boolean(),
    resumeReviewV2WriteEnabled: z.boolean().optional(),
    resumeEncryptionKey: EncryptionKeySchema,
    resumeMaxBytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
    resumeParser: z
      .object({
        mode: z.enum(["process", "container"]),
        containerImage: z.string().min(1).optional(),
      })
      .optional(),
    ai: z.object({
      enabled: z.boolean(),
      baseUrl: HttpsUrlSchema.optional(),
      model: z.string().min(1).optional(),
      apiKey: z.string().min(1).optional(),
      requestTimeoutMs: z.number().int().min(1_000).max(120_000),
    }),
    identity: z.object({
      acceptedOrigins: z.array(HttpOriginSchema),
      // Retained only as a source-compatible empty field for existing test fixtures.
      // Shared invite codes are no longer parsed or used by the identity boundary.
      alphaInviteCodeHashes: z.array(Sha256Schema).default([]),
      masterKey: IdentityMasterKeySchema.optional(),
      invitedEmailHashes: z.array(Sha256Schema).optional(),
      emailDeliveryMode: z.enum(["disabled", "fixture"]).optional(),
      fixtureVerificationCode: z.string().regex(/^\d{6}$/).optional(),
    }),
    workspaceRoot: z.string().min(1),
  })
  .superRefine((config, context) => {
    if (
      (config.enableInternalPreview || config.enableSourceProbe || config.enableLocalMvp) &&
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
  overrideEnvironment?: EnvironmentInput;
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
  const resumeEncryptionKey =
    parsed.RESUME_ENCRYPTION_KEY ??
    (localCapabilitiesDefault ? loadOrCreateLocalEncryptionKey(rootDirectory) : undefined);

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
    enableLocalMvp:
      environment.ENABLE_LOCAL_MVP === undefined
        ? localCapabilitiesDefault
        : parsed.ENABLE_LOCAL_MVP,
    // Remote environments remain closed by default until their compatible reader/worker rollout Gate.
    resumeReviewV2WriteEnabled:
      parsed.RESUME_REVIEW_V2_WRITE_ENABLED ?? localCapabilitiesDefault,
    resumeEncryptionKey,
    resumeMaxBytes: parsed.RESUME_MAX_BYTES,
    resumeParser: {
      mode:
        parsed.RESUME_PARSER_MODE ?? (localCapabilitiesDefault ? "process" : "container"),
      ...(parsed.RESUME_PARSER_CONTAINER_IMAGE
        ? { containerImage: parsed.RESUME_PARSER_CONTAINER_IMAGE }
        : {}),
    },
    ai: {
      enabled: parsed.ENABLE_AI,
      baseUrl: parsed.AI_BASE_URL,
      model: parsed.AI_MODEL,
      apiKey: parsed.AI_API_KEY,
      requestTimeoutMs: parsed.AI_REQUEST_TIMEOUT_MS,
    },
    identity: {
      acceptedOrigins: parsed.ACCEPTED_ORIGINS,
      alphaInviteCodeHashes: [],
      masterKey:
        parsed.IDENTITY_MASTER_KEY ??
        (localCapabilitiesDefault && resumeEncryptionKey
          ? createHash("sha256")
              .update(`aijob:identity-master-v1:${resumeEncryptionKey}`, "utf8")
              .digest("hex")
          : undefined),
      invitedEmailHashes: parsed.ALPHA_INVITED_EMAIL_HASHES,
      emailDeliveryMode: parsed.IDENTITY_EMAIL_DELIVERY_MODE,
      fixtureVerificationCode: parsed.IDENTITY_FIXTURE_VERIFICATION_CODE,
    },
    workspaceRoot: rootDirectory,
  });

  return Object.freeze(config);
};

export const loadAppConfig = (options: LoadAppConfigOptions = {}): AppConfig => {
  const rootDirectory = resolve(options.rootDirectory ?? DEFAULT_WORKSPACE_ROOT);
  const envFile = resolve(rootDirectory, options.envFile ?? ".env");
  let fileEnvironment: EnvironmentInput = {};
  try {
    fileEnvironment = parseDotEnv(readFileSync(envFile));
  } catch (error) {
    if (!isFileSystemError(error, "ENOENT")) throw error;
  }

  return parseAppConfig(
    {
      ...fileEnvironment,
      ...process.env,
      ...options.overrideEnvironment,
    },
    { rootDirectory },
  );
};

export const toSafeConfigLog = (
  config: AppConfig,
): Omit<AppConfig, "databaseUrl" | "resumeEncryptionKey" | "ai" | "identity"> & {
  databaseUrl: "[redacted]";
  resumeEncryptionKey: "[redacted]";
  ai: {
    enabled: boolean;
    providerConfigured: boolean;
    requestTimeoutMs: number;
  };
  identity: {
    acceptedOrigins: readonly string[];
    invitedEmailsConfigured: number;
    emailDeliveryMode: "disabled" | "fixture";
  };
} => {
  return {
    ...config,
    databaseUrl: "[redacted]",
    resumeEncryptionKey: "[redacted]",
    ai: {
      enabled: config.ai.enabled,
      providerConfigured: Boolean(config.ai.baseUrl && config.ai.model && config.ai.apiKey),
      requestTimeoutMs: config.ai.requestTimeoutMs,
    },
    identity: {
      acceptedOrigins: config.identity.acceptedOrigins,
      invitedEmailsConfigured: config.identity.invitedEmailHashes?.length ?? 0,
      emailDeliveryMode: config.identity.emailDeliveryMode ?? "disabled",
    },
  };
};
