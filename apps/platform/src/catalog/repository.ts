import type {
  FieldValue,
  FreshnessState,
  JobDetail,
  JobFamily,
  JobRecommendationDisplay,
  JobRecommendationScope,
  JobSearchItem,
  JobSearchQuery,
  JobSearchResponse,
  Salary,
} from "@aijob/contracts";
import {
  ActivityStateSchema,
  FreshnessStateSchema,
  fieldValueSchema,
  IngestionStateSchema,
  JobDetailSchema,
  JobFamilySchema,
  PolicyStatusSchema,
  ProvenanceLevelSchema,
  PublicationStateSchema,
  SalarySchema,
  SourceTypeSchema,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { z } from "zod";
import { validateNavigationUrl } from "../ingestion/safe-http.js";
import type { SourceTarget } from "../sources/source-config.js";
import { approvedCompanyEmail } from "./application-methods.js";
import {
  collectCatalogSearchItems,
  type CatalogSearchRecord,
  searchCatalogRecords,
} from "./filtering.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

type UnknownReason = "source_not_stated" | "parse_failed" | "not_yet_verified";

interface CatalogDatabaseRow {
  job_id: string;
  published_job_version_id: string | null;
  active_requirement_set_id: string | null;
  revision_id: string;
  source_job_id: string;
  source_id: string;
  source_name: string;
  source_type: string;
  official_domain: string;
  scale_band: string;
  scale_evidence_url: string | null;
  scale_evidence_text: string | null;
  scale_verified_at: Date | string | null;
  provenance_level: string;
  policy_status: string;
  company_name: string;
  title: string;
  job_family: JsonValue;
  locations: JsonValue;
  department: JsonValue;
  job_code: JsonValue;
  recruitment_type: JsonValue;
  employment_type: JsonValue;
  recruitment_batch: JsonValue;
  weekly_attendance_days: JsonValue;
  duration_months: JsonValue;
  student_status: JsonValue;
  earliest_start_date: JsonValue;
  graduation_years: JsonValue;
  education_levels: JsonValue;
  majors: JsonValue;
  languages: JsonValue;
  salary: JsonValue;
  work_mode: JsonValue;
  posted_at: JsonValue;
  deadline_at: JsonValue;
  responsibilities: string;
  requirements: string;
  structured_fields: JsonValue;
  ingestion_state: string;
  publication_state: string;
  activity_state: string;
  source_url: string;
  apply_url: string | null;
  import_mode: string;
  review_reasons: JsonValue;
  last_verified_at: Date | string;
  freshness_state: string;
}

function unknown<T>(reason: UnknownReason = "source_not_stated"): FieldValue<T> {
  return { state: "unknown", reason };
}

function known<T>(value: T, revisionId: string, field: string): FieldValue<T> {
  return {
    state: "known",
    value,
    evidenceRefs: [`${revisionId}#${field}`],
  };
}

function asObject(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function parseField<T>(value: JsonValue | undefined, valueSchema: z.ZodType<T>): FieldValue<T> {
  const parsed = fieldValueSchema(valueSchema).safeParse(value);
  return parsed.success ? (parsed.data as FieldValue<T>) : unknown("parse_failed");
}

function chooseField(
  explicit: JsonValue,
  structured: JsonValue | undefined,
): JsonValue | undefined {
  const explicitObject = asObject(explicit);
  if (explicitObject.state === "known" || explicitObject.state === "conflict") {
    return explicit;
  }
  return structured ?? explicit;
}

function normalizedYears(value: JsonValue | undefined): FieldValue<number[]> {
  const base = parseField(value, z.array(z.union([z.number(), z.string()])).min(1));
  if (base.state !== "known") return base as FieldValue<number[]>;
  const years = base.value.map(Number);
  if (years.some((year) => !Number.isInteger(year) || year < 1900 || year > 2200)) {
    return unknown("parse_failed");
  }
  return { ...base, value: years };
}

function normalizedTimestamp(value: JsonValue | undefined): FieldValue<string> {
  const base = parseField(value, z.string().trim().min(1));
  if (base.state !== "known") return base;
  const date = new Date(base.value);
  if (Number.isNaN(date.valueOf())) return unknown("parse_failed");
  return { ...base, value: date.toISOString() };
}

function normalizedDate(value: JsonValue | undefined): FieldValue<string> {
  const base = parseField(value, z.string().trim().min(1));
  if (base.state !== "known") return base;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(base.value);
  if (!match?.[1]) return unknown("parse_failed");
  return { ...base, value: match[1] };
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function reviewReasonMessage(reason: string): string {
  const messages: Record<string, string> = {
    SOURCE_POLICY_PENDING: "来源访问政策仍待审批，仅允许本地目录查看。",
    STRUCTURED_FIELDS_MISSING: "部分实习条件未在官方页面明确说明。",
    TARGET_SCOPE_REVIEW_REQUIRED: "岗位方向仍需要人工复核。",
    RECRUITMENT_LABEL_CONFLICT: "招聘入口与岗位自身标签存在冲突。",
  };
  return messages[reason] ?? `待复核：${reason}`;
}

function reviewReasons(value: JsonValue): string[] {
  if (!Array.isArray(value)) return ["该岗位尚未完成正式发布复核。"];
  const messages = value.map(String).map(reviewReasonMessage);
  return messages.length > 0 ? messages : ["该岗位尚未完成正式发布复核。"];
}

function displayStatus(
  publicationState: string,
  activityState: string,
  internalPreview: boolean,
): "recruiting" | "pending_review" | "closed" | "unknown" {
  if (activityState === "closed") return "closed";
  if (activityState === "uncertain") return "unknown";
  if (internalPreview || publicationState !== "published") return "pending_review";
  return "recruiting";
}

function safeText(value: string, revisionId: string, field: string): FieldValue<string> {
  return value.trim() ? known(value.trim(), revisionId, field) : unknown("source_not_stated");
}

function companyScale(row: CatalogDatabaseRow) {
  if (
    row.scale_band === "unknown" ||
    !row.scale_evidence_url ||
    !row.scale_evidence_text ||
    !row.scale_verified_at
  ) {
    return {
      band: "unknown" as const,
      evidenceUrl: null,
      evidenceText: null,
      lastVerifiedAt: null,
    };
  }
  return {
    band: row.scale_band,
    evidenceUrl: row.scale_evidence_url,
    evidenceText: row.scale_evidence_text,
    lastVerifiedAt: toIso(row.scale_verified_at),
  };
}

function mapRow(row: CatalogDatabaseRow): CatalogSearchRecord {
  const structured = asObject(row.structured_fields);
  const policyStatus = PolicyStatusSchema.parse(row.policy_status);
  const publicationState = PublicationStateSchema.parse(row.publication_state);
  const activityState = ActivityStateSchema.parse(row.activity_state);
  const ingestionState = IngestionStateSchema.parse(row.ingestion_state);
  const isInternal =
    row.published_job_version_id === null ||
    policyStatus !== "approved" ||
    publicationState !== "published";

  const detail = JobDetailSchema.parse({
    id: row.job_id,
    publishedJobVersionId: row.published_job_version_id,
    activeRequirementSetId: row.active_requirement_set_id,
    companyName: row.company_name,
    companyScale: companyScale(row),
    title: row.title,
    jobFamily: parseField<JobFamily>(row.job_family, JobFamilySchema),
    locations: parseField(row.locations, z.array(z.string().trim().min(1)).min(1)),
    weeklyAttendanceDays: parseField(row.weekly_attendance_days, z.number().int().min(1).max(7)),
    durationMonths: parseField(row.duration_months, z.number().int().positive()),
    studentStatus: parseField(row.student_status, z.boolean()),
    recruitmentBatch: parseField(
      chooseField(row.recruitment_batch, structured.recruitmentBatch),
      z.string().trim().min(1),
    ),
    graduationYears: normalizedYears(row.graduation_years),
    educationLevels: parseField(row.education_levels, z.array(z.string().trim().min(1)).min(1)),
    majors: parseField(row.majors, z.array(z.string().trim().min(1)).min(1)),
    workMode: parseField(row.work_mode, z.string().trim().min(1)),
    salary: parseField<Salary>(row.salary, SalarySchema),
    postedAt: normalizedTimestamp(chooseField(row.posted_at, structured.publishedAt)),
    deadlineAt: normalizedTimestamp(chooseField(row.deadline_at, structured.deadline)),
    source: {
      sourceId: row.source_id,
      type: SourceTypeSchema.parse(row.source_type),
      provenanceLevel: ProvenanceLevelSchema.parse(row.provenance_level),
      displayName: row.source_name,
      domain: row.official_domain,
      lastVerifiedAt: toIso(row.last_verified_at),
      originalUrl: row.source_url,
    },
    publicationState,
    activityState,
    displayStatus: displayStatus(publicationState, activityState, isInternal),
    ...(isInternal
      ? {
          internalPreview: {
            mode: "internal_preview",
            policyStatus,
            ingestionState,
            reviewReasons: reviewReasons(row.review_reasons),
            sourceJobId: row.source_job_id,
            revisionId: row.revision_id,
            importMode: row.import_mode,
          },
        }
      : {}),
    department: parseField(row.department, z.string().trim().min(1)),
    jobCode: parseField(row.job_code, z.string().trim().min(1)),
    recruitmentType: parseField(row.recruitment_type, z.string().trim().min(1)),
    employmentType: parseField(row.employment_type, z.string().trim().min(1)),
    earliestStartDate: normalizedDate(row.earliest_start_date),
    languages: parseField(row.languages, z.array(z.string().trim().min(1)).min(1)),
    responsibilitiesText: safeText(row.responsibilities, row.revision_id, "responsibilities"),
    requirementsText: safeText(row.requirements, row.revision_id, "requirements"),
    officialLink: null,
  });

  return {
    detail,
    freshness: FreshnessStateSchema.catch("unknown").parse(row.freshness_state) as FreshnessState,
  };
}

async function loadLocalRows(db: DbExecutor): Promise<CatalogDatabaseRow[]> {
  const result = await sql<CatalogDatabaseRow>`
    SELECT
      COALESCE(published.published_job_id, preview.job_id) AS job_id,
      published.published_job_version_id,
      published.active_requirement_set_id,
      preview.revision_id,
      preview.source_job_id,
      preview.source_id,
      preview.source_name,
      preview.source_type,
      preview.official_domain,
      organization.scale_band,
      organization.scale_evidence_url,
      organization.scale_evidence_text,
      organization.scale_verified_at,
      preview.provenance_level,
      preview.policy_status,
      preview.company_name,
      preview.title,
      preview.job_family,
      COALESCE(projection.locations, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS locations,
      revision.department,
      revision.job_code,
      preview.recruitment_type,
      revision.employment_type,
      revision.recruitment_batch,
      COALESCE(projection.weekly_attendance_days, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS weekly_attendance_days,
      COALESCE(projection.duration_months, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS duration_months,
      COALESCE(projection.student_status, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS student_status,
      COALESCE(projection.earliest_start_date, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS earliest_start_date,
      COALESCE(projection.graduation_years, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS graduation_years,
      COALESCE(projection.education_levels, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS education_levels,
      COALESCE(projection.majors, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS majors,
      COALESCE(projection.languages, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS languages,
      revision.salary,
      revision.work_mode,
      revision.posted_at,
      revision.deadline_at,
      preview.responsibilities,
      preview.requirements,
      preview.structured_fields,
      preview.ingestion_state,
      preview.publication_state,
      CASE
        WHEN published.published_job_version_id IS NULL THEN preview.activity_state
        ELSE COALESCE(activity.effective_activity_state, preview.activity_state)
      END AS activity_state,
      preview.source_url,
      preview.apply_url,
      preview.import_mode,
      preview.review_reasons,
      preview.last_verified_at,
      COALESCE(runtime.freshness_state, 'unknown') AS freshness_state
    FROM catalog.current_job_eligibility AS preview
    JOIN source_control.sources AS source
      ON source.id = preview.source_id
    JOIN source_control.organizations AS organization
      ON organization.id = source.organization_id
    JOIN ingestion.source_job_revisions AS revision
      ON revision.id = preview.revision_id
    LEFT JOIN source_control.source_runtime_states AS runtime
      ON runtime.source_id = preview.source_id
    LEFT JOIN LATERAL (
      SELECT
        job.id AS published_job_id,
        version.id AS published_job_version_id,
        version.active_requirement_set_id,
        version.source_job_revision_id
      FROM catalog.published_jobs AS job
      JOIN catalog.published_job_versions AS version
        ON version.id = job.current_version_id
      JOIN catalog.published_job_version_revision_links AS materialization
        ON materialization.published_job_version_id = version.id
        AND materialization.source_job_revision_id = preview.revision_id
      LIMIT 1
    ) AS published ON true
    LEFT JOIN catalog.job_condition_projections AS projection
      ON projection.published_job_version_id = published.published_job_version_id
      AND projection.requirement_set_id = published.active_requirement_set_id
    LEFT JOIN catalog.company_quota_selections AS quota
      ON quota.published_job_id = published.published_job_id
    LEFT JOIN catalog.current_job_effective_activity AS activity
      ON activity.published_job_version_id = published.published_job_version_id
    WHERE preview.eligible_for_local_mvp
      -- ADR-0021：被单家配额压缩的岗位只在读取层隐藏，缺口另行公开分母。
      AND (published.published_job_id IS NULL OR COALESCE(quota.selected, TRUE))
  `.execute(db);
  return result.rows;
}

async function loadCompanyQuotaGaps(db: DbExecutor) {
  const rows = await db
    .selectFrom("catalog.company_quota_selections")
    .select(({ fn }) => [
      "company_name",
      "scale_band",
      "quota",
      "supply",
      fn.count<number>(sql`case when selected then 1 end`).as("selectedCount"),
    ])
    .groupBy(["company_name", "scale_band", "quota", "supply"])
    .having(sql`supply`, ">", sql`quota`)
    .orderBy("company_name")
    .execute();
  return rows.map((row) => ({
    companyName: row.company_name,
    scaleBand: row.scale_band,
    quota: row.quota,
    supply: row.supply,
    selected: Number(row.selectedCount),
  }));
}

async function loadPublicRows(db: DbExecutor): Promise<CatalogDatabaseRow[]> {
  const result = await sql<CatalogDatabaseRow>`
    SELECT
      job.id AS job_id,
      version.id AS published_job_version_id,
      version.active_requirement_set_id,
      revision.id AS revision_id,
      record.source_job_id,
      source.id AS source_id,
      source.name AS source_name,
      source.source_type,
      organization.official_domain,
      organization.scale_band,
      organization.scale_evidence_url,
      organization.scale_evidence_text,
      organization.scale_verified_at,
      policy.provenance_level,
      policy.policy_status,
      version.company_name,
      version.title,
      version.job_family,
      COALESCE(projection.locations, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS locations,
      version.department,
      version.job_code,
      version.recruitment_type,
      version.employment_type,
      version.recruitment_batch,
      COALESCE(projection.weekly_attendance_days, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS weekly_attendance_days,
      COALESCE(projection.duration_months, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS duration_months,
      COALESCE(projection.student_status, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS student_status,
      COALESCE(projection.earliest_start_date, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS earliest_start_date,
      COALESCE(projection.graduation_years, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS graduation_years,
      COALESCE(projection.education_levels, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS education_levels,
      COALESCE(projection.majors, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS majors,
      COALESCE(projection.languages, '{"state":"unknown","reason":"source_not_stated"}'::jsonb) AS languages,
      version.salary,
      version.work_mode,
      version.posted_at,
      version.deadline_at,
      version.responsibilities,
      version.requirements,
      version.structured_fields,
      revision.ingestion_state,
      revision.publication_state,
      activity.effective_activity_state AS activity_state,
      version.source_url,
      version.apply_url,
      revision.import_mode,
      '[]'::jsonb AS review_reasons,
      record.last_seen_at AS last_verified_at,
      COALESCE(runtime.freshness_state, 'unknown') AS freshness_state
    FROM catalog.published_jobs AS job
    JOIN catalog.published_job_versions AS version
      ON version.id = job.public_version_id
    JOIN catalog.job_version_eligibility AS eligibility
      ON eligibility.published_job_version_id = version.id
    JOIN catalog.current_job_effective_activity AS activity
      ON activity.published_job_version_id = version.id
    JOIN catalog.job_condition_projections AS projection
      ON projection.published_job_version_id = version.id
      AND projection.requirement_set_id = version.active_requirement_set_id
    JOIN ingestion.source_job_revisions AS revision
      ON revision.id = version.source_job_revision_id
    JOIN ingestion.source_job_records AS record
      ON record.id = revision.source_job_record_id
    JOIN source_control.sources AS source
      ON source.id = record.source_id
    JOIN source_control.organizations AS organization
      ON organization.id = source.organization_id
    JOIN source_control.source_policy_versions AS policy
      ON policy.source_id = source.id
      AND policy.version = source.current_policy_version
    LEFT JOIN source_control.source_runtime_states AS runtime
      ON runtime.source_id = source.id
    WHERE eligibility.eligible_for_alpha
      AND policy.policy_status = 'approved'
      AND revision.ingestion_state = 'validated'
      AND revision.publication_state = 'published'
      AND activity.effective_activity_state = 'active'
  `.execute(db);
  return result.rows;
}

export async function approvedOfficialLinks(
  db: DbExecutor,
  candidates: Array<{
    key: string;
    sourceId: string;
    applyUrl: string | null;
  }>,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>(candidates.map(({ key }) => [key, null]));
  const sourceIds = [...new Set(candidates.map(({ sourceId }) => sourceId))];
  if (sourceIds.length === 0) return results;
  const targets = await db
    .selectFrom("source_control.source_apply_targets")
    .innerJoin(
      "source_control.sources",
      "source_control.sources.id",
      "source_control.source_apply_targets.source_id",
    )
    .select([
      "source_control.source_apply_targets.source_id",
      "source_control.source_apply_targets.method",
      "source_control.source_apply_targets.scheme",
      "source_control.source_apply_targets.host",
      "source_control.source_apply_targets.port",
      "source_control.source_apply_targets.path_prefix",
      "source_control.source_apply_targets.allow_redirects",
      "source_control.source_apply_targets.allowed_query_parameters",
    ])
    .where("source_control.source_apply_targets.source_id", "in", sourceIds)
    .whereRef(
      "source_control.source_apply_targets.policy_version",
      "=",
      "source_control.sources.current_policy_version",
    )
    .execute();
  const targetsBySource = new Map<string, SourceTarget[]>();
  for (const target of targets) {
    const sourceTargets = targetsBySource.get(target.source_id) ?? [];
    sourceTargets.push({
      method: target.method as "GET",
      scheme: target.scheme as "https",
      host: target.host,
      port: target.port as 443,
      pathPrefix: target.path_prefix,
      allowRedirects: target.allow_redirects,
      allowedQueryParameters: target.allowed_query_parameters,
    });
    targetsBySource.set(target.source_id, sourceTargets);
  }
  for (const candidate of candidates) {
    if (!candidate.applyUrl) continue;
    try {
      validateNavigationUrl(
        candidate.applyUrl,
        "GET",
        targetsBySource.get(candidate.sourceId) ?? [],
      );
      results.set(candidate.key, candidate.applyUrl);
    } catch {
      // Immutable URLs remain actionable only while the current source allowlist accepts them.
    }
  }
  return results;
}

export interface ImmutableRecommendationJobProjection {
  publishedJobId: string;
  publishedJobVersionId: string;
  display: Omit<JobRecommendationDisplay, "lastVerifiedAt">;
  officialUrl: string | null;
}

export async function getImmutableRecommendationJobProjections(
  db: DbExecutor,
  publishedJobVersionIds: string[],
): Promise<Map<string, ImmutableRecommendationJobProjection>> {
  if (publishedJobVersionIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("catalog.published_job_versions as version")
    .innerJoin(
      "ingestion.source_job_revisions as revision",
      "revision.id",
      "version.source_job_revision_id",
    )
    .innerJoin(
      "ingestion.source_job_records as record",
      "record.id",
      "revision.source_job_record_id",
    )
    .innerJoin("source_control.sources as source", "source.id", "record.source_id")
    .select([
      "version.id as publishedJobVersionId",
      "version.published_job_id as publishedJobId",
      "version.title",
      "version.company_name as companyName",
      "version.locations",
      "version.work_mode as workMode",
      "version.deadline_at as deadlineAt",
      "version.apply_url as applyUrl",
      "source.id as sourceId",
      "source.name as sourceName",
    ])
    .where("version.id", "in", publishedJobVersionIds)
    .execute();
  const approvedUrls = await approvedOfficialLinks(
    db,
    rows.map((row) => ({
      key: row.publishedJobVersionId,
      sourceId: row.sourceId,
      applyUrl: row.applyUrl,
    })),
  );
  return new Map(
    rows.map((row) => [
      row.publishedJobVersionId,
      {
        publishedJobId: row.publishedJobId,
        publishedJobVersionId: row.publishedJobVersionId,
        display: {
          title: row.title,
          companyName: row.companyName,
          locations: parseField(row.locations, z.array(z.string().trim().min(1)).min(1)),
          workMode: parseField(row.workMode, z.string().trim().min(1)),
          deadlineAt: normalizedTimestamp(row.deadlineAt),
          sourceName: row.sourceName,
        },
        officialUrl: approvedUrls.get(row.publishedJobVersionId) ?? null,
      },
    ]),
  );
}

async function approvedOfficialLink(
  db: DbExecutor,
  sourceId: string,
  applyUrl: string | null,
): Promise<string | null> {
  return (
    (await approvedOfficialLinks(db, [{ key: sourceId, sourceId, applyUrl }])).get(sourceId) ?? null
  );
}

export interface CatalogRepository {
  search(query: JobSearchQuery): Promise<JobSearchResponse>;
  collectRecommendationCandidates(
    scope: JobRecommendationScope,
    maximum: number,
  ): Promise<JobSearchItem[]>;
  get(jobId: string): Promise<JobDetail | null>;
}

export function createCatalogRepository(input: {
  db: DbExecutor;
  enableLocalMvp: boolean;
}): CatalogRepository {
  const load = async () =>
    (input.enableLocalMvp ? await loadLocalRows(input.db) : await loadPublicRows(input.db)).map(
      mapRow,
    );

  return {
    async search(query) {
      const response = searchCatalogRecords(await load(), query);
      if (!input.enableLocalMvp) return response;
      const companyQuotaGaps = await loadCompanyQuotaGaps(input.db);
      return companyQuotaGaps.length > 0 ? { ...response, companyQuotaGaps } : response;
    },
    async collectRecommendationCandidates(scope, maximum) {
      const ready = (await load()).filter(
        ({ detail }) =>
          detail.publishedJobVersionId !== null && detail.activeRequirementSetId !== null,
      );
      return collectCatalogSearchItems(ready, scope, maximum);
    },
    async get(jobId) {
      const records = await load();
      const record = records.find(({ detail }) => detail.id === jobId);
      if (!record) return null;
      const rawRows = input.enableLocalMvp
        ? await loadLocalRows(input.db)
        : await loadPublicRows(input.db);
      const raw = rawRows.find((row) => row.job_id === jobId);
      if (!raw) return null;
      const officialLink = await approvedOfficialLink(
        input.db,
        record.detail.source.sourceId,
        raw.apply_url,
      );
      const emailMethod = approvedCompanyEmail(raw.structured_fields, raw.official_domain);
      return JobDetailSchema.parse({
        ...record.detail,
        officialLink,
        applicationMethods: [
          ...(officialLink ? [{ type: "official_url" as const, url: officialLink }] : []),
          ...(emailMethod ? [emailMethod] : []),
        ],
      });
    },
  };
}
