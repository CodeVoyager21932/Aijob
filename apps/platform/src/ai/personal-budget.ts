import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { ServiceError } from "../lib/service-error.js";
import type { OpenAiCompatibleProvider } from "./provider.js";

/** Existing owner-scoped runs retain results. This boundary stores only anonymous accounting. */
export function personalBudgetProvider(input: {
  db: Kysely<Database>;
  config: AppConfig["ai"];
  purpose:
    | "resume_review"
    | "resume_tailoring"
    | "experience"
    | "interview"
    | "job_explanation"
    | "expression";
  version: string;
  provider?: Pick<OpenAiCompatibleProvider, "completeStructured">;
  fetchImpl?: typeof fetch | undefined;
}): Pick<OpenAiCompatibleProvider, "completeStructured"> {
  // Kept for legacy injected fixture accounting. Production personal tasks use userBudgetProvider.
  // Deliberately do not construct a provider from operator credentials here.
  const provider = input.provider;
  return {
    async completeStructured(request) {
      if (!provider)
        throw new ServiceError(
          409,
          "AI_ACCOUNT_CONNECTION_REQUIRED",
          "请在求职助手中使用自己的 API；平台不提供个人模型。",
        );
      const budget = input.config.budget;
      if (!input.config.enabled)
        throw new ServiceError(503, "AI_DISABLED", "AI 尚未启用，使用规则与模板继续。");
      if (!budget?.dailyCalls || !budget.dailyTokens)
        throw new ServiceError(503, "AI_BUDGET_DISABLED", "AI 预算尚未启用，使用规则与模板继续。");
      if (request.signal?.aborted) throw new Error("OWNER_TASK_ABORTED");
      const bytes = Buffer.byteLength(JSON.stringify(request.untrustedPayload));
      if (bytes > 100000)
        throw new ServiceError(422, "AI_INPUT_TOO_LARGE", "材料超过本轮 AI 处理范围，请缩小内容。");
      const outputTokens = Math.min(
        request.maxOutputTokens ?? budget.maxOutputTokens,
        budget.maxOutputTokens,
      );
      const tokens = bytes + Buffer.byteLength(request.systemInstruction) + outputTokens + 1024,
        id = randomUUID();
      await input.db.transaction().execute(async (tx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended('aijob:personal-ai-budget',0))`.execute(
          tx,
        );
        const { rows } = await sql<{ calls: number; tokens: number; active: number }>`
        SELECT count(*)::int AS calls,COALESCE(sum(reserved_tokens),0)::bigint AS tokens,
          count(*) FILTER(WHERE status='running' AND lease_until>now())::int AS active
        FROM matching.personal_ai_calls WHERE created_at>=now()-interval '24 hours'`.execute(tx);
        const usage = rows[0];
        if (!usage) throw new Error("AI_BUDGET_READ_FAILED");
        if (usage.active >= budget.concurrency)
          throw new ServiceError(
            429,
            "AI_CONCURRENCY_LIMIT",
            "AI 正在处理其他材料，本次先使用模板。",
          );
        if (usage.calls >= budget.dailyCalls || Number(usage.tokens) + tokens > budget.dailyTokens)
          throw new ServiceError(429, "AI_BUDGET_EXHAUSTED", "AI 预算已用完，本次使用规则与模板。");
        await sql`INSERT INTO matching.personal_ai_calls(id,purpose,model_key,extraction_version,reserved_tokens,status,lease_until)
        VALUES(${id},${input.purpose},${input.config.model ?? "unconfigured"},${input.version},${tokens},'running',now()+interval '3 minutes')`.execute(
          tx,
        );
        await sql`DELETE FROM matching.personal_ai_calls WHERE id IN(SELECT id FROM matching.personal_ai_calls WHERE created_at<now()-interval '30 days' LIMIT 300)`.execute(
          tx,
        );
      });
      try {
        const result = await provider.completeStructured({
          ...request,
          maxOutputTokens: outputTokens,
        });
        if (request.signal?.aborted) throw new Error("OWNER_TASK_ABORTED");
        const updated =
          await sql`UPDATE matching.personal_ai_calls SET status='completed',completed_at=now() WHERE id=${id} AND status='running' AND lease_until>now() RETURNING id`.execute(
            input.db,
          );
        if (!updated.rows.length) throw new Error("AI_EXECUTION_LEASE_EXPIRED");
        return result;
      } catch (error) {
        await sql`UPDATE matching.personal_ai_calls SET status='failed',error_code='GENERATION_FAILED',completed_at=now() WHERE id=${id}`.execute(
          input.db,
        );
        throw error;
      }
    },
  };
}
