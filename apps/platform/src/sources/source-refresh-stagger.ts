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

export async function staggerDueSourceRefreshes(input: {
  db: Kysely<Database>;
  sources: SourceRefreshStaggerCandidate[];
  staggerHours: number;
  now: Date;
}): Promise<StaggeredSourceRefresh[]> {
  assertSourceRefreshStaggerHours(input.staggerHours);
  if (input.staggerHours === 0) return [];

  return input.db.transaction().execute(async (transaction) => {
    const staggeredSources: StaggeredSourceRefresh[] = [];
    for (const source of input.sources) {
      if (source.refreshCoverage === "manual_snapshot") continue;

      const offsetMilliseconds = sourceRefreshStaggerOffsetMilliseconds(
        source.sourceKey,
        input.staggerHours,
      );
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
