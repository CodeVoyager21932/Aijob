import type { AppConfig } from "@aijob/config";
import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    appEnv: "local",
    databaseUrl: "postgresql://aijob:aijob@127.0.0.1:5432/aijob",
    snapshotDirectory: ".data/job-snapshots",
    host: "127.0.0.1",
    port: 3000,
    probeRequestIntervalMs: 750,
    logLevel: "silent",
    enableInternalPreview: true,
    enableSourceProbe: true,
    enableLocalMvp: true,
    resumeEncryptionKey: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    resumeMaxBytes: 5 * 1024 * 1024,
    ai: {
      enabled: false,
      requestTimeoutMs: 30_000,
    },
    workspaceRoot: ".",
    ...overrides,
  };
}

const unusedDb = {} as Kysely<Database>;

describe("environment route boundary", () => {
  it("registers preview routes in local mode", async () => {
    const app = buildApp({ config: config(), db: unusedDb });
    try {
      expect(app.printRoutes()).toContain("internal-preview/jobs");
    } finally {
      await app.close();
    }
  });

  it("does not register preview routes outside local/test", async () => {
    const app = buildApp({
      config: config({
        appEnv: "alpha",
        enableInternalPreview: false,
        enableSourceProbe: false,
      }),
      db: unusedDb,
    });
    try {
      const response = await app.inject({ method: "GET", url: "/v1/internal-preview/jobs" });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: "ROUTE_NOT_FOUND" });
    } finally {
      await app.close();
    }
  });
});
