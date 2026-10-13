import { randomUUID } from "node:crypto";
import { type Kysely, sql } from "kysely";
import type { Database } from "@aijob/database";
import type { z } from "zod";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import type { OpenAiCompatibleProvider } from "./provider.js";

export interface PublicAiBudget {
  dailyCalls: number;
  dailyTokens: number;
  concurrency: number;
  maxOutputTokens: number;
}
export interface PublicExtractionResult<T> {
  mode: "ai" | "cache" | "rules";
  reason: string | null;
  value: T;
}

/** Public HTML/JD only. Personal profile objects must never enter this shared cache. */
export async function runPublicExtraction<T>(input: {
  db: Kysely<Database>;
  purpose: "source_configuration" | "job_semantics";
  modelKey: string;
  extractionVersion: string;
  publicContent: { sourceText: string };
  schema: z.ZodType<T>;
  systemInstruction: string;
  fallback: T;
  provider?: Pick<OpenAiCompatibleProvider, "completeStructured">;
  budget: PublicAiBudget;
  validate?: (result: T) => void;
}): Promise<PublicExtractionResult<T>> {
  const fallback = (reason: string): PublicExtractionResult<T> => ({
    mode: "rules",
    reason,
    value: input.fallback,
  });
  if (!input.provider || input.budget.dailyCalls <= 0 || input.budget.dailyTokens <= 0)
    return fallback("AI_NOT_CONFIGURED_OR_BUDGET_DISABLED");
  const byteCount = Buffer.byteLength(input.publicContent.sourceText);
  if (byteCount > 100_000) return fallback("PUBLIC_CONTENT_TOO_LARGE");
  const cacheKey = hashCanonicalJson({
    purpose: input.purpose,
    modelKey: input.modelKey,
    extractionVersion: input.extractionVersion,
    publicContent: input.publicContent,
  });
  const cache = await sql<{
    result: unknown;
  }>`SELECT result FROM source_control.public_ai_cache WHERE cache_key = ${cacheKey}`.execute(
    input.db,
  );
  if (cache.rows[0]) {
    const parsed = input.schema.safeParse(cache.rows[0].result);
    if (parsed.success) {
      try {
        input.validate?.(parsed.data);
        return { mode: "cache", reason: null, value: parsed.data };
      } catch {
        /* invalid cache follows the bounded rule path */
      }
    }
    return fallback("CACHED_EXTRACTION_INVALID");
  }
  // One byte per token is deliberately conservative and includes instruction overhead.
  const reservedTokens =
    byteCount + Buffer.byteLength(input.systemInstruction) + input.budget.maxOutputTokens + 1024;
  const callId = randomUUID();
  const reservation = await input.db.transaction().execute(async (transaction) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('aijob:public-ai-budget', 0))`.execute(
      transaction,
    );
    const { rows } = await sql<{
      calls: number;
      tokens: number;
      active: number;
      same: number;
    }>`SELECT count(*)::int AS calls, COALESCE(sum(reserved_tokens), 0)::int AS tokens,
        count(*) FILTER (WHERE status = 'running' AND lease_until > now())::int AS active,
        count(*) FILTER (WHERE status = 'running' AND lease_until > now() AND cache_key = ${cacheKey})::int AS same
       FROM source_control.public_ai_calls WHERE created_at >= now() - interval '24 hours'`.execute(
      transaction,
    );
    const usage = rows[0];
    if (!usage) throw new Error("AI_BUDGET_READ_FAILED");
    if (usage.same > 0) return "EXTRACTION_IN_PROGRESS";
    if (usage.active >= input.budget.concurrency) return "AI_CONCURRENCY_LIMIT";
    if (
      usage.calls >= input.budget.dailyCalls ||
      usage.tokens + reservedTokens > input.budget.dailyTokens
    )
      return "AI_BUDGET_EXHAUSTED";
    await sql`INSERT INTO source_control.public_ai_calls(id, cache_key, purpose, model_key, extraction_version, reserved_tokens, status, lease_until)
      VALUES (${callId}, ${cacheKey}, ${input.purpose}, ${input.modelKey}, ${input.extractionVersion}, ${reservedTokens}, 'running', now() + interval '3 minutes')`.execute(
      transaction,
    );
    return null;
  });
  if (reservation) return fallback(reservation);
  try {
    const value = input.schema.parse(
      await input.provider.completeStructured({
        schema: input.schema,
        systemInstruction: input.systemInstruction,
        untrustedPayload: input.publicContent,
        maxOutputTokens: input.budget.maxOutputTokens,
      }),
    );
    input.validate?.(value);
    await input.db.transaction().execute(async (transaction) => {
      const updated =
        await sql`UPDATE source_control.public_ai_calls SET status = 'completed', completed_at = now()
        WHERE id = ${callId} AND status = 'running' AND lease_until > now() RETURNING id`.execute(
          transaction,
        );
      if (!updated.rows.length) throw new Error("AI_EXECUTION_LEASE_EXPIRED");
      await sql`INSERT INTO source_control.public_ai_cache(cache_key, call_id, result) VALUES (${cacheKey}, ${callId}, ${JSON.stringify(value)}::jsonb)
        ON CONFLICT(cache_key) DO NOTHING`.execute(transaction);
    });
    return { mode: "ai", reason: null, value };
  } catch {
    await sql`UPDATE source_control.public_ai_calls SET status = 'failed', error_code = 'EXTRACTION_FAILED', completed_at = now() WHERE id = ${callId}`.execute(
      input.db,
    );
    return fallback("EXTRACTION_FAILED");
  }
}
