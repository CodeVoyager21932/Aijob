import { randomUUID } from "node:crypto";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { OpenAiCompatibleProvider } from "./provider.js";
import { runPublicExtraction } from "./public-extraction.js";
const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("public extraction cache and budget in PostgreSQL", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  const modelKey = `fixture-ai-${randomUUID()}`;
  const schema = z.object({ quote: z.string() }).strict();
  const base = {
    db,
    modelKey,
    purpose: "job_semantics" as const,
    extractionVersion: "fixture-v1",
    schema,
    systemInstruction: "Return only supported quoted text",
    fallback: { quote: "规则依据" },
    budget: { dailyCalls: 100, dailyTokens: 1_000_000, concurrency: 1, maxOutputTokens: 256 },
  };
  beforeAll(async () => {
    await migrateToLatest(db);
  }, 60000);
  afterAll(async () => {
    await sql`DELETE FROM source_control.public_ai_cache WHERE call_id IN (SELECT id FROM source_control.public_ai_calls WHERE model_key = ${modelKey})`.execute(
      db,
    );
    await sql`DELETE FROM source_control.public_ai_calls WHERE model_key = ${modelKey}`.execute(db);
    await db.destroy();
  });
  it("reuses a completed extraction by content and extraction version", async () => {
    let calls = 0;
    const provider: Pick<OpenAiCompatibleProvider, "completeStructured"> = {
      completeStructured: async (input) => {
        calls++;
        return input.schema.parse({ quote: "官方原句" });
      },
    };
    const request = { ...base, provider, publicContent: { sourceText: "官方原句" } };
    expect((await runPublicExtraction(request)).mode).toBe("ai");
    expect((await runPublicExtraction(request)).mode).toBe("cache");
    expect(calls).toBe(1);
  });
  it("refuses invented evidence and counts failed calls in the budget", async () => {
    const provider: Pick<OpenAiCompatibleProvider, "completeStructured"> = {
      completeStructured: async (input) => input.schema.parse({ quote: "模型补写的原句" }),
    };
    const result = await runPublicExtraction({
      ...base,
      provider,
      publicContent: { sourceText: "另一条官方原句" },
      validate: (value) => {
        if (value.quote !== "另一条官方原句") throw new Error("QUOTE_NOT_IN_SOURCE");
      },
    });
    expect(result).toMatchObject({
      mode: "rules",
      reason: "EXTRACTION_FAILED",
      value: base.fallback,
    });
    const { rows } = await sql<{
      count: number;
    }>`SELECT count(*)::int AS count FROM source_control.public_ai_calls WHERE created_at > now() - interval '24 hours'`.execute(
      db,
    );
    expect(
      (
        await runPublicExtraction({
          ...base,
          provider,
          publicContent: { sourceText: "预算外请求" },
          budget: { ...base.budget, dailyCalls: rows[0]?.count ?? 1 },
        })
      ).reason,
    ).toBe("AI_BUDGET_EXHAUSTED");
  });
  it("reserves concurrency atomically without holding a transaction during the model call", async () => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: Pick<OpenAiCompatibleProvider, "completeStructured"> = {
      completeStructured: async (input) => {
        entered?.();
        await gate;
        return input.schema.parse({ quote: "并行夹具" });
      },
    };
    const first = runPublicExtraction({
      ...base,
      provider,
      publicContent: { sourceText: "并行一" },
    });
    await started;
    try {
      expect(
        (await runPublicExtraction({ ...base, provider, publicContent: { sourceText: "并行二" } }))
          .reason,
      ).toBe("AI_CONCURRENCY_LIMIT");
    } finally {
      release?.();
      await first;
    }
  });
});
