import { randomUUID } from "node:crypto";
import { parseAppConfig } from "@aijob/config";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveUserAiSettings, userAiSettings } from "../ai/user-ai-service.js";
import { createAnonymousSession } from "../identity/session-repository.js";
import { saveSearch } from "../planner/service.js";
import { runOneOwnerTask } from "../workers/owner-task-worker.js";
import {
  deleteUserDiscoverySettings,
  saveUserDiscoverySettings,
  userDiscoverySettings,
} from "./user-discovery-settings.js";
import { queueUserDiscoveryTest, scheduleUserDiscovery } from "./user-discovery-worker.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("personal search task and permissions", () => {
  const db = createDatabase(url ?? "postgresql://unused"),
    config = parseAppConfig({
      APP_ENV: "test",
      DATABASE_URL: url ?? "postgresql://unused",
      RESUME_ENCRYPTION_KEY: "a".repeat(64),
      LOG_LEVEL: "silent",
    });
  const owner = async () => (await createAnonymousSession({ db })).context;
  const aiSettings = {
    expectedRevision: 0,
    baseUrl: "https://model.example/v1",
    model: "fixture-model",
    apiKey: "fixture-secret",
    dailyCalls: 2,
  };
  const result = () =>
    Response.json({
      output: [
        {
          type: "web_search_call",
          status: "completed",
          action: { sources: [{ url: "https://careers.example.com/jobs", title: "企业招聘" }] },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
  const work = (ownerId: string, fetchImpl: typeof fetch = async () => result()) =>
    runOneOwnerTask({
      db,
      config,
      taskTypes: ["user_source_discovery"],
      ownerIds: [ownerId],
      fetchImpl,
    });
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  it("keeps collector away from private settings, and match away from source enabling", async () => {
    const grants = (
      await sql<{
        collector: boolean;
        matchWrite: boolean;
        submit: boolean;
      }>`SELECT has_table_privilege('aijob_collector_worker','profile.discovery_settings','SELECT') AS collector,
      has_table_privilege('aijob_match_worker','source_control.discovery_leads','UPDATE') AS "matchWrite",
      has_function_privilege('aijob_match_worker','source_control.submit_user_discovery_lead(uuid,bigint,text,text,text,text,text,text)','EXECUTE') AS submit`.execute(
        db,
      )
    ).rows[0];
    expect(grants).toEqual({ collector: false, matchWrite: false, submit: true });
    await db.connection().execute(async (connection) => {
      await sql`SET ROLE aijob_collector_worker`.execute(connection);
      try {
        await expect(
          sql`SELECT ciphertext FROM profile.discovery_settings`.execute(connection),
        ).rejects.toThrow();
      } finally {
        await sql`RESET ROLE`.execute(connection);
      }
    });
  });
  it("shares the owner's AI budget, saves source-only cache, reuses it for a subscription, and isolates another owner", async () => {
    const a = await owner(),
      b = await owner();
    await saveUserAiSettings(db, a, config, aiSettings);
    await saveSearch({
      db,
      owner: a,
      idempotencyKey: randomUUID(),
      request: {
        label: "产品实习",
        scope: { cities: [], recruitmentTypes: [], educationLevels: [] },
        catalogQuery: { keyword: "产品实习", cities: ["上海", "杭州"] },
        subscription: {
          discoveryEnabled: true,
          digestEnabled: false,
          digestTime: "09:00",
          timezone: "Asia/Shanghai",
        },
      },
    });
    const saved = await saveUserDiscoverySettings(db, a, config, {
      expectedRevision: 0,
      mode: "ai_connection",
    });
    expect(JSON.stringify(saved)).not.toContain("fixture-secret");
    await queueUserDiscoveryTest(db, a, 1, randomUUID());
    await work(a.ownerId);
    expect((await userDiscoverySettings(db, a, config)).settings).toMatchObject({
      capability: "ready",
    });
    expect((await userAiSettings(db, a)).usage.calls).toBe(1);
    await scheduleUserDiscovery(db);
    await work(a.ownerId, async () => {
      throw new Error("cache should avoid second request");
    });
    expect((await userAiSettings(db, a)).usage.calls).toBe(1);
    expect((await userDiscoverySettings(db, b, config)).settings).toBeNull();
    expect((await userDiscoverySettings(db, b, config)).usage.dailyUsed).toBe(0);
    const cache = (
      await sql<{
        leads: unknown;
      }>`SELECT leads FROM profile.discovery_cache WHERE owner_id=${a.ownerId}`.execute(db)
    ).rows[0]!;
    expect(cache.leads).toEqual([{ url: "https://careers.example.com/jobs", title: "企业招聘" }]);
    const demand = (
      await sql<{
        enabled: boolean;
      }>`SELECT q.enabled FROM source_control.discovery_queries q JOIN application.saved_searches s ON s.discovery_query_hash=q.query_hash WHERE s.owner_id=${a.ownerId}`.execute(
        db,
      )
    ).rows[0];
    expect(demand?.enabled).toBe(false);
  });
  it("rejects revision conflicts, invalidates AI changes, and drops late results without changing new settings", async () => {
    const a = await owner();
    await saveUserAiSettings(db, a, config, aiSettings);
    await saveUserDiscoverySettings(db, a, config, { expectedRevision: 0, mode: "ai_connection" });
    await expect(
      saveUserDiscoverySettings(db, a, config, { expectedRevision: 0, mode: "existing_sources" }),
    ).rejects.toMatchObject({ code: "SEARCH_SETTINGS_CONFLICT" });
    await queueUserDiscoveryTest(db, a, 1, randomUUID());
    await work(a.ownerId, async () => {
      await saveUserDiscoverySettings(db, a, config, {
        expectedRevision: 1,
        mode: "existing_sources",
      });
      return result();
    });
    expect((await userDiscoverySettings(db, a, config)).settings).toMatchObject({
      revision: 2,
      mode: "existing_sources",
      capability: "ready",
      lastSearchAt: null,
    });
    expect(
      (await sql`SELECT * FROM profile.discovery_cache WHERE owner_id=${a.ownerId}`.execute(db))
        .rows,
    ).toHaveLength(0);
    await saveUserDiscoverySettings(db, a, config, { expectedRevision: 2, mode: "ai_connection" });
    await queueUserDiscoveryTest(db, a, 3, randomUUID());
    await saveUserAiSettings(db, a, config, {
      ...aiSettings,
      expectedRevision: 1,
      model: "new-model",
    });
    await work(a.ownerId, async () => {
      throw new Error("stale settings must not call provider");
    });
    expect((await userDiscoverySettings(db, a, config)).settings?.capability).toBe("unchecked");
    expect((await userAiSettings(db, a)).usage.calls).toBe(1);
  });
  it("encrypts a separate search Key and removes it without reviving old global search", async () => {
    const a = await owner();
    await saveUserDiscoverySettings(db, a, config, {
      expectedRevision: 0,
      mode: "tavily",
      apiKey: "fixture-tavily",
    });
    const row = (
      await sql<{
        ciphertext: Buffer;
      }>`SELECT ciphertext FROM profile.discovery_settings WHERE owner_id=${a.ownerId}`.execute(db)
    ).rows[0]!;
    expect(row.ciphertext.toString()).not.toContain("fixture-tavily");
    await deleteUserDiscoverySettings(db, a, 1);
    const state = await userDiscoverySettings(db, a, config);
    expect(state.settings).toMatchObject({ mode: "existing_sources", keyConfigured: false });
    expect(
      (
        await sql<{
          ciphertext: Buffer | null;
        }>`SELECT ciphertext FROM profile.discovery_settings WHERE owner_id=${a.ownerId}`.execute(
          db,
        )
      ).rows[0]!.ciphertext,
    ).toBeNull();
  });
});
