import { randomUUID } from "node:crypto";
import {
  type FieldValue,
  fieldValueSchema,
  JobFamilySchema,
  type JobRequirement,
  type RequirementKind,
  type RequirementNecessity,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, type Selectable, sql, type Transaction } from "kysely";
import { z } from "zod";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { semanticRevisionValue } from "../sources/normalized-official-job.js";
import { findCrossSourceDuplicateCandidates } from "./dedupe.js";
import {
  decomposeKnownJobRequirements,
  decomposeTextualJobRequirements,
  splitRequirementClauses,
} from "./requirements.js";

type RevisionRow = Selectable<Database["ingestion.source_job_revisions"]>;
type DbExecutor = Kysely<Database> | Transaction<Database>;

const REQUIREMENT_SCHEMA_VERSION = "deterministic-requirements-v4";
const LOCAL_CATALOG_MATERIALIZATION_LOCK_KEY = "aijob:local-catalog-materialization:v1";

const NumberFieldSchema = fieldValueSchema(z.number());
const DateFieldSchema = fieldValueSchema(z.string().trim().min(1));
const NumberListFieldSchema = fieldValueSchema(z.array(z.number()).min(1));
const StringListFieldSchema = fieldValueSchema(z.array(z.string().trim().min(1)).min(1));

function parseField<T>(value: JsonValue, schema: z.ZodType<FieldValue<T>>): FieldValue<T> {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : { state: "unknown", reason: "parse_failed" };
}

function asObject(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function chooseField(explicit: JsonValue, fallback: JsonValue | undefined): JsonValue {
  const object = asObject(explicit);
  return object.state === "known" || object.state === "conflict"
    ? explicit
    : (fallback ?? explicit);
}

function requirementField<T>(
  value: FieldValue<T>,
  sourceText: string,
  necessity: RequirementNecessity = "required",
): { value: FieldValue<T>; sourceText?: string; necessity: RequirementNecessity } {
  return {
    value,
    ...(sourceText.trim() ? { sourceText: sourceText.trim() } : {}),
    necessity,
  };
}

const unknownProjection = { state: "unknown", reason: "source_not_stated" } as const;

function projectedField(requirements: JobRequirement[], kind: RequirementKind): JsonValue {
  const candidates = requirements.filter(
    (requirement) =>
      requirement.kind === kind &&
      requirement.operator !== "unknown" &&
      requirement.necessity !== "optional",
  );
  if (candidates.length === 0) return unknownProjection;

  const values = candidates.map(({ expectedValue }) => expectedValue);
  const canonical = new Set(values.map((value) => JSON.stringify(value)));
  if (canonical.size !== 1) {
    return {
      state: "conflict",
      rawValues: values.map((value) => JSON.stringify(value)),
      evidenceRefs: candidates.map(({ id }) => id),
    };
  }
  const candidate = candidates[0];
  if (!candidate) return unknownProjection;
  const supportsProjection =
    candidate.operator === "equals" ||
    candidate.operator === "one_of" ||
    candidate.operator === "at_least" ||
    candidate.operator === "before_or_on" ||
    candidate.operator === "contains";
  if (!supportsProjection) return { state: "unknown", reason: "parse_failed" };
  return {
    state: "known",
    value: candidate.expectedValue,
    evidenceRefs: candidates.map(({ id }) => id),
  } as JsonValue;
}

function exactRequirementExcerpt(sourceText: string, pattern: RegExp): string {
  return splitRequirementClauses(sourceText).find((clause) => pattern.test(clause)) ?? "";
}

function versionContent(revision: RevisionRow) {
  const structured = asObject(revision.structured_fields);
  return {
    companyName: revision.company_name,
    title: revision.title,
    jobFamily: semanticRevisionValue(revision.job_family),
    locations: semanticRevisionValue(revision.locations),
    department: semanticRevisionValue(revision.department),
    jobCode: semanticRevisionValue(revision.job_code),
    recruitmentType: semanticRevisionValue(revision.recruitment_type),
    employmentType: semanticRevisionValue(revision.employment_type),
    recruitmentBatch: semanticRevisionValue(
      chooseField(revision.recruitment_batch, structured.recruitmentBatch),
    ),
    weeklyAttendanceDays: semanticRevisionValue(
      chooseField(revision.weekly_attendance_days, structured.weeklyAttendanceDays),
    ),
    durationMonths: semanticRevisionValue(
      chooseField(revision.duration_months, structured.durationMonths),
    ),
    earliestStartDate: semanticRevisionValue(
      chooseField(revision.earliest_start_date, structured.arrivalTime),
    ),
    graduationYears: semanticRevisionValue(
      chooseField(revision.graduation_years, structured.graduationYears),
    ),
    educationLevels: semanticRevisionValue(revision.education_levels),
    majors: semanticRevisionValue(revision.majors),
    languages: semanticRevisionValue(revision.languages),
    salary: semanticRevisionValue(revision.salary),
    workMode: semanticRevisionValue(revision.work_mode),
    postedAt: semanticRevisionValue(chooseField(revision.posted_at, structured.publishedAt)),
    deadlineAt: semanticRevisionValue(chooseField(revision.deadline_at, structured.deadline)),
    responsibilities: revision.responsibilities,
    requirements: revision.requirements,
    structuredFields: semanticRevisionValue(revision.structured_fields),
    activityState: revision.activity_state,
    sourceUrl: revision.source_url,
    applyUrl: revision.apply_url,
  };
}

async function findOrCreatePublishedJob(
  transaction: Transaction<Database>,
  sourceJobRecordId: string,
): Promise<string> {
  const existing = await transaction
    .selectFrom("catalog.published_jobs")
    .innerJoin(
      "catalog.published_job_versions",
      "catalog.published_job_versions.published_job_id",
      "catalog.published_jobs.id",
    )
    .innerJoin(
      "ingestion.source_job_revisions",
      "ingestion.source_job_revisions.id",
      "catalog.published_job_versions.source_job_revision_id",
    )
    .select("catalog.published_jobs.id")
    .where("ingestion.source_job_revisions.source_job_record_id", "=", sourceJobRecordId)
    .limit(1)
    .executeTakeFirst();
  if (existing) return existing.id;
  return (
    await transaction
      .insertInto("catalog.published_jobs")
      .values({ id: randomUUID(), current_version_id: null })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
}

async function materializeRevision(
  transaction: Transaction<Database>,
  revision: RevisionRow,
): Promise<{ createdVersion: boolean; createdRequirementSet: boolean }> {
  const publishedJobId = await findOrCreatePublishedJob(transaction, revision.source_job_record_id);
  const contentHash = hashCanonicalJson(versionContent(revision));
  const structured = asObject(revision.structured_fields);
  let version = await transaction
    .selectFrom("catalog.published_job_versions")
    .selectAll()
    .where("published_job_id", "=", publishedJobId)
    .where("content_hash", "=", contentHash)
    .executeTakeFirst();
  const createdVersion = !version;
  if (!version) {
    version = await transaction
      .insertInto("catalog.published_job_versions")
      .values({
        id: randomUUID(),
        published_job_id: publishedJobId,
        source_job_revision_id: revision.id,
        content_hash: contentHash,
        company_name: revision.company_name,
        title: revision.title,
        job_family: revision.job_family,
        locations: revision.locations,
        department: revision.department,
        job_code: revision.job_code,
        recruitment_type: revision.recruitment_type,
        employment_type: revision.employment_type,
        recruitment_batch: chooseField(revision.recruitment_batch, structured.recruitmentBatch),
        weekly_attendance_days: chooseField(
          revision.weekly_attendance_days,
          structured.weeklyAttendanceDays,
        ),
        duration_months: chooseField(revision.duration_months, structured.durationMonths),
        earliest_start_date: chooseField(revision.earliest_start_date, structured.arrivalTime),
        graduation_years: chooseField(revision.graduation_years, structured.graduationYears),
        education_levels: revision.education_levels,
        majors: revision.majors,
        languages: revision.languages,
        salary: revision.salary,
        work_mode: revision.work_mode,
        posted_at: chooseField(revision.posted_at, structured.publishedAt),
        deadline_at: chooseField(revision.deadline_at, structured.deadline),
        responsibilities: revision.responsibilities,
        requirements: revision.requirements,
        structured_fields: revision.structured_fields,
        activity_state: revision.activity_state,
        source_url: revision.source_url,
        apply_url: revision.apply_url,
        effective_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  await transaction
    .insertInto("catalog.published_job_version_revision_links")
    .values({
      published_job_version_id: version.id,
      source_job_revision_id: revision.id,
    })
    .onConflict((conflict) =>
      conflict.columns(["published_job_version_id", "source_job_revision_id"]).doNothing(),
    )
    .execute();
  if (revision.publication_state === "published") {
    await transaction
      .updateTable("catalog.published_job_versions")
      .set({ source_job_revision_id: revision.id })
      .where("id", "=", version.id)
      .execute();
  }
  await transaction
    .updateTable("catalog.published_jobs")
    .set({
      current_version_id: version.id,
      ...(revision.publication_state === "published" ? { public_version_id: version.id } : {}),
    })
    .where("id", "=", publishedJobId)
    .execute();

  const sourceText = revision.requirements;
  const structuredRequirements = decomposeKnownJobRequirements({
    publishedJobVersionId: version.id,
    locations: requirementField(
      parseField(revision.locations, StringListFieldSchema),
      parseField(revision.locations, StringListFieldSchema).state === "known"
        ? (parseField(revision.locations, StringListFieldSchema) as { value: string[] }).value.join(
            "、",
          )
        : "",
      "preferred",
    ),
    earliestStartDate: requirementField(
      parseField(
        chooseField(revision.earliest_start_date, structured.arrivalTime),
        DateFieldSchema,
      ),
      exactRequirementExcerpt(sourceText, /(?:到岗|入职|开始实习)/),
    ),
    weeklyAttendanceDays: requirementField(
      parseField(
        chooseField(revision.weekly_attendance_days, structured.weeklyAttendanceDays),
        NumberFieldSchema,
      ),
      exactRequirementExcerpt(sourceText, /(?:每周|一周).*(?:天|工作日)/),
    ),
    durationMonths: requirementField(
      parseField(
        chooseField(revision.duration_months, structured.durationMonths),
        NumberFieldSchema,
      ),
      exactRequirementExcerpt(sourceText, /(?:实习|连续).*(?:个)?月/),
    ),
    graduationYears: requirementField(
      parseField(
        chooseField(revision.graduation_years, structured.graduationYears),
        NumberListFieldSchema,
      ),
      exactRequirementExcerpt(
        sourceText,
        /(?:20\d{2}).{0,8}(?:届|毕业)|(?:届|毕业).{0,8}(?:20\d{2})/,
      ),
    ),
    educationLevels: requirementField(
      parseField(revision.education_levels, StringListFieldSchema),
      exactRequirementExcerpt(sourceText, /(?:学历|大专|专科|本科|硕士|博士)/),
    ),
    majors: requirementField(
      parseField(revision.majors, StringListFieldSchema),
      exactRequirementExcerpt(sourceText, /专业/),
    ),
    languages: requirementField(
      parseField(revision.languages, StringListFieldSchema),
      exactRequirementExcerpt(sourceText, /(?:英语|语言|CET[- ]?[46]|雅思|托福|TOEFL|IELTS)/i),
    ),
  });
  const textualRequirements = decomposeTextualJobRequirements({
    publishedJobVersionId: version.id,
    sourceText,
    evidenceRefPrefix: `source-job-revision:${revision.id}:requirements`,
  });
  const requirementsBySource = new Map(
    structuredRequirements.map((requirement) => [
      `${requirement.kind}:${requirement.sourceText}`,
      requirement,
    ]),
  );
  for (const requirement of textualRequirements) {
    const key = `${requirement.kind}:${requirement.sourceText}`;
    const existing = requirementsBySource.get(key);
    if (!existing) {
      requirementsBySource.set(key, requirement);
    } else if (requirement.necessity === "preferred" && existing.necessity === "required") {
      requirementsBySource.set(key, { ...existing, necessity: "preferred" });
    }
  }
  const requirements = [...requirementsBySource.values()];
  const requirementHash = hashCanonicalJson({
    schemaVersion: REQUIREMENT_SCHEMA_VERSION,
    requirements,
  });
  const insertedRequirementSet = await transaction
    .insertInto("catalog.job_requirement_sets")
    .values({
      id: randomUUID(),
      published_job_version_id: version.id,
      schema_version: REQUIREMENT_SCHEMA_VERSION,
      requirements: JSON.stringify(requirements),
      content_hash: requirementHash,
    })
    .onConflict((conflict) =>
      conflict.columns(["published_job_version_id", "content_hash"]).doNothing(),
    )
    .returning("id")
    .executeTakeFirst();
  const requirementSetId =
    insertedRequirementSet?.id ??
    (
      await transaction
        .selectFrom("catalog.job_requirement_sets")
        .select("id")
        .where("published_job_version_id", "=", version.id)
        .where("content_hash", "=", requirementHash)
        .executeTakeFirstOrThrow()
    ).id;
  const projection = {
    locations: projectedField(requirements, "city"),
    weekly_attendance_days: projectedField(requirements, "weekly_attendance"),
    duration_months: projectedField(requirements, "duration"),
    earliest_start_date: projectedField(requirements, "arrival_date"),
    graduation_years: projectedField(requirements, "graduation_year"),
    student_status: projectedField(requirements, "student_status"),
    education_levels: projectedField(requirements, "education"),
    majors: projectedField(requirements, "major"),
    languages: projectedField(requirements, "language"),
  };
  await transaction
    .insertInto("catalog.job_condition_projections")
    .values({
      published_job_version_id: version.id,
      requirement_set_id: requirementSetId,
      ...projection,
    })
    .onConflict((conflict) =>
      conflict.column("published_job_version_id").doUpdateSet({
        requirement_set_id: requirementSetId,
        ...projection,
        updated_at: new Date(),
      }),
    )
    .execute();
  await transaction
    .updateTable("catalog.published_job_versions")
    .set({ active_requirement_set_id: requirementSetId })
    .where("id", "=", version.id)
    .execute();
  return {
    createdVersion,
    createdRequirementSet: insertedRequirementSet !== undefined,
  };
}

export interface LocalCatalogMaterializationResult {
  eligibleRevisions: number;
  createdVersions: number;
  createdRequirementSets: number;
  suspectedDuplicatePairs: number;
  quotaSelectedJobs: number;
  quotaSuppressedJobs: number;
}

// ADR-0021：无已接受 small/medium 规模证据的企业单家配额压缩到 10 条；
// 有证据的中小企业维持 30 条。择优保留 ADR-0020 两条优先轨道岗位。
const NON_SME_COMPANY_QUOTA = 10;
const SME_COMPANY_QUOTA = 30;
const SME_SCALE_BANDS = new Set(["small", "medium"]);
const PRIORITY_TRACK_FAMILIES = new Set(["product", "operations", "engineering", "data_ai"]);

function isPriorityTrackFamily(jobFamily: JsonValue): boolean {
  const field = asObject(jobFamily);
  return (
    field.state === "known" &&
    typeof field.value === "string" &&
    PRIORITY_TRACK_FAMILIES.has(field.value)
  );
}

export interface CompanyQuotaApplication {
  selectedJobs: number;
  suppressedJobs: number;
}

/**
 * 确定性计算并整表重写单家配额选择（ADR-0021）。
 * 排序键：优先轨道岗位在前，其余按 published_jobs.created_at 与 id 稳定排序；
 * 不删除任何岗位版本或来源修订，仅在读取层过滤并公开缺口。
 */
export async function applyCompanyQuotaSelections(
  db: DbExecutor,
): Promise<CompanyQuotaApplication> {
  const rows = await db
    .selectFrom("catalog.published_jobs as job")
    .innerJoin("catalog.published_job_versions as version", "version.id", "job.current_version_id")
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
    .innerJoin(
      "source_control.organizations as organization",
      "organization.id",
      "source.organization_id",
    )
    .select([
      "job.id as jobId",
      "job.created_at as createdAt",
      "version.company_name as companyName",
      "version.job_family as jobFamily",
      "organization.scale_band as scaleBand",
    ])
    .where(sql<boolean>`EXISTS (
      SELECT 1
      FROM catalog.current_job_effective_activity AS activity
      WHERE activity.published_job_version_id = version.id
        AND activity.effective_activity_state <> 'closed'
    )`)
    .execute();

  const byCompany = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = byCompany.get(row.companyName) ?? [];
    group.push(row);
    byCompany.set(row.companyName, group);
  }

  let selectedJobs = 0;
  let suppressedJobs = 0;
  const values: Array<{
    published_job_id: string;
    company_name: string;
    scale_band: string;
    quota: number;
    supply: number;
    selection_rank: number;
    selected: boolean;
  }> = [];
  for (const [companyName, group] of byCompany) {
    // 同名公司出现多个来源组织时，只要任一组织有已接受的中小规模证据即按中小配额。
    const smeEvidence = group.some((row) => SME_SCALE_BANDS.has(row.scaleBand));
    const scaleBand = smeEvidence
      ? (group.find((row) => SME_SCALE_BANDS.has(row.scaleBand))?.scaleBand ?? "unknown")
      : (group[0]?.scaleBand ?? "unknown");
    const quota = smeEvidence ? SME_COMPANY_QUOTA : NON_SME_COMPANY_QUOTA;
    const ranked = [...group].sort((left, right) => {
      const leftPriority = isPriorityTrackFamily(left.jobFamily) ? 0 : 1;
      const rightPriority = isPriorityTrackFamily(right.jobFamily) ? 0 : 1;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      const timeOrder = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      if (timeOrder !== 0) return timeOrder;
      return left.jobId < right.jobId ? -1 : left.jobId > right.jobId ? 1 : 0;
    });
    for (const [index, row] of ranked.entries()) {
      const selected = index < quota;
      if (selected) selectedJobs += 1;
      else suppressedJobs += 1;
      values.push({
        published_job_id: row.jobId,
        company_name: companyName,
        scale_band: scaleBand,
        quota,
        supply: ranked.length,
        selection_rank: index + 1,
        selected,
      });
    }
  }

  await db.deleteFrom("catalog.company_quota_selections").execute();
  if (values.length > 0) {
    await db.insertInto("catalog.company_quota_selections").values(values).execute();
  }
  return { selectedJobs, suppressedJobs };
}

async function persistCrossSourceDuplicateReviews(
  db: DbExecutor,
  revisionIds: string[],
): Promise<number> {
  if (revisionIds.length < 2) return 0;
  const rows = await db
    .selectFrom("ingestion.source_job_revisions")
    .innerJoin(
      "ingestion.source_job_records",
      "ingestion.source_job_records.id",
      "ingestion.source_job_revisions.source_job_record_id",
    )
    .innerJoin(
      "source_control.sources",
      "source_control.sources.id",
      "ingestion.source_job_records.source_id",
    )
    .innerJoin(
      "source_control.organizations",
      "source_control.organizations.id",
      "source_control.sources.organization_id",
    )
    .select([
      "ingestion.source_job_revisions.id as id",
      "source_control.sources.id as sourceId",
      "ingestion.source_job_revisions.company_name as companyName",
      "ingestion.source_job_revisions.title as title",
      "ingestion.source_job_revisions.locations as locations",
      "source_control.organizations.official_domain as officialDomain",
    ])
    .where("ingestion.source_job_revisions.id", "in", revisionIds)
    .execute();
  const pairs = findCrossSourceDuplicateCandidates(
    rows.map((row) => ({
      id: row.id,
      sourceId: row.sourceId,
      companyName: row.companyName,
      title: row.title,
      locations: parseField(row.locations, StringListFieldSchema),
      officialDomain: row.officialDomain,
    })),
  );
  const candidatesByRevision = new Map<
    string,
    Array<{ otherRevisionId: string; score: number; reasons: string[] }>
  >();
  for (const pair of pairs) {
    for (const [revisionId, otherRevisionId] of [
      [pair.leftJobId, pair.rightJobId],
      [pair.rightJobId, pair.leftJobId],
    ] as const) {
      const candidates = candidatesByRevision.get(revisionId) ?? [];
      candidates.push({ otherRevisionId, score: pair.score, reasons: pair.reasons });
      candidatesByRevision.set(revisionId, candidates);
    }
  }
  for (const [revisionId, candidates] of candidatesByRevision) {
    const details = JSON.stringify({
      candidates: candidates.sort((left, right) =>
        left.otherRevisionId.localeCompare(right.otherRevisionId),
      ),
    });
    await db
      .insertInto("ingestion.review_items")
      .values({
        id: randomUUID(),
        revision_id: revisionId,
        reason_code: "CROSS_SOURCE_DUPLICATE_CANDIDATE",
        status: "open",
        details,
        resolved_at: null,
      })
      .onConflict((conflict) =>
        conflict.columns(["revision_id", "reason_code"]).doUpdateSet({
          details,
        }),
      )
      .execute();
  }
  return pairs.length;
}

export async function lockLocalCatalogMaterialization(
  transaction: Transaction<Database>,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${LOCAL_CATALOG_MATERIALIZATION_LOCK_KEY}, 0))`.execute(
    transaction,
  );
}

export async function materializeLocalCatalog(
  db: Kysely<Database>,
): Promise<LocalCatalogMaterializationResult> {
  return db.transaction().execute(async (transaction) => {
    await lockLocalCatalogMaterialization(transaction);
    const revisions = await transaction
      .selectFrom("catalog.internal_job_previews")
      .innerJoin(
        "ingestion.source_job_revisions",
        "ingestion.source_job_revisions.id",
        "catalog.internal_job_previews.revision_id",
      )
      .selectAll("ingestion.source_job_revisions")
      .where("catalog.internal_job_previews.ingestion_state", "=", "validated")
      .where("catalog.internal_job_previews.publication_state", "in", ["review", "published"])
      .where("catalog.internal_job_previews.policy_status", "in", ["pending_review", "approved"])
      .execute();

    let createdVersions = 0;
    let createdRequirementSets = 0;
    for (const revision of revisions) {
      const result = await materializeRevision(transaction, revision);
      if (result.createdVersion) createdVersions += 1;
      if (result.createdRequirementSet) createdRequirementSets += 1;
    }
    const suspectedDuplicatePairs = await persistCrossSourceDuplicateReviews(
      transaction,
      revisions.map(({ id }) => id),
    );
    const quota = await applyCompanyQuotaSelections(transaction);
    return {
      eligibleRevisions: revisions.length,
      createdVersions,
      createdRequirementSets,
      suspectedDuplicatePairs,
      quotaSelectedJobs: quota.selectedJobs,
      quotaSuppressedJobs: quota.suppressedJobs,
    };
  });
}

export const localCatalogMaterializationSchemas = {
  jobFamily: fieldValueSchema(JobFamilySchema),
  number: NumberFieldSchema,
  date: DateFieldSchema,
  numberList: NumberListFieldSchema,
  stringList: StringListFieldSchema,
};
