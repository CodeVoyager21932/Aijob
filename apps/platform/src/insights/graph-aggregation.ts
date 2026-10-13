import { JobGraphResultSchema, type JobGraphScope } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { sql, type Kysely, type Transaction } from "kysely";
import { scopedJobs } from "./graph-scope.js";

/** Only counts and a bounded set of original examples leave PostgreSQL. */
export async function aggregateGraphInDatabase(input: {
  db: Kysely<Database> | Transaction<Database>;
  scope: JobGraphScope;
  local: boolean;
  generation: string;
}) {
  const result = await sql<{ sample: unknown; items: unknown }>`
    WITH visible AS MATERIALIZED (
      SELECT job.id AS job_id,version.id AS version_id,source.organization_id AS company_id,
        version.company_name,version.title,record.last_seen_at AS verified_at,
        semantics.job_version_id IS NOT NULL AS parsed,COALESCE(semantics.atoms,'[]'::jsonb) AS atoms
      ${scopedJobs(input.scope, input.local)}
    ), sample AS (
      SELECT count(*)::int AS jobs,count(DISTINCT company_id)::int AS companies,
        count(*) FILTER(WHERE parsed)::int AS parsed,min(verified_at) AS first,max(verified_at) AS last FROM visible
    ), atoms AS MATERIALIZED (
      SELECT v.job_id,v.version_id,v.company_id,v.company_name,v.title,a.atom,a.ordinality,a.atom->>'key' AS key,
        COALESCE((a.atom->>'negated')::boolean,false) AS negated,
        a.atom->>'necessity' AS necessity,COALESCE(a.atom->>'condition','')<>'' AS conditional
      FROM visible v CROSS JOIN LATERAL jsonb_array_elements(v.atoms) WITH ORDINALITY a(atom,ordinality)
    ), first_atoms AS (
      SELECT DISTINCT ON(key,job_id) * FROM atoms ORDER BY key,job_id,ordinality
    ), examples AS (
      SELECT *,row_number() OVER(PARTITION BY key ORDER BY job_id) AS rn FROM first_atoms
    ), representative_examples AS MATERIALIZED (
      SELECT * FROM examples WHERE rn<=3
    ), counts AS (
      SELECT key,count(DISTINCT job_id)::int AS jobs,count(DISTINCT company_id)::int AS companies,
        count(DISTINCT job_id) FILTER(WHERE NOT negated AND necessity='required' AND NOT conditional)::int AS required,
        count(DISTINCT job_id) FILTER(WHERE NOT negated AND necessity='preferred')::int AS preferred,
        count(DISTINCT job_id) FILTER(WHERE NOT negated AND NOT (necessity='required' AND NOT conditional) AND necessity<>'preferred')::int AS unknown,
        count(DISTINCT job_id) FILTER(WHERE negated)::int AS negated,
        count(DISTINCT job_id) FILTER(WHERE conditional)::int AS conditional
      FROM atoms GROUP BY key
    ), summaries AS (
      SELECT c.key,jsonb_build_object('key',c.key,'label',first.atom->>'label','kind',first.atom->>'kind',
        'jobCount',c.jobs,'companyCount',c.companies,'mentionRate',c.jobs::float/NULLIF(s.jobs,0),
        'companyCoverage',COALESCE(c.companies::float/NULLIF(s.companies,0),0),'requiredJobCount',c.required,
        'preferredJobCount',c.preferred,'unknownJobCount',c.unknown,'negatedJobCount',c.negated,'conditionalJobCount',c.conditional,
        'examples',(SELECT jsonb_agg(jsonb_build_object('jobId',e.job_id,'jobVersionId',e.version_id,'companyName',e.company_name,
          'title',e.title,'atom',e.atom,'context','public') ORDER BY e.job_id) FROM representative_examples e WHERE e.key=c.key)) AS item
      FROM counts c JOIN representative_examples first ON first.key=c.key AND first.rn=1 CROSS JOIN sample s
    ) SELECT jsonb_build_object('jobCount',s.jobs,'companyCount',s.companies,'parsedJobCount',s.parsed,
        'parseCoverage',COALESCE(s.parsed::float/NULLIF(s.jobs,0),0),
        'firstVerifiedAt',to_char(s.first AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'lastVerifiedAt',to_char(s.last AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS sample,
      COALESCE((SELECT jsonb_agg(item) FROM summaries),'[]'::jsonb) AS items FROM sample s
  `.execute(input.db);
  const row = result.rows[0];
  const parsed = JobGraphResultSchema.parse({
    schemaVersion: "job-graph-v1",
    scope: input.scope,
    generation: input.generation,
    generatedAt: new Date().toISOString(),
    ...row,
  });
  // PostgreSQL JSON timestamps and JavaScript use different equivalent ISO representations.
  if (parsed.sample.firstVerifiedAt)
    parsed.sample.firstVerifiedAt = new Date(parsed.sample.firstVerifiedAt).toISOString();
  if (parsed.sample.lastVerifiedAt)
    parsed.sample.lastVerifiedAt = new Date(parsed.sample.lastVerifiedAt).toISOString();
  parsed.items.sort(
    (a, b) =>
      b.companyCount - a.companyCount || b.jobCount - a.jobCount || a.key.localeCompare(b.key),
  );
  return parsed;
}
