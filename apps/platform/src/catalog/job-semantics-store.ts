import type { Database } from "@aijob/database";
import { sql, type Kysely, type Transaction } from "kysely";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { interpretOfficialJob, JOB_SEMANTICS_VERSION } from "./job-semantics.js";
import { indexJobV2 } from "./job-semantics-v2-store.js";

export async function indexOfficialJob(
  db: Kysely<Database> | Transaction<Database>,
  input: Parameters<typeof interpretOfficialJob>[0],
) {
  await indexJobV2(db, input);
  const existing =
    await sql`SELECT 1 FROM catalog.job_semantic_indexes WHERE job_version_id = ${input.jobVersionId} AND extraction_version = ${JOB_SEMANTICS_VERSION}`.execute(
      db,
    );
  if (existing.rows.length) return;
  const interpretation = interpretOfficialJob(input);
  const role = interpretation.role;
  await sql`INSERT INTO catalog.job_semantic_indexes(job_version_id, extraction_version, source_hash, primary_family, families, subrole, domains, education_levels, atoms)
    VALUES (${input.jobVersionId}, ${JOB_SEMANTICS_VERSION}, ${hashCanonicalJson(input)}, ${role.primaryFamily}, ${role.families}::text[],
      ${role.subrole}, ${role.domains}::text[], ${interpretation.educationLevels}::text[], ${JSON.stringify(interpretation.atoms)}::jsonb)
    ON CONFLICT(job_version_id, extraction_version) DO NOTHING`.execute(db);
}
