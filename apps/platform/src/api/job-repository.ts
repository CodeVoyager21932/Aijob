import type {
  FieldValue,
  JobDetail,
  JobListResponse,
  JobSummary,
  SourceType,
} from "@aijob/contracts";
import { JobDetailSchema, JobListResponseSchema } from "@aijob/contracts";
import type { Database, InternalJobPreviewView, JsonValue } from "@aijob/database";
import type { Kysely, Selectable } from "kysely";
import { validateNavigationUrl } from "../ingestion/safe-http.js";

type PreviewRow = Selectable<InternalJobPreviewView>;

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function unknown<T>(
  reason: "source_not_stated" | "parse_failed" | "not_yet_verified" = "source_not_stated",
): FieldValue<T> {
  return { state: "unknown", reason };
}

function known<T>(value: T, revisionId: string, field: string): FieldValue<T> {
  return { state: "known", value, evidenceRefs: [`${revisionId}#${field}`] };
}

function asObject(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function asFieldValue<T>(value: JsonValue | undefined): FieldValue<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return unknown("parse_failed");
  }
  return value as unknown as FieldValue<T>;
}

function reviewReasonMessage(reason: string): string {
  const messages: Record<string, string> = {
    SOURCE_POLICY_PENDING: "来源访问政策仍待审批，仅允许本地预览。",
    STRUCTURED_FIELDS_MISSING: "部分实习条件未在官方页面明确说明。",
    TARGET_SCOPE_REVIEW_REQUIRED: "岗位方向仍需要人工确认。",
    RECRUITMENT_LABEL_CONFLICT: "招聘入口与岗位自身标签存在冲突。",
  };
  return messages[reason] ?? `待复核：${reason}`;
}

function displayStatus(row: PreviewRow): "recruiting" | "pending_review" | "closed" | "unknown" {
  if (row.activity_state === "closed") return "closed";
  if (row.activity_state === "uncertain") return "unknown";
  return row.publication_state === "published" ? "recruiting" : "pending_review";
}

function previewMetadata(row: PreviewRow): JobSummary["internalPreview"] {
  const reasons = Array.isArray(row.review_reasons)
    ? row.review_reasons.map(String).map(reviewReasonMessage)
    : [];
  return {
    mode: "internal_preview",
    policyStatus: row.policy_status as "pending_review",
    ingestionState: row.ingestion_state as "validated",
    reviewReasons: reasons.length > 0 ? reasons : ["该岗位尚未完成正式发布复核。"],
    sourceJobId: row.source_job_id,
    revisionId: row.revision_id,
    importMode: row.import_mode as "collector" | "manual",
  };
}

function summaryFromPreview(row: PreviewRow): JobSummary {
  const structured = asObject(row.structured_fields);
  return {
    id: row.job_id,
    publishedJobVersionId: null,
    companyName: row.company_name,
    title: row.title,
    jobFamily: asFieldValue(row.job_family),
    locations: asFieldValue(row.locations),
    weeklyAttendanceDays: asFieldValue(structured.weeklyAttendanceDays),
    durationMonths: asFieldValue(structured.durationMonths),
    source: {
      sourceId: row.source_id,
      type: row.source_type as SourceType,
      provenanceLevel: row.provenance_level as "organization_owned",
      displayName: row.source_name,
      domain: row.official_domain,
      lastVerifiedAt: toIso(row.last_verified_at),
    },
    publicationState: row.publication_state as "review",
    activityState: row.activity_state as "active" | "uncertain" | "closed",
    displayStatus: displayStatus(row),
    internalPreview: previewMetadata(row),
  };
}

async function approvedOfficialLink(db: Kysely<Database>, row: PreviewRow): Promise<string | null> {
  if (!row.apply_url) return null;
  const targets = await db
    .selectFrom("source_control.source_apply_targets")
    .innerJoin(
      "source_control.sources",
      "source_control.sources.id",
      "source_control.source_apply_targets.source_id",
    )
    .select([
      "source_control.source_apply_targets.method",
      "source_control.source_apply_targets.scheme",
      "source_control.source_apply_targets.host",
      "source_control.source_apply_targets.port",
      "source_control.source_apply_targets.path_prefix",
      "source_control.source_apply_targets.allow_redirects",
      "source_control.source_apply_targets.allowed_query_parameters",
    ])
    .where("source_control.source_apply_targets.source_id", "=", row.source_id)
    .whereRef(
      "source_control.source_apply_targets.policy_version",
      "=",
      "source_control.sources.current_policy_version",
    )
    .execute();

  try {
    validateNavigationUrl(
      row.apply_url,
      "GET",
      targets.map((target) => ({
        method: target.method as "GET",
        scheme: target.scheme as "https",
        host: target.host,
        port: target.port as 443,
        pathPrefix: target.path_prefix,
        allowRedirects: target.allow_redirects,
        allowedQueryParameters: target.allowed_query_parameters,
      })),
    );
    return row.apply_url;
  } catch {
    return null;
  }
}

function safeText(value: string, revisionId: string, field: string): FieldValue<string> {
  return value.trim() ? known(value, revisionId, field) : unknown();
}

function normalizedGraduationYears(value: JsonValue | undefined): FieldValue<number[]> {
  const field = asFieldValue<unknown>(value);
  if (field.state !== "known") return field as FieldValue<number[]>;
  if (!Array.isArray(field.value)) return unknown("parse_failed");
  const years = field.value.map(Number);
  if (years.some((year) => !Number.isInteger(year))) return unknown("parse_failed");
  return { ...field, value: years } as FieldValue<number[]>;
}

function detailFromPreview(row: PreviewRow, officialLink: string | null): JobDetail {
  const summary = summaryFromPreview(row);
  const structured = asObject(row.structured_fields);
  return {
    ...summary,
    source: {
      ...summary.source,
      originalUrl: row.source_url,
    },
    department: unknown(),
    jobCode: known(row.source_job_id, row.revision_id, "sourceJobId"),
    recruitmentType: asFieldValue(row.recruitment_type),
    employmentType: unknown("not_yet_verified"),
    recruitmentBatch: asFieldValue(structured.recruitmentBatch),
    earliestStartDate: asFieldValue(structured.arrivalTime),
    graduationYears: normalizedGraduationYears(structured.graduationYears),
    postedAt: asFieldValue(structured.publishedAt),
    deadlineAt: asFieldValue(structured.deadline),
    responsibilitiesText: safeText(row.responsibilities, row.revision_id, "responsibilities"),
    requirementsText: safeText(row.requirements, row.revision_id, "requirements"),
    officialLink,
  };
}

export async function listInternalPreviewJobs(
  db: Kysely<Database>,
  limit: number,
): Promise<JobListResponse> {
  const rows = await db
    .selectFrom("catalog.internal_job_previews")
    .selectAll()
    .orderBy("last_verified_at", "desc")
    .orderBy("job_id", "asc")
    .limit(limit)
    .execute();
  return JobListResponseSchema.parse({
    items: rows.map(summaryFromPreview),
    nextCursor: null,
  });
}

export async function getInternalPreviewJob(
  db: Kysely<Database>,
  jobId: string,
): Promise<JobDetail | null> {
  const row = await db
    .selectFrom("catalog.internal_job_previews")
    .selectAll()
    .where("job_id", "=", jobId)
    .executeTakeFirst();
  if (!row) return null;
  const officialLink = await approvedOfficialLink(db, row);
  return JobDetailSchema.parse(detailFromPreview(row, officialLink));
}

export async function listPublishedJobs(): Promise<JobListResponse> {
  // Publication requires an explicit ops review path, which is intentionally outside slice 1.
  return JobListResponseSchema.parse({ items: [], nextCursor: null });
}

export async function getPublishedJob(): Promise<JobDetail | null> {
  return null;
}
