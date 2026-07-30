import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AiProviderBaseUrlSchema,
  LOCAL_AI_PROVIDER_CONFIG_RELATIVE_PATH,
  localAiProviderConfigExists,
  readLocalAiProviderConfig,
  saveLocalAiProviderConfig,
} from "./local-provider-config.js";

describe("local backend AI provider config", () => {
  it("stores one Git-ignored backend config and supports replacement", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "aijob-local-ai-config-"));
    try {
      const first = saveLocalAiProviderConfig({
        rootDirectory,
        baseUrl: "https://provider.example/v1",
        model: "example-model",
        apiKey: "local-test-key",
        now: new Date("2026-07-19T00:00:00.000Z"),
      });
      expect(localAiProviderConfigExists(rootDirectory)).toBe(true);
      expect(readLocalAiProviderConfig(rootDirectory)).toEqual(first);
      expect(
        readFileSync(join(rootDirectory, LOCAL_AI_PROVIDER_CONFIG_RELATIVE_PATH), "utf8"),
      ).toContain("local-test-key");

      const replacement = saveLocalAiProviderConfig({
        rootDirectory,
        baseUrl: "https://provider.example/v1",
        model: "replacement-model",
        apiKey: "replacement-test-key",
      });
      expect(replacement.model).toBe("replacement-model");
      expect(readLocalAiProviderConfig(rootDirectory)?.apiKey).toBe("replacement-test-key");
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    "http://provider.example/v1",
    "https://user:password@provider.example/v1",
    "https://provider.example/v1?key=value",
  ])("rejects unsafe provider base URL %s", (value) => {
    expect(() => AiProviderBaseUrlSchema.parse(value)).toThrow();
  });
});
