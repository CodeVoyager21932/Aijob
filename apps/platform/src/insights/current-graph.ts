import {
  JobGraphResultSchema,
  JobGraphEvidencePageSchema,
  JobSemanticAtomSchema,
  type JobGraphResult,
  type JobGraphScope,
  type JobSemanticAtom,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import { scopedJobs } from "./graph-scope.js";
import { aggregateGraphInDatabase } from "./graph-aggregation.js";
import { AI_JOB_SEMANTICS_VERSION } from "../catalog/semantic-enrichment.js";
import { cachedPublicProjection } from "../catalog/projection-cache.js";

type Db = Kysely<Database> | Transaction<Database>;
export interface GraphRecord {
  jobId: string;
  jobVersionId: string;
  companyId: string | null;
  companyName: string;
  title: string;
  verifiedAt: string;
  parsed: boolean;
  atoms: JobSemanticAtom[];
  context?: "public" | "private";
  caseId?: string;
}

export async function loadGraphRecords(
  db: Db,
  scope: JobGraphScope,
  local: boolean,
): Promise<GraphRecord[]> {
  const { rows } = await sql<{
    job_id: string;
    version_id: string;
    company_id: string;
    company_name: string;
    title: string;
    verified_at: Date;
    atoms: unknown;
    parsed: boolean;
  }>`SELECT job.id AS job_id, version.id AS version_id, source.organization_id AS company_id, version.company_name, version.title,
      record.last_seen_at AS verified_at, semantics.atoms, semantics.job_version_id IS NOT NULL AS parsed
     ${scopedJobs(scope, local)} ORDER BY job.id`.execute(db);
  return rows.map((row) => ({
    jobId: row.job_id,
    jobVersionId: row.version_id,
    companyId: row.company_id,
    companyName: row.company_name,
    title: row.title,
    verifiedAt: new Date(row.verified_at).toISOString(),
    atoms: z.array(JobSemanticAtomSchema).parse(row.atoms ?? []),
    parsed: row.parsed,
  }));
}

export function aggregateCurrentGraph(
  records: GraphRecord[],
  scope: JobGraphScope,
  generation: string,
): JobGraphResult {
  const unique = [...new Map(records.map((record) => [record.jobId, record])).values()];
  const companyCount = new Set(unique.map((record) => record.companyId).filter(Boolean)).size;
  const parsedJobCount = unique.filter((record) => record.parsed).length;
  const grouped = new Map<
    string,
    {
      label: string;
      kind: JobSemanticAtom["kind"];
      jobs: Set<string>;
      companies: Set<string>;
      required: Set<string>;
      preferred: Set<string>;
      unknown: Set<string>;
      negated: Set<string>;
      conditional: Set<string>;
      examples: JobGraphResult["items"][number]["examples"];
    }
  >();
  for (const record of unique)
    for (const atom of record.atoms) {
      let item = grouped.get(atom.key);
      if (!item) {
        item = {
          label: atom.label,
          kind: atom.kind,
          jobs: new Set(),
          companies: new Set(),
          required: new Set(),
          preferred: new Set(),
          unknown: new Set(),
          negated: new Set(),
          conditional: new Set(),
          examples: [],
        };
        grouped.set(atom.key, item);
      }
      item.jobs.add(record.jobId);
      if (record.companyId) item.companies.add(record.companyId);
      if (atom.negated) item.negated.add(record.jobId);
      else if (atom.necessity === "required" && !atom.condition) item.required.add(record.jobId);
      else if (atom.necessity === "preferred") item.preferred.add(record.jobId);
      else item.unknown.add(record.jobId);
      if (atom.condition) item.conditional.add(record.jobId);
      if (
        item.examples.length < 3 &&
        !item.examples.some((example) => example.jobId === record.jobId)
      )
        item.examples.push({
          jobId: record.jobId,
          jobVersionId: record.jobVersionId,
          companyName: record.companyName,
          title: record.title,
          atom,
          context: record.context ?? "public",
          ...(record.caseId ? { caseId: record.caseId } : {}),
        });
    }
  const verified = unique.map((record) => record.verifiedAt).sort();
  return JobGraphResultSchema.parse({
    schemaVersion: "job-graph-v1",
    scope,
    generation,
    generatedAt: new Date().toISOString(),
    sample: {
      jobCount: unique.length,
      companyCount,
      parsedJobCount,
      parseCoverage: unique.length ? parsedJobCount / unique.length : 0,
      firstVerifiedAt: verified[0] ?? null,
      lastVerifiedAt: verified.at(-1) ?? null,
    },
    items: [...grouped]
      .map(([key, item]) => ({
        key,
        label: item.label,
        kind: item.kind,
        jobCount: item.jobs.size,
        companyCount: item.companies.size,
        mentionRate: unique.length ? item.jobs.size / unique.length : 0,
        companyCoverage: companyCount ? item.companies.size / companyCount : 0,
        requiredJobCount: item.required.size,
        preferredJobCount: item.preferred.size,
        unknownJobCount: item.unknown.size,
        negatedJobCount: item.negated.size,
        conditionalJobCount: item.conditional.size,
        examples: item.examples,
      }))
      .sort(
        (left, right) =>
          right.companyCount - left.companyCount ||
          right.jobCount - left.jobCount ||
          left.key.localeCompare(right.key),
      ),
  });
}

export async function getCurrentJobGraph(input: {
  db: Kysely<Database>;
  scope: JobGraphScope;
  local: boolean;
}) {
  const scope = {
    ...input.scope,
    cities: [...new Set(input.scope.cities)].sort(),
    educationLevels: [...new Set(input.scope.educationLevels)].sort(),
    recruitmentTypes: [...new Set(input.scope.recruitmentTypes)].sort(),
  };
  return cachedPublicProjection({
    db: input.db,
    key: { kind: "job-graph-v1", scope, local: input.local, version: AI_JOB_SEMANTICS_VERSION },
    schema: JobGraphResultSchema,
    load: async (db, generation) =>
      aggregateGraphInDatabase({ db, scope, local: input.local, generation }),
  });
}

export async function getCurrentGraphEvidence(input: {
  db: Kysely<Database>;
  scope: JobGraphScope;
  local: boolean;
  key: string;
  offset: number;
  limit: number;
}) {
  const { rows } = await sql<{ total: number; items: unknown }>`
    WITH visible AS (
      SELECT job.id AS job_id, version.id AS version_id, version.company_name, version.title, semantics.atoms
      ${scopedJobs(input.scope, input.local)} AND semantics.atoms @> ${JSON.stringify([{ key: input.key }])}::jsonb
    ), matches AS MATERIALIZED (
      SELECT visible.*, atom.value AS atom FROM visible CROSS JOIN LATERAL jsonb_array_elements(visible.atoms) atom(value)
      WHERE atom.value->>'key' = ${input.key}
    ), page AS (
      SELECT * FROM matches ORDER BY company_name, title, job_id, (atom->'sourceSpan'->>'start')::integer
      LIMIT ${input.limit} OFFSET ${input.offset}
    ) SELECT (SELECT count(*)::int FROM matches) AS total,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('jobId', job_id, 'jobVersionId', version_id, 'companyName', company_name,
        'title', title, 'atom', atom) ORDER BY company_name, title, job_id, (atom->'sourceSpan'->>'start')::integer) FROM page), '[]'::jsonb) AS items
  `.execute(input.db);
  const total = rows[0]?.total ?? 0;
  return JobGraphEvidencePageSchema.parse({
    items: rows[0]?.items ?? [],
    nextOffset: input.offset + input.limit < total ? input.offset + input.limit : null,
    total,
  });
}
