import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isLoopbackHost, parseAppConfig, toSafeConfigLog } from "./index.js";

const explicitTestKey = "ab".repeat(32);

describe("internal capability network boundary", () => {
  it.each(["127.0.0.1", "127.0.0.42", "::1", "0:0:0:0:0:0:0:1"])(
    "accepts numeric loopback host %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
      expect(() => parseAppConfig({ APP_ENV: "local", HOST: host })).not.toThrow();
    },
  );

  it.each(["0.0.0.0", "192.168.1.20", "localhost", "::"])(
    "rejects non-literal-loopback host %s when local capabilities default on",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
      expect(() => parseAppConfig({ APP_ENV: "local", HOST: host })).toThrow(
        /HOST must be a numeric loopback address/,
      );
    },
  );

  it("allows an external bind only when preview and probing are both disabled", () => {
    const config = parseAppConfig({
      APP_ENV: "local",
      HOST: "0.0.0.0",
      ENABLE_INTERNAL_PREVIEW: "false",
      ENABLE_SOURCE_PROBE: "false",
      ENABLE_LOCAL_MVP: "false",
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.enableInternalPreview).toBe(false);
    expect(config.enableSourceProbe).toBe(false);
  });

  it("rejects an external bind when either capability is explicitly enabled", () => {
    expect(() =>
      parseAppConfig({
        APP_ENV: "local",
        HOST: "0.0.0.0",
        ENABLE_INTERNAL_PREVIEW: "true",
        ENABLE_SOURCE_PROBE: "false",
        ENABLE_LOCAL_MVP: "false",
      }),
    ).toThrow(/HOST must be a numeric loopback address/);

    expect(() =>
      parseAppConfig({
        APP_ENV: "local",
        HOST: "0.0.0.0",
        ENABLE_INTERNAL_PREVIEW: "false",
        ENABLE_SOURCE_PROBE: "true",
        ENABLE_LOCAL_MVP: "false",
      }),
    ).toThrow(/HOST must be a numeric loopback address/);
  });

  it("keeps AI disabled without a provider and requires a complete provider when enabled", () => {
    const disabled = parseAppConfig({ APP_ENV: "local" });
    expect(disabled.ai.enabled).toBe(false);
    expect(disabled.ai.apiKey).toBeUndefined();

    expect(() =>
      parseAppConfig({
        APP_ENV: "local",
        ENABLE_AI: "true",
        AI_BASE_URL: "https://api.example.test/v1",
        AI_MODEL: "example-model",
      }),
    ).toThrow(/AI_BASE_URL, AI_MODEL and AI_API_KEY/);

    const enabled = parseAppConfig({
      APP_ENV: "local",
      ENABLE_AI: "true",
      AI_BASE_URL: "https://api.example.test/v1",
      AI_MODEL: "example-model",
      AI_API_KEY: "secret",
    });
    expect(enabled.ai).toMatchObject({
      enabled: true,
      baseUrl: "https://api.example.test/v1",
      model: "example-model",
    });
  });

  it.each(["alpha", "production"] as const)(
    "requires an explicit encryption key in %s",
    (appEnv) => {
      expect(() =>
        parseAppConfig({
          APP_ENV: appEnv,
          DATABASE_URL: "postgresql://aijob:aijob@db.example.test:5432/aijob",
        }),
      ).toThrow(/RESUME_ENCRYPTION_KEY is required/);

      expect(
        parseAppConfig({
          APP_ENV: appEnv,
          DATABASE_URL: "postgresql://aijob:aijob@db.example.test:5432/aijob",
          RESUME_ENCRYPTION_KEY: explicitTestKey,
        }).resumeEncryptionKey,
      ).toBe(explicitTestKey);
    },
  );

  it("creates and reuses one random workspace-local encryption key", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "aijob-config-"));
    const independentRootDirectory = mkdtempSync(join(tmpdir(), "aijob-config-"));
    try {
      const first = parseAppConfig({ APP_ENV: "local" }, { rootDirectory });
      const keyPath = join(rootDirectory, ".data", "resume-encryption.key");
      const persisted = readFileSync(keyPath, "utf8");
      const second = parseAppConfig({ APP_ENV: "local" }, { rootDirectory });
      const independent = parseAppConfig(
        { APP_ENV: "local" },
        { rootDirectory: independentRootDirectory },
      );

      expect(first.resumeEncryptionKey).toMatch(/^[a-f0-9]{64}$/);
      expect(persisted).toBe(first.resumeEncryptionKey);
      expect(second.resumeEncryptionKey).toBe(first.resumeEncryptionKey);
      expect(independent.resumeEncryptionKey).not.toBe(first.resumeEncryptionKey);
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
      rmSync(independentRootDirectory, { recursive: true, force: true });
    }
  });

  it("accepts an explicit fixed key for isolated test environments", () => {
    const config = parseAppConfig({
      APP_ENV: "test",
      RESUME_ENCRYPTION_KEY: explicitTestKey,
    });
    expect(config.resumeEncryptionKey).toBe(explicitTestKey);
  });

  it("redacts encryption and AI secrets from startup logs", () => {
    const config = parseAppConfig({
      APP_ENV: "test",
      RESUME_ENCRYPTION_KEY: explicitTestKey,
      ENABLE_AI: "true",
      AI_BASE_URL: "https://api.example.test/v1",
      AI_MODEL: "example-model",
      AI_API_KEY: "provider-secret",
    });
    const logged = JSON.stringify(toSafeConfigLog(config));
    expect(logged).not.toContain(explicitTestKey);
    expect(logged).not.toContain("provider-secret");
    expect(logged).toContain("[redacted]");
  });
});
