import type { Database } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";

type DbExecutor = Kysely<Database> | Transaction<Database>;
export type DirectClosureReason = "official_closed" | "http_404" | "http_410";

export interface AbsenceProjection {
  state: "active" | "uncertain" | "closed";
  count: 0 | 1 | 2;
  lastAbsentAt: Date | null;
}

export function nextAbsenceProjection(input: {
  current: AbsenceProjection;
  observedAt: Date;
  minimumHours: number;
}): AbsenceProjection {
  if (input.current.state === "closed") return input.current;
  if (input.current.count === 0 || !input.current.lastAbsentAt) {
    return { state: "uncertain", count: 1, lastAbsentAt: input.observedAt };
  }
  const nextEligibleAt =
    input.current.lastAbsentAt.getTime() + input.minimumHours * 60 * 60 * 1_000;
  if (input.observedAt.getTime() < nextEligibleAt) return input.current;
  return { state: "closed", count: 2, lastAbsentAt: input.observedAt };
}

export async function updateSourceJobActivityAfterRun(input: {
  db: DbExecutor;
  sourceId: string;
  runId: string;
  observedAt: Date;
  completion: "complete" | "partial" | "failed";
  refreshCoverage: "full_scope" | "tracked_records" | "manual_snapshot";
  absencePolicy: "none" | "close_after_two_complete_absences";
  minimumHours: number;
}): Promise<void> {
  const seenRows = await input.db
    .selectFrom("ingestion.source_job_records as record")
    .innerJoin(
      "ingestion.source_job_revisions as revision",
      "revision.source_job_record_id",
      "record.id",
    )
    .innerJoin(
      "ingestion.source_job_revision_evidence as evidence",
      "evidence.revision_id",
      "revision.id",
    )
    .innerJoin("ingestion.crawl_fetches as fetch", "fetch.id", "evidence.crawl_fetch_id")
    .select("record.id")
    .distinct()
    .where("record.source_id", "=", input.sourceId)
    .where("fetch.crawl_run_id", "=", input.runId)
    .execute();
  const seenRecordIds = new Set(seenRows.map(({ id }) => id));
  if (seenRecordIds.size > 0) {
    await input.db
      .updateTable("ingestion.source_job_records")
      .set({
        last_seen_at: sql`greatest(ingestion.source_job_records.last_seen_at, ${input.observedAt})`,
      })
      .where("id", "in", [...seenRecordIds])
      .execute();
  }
  const records = await input.db
    .selectFrom("ingestion.source_job_records as record")
    .leftJoin(
      "ingestion.source_job_activity_states as activity",
      "activity.source_job_record_id",
      "record.id",
    )
    .select([
      "record.id",
      "activity.absence_state as absenceState",
      "activity.consecutive_complete_absences as absenceCount",
      "activity.last_absent_at as lastAbsentAt",
    ])
    .where("record.source_id", "=", input.sourceId)
    .execute();

  for (const record of records) {
    const seen = seenRecordIds.has(record.id);
    if (seen) {
      await input.db
        .insertInto("ingestion.source_job_activity_states")
        .values({
          source_job_record_id: record.id,
          absence_state: "active",
          direct_state: "active",
          direct_reason: null,
          direct_evidence_run_id: null,
          consecutive_complete_absences: 0,
          last_seen_run_id: input.runId,
          last_absent_run_id: null,
          last_absent_at: null,
          closed_reason: null,
          updated_at: input.observedAt,
        })
        .onConflict((conflict) =>
          conflict.column("source_job_record_id").doUpdateSet({
            absence_state: "active",
            direct_state: "active",
            direct_reason: null,
            direct_evidence_run_id: null,
            consecutive_complete_absences: 0,
            last_seen_run_id: input.runId,
            last_absent_run_id: null,
            last_absent_at: null,
            closed_reason: null,
            updated_at: input.observedAt,
          }),
        )
        .execute();
      continue;
    }

    if (
      input.completion !== "complete" ||
      input.refreshCoverage !== "full_scope" ||
      input.absencePolicy !== "close_after_two_complete_absences"
    ) {
      continue;
    }

    const current: AbsenceProjection = {
      state: (record.absenceState ?? "active") as AbsenceProjection["state"],
      count: Number(record.absenceCount ?? 0) as AbsenceProjection["count"],
      lastAbsentAt: record.lastAbsentAt ? new Date(record.lastAbsentAt) : null,
    };
    const next = nextAbsenceProjection({
      current,
      observedAt: input.observedAt,
      minimumHours: input.minimumHours,
    });
    if (next === current) continue;
    await input.db
      .insertInto("ingestion.source_job_activity_states")
      .values({
        source_job_record_id: record.id,
        absence_state: next.state,
        consecutive_complete_absences: next.count,
        last_seen_run_id: null,
        last_absent_run_id: input.runId,
        last_absent_at: next.lastAbsentAt,
        closed_reason: next.state === "closed" ? "two_complete_absences" : null,
        updated_at: input.observedAt,
      })
      .onConflict((conflict) =>
        conflict.column("source_job_record_id").doUpdateSet({
          absence_state: next.state,
          consecutive_complete_absences: next.count,
          last_absent_run_id: input.runId,
          last_absent_at: next.lastAbsentAt,
          closed_reason: next.state === "closed" ? "two_complete_absences" : null,
          updated_at: input.observedAt,
        }),
      )
      .execute();
  }
}

export async function applyDirectSourceJobClosures(input: {
  db: DbExecutor;
  recordIds: string[];
  runId: string;
  reason: DirectClosureReason;
  observedAt: Date;
}): Promise<void> {
  for (const recordId of [...new Set(input.recordIds)]) {
    await input.db
      .insertInto("ingestion.source_job_activity_states")
      .values({
        source_job_record_id: recordId,
        direct_state: "closed",
        direct_reason: input.reason,
        direct_evidence_run_id: input.runId,
        updated_at: input.observedAt,
      })
      .onConflict((conflict) =>
        conflict.column("source_job_record_id").doUpdateSet({
          direct_state: "closed",
          direct_reason: input.reason,
          direct_evidence_run_id: input.runId,
          updated_at: input.observedAt,
        }),
      )
      .execute();
  }
}
