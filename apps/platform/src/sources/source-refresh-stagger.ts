import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { sha256 } from "../lib/canonical-json.js";

const HOUR_IN_MILLISECONDS = 60 * 60 * 1_000;

export interface SourceRefreshStaggerCandidate {
  sourceId: string;
  sourceKey: string;
  policyVersion: number;
  refreshCoverage: "full_scope" | "tracked_records" | "manual_snapshot";
}

export interface StaggeredSourceRefresh {
  sourceKey: string;
  offsetMilliseconds: number;
  nextDueAt: string;
}

export interface StableSourceRefreshOffset {
  sourceKey: string;
  offsetMilliseconds: number;
}

export function assertSourceRefreshStaggerHours(staggerHours: number): void {
  if (!Number.isInteger(staggerHours) || staggerHours < 0 || staggerHours > 24) {
    throw new Error("SOURCE_REFRESH_STAGGER_HOURS_OUT_OF_RANGE");
  }
}

export function sourceRefreshStaggerOffsetMilliseconds(
  sourceKey: string,
  staggerHours: number,
): number {
  assertSourceRefreshStaggerHours(staggerHours);
  if (staggerHours === 0) return 0;

  const windowMilliseconds = BigInt(staggerHours * HOUR_IN_MILLISECONDS);
  const hash = BigInt(`0x${sha256(`source-refresh-stagger:v1:${sourceKey}`)}`);
  return Number(hash % windowMilliseconds);
}

export function planStableSourceRefreshOffsets(
  sourceKeys: string[],
  staggerHours: number,
): StableSourceRefreshOffset[] {
  assertSourceRefreshStaggerHours(staggerHours);
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    throw new Error("SOURCE_REFRESH_STAGGER_DUPLICATE_SOURCE_KEY");
  }
  if (staggerHours === 0 || sourceKeys.length === 0) {
    return sourceKeys.map((sourceKey) => ({ sourceKey, offsetMilliseconds: 0 }));
  }

  const orderedSourceKeys = sourceKeys
    .map((sourceKey) => ({
      sourceKey,
      hash: sha256(`source-refresh-stagger:v2:${sourceKey}`),
    }))
    .sort((left, right) => left.hash.localeCompare(right.hash) || left.sourceKey.localeCompare(right.sourceKey))
    .map(({ sourceKey }) => sourceKey);
  const windowMilliseconds = staggerHours * HOUR_IN_MILLISECONDS;
  return orderedSourceKeys.map((sourceKey, index) => ({
    sourceKey,
    offsetMilliseconds: Math.floor(
      ((index * 2 + 1) * windowMilliseconds) / (orderedSourceKeys.length * 2),
    ),
  }));
}

export async function staggerDueSourceRefreshes(input: {
  db: Kysely<Database>;
  sources: SourceRefreshStaggerCandidate[];
  staggerHours: number;
  now: Date;
}): Promise<StaggeredSourceRefresh[]> {
  assertSourceRefreshStaggerHours(input.staggerHours);
  if (input.staggerHours === 0) return [];

  const deterministicSources = input.sources.filter(
    (source) => source.refreshCoverage !== "manual_snapshot",
  );
  const offsets = new Map(
    planStableSourceRefreshOffsets(
      deterministicSources.map(({ sourceKey }) => sourceKey),
      input.staggerHours,
    ).map(({ sourceKey, offsetMilliseconds }) => [sourceKey, offsetMilliseconds]),
  );

  return input.db.transaction().execute(async (transaction) => {
    const staggeredSources: StaggeredSourceRefresh[] = [];
    for (const source of deterministicSources) {
      const offsetMilliseconds = offsets.get(source.sourceKey);
      if (offsetMilliseconds === undefined) throw new Error("SOURCE_REFRESH_STAGGER_PLAN_MISSING");
      const nextDueAt = new Date(input.now.getTime() + offsetMilliseconds);
      const updated = await transaction
        .updateTable("source_control.source_runtime_states")
        .set({ next_due_at: nextDueAt, updated_at: input.now })
        .where("source_id", "=", source.sourceId)
        .where("policy_version", "=", source.policyVersion)
        .where("next_due_at", "is not", null)
        .where("next_due_at", "<=", input.now)
        .returning("next_due_at")
        .executeTakeFirst();
      if (!updated?.next_due_at) continue;

      staggeredSources.push({
        sourceKey: source.sourceKey,
        offsetMilliseconds,
        nextDueAt: new Date(updated.next_due_at).toISOString(),
      });
    }
    return staggeredSources;
  });
}
