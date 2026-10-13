import { type JobFacet, type JobSearchQuery, JobSearchResponseSchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { type Kysely, type RawBuilder, sql, type Transaction } from "kysely";
import {
  asSummary,
  type CatalogSearchRecord,
  canonicalCityNames,
  canonicalQuery,
  decodeCursor,
  InvalidCatalogCursorError,
} from "./filtering.js";
import { JOB_SEMANTICS_VERSION } from "./job-semantics.js";
import { cachedPublicProjection } from "./projection-cache.js";
import type { CatalogDatabaseRow } from "./repository.js";
import { AI_JOB_SEMANTICS_VERSION } from "./semantic-enrichment.js";

type Db = Kysely<Database> | Transaction<Database>;
const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
const norm = (value: RawBuilder<unknown>) => sql`lower(btrim(normalize(${value},NFKC)))`;
const field = (column: string) => sql.ref(`r.${column}`);
const value = (column: string) => sql`${field(column)}->>'value'`;
const known = (column: string) => sql`COALESCE(${field(column)}->>'state'='known',false)`;
const arrayValue = (column: string) =>
  sql`CASE WHEN jsonb_typeof(${field(column)}->'value')='array' THEN ${field(column)}->'value' ELSE '[]'::jsonb END`;
const knownList = (column: string) => {
  const array = arrayValue(column);
  const invalidElement =
    column === "graduation_years"
      ? sql`CASE WHEN jsonb_typeof(e.v) IN ('number','string') AND btrim(e.v#>>'{}') ~ '^[0-9]{4}$' THEN (e.v#>>'{}')::int NOT BETWEEN 1900 AND 2200 ELSE true END`
      : sql`jsonb_typeof(e.v)<>'string' OR btrim(e.v#>>'{}')=''`;
  return sql`(${known(column)} AND jsonb_array_length(${array})>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${array}) e(v) WHERE ${invalidElement}))`;
};
function canonicalCity(value: RawBuilder<unknown>) {
  const pattern = `^(中国)?(${canonicalCityNames.join("|")})(市|总部|$)`;
  return sql`CASE WHEN btrim(${value}) ~ '^(中国)?香港' THEN '香港' WHEN btrim(${value}) ~ ${pattern} THEN (regexp_match(btrim(${value}),${pattern}))[2] ELSE regexp_replace(btrim(${value}),'市$','') END`;
}
function criteria(query: JobSearchQuery) {
  const filters: RawBuilder<unknown>[] = [],
    unknowns: RawBuilder<unknown>[] = [];
  const hard = (isKnown: RawBuilder<unknown>, match: RawBuilder<unknown>) => {
    filters.push(sql`(NOT (${isKnown}) OR (${match}))`);
    unknowns.push(sql`NOT (${isKnown})`);
  };
  const scalar = (column: string, selected: string[] | undefined) => {
    if (selected?.length)
      hard(known(column), sql`${norm(value(column))}=ANY(${selected.map(normalize)}::text[])`);
  };
  const array = (column: string, selected: string[] | undefined, isCity = false) => {
    if (selected?.length)
      hard(
        knownList(column),
        sql`EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(${field(column)}->'value')='array' THEN ${field(column)}->'value' ELSE '[]'::jsonb END) x(v) WHERE ${norm(isCity ? canonicalCity(sql`x.v`) : sql`x.v`)}=ANY(${selected.map((v) => normalize(isCity ? canonicalCityJs(v) : v))}::text[]))`,
      );
  };
  if (query.jobIds !== undefined) filters.push(sql`r.job_id=ANY(${query.jobIds}::uuid[])`);
  if (query.keyword)
    filters.push(
      sql`strpos(${norm(sql`concat_ws(E'\n',r.title,r.company_name,r.responsibilities,r.requirements)`)},${normalize(query.keyword)})>0`,
    );
  if (query.companies?.length)
    filters.push(sql`${norm(sql`r.company_name`)}=ANY(${query.companies.map(normalize)}::text[])`);
  array("locations", query.cities, true);
  array("graduation_years", query.graduationYears?.map(String));
  array("education_levels", query.educationLevels);
  array("majors", query.majors);
  if (query.jobFamilies?.length)
    hard(
      sql`(COALESCE(cardinality(r.role_families),0)>0 OR ${known("job_family")})`,
      sql`(r.role_families && ${query.jobFamilies}::text[] OR ${value("job_family")}=ANY(${query.jobFamilies}::text[]))`,
    );
  scalar("recruitment_batch", query.recruitmentBatches);
  scalar("work_mode", query.workModes);
  for (const [column, maximum] of [
    ["weekly_attendance_days", query.availableWeeklyAttendanceDays],
    ["duration_months", query.availableDurationMonths],
  ] as const) {
    if (maximum !== undefined)
      hard(
        sql`(${known(column)} AND jsonb_typeof(${field(column)}->'value')='number')`,
        sql`CASE WHEN jsonb_typeof(${field(column)}->'value')='number' THEN (${value(column)})::numeric<=${maximum} ELSE false END`,
      );
  }
  if (query.latestStartDate)
    hard(
      known("earliest_start_date"),
      sql`${value("earliest_start_date")}<=${query.latestStartDate}`,
    );
  if (query.minimumSalary !== undefined)
    hard(
      sql`(${known("salary")} AND jsonb_typeof(r.salary->'value'->'minimum')='number')`,
      sql`CASE WHEN jsonb_typeof(r.salary->'value'->'minimum')='number' THEN (r.salary->'value'->>'minimum')::numeric>=${query.minimumSalary} ELSE false END`,
    );
  if (query.salaryPeriods?.length)
    hard(known("salary"), sql`r.salary->'value'->>'period'=ANY(${query.salaryPeriods}::text[])`);
  if (query.sources?.length)
    filters.push(sql`${norm(sql`r.source_name`)}=ANY(${query.sources.map(normalize)}::text[])`);
  if (query.sourceTypes?.length) filters.push(sql`r.source_type=ANY(${query.sourceTypes}::text[])`);
  if (query.freshness) filters.push(sql`r.freshness_state=${query.freshness}`);
  return {
    filter: filters.length ? sql.join(filters, sql` AND `) : sql`true`,
    rank: unknowns.length
      ? sql`CASE WHEN ${sql.join(unknowns, sql` OR `)} THEN 1 ELSE 0 END`
      : sql`0`,
  };
}

import { canonicalCity as canonicalCityJs } from "./filtering.js";

const scalarArray = (column: string) =>
  sql`CASE WHEN ${known(column)} THEN jsonb_build_array(${value(column)}) ELSE NULL END`;
const listArray = (column: string) =>
  sql`CASE WHEN ${knownList(column)} THEN ${field(column)}->'value' ELSE NULL END`;
function facets() {
  return [
    ["company", sql`jsonb_build_array(r.company_name)`],
    [
      "city",
      sql`CASE WHEN ${knownList("locations")} THEN COALESCE((SELECT jsonb_agg(${canonicalCity(sql`city.v`)}) FROM jsonb_array_elements_text(${arrayValue("locations")}) city(v)),'[]'::jsonb) ELSE NULL END`,
    ],
    [
      "jobFamily",
      sql`CASE WHEN cardinality(r.role_families)>0 THEN to_jsonb(r.role_families) ELSE ${scalarArray("job_family")} END`,
    ],
    ["recruitmentBatch", scalarArray("recruitment_batch")],
    ["weeklyAttendanceDays", scalarArray("weekly_attendance_days")],
    ["durationMonths", scalarArray("duration_months")],
    ["earliestStartDate", scalarArray("earliest_start_date")],
    ["graduationYear", listArray("graduation_years")],
    ["educationLevel", listArray("education_levels")],
    ["major", listArray("majors")],
    [
      "salaryPeriod",
      sql`CASE WHEN ${known("salary")} THEN jsonb_build_array(r.salary->'value'->>'period') ELSE NULL END`,
    ],
    ["workMode", scalarArray("work_mode")],
    ["source", sql`jsonb_build_array(r.source_name)`],
    ["sourceType", sql`jsonb_build_array(r.source_type)`],
    [
      "freshness",
      sql`CASE WHEN r.freshness_state<>'unknown' THEN jsonb_build_array(r.freshness_state) ELSE NULL END`,
    ],
  ] as const;
}
async function queryCatalogPage(input: {
  db: Db;
  rowsQuery: RawBuilder<CatalogDatabaseRow>;
  query: JobSearchQuery;
  mapRecord: (row: CatalogDatabaseRow) => CatalogSearchRecord;
  local: boolean;
}) {
  const query = input.query,
    hash = canonicalQuery(query),
    cursor = query.cursor ? decodeCursor(query.cursor, hash) : null,
    { filter, rank } = criteria(query),
    definitions = facets();
  if (cursor && query.sort === "company_asc" && typeof cursor.companyName !== "string")
    throw new InvalidCatalogCursorError();
  const order =
    query.sort === "company_asc"
      ? sql`filter_rank,company_name COLLATE "C",job_id`
      : sql`filter_rank,date_trunc('milliseconds',last_verified_at) DESC,job_id`;
  const after = cursor
    ? query.sort === "company_asc"
      ? sql`(r.filter_rank>${cursor.rank} OR (r.filter_rank=${cursor.rank} AND (r.company_name COLLATE "C">${cursor.companyName ?? ""} OR (r.company_name=${cursor.companyName ?? ""} AND r.job_id>${cursor.id}::uuid))))`
      : sql`(r.filter_rank>${cursor.rank} OR (r.filter_rank=${cursor.rank} AND (date_trunc('milliseconds',r.last_verified_at)<${cursor.verifiedAt}::timestamptz OR (date_trunc('milliseconds',r.last_verified_at)=${cursor.verifiedAt}::timestamptz AND r.job_id>${cursor.id}::uuid))))`
    : sql`true`;
  const { rows } = await sql<{
    page: CatalogDatabaseRow[];
    total_known: number;
    total_unknown: number;
    facets: JobFacet[];
  }>`WITH raw AS (${input.rowsQuery}), enriched AS (
    SELECT raw.*,semantic.families AS role_families FROM raw LEFT JOIN LATERAL (
      SELECT families FROM catalog.job_semantic_indexes WHERE job_version_id=raw.published_job_version_id AND extraction_version IN (${JOB_SEMANTICS_VERSION},${AI_JOB_SEMANTICS_VERSION}) ORDER BY (mode='ai') DESC LIMIT 1
    ) semantic ON true
  ), candidates AS MATERIALIZED (SELECT r.*,${rank} AS filter_rank FROM enriched r WHERE ${filter}),
  ranked AS MATERIALIZED (SELECT * FROM candidates WHERE ${query.includeUnknownHardConditions ? sql`true` : sql`filter_rank=0`}),
  page AS (SELECT r.* FROM ranked r WHERE ${after} ORDER BY ${order} LIMIT ${query.limit + 1}),
  facet_rows AS MATERIALIZED (SELECT r.job_id,f.key,f.values FROM ranked r CROSS JOIN LATERAL (VALUES ${sql.join(definitions.map(([key, values]) => sql`(${key}::text,${values})`))}) f(key,values)),
  facet_totals AS (SELECT key,count(*) FILTER(WHERE values IS NOT NULL)::int AS known_count,count(*) FILTER(WHERE values IS NULL)::int AS unknown_count FROM facet_rows GROUP BY key),
  facet_values AS MATERIALIZED (SELECT key,value,count(*)::int AS count FROM (
    SELECT DISTINCT f.key,v.value,f.job_id FROM facet_rows f CROSS JOIN LATERAL jsonb_array_elements_text(f.values) v(value)
  ) distinct_values GROUP BY key,value),
  facet_result AS (SELECT totals.key,totals.known_count,totals.unknown_count,COALESCE((SELECT jsonb_agg(jsonb_build_object('value',value,'count',count)) FROM facet_values value WHERE value.key=totals.key),'[]'::jsonb) AS values FROM facet_totals totals)
  SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${order}) FROM page),'[]'::jsonb) AS page,
    (SELECT count(*)::int FROM candidates WHERE filter_rank=0) AS total_known,(SELECT count(*)::int FROM candidates WHERE filter_rank=1) AS total_unknown,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('key',key,'knownCount',known_count,'unknownCount',unknown_count,'values',values)) FROM facet_result),'[]'::jsonb) AS facets`.execute(
    input.db,
  );
  const row = rows[0];
  if (!row) throw new Error("CATALOG_PAGE_QUERY_EMPTY");
  const page = row.page.slice(0, query.limit).map((raw) => {
    const item = input.mapRecord({ ...raw, last_verified_at: new Date(raw.last_verified_at) });
    return { item, rank: (raw as CatalogDatabaseRow & { filter_rank: number }).filter_rank };
  });
  const last = page.at(-1),
    facetsByKey = new Map(row.facets.map((facet) => [facet.key, facet]));
  return JobSearchResponseSchema.parse({
    items: page.map(({ item, rank }) => ({
      ...asSummary(item.detail),
      conditionState: rank === 0 ? "explicit_match" : "information_unknown",
    })),
    nextCursor:
      row.page.length > query.limit && last
        ? Buffer.from(
            JSON.stringify({
              version: 1,
              query: hash,
              rank: last.rank,
              verifiedAt: last.item.detail.source.lastVerifiedAt,
              id: last.item.detail.id,
              ...(query.sort === "company_asc"
                ? { companyName: last.item.detail.companyName }
                : {}),
            }),
          ).toString("base64url")
        : null,
    totalKnown: row.total_known,
    totalUnknown: row.total_unknown,
    facets: definitions.map(([key]) => {
      const facet = facetsByKey.get(key) ?? { key, knownCount: 0, unknownCount: 0, values: [] };
      return {
        ...facet,
        values: facet.values.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
      };
    }),
  });
}

export async function searchCatalogInDatabase(input: Parameters<typeof queryCatalogPage>[0]) {
  // Validate cursors before consulting a cached response; no cache can weaken a query binding.
  const queryHash = canonicalQuery(input.query);
  if (input.query.cursor) decodeCursor(input.query.cursor, queryHash);
  if (input.query.jobIds !== undefined) return queryCatalogPage(input);
  return cachedPublicProjection({
    db: input.db,
    key: {
      kind: "catalog-page-v2-list-shapes",
      query: queryHash,
      cursor: input.query.cursor ?? null,
      local: input.local,
    },
    schema: JobSearchResponseSchema,
    load: (db) => queryCatalogPage({ ...input, db }),
  });
}
