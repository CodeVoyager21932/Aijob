import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { shanghaiDateKey } from "../catalog/effective-activity.js";

export const DISCOVERY_DAILY_LIMIT = 20;
export const DISCOVERY_MONTHLY_LIMIT = 500;
const DAY_MS = 86_400_000;
export function discoveryConfig(environment: NodeJS.ProcessEnv = process.env) {
  return {
    apiKey: environment.TAVILY_API_KEY?.trim() ?? "",
    enabled: environment.OPPORTUNITY_DISCOVERY_ENABLED === "true",
  };
}
export function normalizeLeadUrl(value: string): string | null {
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      (u.port && u.port !== "443") ||
      isIP(u.hostname) ||
      !u.hostname.includes(".") ||
      u.hostname.endsWith(".localhost") ||
      u.hostname.endsWith(".local")
    )
      return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (/^(utm_|gclid|fbclid)/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    return u.toString();
  } catch {
    return null;
  }
}
export async function reserveDiscoveryBudget(
  db: Kysely<Database>,
  now = new Date(),
): Promise<boolean> {
  const day = shanghaiDateKey(now),
    month = day.slice(0, 7);
  return db.transaction().execute(async (tx) => {
    // One transaction reserves both buckets. Uncertain requests are never refunded.
    for (const [bucket, maximum] of [
      [`tavily:day:${day}`, 20],
      [`tavily:month:${month}`, 500],
    ] as const)
      await sql`INSERT INTO source_control.discovery_budget_buckets(bucket,maximum) VALUES(${bucket},${maximum}) ON CONFLICT DO NOTHING`.execute(
        tx,
      );
    const rows = await sql<{
      bucket: string;
      used: number;
      maximum: number;
    }>`SELECT * FROM source_control.discovery_budget_buckets WHERE bucket IN (${`tavily:day:${day}`},${`tavily:month:${month}`}) ORDER BY bucket FOR UPDATE`.execute(
      tx,
    );
    if (rows.rows.some((r) => r.used >= r.maximum)) return false;
    await sql`UPDATE source_control.discovery_budget_buckets SET used=used+1 WHERE bucket IN (${`tavily:day:${day}`},${`tavily:month:${month}`})`.execute(
      tx,
    );
    return true;
  });
}
export async function getDiscoveryStatus(
  db: Kysely<Database>,
  now = new Date(),
  config = discoveryConfig(),
) {
  const day = shanghaiDateKey(now);
  const result = await sql<{
    bucket: string;
    used: number;
  }>`SELECT bucket,used FROM source_control.discovery_budget_buckets WHERE bucket IN (${`tavily:day:${day}`},${`tavily:month:${day.slice(0, 7)}`})`.execute(
    db,
  );
  return {
    provider: "tavily" as const,
    configured: !!config.apiKey,
    enabled: config.enabled,
    dailyUsed: result.rows.find((r) => r.bucket.includes(":day:"))?.used ?? 0,
    dailyLimit: 20 as const,
    monthlyUsed: result.rows.find((r) => r.bucket.includes(":month:"))?.used ?? 0,
    monthlyLimit: 500 as const,
    notice:
      !config.enabled || !config.apiKey
        ? "新来源发现尚未配置；已准入来源的岗位更新与每日摘要仍可使用。"
        : "新企业先进入内部核验，准入后自动刷新。运行期间执行计划，关机后启动补跑。",
  };
}
export async function searchTavily(input: {
  query: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) {
  const response = await (input.fetchImpl ?? fetch)("https://api.tavily.com/search", {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({
      query: input.query,
      search_depth: "basic",
      max_results: 10,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      auto_parameters: false,
    }),
    signal: input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "DISCOVERY_RATE_LIMITED"
        : response.status === 401 || response.status === 403
          ? "DISCOVERY_AUTH_REQUIRED"
          : "DISCOVERY_PROVIDER_FAILED",
    );
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("DISCOVERY_RESPONSE_TOO_LARGE");
  const body: unknown = JSON.parse(text);
  if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray(body.results))
    throw new Error("DISCOVERY_RESPONSE_INVALID");
  const leads = new Map<string, { url: string; title: string }>();
  for (const item of body.results.slice(0, 10)) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.url !== "string" ||
      typeof item.title !== "string"
    )
      continue;
    const url = normalizeLeadUrl(item.url);
    if (url) leads.set(url, { url, title: item.title.slice(0, 300) });
  }
  return [...leads.values()];
}
/** Collector-only, ownerless PG task. No result URL is fetched here. */
export async function runDiscoveryCycle(input: {
  db: Kysely<Database>;
  now?: Date;
  fetchImpl?: typeof fetch;
  config?: ReturnType<typeof discoveryConfig>;
  signal?: AbortSignal;
  queryHash?: string;
}) {
  const config = input.config ?? discoveryConfig(),
    now = input.now ?? new Date();
  if (!config.enabled || !config.apiKey || input.signal?.aborted) return false;
  const cooling = (
    await sql`SELECT 1 FROM source_control.discovery_queries WHERE last_status IN ('DISCOVERY_AUTH_REQUIRED','DISCOVERY_RATE_LIMITED') AND updated_at>${new Date(now.getTime() - 3600_000)} LIMIT 1`.execute(
      input.db,
    )
  ).rows.length;
  if (cooling) return false;
  const task = await input.db.transaction().execute(async (tx) => {
    await sql`UPDATE task_queue.tasks SET status='dead',lease_owner=NULL,lease_until=NULL,last_error_code='DISCOVERY_ATTEMPTS_EXHAUSTED',completed_at=now() WHERE task_type='source_discovery' AND attempt>=max_attempts AND (status='queued' OR (status='running' AND lease_until<now()))`.execute(
      tx,
    );
    const due = (
      await sql<{
        query_hash: string;
        query_text: string;
        next_due_at: Date;
      }>`SELECT q.* FROM source_control.discovery_queries q WHERE q.enabled AND ${input.queryHash ? sql`q.query_hash=${input.queryHash}` : sql`true`} AND q.next_due_at<=${now} AND (q.last_success_at IS NULL OR q.last_success_at<=${new Date(now.getTime() - DAY_MS)}) ORDER BY q.next_due_at,q.query_hash FOR UPDATE SKIP LOCKED LIMIT 1`.execute(
        tx,
      )
    ).rows[0];
    if (due) {
      await sql`INSERT INTO task_queue.tasks(task_type,idempotency_key,status,backoff_policy,payload,max_attempts) VALUES('source_discovery',${`discovery:${due.query_hash}:${new Date(due.next_due_at).toISOString()}`},'queued','{}',${JSON.stringify({ queryHash: due.query_hash, query: due.query_text })}::jsonb,3) ON CONFLICT(idempotency_key) DO NOTHING`.execute(
        tx,
      );
      await sql`UPDATE source_control.discovery_queries SET next_due_at=${new Date(now.getTime() + DAY_MS)} WHERE query_hash=${due.query_hash}`.execute(
        tx,
      );
    }
    const row = (
      await sql<{
        id: string;
        payload: { queryHash: string; query: string };
        fencing_token: string;
        attempt: number;
      }>`SELECT t.id,t.payload,t.fencing_token,t.attempt FROM task_queue.tasks t JOIN source_control.discovery_queries q ON q.query_hash=t.payload->>'queryHash' WHERE q.enabled AND ${input.queryHash ? sql`q.query_hash=${input.queryHash}` : sql`true`} AND (q.last_success_at IS NULL OR q.last_success_at<=${new Date(now.getTime() - DAY_MS)}) AND t.task_type='source_discovery' AND t.attempt<t.max_attempts AND ((t.status='queued' AND t.available_at<=${now}) OR (t.status='running' AND t.lease_until<${now})) ORDER BY t.available_at FOR UPDATE OF t SKIP LOCKED LIMIT 1`.execute(
        tx,
      )
    ).rows[0];
    if (!row) return null;
    const worker = `discovery-${randomUUID()}`;
    await sql`UPDATE task_queue.tasks SET status='running',attempt=attempt+1,lease_owner=${worker},lease_until=now()+interval '60 seconds',heartbeat_at=now(),fencing_token=fencing_token+1 WHERE id=${row.id}::uuid`.execute(
      tx,
    );
    return { ...row, worker, fencing: Number(row.fencing_token) + 1 };
  });
  if (!task) return false;
  let code: string | null = null;
  let leads: Awaited<ReturnType<typeof searchTavily>> = [];
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    void sql`UPDATE task_queue.tasks SET heartbeat_at=now(),lease_until=now()+interval '60 seconds' WHERE id=${task.id}::uuid AND status='running' AND lease_owner=${task.worker} AND fencing_token=${task.fencing} AND lease_until>now() RETURNING id`
      .execute(input.db)
      .then((r) => {
        if (!r.rows.length) controller.abort();
      })
      .catch(() => controller.abort());
  }, 10_000);
  heartbeat.unref();
  try {
    if (!(await reserveDiscoveryBudget(input.db, now)))
      throw new Error("DISCOVERY_BUDGET_EXHAUSTED");
    leads = await searchTavily({
      query: task.payload.query,
      apiKey: config.apiKey,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      signal: input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal,
    });
  } catch (error) {
    code =
      error instanceof Error && /^DISCOVERY_[A-Z_]+$/.test(error.message)
        ? error.message
        : "DISCOVERY_REQUEST_FAILED";
  } finally {
    clearInterval(heartbeat);
  }
  await input.db.transaction().execute(async (tx) => {
    const held = (
      await sql`SELECT id FROM task_queue.tasks WHERE id=${task.id}::uuid AND status='running' AND lease_owner=${task.worker} AND fencing_token=${task.fencing} AND lease_until>now() FOR UPDATE`.execute(
        tx,
      )
    ).rows.length;
    if (!held) return;
    const activeQuery = (
      await sql`SELECT 1 FROM source_control.discovery_queries WHERE query_hash=${task.payload.queryHash} AND enabled`.execute(
        tx,
      )
    ).rows.length;
    if (!activeQuery) {
      await sql`UPDATE task_queue.tasks SET status='cancelled',lease_owner=NULL,lease_until=NULL,completed_at=now(),last_error_code='DISCOVERY_SETTINGS_CHANGED' WHERE id=${task.id}::uuid`.execute(
        tx,
      );
      return;
    }
    if (!code)
      for (const lead of leads)
        await sql`INSERT INTO source_control.discovery_leads(canonical_url,hostname,title,query_hash) VALUES(${lead.url},${new URL(lead.url).hostname},${lead.title},${task.payload.queryHash}) ON CONFLICT(canonical_url) DO UPDATE SET last_seen_at=now(),title=excluded.title`.execute(
          tx,
        );
    const retry = code !== null && code !== "DISCOVERY_AUTH_REQUIRED" && task.attempt + 1 < 3;
    await sql`UPDATE task_queue.tasks SET status=${code ? (retry ? "queued" : "dead") : "succeeded"},lease_owner=NULL,lease_until=NULL,heartbeat_at=now(),available_at=now()+${code === "DISCOVERY_BUDGET_EXHAUSTED" ? "24 hours" : "1 hour"}::interval,last_error_code=${code},completed_at=CASE WHEN ${retry} THEN NULL ELSE now() END WHERE id=${task.id}::uuid`.execute(
      tx,
    );
    await sql`UPDATE source_control.discovery_queries SET last_status=${code ?? "succeeded"},last_success_at=CASE WHEN ${code === null} THEN now() ELSE last_success_at END,updated_at=now() WHERE query_hash=${task.payload.queryHash}`.execute(
      tx,
    );
  });
  return true;
}
