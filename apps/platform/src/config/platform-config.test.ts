import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { saveLocalAiProviderConfig } from "../ai/local-provider-config.js";
import { databaseUrlForRuntime, loadPlatformConfig } from "./platform-config.js";

describe("platform local AI config source", () => {
  it("loads the backend-only local provider file into the existing AI adapter", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "aijob-platform-config-"));
    try {
      saveLocalAiProviderConfig({
        rootDirectory,
        baseUrl: "https://provider.example/v1",
        model: "example-model",
        apiKey: "local-test-key",
      });
      const config = loadPlatformConfig({ rootDirectory });
      expect(config.ai).toMatchObject({
        enabled: true,
        baseUrl: "https://provider.example/v1",
        model: "example-model",
        apiKey: "local-test-key",
      });
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("selects the local provider atomically instead of mixing partial environment values", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "aijob-platform-config-"));
    try {
      saveLocalAiProviderConfig({
        rootDirectory,
        baseUrl: "https://provider.example/v1",
        model: "example-model",
        apiKey: "local-test-key",
      });
      const config = loadPlatformConfig({
        rootDirectory,
        overrideEnvironment: {
          AI_BASE_URL: "https://other-provider.example/v1",
        },
      });
      expect(config.ai).toMatchObject({
        enabled: true,
        baseUrl: "https://provider.example/v1",
        model: "example-model",
        apiKey: "local-test-key",
      });
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("ignores the local MVP provider outside local and test environments", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "aijob-platform-config-"));
    try {
      saveLocalAiProviderConfig({
        rootDirectory,
        baseUrl: "https://provider.example/v1",
        model: "example-model",
        apiKey: "local-test-key",
      });
      const config = loadPlatformConfig({
        rootDirectory,
        overrideEnvironment: {
          APP_ENV: "production",
          DATABASE_URL: "postgresql://aijob:aijob@db.example.test:5432/aijob",
          RESUME_ENCRYPTION_KEY: "ab".repeat(32),
          ENABLE_INTERNAL_PREVIEW: "false",
          ENABLE_SOURCE_PROBE: "false",
          ENABLE_LOCAL_MVP: "false",
        },
      });
      expect(config.ai.enabled).toBe(false);
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("uses one local database by default but requires a role URL in Alpha", () => {
    const local = loadPlatformConfig({
      overrideEnvironment: { APP_ENV: "test", RESUME_ENCRYPTION_KEY: "ab".repeat(32) },
    });
    expect(databaseUrlForRuntime(local, "webApi", {})).toBe(local.databaseUrl);

    const alpha = { ...local, appEnv: "alpha" as const };
    expect(() => databaseUrlForRuntime(alpha, "webApi", {})).toThrow(
      "DATABASE_RUNTIME_URL_REQUIRED:WEB_API_DATABASE_URL",
    );
    expect(
      databaseUrlForRuntime(alpha, "webApi", {
        WEB_API_DATABASE_URL: "postgresql://web:secret@db.example.test:5432/aijob",
      }),
    ).toBe("postgresql://web:secret@db.example.test:5432/aijob");
  });
});
