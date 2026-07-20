import type { JobDetail, JobFamily, JobListResponse } from "@aijob/contracts";

type JobSummary = JobListResponse["items"][number];
type FieldState = "known" | "unknown" | "conflict";

interface ContractFieldValue<T> {
  state: FieldState;
  value?: T;
  reason?: string;
  rawValues?: unknown[];
  evidenceRefs?: string[];
}

export interface DisplayField {
  value: string;
  state: FieldState;
  detail?: string;
}

export interface PreviewWarning {
  code: string;
  message: string;
}

export interface PreviewJobSummary {
  id: string;
  versionId: string | null;
  title: string;
  organizationName: string;
  functionTrack: string;
  functionTrackState: FieldState;
  locations: DisplayField;
  daysPerWeek: DisplayField;
  internshipMonths: DisplayField;
  sourceType: string;
  sourceName: string;
  sourceDomain: string;
  lastVerifiedAt: string | null;
  publicationState: string;
  activityState: string;
  displayStatus: string;
  warnings: PreviewWarning[];
}

export interface PreviewRequirement {
  key:
    | "locations"
    | "earliestStartDate"
    | "weeklyAttendanceDays"
    | "durationMonths"
    | "graduationYears"
    | "recruitmentBatch";
  label: string;
  field: DisplayField;
}

export interface PreviewJobDetail extends PreviewJobSummary {
  department: DisplayField;
  jobCode: DisplayField;
  recruitmentType: DisplayField;
  employmentType: DisplayField;
  recruitmentBatch: DisplayField;
  earliestStartDate: DisplayField;
  graduationYears: DisplayField;
  postedAt: DisplayField;
  deadlineAt: DisplayField;
  responsibilities: DisplayField;
  requirements: DisplayField;
  structuredRequirements: PreviewRequirement[];
  source: {
    publisherName: string;
    provenanceLevel: string;
    originalUrl: string | null;
  };
  officialLink: string | null;
  officialLinkDomain: string | null;
  officialLinkIsSafe: boolean;
  internalPreview: {
    policyStatus: string;
    ingestionState: string;
    reviewReasons: string[];
    sourceJobId: string;
    revisionId: string;
    importMode: string;
  } | null;
}

function contractField<T>(field: unknown): ContractFieldValue<T> {
  if (!field || typeof field !== "object") {
    return { state: "unknown", reason: "接口未返回该字段" };
  }

  const candidate = field as Partial<ContractFieldValue<T>>;
  if (
    candidate.state !== "known" &&
    candidate.state !== "unknown" &&
    candidate.state !== "conflict"
  ) {
    return { state: "unknown", reason: "字段状态无法识别" };
  }
  return candidate as ContractFieldValue<T>;
}

function rawValueText(values: unknown[] | undefined) {
  if (!values || values.length === 0) {
    return "来源返回了互相冲突的值";
  }
  return `原始值：${values
    .map((value) => (Array.isArray(value) ? value.map(String).join("、") : String(value)))
    .join(" / ")}`;
}

function displayField<T>(
  field: unknown,
  formatter: (value: T) => string = (value) => String(value),
): DisplayField {
  const normalized = contractField<T>(field);

  if (normalized.state === "known" && normalized.value !== undefined) {
    const formatted = formatter(normalized.value);
    return formatted.trim()
      ? { value: formatted, state: "known" }
      : {
          value: "未说明",
          state: "unknown",
          detail: "来源没有提供可展示的内容",
        };
  }

  if (normalized.state === "conflict") {
    return {
      value: "待核对",
      state: "conflict",
      detail: rawValueText(normalized.rawValues),
    };
  }

  return {
    value: "未说明",
    state: "unknown",
    detail: unknownReasonLabel(normalized.reason),
  };
}

function unknownReasonLabel(reason: string | undefined) {
  const labels: Record<string, string> = {
    source_not_stated: "官方页面未明确说明",
    parse_failed: "本次解析未能确认该字段",
    not_yet_verified: "该字段尚未完成核验",
  };
  return (reason && labels[reason]) || "官方页面未明确说明";
}

function displayText(field: unknown) {
  return displayField<string>(field, (value) => value);
}

function jobFamily(field: unknown): DisplayField {
  const labels: Record<JobFamily, string> = {
    product: "产品",
    operations: "运营",
    engineering: "工程技术",
    data_ai: "数据与 AI",
    design: "设计",
    marketing: "市场营销",
    sales_business: "销售与商务",
    finance: "财务",
    people_admin_legal: "人力、行政与法务",
    research_consulting: "研究与咨询",
    supply_chain_manufacturing: "供应链与制造",
    other: "其他",
  };
  return displayField<JobFamily>(field, (value) => labels[value]);
}

function sourceTypeLabel(value: string) {
  const labels: Record<string, string> = {
    organization_career_site: "企业官网",
    official_ats: "官方 ATS",
    university_employment_site: "高校就业网",
  };
  return labels[value] || value || "未说明";
}

function warningForField(code: string, label: string, field: DisplayField) {
  return field.state === "conflict"
    ? [{ code, message: `${label}存在冲突：${field.detail || "需要人工复核"}` }]
    : [];
}

function mapSummary(job: JobSummary): PreviewJobSummary {
  const track = jobFamily(job.jobFamily);
  const locations = displayField<string[]>(job.locations, (value) => value.join("、"));
  const days = displayField<number>(job.weeklyAttendanceDays, (value) => `每周 ${value} 天`);
  const months = displayField<number>(job.durationMonths, (value) => `${value} 个月`);

  const internalReviewWarnings =
    job.internalPreview?.reviewReasons.map((message, index) => ({
      code: `review_reason_${index + 1}`,
      message,
    })) ?? [];

  return {
    id: job.id,
    versionId: job.publishedJobVersionId,
    title: job.title || "未命名岗位",
    organizationName: job.companyName || "未说明企业",
    functionTrack: track.value,
    functionTrackState: track.state,
    locations,
    daysPerWeek: days,
    internshipMonths: months,
    sourceType: sourceTypeLabel(job.source.type),
    sourceName: job.source.displayName,
    sourceDomain: job.source.domain,
    lastVerifiedAt: job.source.lastVerifiedAt,
    publicationState: job.publicationState,
    activityState: job.activityState,
    displayStatus: job.displayStatus,
    warnings: [
      ...warningForField("job_family_conflict", "岗位方向", track),
      ...warningForField("locations_conflict", "工作地点", locations),
      ...warningForField("attendance_conflict", "每周出勤", days),
      ...warningForField("duration_conflict", "持续时间", months),
      ...internalReviewWarnings,
    ],
  };
}

export function toPreviewJobList(response: JobListResponse) {
  return {
    items: response.items.map(mapSummary),
    nextCursor: response.nextCursor,
  };
}

function normalizeOfficialLink(value: unknown) {
  const url =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "url" in value && typeof value.url === "string"
        ? value.url
        : null;

  if (!url) {
    return { url: null, domain: null, isSafe: false };
  }

  try {
    const parsed = new URL(url);
    return {
      url,
      domain: parsed.hostname,
      isSafe: parsed.protocol === "https:" && Boolean(parsed.hostname),
    };
  } catch {
    return { url, domain: null, isSafe: false };
  }
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "";
}

export function toPreviewJobDetail(job: JobDetail): PreviewJobDetail {
  const summary = mapSummary(job);
  const department = displayText(job.department);
  const jobCode = displayText(job.jobCode);
  const recruitmentType = displayText(job.recruitmentType);
  const employmentType = displayText(job.employmentType);
  const recruitmentBatch = displayText(job.recruitmentBatch);
  const earliestStartDate = displayText(job.earliestStartDate);
  const graduationYears = displayField<number[]>(job.graduationYears, (value) =>
    value.map(String).join("、"),
  );
  const responsibilities = displayText(job.responsibilitiesText);
  const requirements = displayText(job.requirementsText);
  const postedAt = displayField<string>(job.postedAt, (value) => formatAbsoluteDateTime(value));
  const deadlineAt = displayField<string>(job.deadlineAt, (value) => formatAbsoluteDateTime(value));
  const officialLink = normalizeOfficialLink(job.officialLink);
  const internalPreview = job.internalPreview
    ? {
        policyStatus: job.internalPreview.policyStatus,
        ingestionState: job.internalPreview.ingestionState,
        reviewReasons: job.internalPreview.reviewReasons,
        sourceJobId: job.internalPreview.sourceJobId,
        revisionId: job.internalPreview.revisionId,
        importMode: job.internalPreview.importMode,
      }
    : null;

  const detailWarnings = [
    ...warningForField("department_conflict", "部门", department),
    ...warningForField("job_code_conflict", "岗位编号", jobCode),
    ...warningForField("batch_conflict", "招聘批次", recruitmentBatch),
    ...warningForField("arrival_conflict", "到岗时间", earliestStartDate),
    ...warningForField("graduation_conflict", "毕业年份", graduationYears),
    ...warningForField("responsibilities_conflict", "岗位职责", responsibilities),
    ...warningForField("requirements_conflict", "岗位要求", requirements),
  ];

  return {
    ...summary,
    warnings: [...summary.warnings, ...detailWarnings],
    department,
    jobCode,
    recruitmentType,
    employmentType,
    recruitmentBatch,
    earliestStartDate,
    graduationYears,
    postedAt,
    deadlineAt,
    responsibilities,
    requirements,
    structuredRequirements: [
      { key: "locations", label: "城市 / 地点", field: summary.locations },
      {
        key: "earliestStartDate",
        label: "最早到岗时间",
        field: earliestStartDate,
      },
      {
        key: "weeklyAttendanceDays",
        label: "每周出勤",
        field: summary.daysPerWeek,
      },
      {
        key: "durationMonths",
        label: "持续时间",
        field: summary.internshipMonths,
      },
      {
        key: "graduationYears",
        label: "毕业年份",
        field: graduationYears,
      },
      {
        key: "recruitmentBatch",
        label: "招聘批次",
        field: recruitmentBatch,
      },
    ],
    source: {
      publisherName: job.companyName,
      provenanceLevel: provenanceLevelLabel(job.source.provenanceLevel),
      originalUrl: optionalText(job.source.originalUrl) || null,
    },
    officialLink: officialLink.url,
    officialLinkDomain: officialLink.domain,
    officialLinkIsSafe: officialLink.isSafe,
    internalPreview,
  };
}

function provenanceLevelLabel(value: string) {
  const labels: Record<string, string> = {
    organization_owned: "企业自有招聘域名",
    verified_ats_tenant: "已核验企业 ATS 租户",
    university_published: "高校就业网发布",
    official_account_link: "企业认证公开账号链接",
    unverified: "尚未核验",
  };
  return labels[value] || value || "未说明";
}

export function formatAbsoluteDateTime(value: string | null) {
  if (!value) return "未说明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间格式待核对";

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

export function activityLabel(value: string) {
  const labels: Record<string, string> = {
    active: "页面仍可访问",
    uncertain: "状态未知",
    closed: "已关闭",
  };
  return labels[value] || "状态未知";
}

export function publicationLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    review: "待发布复核",
    published: "已发布",
    suppressed: "已暂停",
    archived: "已归档",
  };
  return labels[value] || "待发布复核";
}

export function displayStatusLabel(value: string) {
  const labels: Record<string, string> = {
    recruiting: "招聘中",
    pending_review: "待复查",
    closed: "已关闭",
    unknown: "状态未知",
  };
  return labels[value] || "状态未知";
}

export function fieldStateLabel(value: FieldState) {
  if (value === "known") return "已提取";
  if (value === "conflict") return "存在冲突";
  return "未说明";
}
