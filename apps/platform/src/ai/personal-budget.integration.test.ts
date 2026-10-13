import { randomUUID } from "node:crypto";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { personalBudgetProvider } from "./personal-budget.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("personal AI accounting without personal content", () => {
  const db = createDatabase(url ?? "postgresql://unused"),
    model = `budget-fixture-${randomUUID()}`;
  const config = {
    enabled: true,
    model,
    requestTimeoutMs: 30000,
    budget: { dailyCalls: 10000, dailyTokens: 10000000, concurrency: 1, maxOutputTokens: 256 },
  };
  const schema = z.object({ text: z.string() }),
    request = {
      systemInstruction: "Return confirmed text",
      untrustedPayload: { text: "个人夹具，不得写入调用账本" },
      schema,
    };
  beforeAll(() => migrateToLatest(db), 60000);
  afterAll(async () => {
    await sql`DELETE FROM matching.personal_ai_calls WHERE model_key=${model}`.execute(db);
    await db.destroy();
  });
  it("never constructs a personal provider from operator credentials", async () => {
    let calls = 0;
    const instance = personalBudgetProvider({
      db,
      config: { ...config, baseUrl: "https://operator.example/v1", apiKey: "operator-only-key" },
      purpose: "resume_review",
      version: "fixture",
      fetchImpl: async () => {
        calls++;
        throw new Error("must not call");
      },
    });
    await expect(instance.completeStructured(request)).rejects.toMatchObject({
      code: "AI_ACCOUNT_CONNECTION_REQUIRED",
    });
    expect(calls).toBe(0);
  });
  it("fails closed without budget and records failed calls without prompts or owner identifiers", async () => {
    let calls = 0;
    const provider = {
      completeStructured: async () => {
        calls++;
        throw new Error("provider failure containing private input");
      },
    };
    const disabled = personalBudgetProvider({
      db,
      config: { ...config, budget: { ...config.budget, dailyCalls: 0 } },
      purpose: "resume_review",
      version: "fixture-v1",
      provider,
    });
    await expect(disabled.completeStructured(request)).rejects.toMatchObject({
      code: "AI_BUDGET_DISABLED",
    });
    expect(calls).toBe(0);
    const enabled = personalBudgetProvider({
      db,
      config,
      purpose: "resume_review",
      version: "fixture-v1",
      provider,
    });
    await expect(enabled.completeStructured(request)).rejects.toThrow("provider failure");
    const rows = await sql<
      Record<string, unknown>
    >`SELECT * FROM matching.personal_ai_calls WHERE model_key=${model}`.execute(db);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ status: "failed", error_code: "GENERATION_FAILED" });
    expect(JSON.stringify(rows.rows)).not.toContain("个人夹具");
    expect(rows.rows[0]).not.toHaveProperty("owner_id");
    const total = await sql<{
      calls: number;
    }>`SELECT count(*)::int AS calls FROM matching.personal_ai_calls WHERE created_at>=now()-interval '24 hours'`.execute(
      db,
    );
    await expect(
      personalBudgetProvider({
        db,
        config: { ...config, budget: { ...config.budget, dailyCalls: total.rows[0]?.calls ?? 1 } },
        purpose: "resume_review",
        version: "fixture-v1",
        provider,
      }).completeStructured(request),
    ).rejects.toMatchObject({ code: "AI_BUDGET_EXHAUSTED" });
  });
  it("reserves concurrency across workers and caps output tokens", async () => {
    let release: () => void = () => {},
      started: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
        release = resolve;
      }),
      begin = new Promise<void>((resolve) => {
        started = resolve;
      });
    let outputTokens = 0;
    const provider: Parameters<typeof personalBudgetProvider>[0]["provider"] = {
      completeStructured: async (input) => {
        outputTokens = input.maxOutputTokens ?? 0;
        started();
        await wait;
        return input.schema.parse({ text: "已确认内容" });
      },
    };
    const instance = personalBudgetProvider({
      db,
      config,
      purpose: "resume_tailoring",
      version: "fixture-v1",
      provider,
    });
    const first = instance.completeStructured({ ...request, maxOutputTokens: 4096 });
    await begin;
    try {
      await expect(instance.completeStructured(request)).rejects.toMatchObject({
        code: "AI_CONCURRENCY_LIMIT",
      });
    } finally {
      release();
      await first;
    }
    expect(outputTokens).toBe(256);
  });
});
