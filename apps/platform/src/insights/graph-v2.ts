import {
  GRAPH_GROUPS, GraphDirectionsSchema, GraphEvidenceV2Schema, GraphItemV2Schema, GraphV2Schema,
  JOB_DIRECTIONS, JOB_DIRECTION_VERSION, JOB_FAMILY_NAMES, JOB_SEMANTICS_V2,
  type GraphAtomV2, type GraphItemV2, type GraphV2, type JobFamily, type JobGraphScope,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { sql, type Kysely, type Transaction } from "kysely";
import { cachedPublicProjection } from "../catalog/projection-cache.js";
import { scopedJobs } from "./graph-scope.js";
type Db = Kysely<Database> | Transaction<Database>;
export type GraphRecordV2 = { jobId: string; jobVersionId: string; companyId: string | null; companyName: string; title: string; verifiedAt: string | null; parsed: boolean; atoms: GraphAtomV2[]; context?: "public" | "private"; caseId?: string };

export function normalizeGraphScopeV2(scope: JobGraphScope): JobGraphScope {
  const result = { ...scope, cities: [...new Set(scope.cities)].sort(), educationLevels: [...new Set(scope.educationLevels)].sort(), recruitmentTypes: [...new Set(scope.recruitmentTypes)].sort() };
  if (result.subrole && result.subrole !== "__general__" && !JOB_DIRECTIONS.some((d) => d.id === result.subrole)) delete result.subrole;
  return result;
}
export function buildGraphV2(input: { scope: JobGraphScope; generation: string; sample: GraphV2["sample"]; items: GraphItemV2[]; dataset?: "public" | "private" }) {
  const sorted = [...input.items].sort((a, b) => b.companyCount - a.companyCount || b.jobCount - a.jobCount || a.key.localeCompare(b.key));
  return GraphV2Schema.parse({ schemaVersion: "job-graph-v2", extractionVersion: JOB_SEMANTICS_V2, dataset: input.dataset ?? "public",
    scope: input.scope, generation: input.generation, generatedAt: new Date().toISOString(), sample: input.sample,
    groups: GRAPH_GROUPS.map((g) => ({ ...g, items: sorted.filter((i) => i.kind === g.kind) })) });
}
export function aggregateGraphV2(records: GraphRecordV2[], scope: JobGraphScope, generation: string, dataset: "public" | "private" = "public") {
  const unique = [...new Map(records.map((r) => [r.jobId, r])).values()];
  const companies = new Set(unique.map((r) => r.companyId).filter(Boolean));
  const keys = [...new Set(unique.flatMap((r) => r.atoms.map((a) => a.key)))];
  const items = keys.map((key) => {
    const mentions = unique.flatMap((record) => record.atoms.filter((a) => a.key === key).map((atom) => ({ record, atom })));
    const first = mentions[0]!.atom;
    const positive = mentions.filter((m) => !m.atom.negated);
    const count = (match: (a: GraphAtomV2) => boolean) => new Set(mentions.filter((m) => match(m.atom)).map((m) => m.record.jobId)).size;
    const jobCount = count((a) => !a.negated), companyCount = new Set(positive.map((m) => m.record.companyId).filter(Boolean)).size;
    const examples = [...new Map(mentions.map(({ record, atom }) => [record.jobId, { jobId: record.jobId, jobVersionId: record.jobVersionId, title: record.title, companyName: record.companyName, atom, context: record.context ?? "public", ...(record.caseId ? { caseId: record.caseId } : {}) }])).values()].slice(0, 3);
    return GraphItemV2Schema.parse({ key, label: first.label, kind: first.kind, parentKeys: first.parentKeys,
      jobCount, companyCount, mentionRate: unique.length ? jobCount / unique.length : 0, companyCoverage: companies.size ? companyCount / companies.size : 0,
      requiredJobCount: count((a) => !a.negated && a.necessity === "required" && !a.condition && a.section === "requirements"),
      preferredJobCount: count((a) => !a.negated && a.necessity === "preferred"),
      unknownJobCount: count((a) => !a.negated && a.necessity === "unknown"), negatedJobCount: count((a) => a.negated),
      conditionalJobCount: count((a) => !a.negated && Boolean(a.condition)), dutyJobCount: count((a) => !a.negated && a.section === "responsibilities"), examples });
  });
  const verified = unique.map((r) => r.verifiedAt).filter((s): s is string => Boolean(s)).sort();
  return buildGraphV2({ scope, generation, dataset, items, sample: { jobCount: unique.length, companyCount: companies.size,
    parsedJobCount: unique.filter((r) => r.parsed).length, parseCoverage: unique.length ? unique.filter((r) => r.parsed).length / unique.length : 0,
    firstVerifiedAt: verified[0] ?? null, lastVerifiedAt: verified.at(-1) ?? null } });
}

export function graphV2Scope(scope: JobGraphScope, local: boolean) {
  if (scope.subrole === "__general__") { const broad = { ...scope }; delete broad.subrole; return sql`${scopedJobs(broad, local, JOB_SEMANTICS_V2)} AND semantics.subrole IS NULL`; }
  return scopedJobs(scope, local, JOB_SEMANTICS_V2);
}
async function aggregateInDb(db: Db, scope: JobGraphScope, local: boolean, generation: string) {
  const { rows } = await sql<{ sample: GraphV2["sample"]; items: unknown[] }>`
    WITH visible AS MATERIALIZED (
      SELECT job.id AS job_id,version.id AS version_id,source.organization_id AS company_id,version.company_name,version.title,
        record.last_seen_at AS verified_at,semantics.job_version_id IS NOT NULL AS parsed ${graphV2Scope(scope, local)}
    ), sample AS (
      SELECT count(*)::int AS jobs,count(DISTINCT company_id)::int AS companies,count(*) FILTER(WHERE parsed)::int AS parsed,
        min(verified_at) AS first,max(verified_at) AS last FROM visible
    ), atoms AS MATERIALIZED (
      SELECT v.*,p.atom,p.concept_key AS key,p.negated,p.necessity,p.conditional,p.duty,p.atom_index
      FROM visible v JOIN catalog.job_concept_projections p ON p.job_version_id=v.version_id AND p.extraction_version=${JOB_SEMANTICS_V2}
    ), firsts AS (SELECT DISTINCT ON(key,job_id) * FROM atoms ORDER BY key,job_id,negated,atom_index),
    examples AS (SELECT *,row_number() OVER(PARTITION BY key ORDER BY negated,job_id) AS rn FROM firsts),
    representative AS MATERIALIZED (SELECT * FROM examples WHERE rn<=3),
    counts AS (
      SELECT key,count(DISTINCT job_id) FILTER(WHERE NOT negated)::int AS jobs,count(DISTINCT company_id) FILTER(WHERE NOT negated)::int AS companies,
        count(DISTINCT job_id) FILTER(WHERE NOT negated AND necessity='required' AND NOT conditional AND NOT duty)::int AS required,
        count(DISTINCT job_id) FILTER(WHERE NOT negated AND necessity='preferred')::int AS preferred,
        count(DISTINCT job_id) FILTER(WHERE NOT negated AND necessity='unknown')::int AS unknown,
        count(DISTINCT job_id) FILTER(WHERE negated)::int AS negated,
        count(DISTINCT job_id) FILTER(WHERE NOT negated AND conditional)::int AS conditional,
        count(DISTINCT job_id) FILTER(WHERE NOT negated AND duty)::int AS duty FROM atoms GROUP BY key
    ), summaries AS (
      SELECT jsonb_build_object('key',c.key,'label',f.atom->>'label','kind',f.atom->>'kind','parentKeys',f.atom->'parentKeys',
        'jobCount',c.jobs,'companyCount',c.companies,'mentionRate',COALESCE(c.jobs::float/NULLIF(s.jobs,0),0),
        'companyCoverage',COALESCE(c.companies::float/NULLIF(s.companies,0),0),'requiredJobCount',c.required,'preferredJobCount',c.preferred,
        'unknownJobCount',c.unknown,'negatedJobCount',c.negated,'conditionalJobCount',c.conditional,'dutyJobCount',c.duty,
        'examples',(SELECT jsonb_agg(jsonb_build_object('jobId',e.job_id,'jobVersionId',e.version_id,'title',e.title,'companyName',e.company_name,'atom',e.atom,'context','public') ORDER BY e.rn) FROM representative e WHERE e.key=c.key)) AS item
      FROM counts c JOIN representative f ON f.key=c.key AND f.rn=1 CROSS JOIN sample s
    ) SELECT jsonb_build_object('jobCount',s.jobs,'companyCount',s.companies,'parsedJobCount',s.parsed,'parseCoverage',COALESCE(s.parsed::float/NULLIF(s.jobs,0),0),
      'firstVerifiedAt',to_char(s.first AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'lastVerifiedAt',to_char(s.last AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS sample,
      COALESCE((SELECT jsonb_agg(item) FROM summaries),'[]'::jsonb) AS items FROM sample s`.execute(db);
  return buildGraphV2({ scope, generation, sample: rows[0]!.sample, items: rows[0]!.items.map((i) => GraphItemV2Schema.parse(i)) });
}
export async function getGraphV2(input: { db: Kysely<Database>; scope: JobGraphScope; local: boolean }): Promise<GraphV2> {
  const scope = normalizeGraphScopeV2(input.scope);
  return cachedPublicProjection({ db: input.db, key: { kind: "graph-v2", scope, local: input.local, extraction: JOB_SEMANTICS_V2, classification: JOB_DIRECTION_VERSION },
    schema: GraphV2Schema, load: (db, generation) => aggregateInDb(db, scope, input.local, generation) });
}
export async function getDirectionsV2(input: { db: Kysely<Database>; scope: JobGraphScope; local: boolean }) {
  const scope = { ...normalizeGraphScopeV2(input.scope) }; delete scope.jobFamily; delete scope.subrole;
  return cachedPublicProjection({ db: input.db, key: { kind: "directions-v3", scope, local: input.local, extraction: JOB_SEMANTICS_V2 }, schema: GraphDirectionsSchema,
    load: async (db) => {
      const { rows } = await sql<{ family: JobFamily | "unclassified"; subrole: string | null; jobs: number }>`
        WITH visible AS (SELECT job.id,semantics.families,semantics.subrole ${graphV2Scope(scope, input.local)})
        SELECT family,subrole,count(DISTINCT id)::int AS jobs FROM visible,
          unnest(CASE WHEN cardinality(families)>0 THEN families ELSE ARRAY['unclassified'] END) family GROUP BY family,subrole`.execute(db);
      return directionsFromCounts(rows);
    } });
}
export function directionsFromCounts(rows: { family: JobFamily | "unclassified"; subrole: string | null; jobs: number }[]) {
  return GraphDirectionsSchema.parse({ schemaVersion: JOB_DIRECTION_VERSION, items: [...new Set(rows.map((r) => r.family))].map((family) => {
    const group = rows.filter((r) => r.family === family);
    return { family, label: family === "unclassified" ? "尚未分类" : JOB_FAMILY_NAMES[family], jobCount: group.reduce((n, r) => n + r.jobs, 0),
      children: group.map((r) => ({ id: r.subrole ?? "__general__", label: JOB_DIRECTIONS.find((d) => d.id === r.subrole)?.label ?? "未细分方向", jobCount: r.jobs })).sort((a, b) => b.jobCount - a.jobCount) };
  }).sort((a, b) => b.jobCount - a.jobCount) });
}
export async function getEvidenceV2(input: { db: Kysely<Database>; scope: JobGraphScope; local: boolean; key: string; offset: number; limit: number }) {
  const scope = normalizeGraphScopeV2(input.scope);
  return cachedPublicProjection({ db: input.db, key: { kind: 'graph-v2-evidence', scope, local: input.local, key: input.key, offset: input.offset, limit: input.limit, extraction: JOB_SEMANTICS_V2, classification: JOB_DIRECTION_VERSION }, schema: GraphEvidenceV2Schema, load: async (db) => {
  const { rows } = await sql<{ items: unknown; total: number }>`
    WITH visible AS (SELECT job.id AS job_id,version.id AS version_id,version.title,version.company_name ${graphV2Scope(scope, input.local)}),
    matches AS MATERIALIZED (SELECT v.*,p.atom,p.atom_index,p.negated FROM visible v JOIN catalog.job_concept_projections p ON p.job_version_id=v.version_id
      AND p.extraction_version=${JOB_SEMANTICS_V2} AND p.concept_key=${input.key}),
    page AS (SELECT * FROM matches ORDER BY negated,company_name,title,job_id,atom_index LIMIT ${input.limit} OFFSET ${input.offset})
    SELECT (SELECT count(*)::int FROM matches) AS total,COALESCE((SELECT jsonb_agg(jsonb_build_object('jobId',job_id,'jobVersionId',version_id,'title',title,'companyName',company_name,'atom',atom,'context','public') ORDER BY negated,company_name,title,job_id,atom_index) FROM page),'[]'::jsonb) AS items`.execute(db);
  return GraphEvidenceV2Schema.parse({ items: rows[0]?.items ?? [], total: rows[0]?.total ?? 0, nextOffset: input.offset + input.limit < (rows[0]?.total ?? 0) ? input.offset + input.limit : null });
  } });
}
