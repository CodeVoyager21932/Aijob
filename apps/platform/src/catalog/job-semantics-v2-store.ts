import { randomUUID } from "node:crypto";
import { JOB_SEMANTICS_V2 } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { sql, type Kysely, type Transaction } from "kysely";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { interpretJobV2, type SemanticInputV2 } from "./job-semantics-v2.js";
type Db = Kysely<Database> | Transaction<Database>;
export const SEMANTIC_V2_IMPLEMENTATION = '2026-09-09.3';

export async function indexJobV2(db: Db, input: SemanticInputV2) {
  const sourceHash=hashCanonicalJson({implementation:SEMANTIC_V2_IMPLEMENTATION,jobVersionId:input.jobVersionId,title:input.title,requirements:input.requirements,responsibilities:input.responsibilities});
  const old = await sql`SELECT 1 FROM catalog.job_semantic_indexes WHERE job_version_id=${input.jobVersionId} AND extraction_version=${JOB_SEMANTICS_V2} AND source_hash=${sourceHash}`.execute(db);
  if (old.rows.length) return false;
  const result = interpretJobV2(input), role = result.role;
  const inserted = await sql`INSERT INTO catalog.job_semantic_indexes(job_version_id,extraction_version,source_hash,primary_family,families,subrole,domains,education_levels,atoms)
    VALUES(${input.jobVersionId},${JOB_SEMANTICS_V2},${sourceHash},${role.primaryFamily},${role.families}::text[],${role.subrole},${role.domains}::text[],${result.educationLevels}::text[],${JSON.stringify(result.atoms)}::jsonb)
    ON CONFLICT(job_version_id,extraction_version) DO UPDATE SET source_hash=EXCLUDED.source_hash,primary_family=EXCLUDED.primary_family,families=EXCLUDED.families,subrole=EXCLUDED.subrole,domains=EXCLUDED.domains,education_levels=EXCLUDED.education_levels,atoms=EXCLUDED.atoms WHERE catalog.job_semantic_indexes.source_hash IS DISTINCT FROM EXCLUDED.source_hash RETURNING job_version_id`.execute(db);
  return inserted.rows.length > 0;
}

/** Bounded, resumable derived-index backfill. Never fetches sources or updates official revisions. */
export async function reindexGraphV2(db: Kysely<Database>, batchSize = 200) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error("INVALID_REINDEX_BATCH_SIZE");
  const id = randomUUID();
  await sql`INSERT INTO catalog.semantic_reindex_runs(id,extraction_version) VALUES(${id},${`${JOB_SEMANTICS_V2}+${SEMANTIC_V2_IMPLEMENTATION}`})`.execute(db);
  let processed = 0, cursor = "00000000-0000-0000-0000-000000000000";
  const failures: { jobVersionId: string; code: string }[] = [];
  for (;;) {
    const { rows } = await sql<{ id: string; title: string; requirements: string; responsibilities: string }>`
      SELECT v.id,v.title,v.requirements,v.responsibilities FROM catalog.published_job_versions v
      JOIN catalog.published_jobs j ON j.current_version_id=v.id OR j.public_version_id=v.id
      WHERE v.id>${cursor}::uuid
      ORDER BY v.id LIMIT ${batchSize}`.execute(db);
    if (!rows.length) break;
    for (const row of rows) {
      try { if (await indexJobV2(db, { ...row, jobVersionId: row.id })) processed++; }
      catch (error) { failures.push({ jobVersionId: row.id, code: error && typeof error === "object" && "code" in error ? String(error.code) : "SEMANTIC_INDEX_FAILED" }); }
    }
    cursor = rows.at(-1)!.id;
    await sql`UPDATE catalog.semantic_reindex_runs SET processed=${processed},failed=${failures.length},failures=${JSON.stringify(failures)}::jsonb WHERE id=${id}`.execute(db);
  }
  await sql`UPDATE catalog.semantic_reindex_runs SET completed_at=now() WHERE id=${id}`.execute(db);
  return { id, extractionVersion: JOB_SEMANTICS_V2, processed, failed: failures.length, failures };
}
