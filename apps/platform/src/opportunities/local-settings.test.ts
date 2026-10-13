import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOpportunitySettings, saveOpportunitySettings } from "./local-settings.js";
import { buildOperationsConsole } from "../sources/operations-console.js";
import { parseAppConfig } from "@aijob/config";
import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";

const roots: string[] = [];
function config() {
  const root = mkdtempSync(join(tmpdir(), "aijob-discovery-settings-"));
  roots.push(root);
  return {
    ...parseAppConfig({
      APP_ENV: "local",
      ENABLE_SOURCE_PROBE: "false",
      RESUME_ENCRYPTION_KEY: "a".repeat(64),
    }),
    workspaceRoot: root,
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("local discovery setup", () => {
  it("stores only encrypted credentials and reloads toggles without losing the key", () => {
    const runtime = config();
    saveOpportunitySettings(runtime, { enabled: true, apiKey: "fixture-secret-for-search" });
    expect(
      readFileSync(join(runtime.workspaceRoot, ".data/opportunity-discovery.local.json"), "utf8"),
    ).not.toContain("fixture-secret-for-search");
    expect(readOpportunitySettings(runtime)).toMatchObject({
      enabled: true,
      apiKey: "fixture-secret-for-search",
      sourceNetworkEnabled: false,
    });
    saveOpportunitySettings(runtime, { enabled: false, sourceNetworkEnabled: true });
    expect(readOpportunitySettings({ ...runtime })).toMatchObject({
      enabled: false,
      apiKey: "fixture-secret-for-search",
      sourceNetworkEnabled: true,
    });
  });
  it("requires credentials to enable and leaves remote environments under deployment configuration", () => {
    const runtime = config();
    expect(() => saveOpportunitySettings(runtime, { enabled: true })).toThrow("API Key");
    const remote = { ...runtime, appEnv: "production" as const };
    expect(() => saveOpportunitySettings(remote, { enabled: false })).toThrow("仅限本机");
  });
  it("keeps setup writes behind the existing loopback operator boundary and never returns the key", async () => {
    const runtime = config();
    // This setup route only writes the local encrypted config; it must not query or mutate PG.
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error("UNEXPECTED_DATABASE_ACCESS");
        },
      },
    ) as Kysely<Database>;
    const app = buildOperationsConsole({ db, config: runtime, port: 8092 });
    try {
      const page = await app.inject({
        method: "GET",
        url: "/discovery-setup",
        headers: { host: "127.0.0.1:8092" },
      });
      const token = /<script nonce="([a-f0-9]+)"/.exec(page.body)?.[1];
      expect(token).toBeTruthy();
      const rejected = await app.inject({
        method: "POST",
        url: "/api/discovery/settings",
        headers: { host: "127.0.0.1:8092", origin: "http://another-host" },
        payload: { enabled: true, apiKey: "fixture-secret" },
      });
      expect(rejected.statusCode).toBe(403);
      const saved = await app.inject({
        method: "POST",
        url: "/api/discovery/settings",
        headers: {
          host: "127.0.0.1:8092",
          origin: "http://127.0.0.1:8092",
          "x-aijob-ops": token ?? "",
        },
        payload: { enabled: true, apiKey: "fixture-secret" },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toEqual({ configured: true, enabled: true });
      expect(saved.body).not.toContain("fixture-secret");
    } finally {
      await app.close();
    }
  });
});
