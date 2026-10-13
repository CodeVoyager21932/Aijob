import type { Database } from "@aijob/database";
import { sql, type Transaction } from "kysely";
import type { OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";

/** Must run in the same transaction as the caller's task/budget reservation. */
export async function reserveUserAiUsage(
  tx: Transaction<Database>,
  input: {
    owner: OwnerScope;
    connectionId: string;
    revision: number;
    tokens: number;
    purpose: string;
    id: string;
  },
) {
  const { owner } = input;
  const row = (
    await sql<{
      id: string;
      revision: number;
      settings: {
        enabled: boolean;
        model: string;
        concurrency: number;
        dailyCalls: number;
        dailyTokens: number;
      };
    }>`SELECT id,revision,settings FROM profile.ai_connections WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} FOR UPDATE`.execute(
      tx,
    )
  ).rows[0];
  if (
    !row ||
    !row.settings.enabled ||
    row.id !== input.connectionId ||
    row.revision !== input.revision
  )
    throw new ServiceError(409, "AI_CONNECTION_CHANGED", "AI 配置已改变，请重新检查连接。");
  const usage = (
    await sql<{
      calls: number;
      tokens: number;
      running: number;
    }>`SELECT count(*)::int AS calls,COALESCE(sum(reserved_tokens),0)::float8 AS tokens,count(*) FILTER(WHERE status='running' AND lease_until>now())::int AS running FROM profile.ai_usage WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND created_at>=now()-interval '24 hours'`.execute(
      tx,
    )
  ).rows[0]!;
  if (usage.running >= row.settings.concurrency)
    throw new ServiceError(429, "AI_CONCURRENCY_LIMIT", "其他 AI 任务正在处理，稍后重试。");
  if (
    usage.calls >= row.settings.dailyCalls ||
    usage.tokens + input.tokens > row.settings.dailyTokens
  )
    throw new ServiceError(429, "AI_BUDGET_EXHAUSTED", "已达到你设置的 AI 用量限制。");
  await sql`INSERT INTO profile.ai_usage(id,owner_id,owner_epoch,connection_revision,purpose,model,reserved_tokens,status,lease_until) VALUES(${input.id}::uuid,${owner.ownerId}::uuid,${owner.ownerEpoch},${row.revision},${input.purpose},${row.settings.model},${input.tokens},'running',now()+interval '3 minutes')`.execute(
    tx,
  );
}
