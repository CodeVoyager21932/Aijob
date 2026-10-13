import type { Database } from "@aijob/database";
import { sql, type Kysely, type Transaction } from "kysely";
import type { z } from "zod";
import { hashCanonicalJson } from "../lib/canonical-json.js";
type Db = Kysely<Database> | Transaction<Database>;
const inFlight = new WeakMap<Db, Map<string, Promise<unknown>>>();
type MemoryEntry = { generation: string; buildId: string; value: unknown; bytes: number };
const memory = new WeakMap<Db, Map<string, MemoryEntry>>();
function freeze(value: unknown): unknown {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function remember(db: Db, key: string, state: Awaited<ReturnType<typeof lookup>>, value: unknown) {
  if (!state.buildId) return;
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > 1024 * 1024) return;
  const entries = memory.get(db) ?? new Map<string, MemoryEntry>();
  memory.set(db, entries);
  entries.delete(key);
  while (
    entries.size >= 32 ||
    [...entries.values()].reduce((sum, item) => sum + item.bytes, bytes) > 8 * 1024 * 1024
  ) {
    const oldest = entries.keys().next().value;
    if (!oldest) break;
    entries.delete(oldest);
  }
  entries.set(key, {
    generation: state.generation,
    buildId: state.buildId,
    value: freeze(value),
    bytes,
  });
}
async function lookup(db: Db, projectionKey: string, known?: MemoryEntry) {
  const { rows } = await sql<{
    generation: string;
    result: unknown | null;
    buildId: string | null;
  }>`
    SELECT g.generation::text AS generation,c.created_at::text AS "buildId",
      CASE WHEN g.generation::text=${known?.generation ?? null} AND c.created_at::text=${known?.buildId ?? null}
        THEN NULL ELSE c.result END AS result FROM catalog.job_graph_generation g
    LEFT JOIN LATERAL (SELECT result,created_at FROM catalog.job_graph_cache WHERE projection_key=${projectionKey}
      AND generation=g.generation AND expires_at>now() ORDER BY created_at DESC LIMIT 1) c ON true WHERE g.id=true
  `.execute(db);
  const row = rows[0];
  if (!row) throw new Error("PROJECTION_GENERATION_MISSING");
  return row;
}
/** Owner-free projections. A cache hit reads current publication generation and data in one statement. */
export async function cachedPublicProjection<T>(input: {
  db: Db;
  key: unknown;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  load: (db: Db, generation: string) => Promise<T>;
}): Promise<T> {
  const projectionKey = hashCanonicalJson(input.key);
  const readSnapshot = async (db: Db) => {
    const state = await lookup(db, projectionKey);
    if (state.result !== null) return input.schema.parse(state.result);
    const result = await input.load(db, state.generation),
      cacheKey = hashCanonicalJson({ key: input.key, generation: state.generation });
    await sql`INSERT INTO catalog.job_graph_cache(cache_key,generation,result,projection_key)
      VALUES (${cacheKey},${state.generation}::bigint,${JSON.stringify(result)}::jsonb,${projectionKey})
      ON CONFLICT(cache_key) DO UPDATE SET result=EXCLUDED.result,projection_key=EXCLUDED.projection_key,created_at=now(),expires_at=now()+interval '1 minute'
      WHERE job_graph_cache.expires_at<=now() OR job_graph_cache.projection_key IS NULL`.execute(
      db,
    );
    return result;
  };
  if (input.db.isTransaction) return readSnapshot(input.db);
  const known = memory.get(input.db)?.get(projectionKey);
  const state = await lookup(input.db, projectionKey, known);
  // Every read still checks PostgreSQL generation, expiry and build identity. Memory
  // only avoids transferring and validating an unchanged public JSON document.
  if (known && state.generation === known.generation && state.buildId === known.buildId)
    return known.value as T;
  if (state.result !== null) {
    const value = input.schema.parse(state.result);
    remember(input.db, projectionKey, state, value);
    return value;
  }
  const flights = inFlight.get(input.db) ?? new Map<string, Promise<unknown>>();
  inFlight.set(input.db, flights);
  const key = `${projectionKey}:${state.generation}`,
    previous = flights.get(key);
  if (previous) return input.schema.parse(await previous);
  const run = () =>
    input.db.transaction().setIsolationLevel("repeatable read").execute(readSnapshot);
  const build = async () => {
    try {
      return await run();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "40001")
        return run();
      throw error;
    }
  };
  const promise = build();
  flights.set(key, promise);
  try {
    return await promise;
  } finally {
    if (flights.get(key) === promise) flights.delete(key);
  }
}
export async function trimExpiredProjectionCache(db: Kysely<Database>) {
  await sql`DELETE FROM catalog.job_graph_cache WHERE cache_key IN (SELECT cache_key FROM catalog.job_graph_cache WHERE expires_at<now() ORDER BY expires_at LIMIT 500)`.execute(
    db,
  );
}
