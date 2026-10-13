import { sql, type Kysely } from "kysely";
import type { Database } from "@aijob/database";
export async function sourceExceptionEvidence(db: Kysely<Database>, runId: string, offset: number) {
  const run = await db
    .selectFrom("ingestion.crawl_runs as run")
    .innerJoin("source_control.sources as source", "source.id", "run.source_id")
    .select([
      "run.id",
      "source.source_key",
      "run.completion",
      "run.error_summary",
      "run.access_observations",
      "run.policy_version",
      "run.started_at",
      "run.finished_at",
    ])
    .where("run.id", "=", runId)
    .executeTakeFirst();
  if (!run) return null;
  const { rows } = await sql<{
    id: string;
    title: string;
    source_url: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
  }>`
    WITH observed AS MATERIALIZED(
      SELECT DISTINCT revision.id,revision.source_job_record_id,revision.created_at
      FROM ingestion.source_job_revisions revision
      JOIN ingestion.source_job_revision_evidence evidence ON evidence.revision_id=revision.id
      JOIN ingestion.crawl_fetches fetch_record ON fetch_record.id=evidence.crawl_fetch_id
      WHERE fetch_record.crawl_run_id=${runId}::uuid
    )
    SELECT current_revision.id,current_revision.title,current_revision.source_url,
      CASE WHEN previous.id IS NULL THEN NULL ELSE jsonb_build_object('title',previous.title,'requirements',previous.requirements,'responsibilities',previous.responsibilities,'locations',previous.locations,'applyUrl',previous.apply_url) END AS before,
      jsonb_build_object('title',current_revision.title,'requirements',current_revision.requirements,'responsibilities',current_revision.responsibilities,'locations',current_revision.locations,'applyUrl',current_revision.apply_url) AS after
    FROM observed JOIN ingestion.source_job_revisions current_revision ON current_revision.id=observed.id
    LEFT JOIN LATERAL(SELECT * FROM ingestion.source_job_revisions older WHERE older.source_job_record_id=current_revision.source_job_record_id
      AND (older.created_at,older.id)<(current_revision.created_at,current_revision.id) ORDER BY older.created_at DESC,older.id DESC LIMIT 1) previous ON true
    ORDER BY current_revision.created_at DESC,current_revision.id LIMIT 51 OFFSET ${offset}`.execute(
    db,
  );
  return {
    run,
    items: rows.slice(0, 50).map((row) => ({
      id: row.id,
      title: row.title,
      sourceUrl: row.source_url,
      isNew: row.before === null,
      changes: Object.entries(row.after)
        .filter(([field, value]) => JSON.stringify(row.before?.[field]) !== JSON.stringify(value))
        .map(([field, after]) => ({ field, before: row.before?.[field] ?? null, after })),
    })),
    nextOffset: rows.length > 50 ? offset + 50 : null,
  };
}
