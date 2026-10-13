import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import type { Database } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { z } from "zod";
import { reserveUserAiUsage } from "../ai/user-ai-budget.js";
import { loadUserAiConnection, userAiSettings } from "../ai/user-ai-service.js";
import { shanghaiDateKey } from "../catalog/effective-activity.js";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { type OwnerTaskLease, withOwnerTaskLease } from "../workers/owner-task-lease.js";
import {
  executeSearch,
  SEARCH_ADAPTER_VERSION,
  SearchError,
  type SearchResult,
  selectSearchAdapter,
} from "./search-adapters.js";
import { discoveryQueries, syncDiscoveryDemand } from "./subscriptions.js";
import { discoveryRow, discoverySecret, userDiscoveryUsage } from "./user-discovery-settings.js";

export const UserDiscoveryPayloadSchema = z.object({
  settingsId: z.string().uuid(),
  revision: z.number().int().positive(),
  purpose: z.enum(["test", "discover"]),
  searchId: z.string().uuid().nullable(),
  searchRevision: z.number().int().positive().nullable(),
  connectionId: z.string().uuid().nullable(),
  connectionRevision: z.number().int().positive().nullable(),
  query: z.string().min(1).max(500),
  queryHash: z.string().min(1).max(100),
});
type Payload = z.infer<typeof UserDiscoveryPayloadSchema>;
async function currentSettings(tx: Transaction<Database>, owner: OwnerScope, payload: Payload) {
  const row = await discoveryRow(tx, owner, true);
  if (
    !row ||
    row.id !== payload.settingsId ||
    row.revision !== payload.revision ||
    row.mode === "existing_sources"
  )
    return null;
  if (payload.purpose === "discover") {
    const search = await tx
      .selectFrom("application.saved_searches")
      .select(["revision", "discovery_enabled"])
      .where("id", "=", payload.searchId!)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .forUpdate()
      .executeTakeFirst();
    if (
      !search?.discovery_enabled ||
      search.revision !== payload.searchRevision ||
      row.capability !== "ready"
    )
      return null;
  }
  if (row.mode === "ai_connection") {
    const ai = (await userAiSettings(tx, owner)).settings;
    if (
      !ai?.enabled ||
      ai.connectionId !== payload.connectionId ||
      ai.revision !== payload.connectionRevision
    )
      return null;
  }
  return row;
}
async function enqueue(
  tx: Transaction<Database>,
  owner: OwnerScope,
  payload: Payload,
  key: string,
) {
  await sql`INSERT INTO task_queue.tasks(task_type,owner_id,owner_epoch,payload,idempotency_key,status,max_attempts,backoff_policy)
    VALUES('user_source_discovery',${owner.ownerId}::uuid,${owner.ownerEpoch},${JSON.stringify(payload)}::jsonb,${`user-discovery:${owner.ownerId}:${owner.ownerEpoch}:${key}`},'queued',2,'{}') ON CONFLICT(idempotency_key) DO NOTHING`.execute(
    tx,
  );
}
export async function queueUserDiscoveryTest(
  db: Kysely<Database>,
  owner: OwnerScope,
  revision: number,
  key: string,
) {
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const row = await discoveryRow(tx, owner, true);
    if (!row || row.revision !== revision || row.mode === "existing_sources")
      throw new ServiceError(409, "SEARCH_SETTINGS_CONFLICT", "请先保存需要检查的搜索配置。");
    const ai = (await userAiSettings(tx, owner)).settings;
    if (row.mode === "ai_connection" && !ai?.enabled)
      throw new ServiceError(409, "AI_NOT_READY", "请先启用 AI 连接。");
    const sameConnection =
      row.mode !== "ai_connection" ||
      (row.connection_id === ai?.connectionId && row.connection_revision === ai?.revision);
    if (
      sameConnection &&
      row.adapter_version === SEARCH_ADAPTER_VERSION &&
      ["ready", "queued"].includes(row.capability)
    )
      return { queued: row.capability === "queued" };
    const seen = (
      await sql`SELECT id FROM task_queue.tasks WHERE idempotency_key=${`user-discovery:${owner.ownerId}:${owner.ownerEpoch}:test:${key}`}`.execute(
        tx,
      )
    ).rows.length;
    if (seen) return { queued: true };
    const search = await tx
      .selectFrom("application.saved_searches")
      .select("scope")
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("discovery_enabled", "=", true)
      .orderBy("created_at")
      .executeTakeFirst();
    const query = discoveryQueries(
      (search?.scope as Record<string, unknown>) ?? { __catalogQuery: { keyword: "企业招聘" } },
    )[0]!;
    const payload: Payload = {
      settingsId: row.id,
      revision,
      purpose: "test",
      searchId: null,
      searchRevision: null,
      connectionId: row.mode === "ai_connection" ? ai!.connectionId : null,
      connectionRevision: row.mode === "ai_connection" ? ai!.revision : null,
      query: query.text,
      queryHash: query.hash,
    };
    await enqueue(tx, owner, payload, `test:${key}`);
    await sql`UPDATE profile.discovery_settings SET capability='queued',capability_code=NULL,connection_id=${payload.connectionId}::uuid,connection_revision=${payload.connectionRevision},adapter_version=${SEARCH_ADAPTER_VERSION} WHERE owner_id=${owner.ownerId}::uuid`.execute(
      tx,
    );
    return { queued: true };
  });
}
export async function scheduleUserDiscovery(db: Kysely<Database>, now = new Date()) {
  await sql`INSERT INTO profile.discovery_schedule(owner_id,owner_epoch,search_id)
    SELECT s.owner_id,s.owner_epoch,s.id FROM application.saved_searches s JOIN profile.discovery_settings d ON d.owner_id=s.owner_id AND d.owner_epoch=s.owner_epoch
    JOIN identity.owners o ON o.id=s.owner_id AND o.epoch=s.owner_epoch WHERE s.discovery_enabled AND d.mode<>'existing_sources' AND o.status='active' AND (o.retention_expires_at IS NULL OR o.retention_expires_at>now()) ON CONFLICT DO NOTHING`.execute(
    db,
  );
  const due = (
    await sql<{
      owner_id: string;
      owner_epoch: number;
      search_id: string;
    }>`SELECT p.owner_id,p.owner_epoch,p.search_id FROM profile.discovery_schedule p
    JOIN profile.discovery_settings d ON d.owner_id=p.owner_id AND d.owner_epoch=p.owner_epoch
    WHERE p.next_due_at<=${now} AND d.next_search_at<=${now} AND d.mode<>'existing_sources' AND d.capability='ready'
    ORDER BY p.next_due_at,p.search_id LIMIT 20`.execute(db)
  ).rows;
  for (const item of due)
    await db.transaction().execute(async (tx) => {
      const owner = { ownerId: item.owner_id, ownerEpoch: Number(item.owner_epoch) };
      try {
        await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
      } catch {
        return;
      }
      const row = await discoveryRow(tx, owner, true);
      if (
        !row ||
        row.mode === "existing_sources" ||
        row.capability !== "ready" ||
        new Date(row.next_search_at) > now
      )
        return;
      const schedule = (
        await sql<{
          next_due_at: Date;
          query_cursor: number;
        }>`SELECT next_due_at,query_cursor FROM profile.discovery_schedule WHERE search_id=${item.search_id}::uuid FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      if (!schedule || new Date(schedule.next_due_at) > now) return;
      const search = await tx
        .selectFrom("application.saved_searches")
        .selectAll()
        .where("id", "=", item.search_id)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .executeTakeFirst();
      if (!search?.discovery_enabled) return;
      const ai = (await userAiSettings(tx, owner)).settings;
      if (
        row.mode === "ai_connection" &&
        (!ai?.enabled ||
          ai.connectionId !== row.connection_id ||
          ai.revision !== row.connection_revision ||
          row.adapter_version !== SEARCH_ADAPTER_VERSION)
      )
        return;
      const queries = discoveryQueries(search.scope as Record<string, unknown>),
        query = queries[schedule.query_cursor % queries.length]!;
      await enqueue(
        tx,
        owner,
        {
          settingsId: row.id,
          revision: row.revision,
          purpose: "discover",
          searchId: search.id,
          searchRevision: search.revision,
          connectionId: row.mode === "ai_connection" ? row.connection_id : null,
          connectionRevision: row.mode === "ai_connection" ? row.connection_revision : null,
          query: query.text,
          queryHash: query.hash,
        },
        `${search.id}:${search.revision}:${row.id}:${row.revision}:${new Date(schedule.next_due_at).toISOString()}`,
      );
      // One catch-up, not one request for every missed day. Rotate cities for the next occurrence.
      await sql`UPDATE profile.discovery_schedule SET next_due_at=${new Date(now.getTime() + 86400000)},query_cursor=query_cursor+1 WHERE search_id=${search.id}::uuid`.execute(
        tx,
      );
    });
}
export async function processUserDiscovery(input: {
  db: Kysely<Database>;
  config: AppConfig;
  owner: OwnerScope;
  payload: Payload;
  lease: OwnerTaskLease;
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch | undefined;
}) {
  const { db, owner, payload, lease, config } = input;
  const row = await withOwnerTaskLease(db, lease, (tx) => currentSettings(tx, owner, payload));
  if (!row) return;
  const connection =
    row.mode === "ai_connection"
      ? await loadUserAiConnection(
          db,
          owner,
          config,
          payload.connectionRevision,
          payload.connectionId,
        )
      : null;
  const adapter = connection ? selectSearchAdapter(connection.baseUrl, row.adapter) : "tavily";
  const cacheKey = hashCanonicalJson({
    settingsId: row.id,
    revision: row.revision,
    connectionId: connection?.connectionId,
    connectionRevision: connection?.revision,
    adapter,
    version: SEARCH_ADAPTER_VERSION,
    model: connection?.model,
    query: payload.queryHash,
  });
  let result: SearchResult | null = null,
    usageId: string | null = null,
    error: SearchError | null = null;
  try {
    const reservation = await withOwnerTaskLease(db, lease, async (tx) => {
      if (!(await currentSettings(tx, owner, payload))) return null;
      const cache = (
        await sql<{
          leads: SearchResult["leads"];
        }>`SELECT leads FROM profile.discovery_cache WHERE owner_id=${owner.ownerId}::uuid AND owner_epoch=${owner.ownerEpoch} AND cache_key=${cacheKey} AND created_at>now()-interval '24 hours'`.execute(
          tx,
        )
      ).rows[0];
      if (cache)
        return {
          cached: { leads: cache.leads, toolCalls: null, modelTokens: null } as SearchResult,
          id: null,
        };
      const usage = await userDiscoveryUsage(tx, owner);
      if (usage.dailyUsed >= 20 || usage.monthlyUsed >= 500)
        throw new SearchError("SEARCH_BUDGET_EXHAUSTED", "temporary_failure");
      const id = randomUUID();
      if (connection)
        await reserveUserAiUsage(tx, {
          owner,
          id,
          connectionId: connection.connectionId,
          revision: connection.revision,
          tokens: 32768 + Buffer.byteLength(payload.query) + 1024,
          purpose: "source_discovery",
        });
      if (adapter === "tavily") {
        const day = shanghaiDateKey(new Date());
        const reserved = (
          await sql<{
            ok: boolean;
          }>`SELECT source_control.reserve_user_tavily_budget(${lease.taskId}::uuid,${lease.fencingToken},${lease.leaseOwner},${`tavily:day:${day}`},${`tavily:month:${day.slice(0, 7)}`}) AS ok`.execute(
            tx,
          )
        ).rows[0]?.ok;
        if (!reserved) throw new SearchError("SEARCH_BUDGET_EXHAUSTED", "temporary_failure");
      }
      await sql`INSERT INTO profile.discovery_usage(id,owner_id,owner_epoch,settings_id,settings_revision,connection_id,connection_revision,adapter,model,task_id,query_hash,purpose)
        VALUES(${id}::uuid,${owner.ownerId}::uuid,${owner.ownerEpoch},${row.id}::uuid,${row.revision},${connection?.connectionId ?? null}::uuid,${connection?.revision ?? null},${adapter},${connection?.model ?? null},${lease.taskId}::uuid,${payload.queryHash},${payload.purpose})`.execute(
        tx,
      );
      return { cached: null, id };
    });
    if (!reservation) return;
    usageId = reservation.id;
    result =
      reservation.cached ??
      (await executeSearch({
        query: payload.query,
        adapter,
        apiKey: connection?.apiKey ?? discoverySecret(row, config, owner),
        ...(connection
          ? {
              baseUrl: connection.baseUrl,
              model: connection.model,
              maxOutputTokens: Math.min(1024, connection.maxOutputTokens),
              timeoutMs: connection.requestTimeoutMs,
            }
          : {}),
        signal: input.signal,
        fetchImpl: input.fetchImpl,
      }));
  } catch (cause) {
    if (input.signal?.aborted) throw cause;
    if (cause instanceof ServiceError && cause.code === "AI_CONCURRENCY_LIMIT") throw cause;
    error =
      cause instanceof SearchError
        ? cause
        : new SearchError(
            cause instanceof ServiceError ? cause.code : "SEARCH_REQUEST_FAILED",
            "temporary_failure",
          );
  }
  await withOwnerTaskLease(db, lease, async (tx) => {
    // Usage belongs to the old attempt even when the user changes configuration in flight.
    if (usageId) {
      await sql`UPDATE profile.discovery_usage SET status=${error ? "failed" : "completed"},tool_calls=${result?.toolCalls ?? null},model_tokens=${result?.modelTokens ?? null},error_code=${error?.code ?? null},completed_at=now() WHERE id=${usageId}::uuid AND owner_id=${owner.ownerId}::uuid AND owner_epoch=${owner.ownerEpoch}`.execute(
        tx,
      );
      if (connection)
        await sql`UPDATE profile.ai_usage SET status=${error ? "failed" : "completed"},error_code=${error?.code ?? null},completed_at=now() WHERE id=${usageId}::uuid AND owner_id=${owner.ownerId}::uuid AND owner_epoch=${owner.ownerEpoch}`.execute(
          tx,
        );
    }
    if (!(await currentSettings(tx, owner, payload))) return;
    if (result) {
      for (const lead of result.leads)
        await sql`SELECT source_control.submit_user_discovery_lead(${lease.taskId}::uuid,${lease.fencingToken},${lease.leaseOwner},${lead.url},${new URL(lead.url).hostname},${lead.title},${payload.queryHash},${payload.query})`.execute(
          tx,
        );
      if (usageId)
        await sql`INSERT INTO profile.discovery_cache(owner_id,owner_epoch,cache_key,leads) VALUES(${owner.ownerId}::uuid,${owner.ownerEpoch},${cacheKey},${JSON.stringify(result.leads)}::jsonb) ON CONFLICT(owner_id,owner_epoch,cache_key) DO UPDATE SET leads=EXCLUDED.leads,created_at=now()`.execute(
          tx,
        );
    }
    const temporary = error?.capability === "temporary_failure";
    await sql`UPDATE profile.discovery_settings SET capability=${error ? (payload.purpose === "discover" && temporary ? "ready" : error.capability) : "ready"},capability_code=${error?.code ?? null},checked_at=now(),last_search_status=${error?.code ?? "succeeded"},last_search_at=CASE WHEN ${!error} THEN now() ELSE last_search_at END,
      next_search_at=CASE WHEN ${temporary} THEN now()+interval '1 hour' ELSE now() END,legacy_pending=CASE WHEN ${!error} THEN false ELSE legacy_pending END,adapter_version=${SEARCH_ADAPTER_VERSION},updated_at=now() WHERE owner_id=${owner.ownerId}::uuid AND owner_epoch=${owner.ownerEpoch}`.execute(
      tx,
    );
    if (!error && row.legacy_pending) await syncDiscoveryDemand(tx);
    await sql`DELETE FROM profile.discovery_cache WHERE owner_id=${owner.ownerId}::uuid AND owner_epoch=${owner.ownerEpoch} AND created_at<now()-interval '24 hours'`.execute(
      tx,
    );
  });
}
