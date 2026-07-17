import { z } from "zod";
import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import type { ProbeQueryStream } from "./source-config.js";

export const TENCENT_ADAPTER_VERSION = "0.1.2";
export const TENCENT_NORMALIZER_VERSION = "0.1.2";

const sourceIdentifier = z.string().min(1);

export const tencentListItemSchema = z
  .object({
    id: z.number().int(),
    position: z.number().int(),
    positionTitle: z.string().min(1),
    positionFamily: z.number().int(),
    projectId: z.number().int(),
    bgs: z.string(),
    workCities: z.string(),
    positionUrl: z.string().nullable(),
    positionSource: z.string(),
    projectName: z.string().nullable(),
    recruitLabelName: z.string().nullable(),
    groupTag: z.string().nullable(),
    postId: sourceIdentifier,
  })
  .passthrough();

export const tencentSearchResponseSchema = z
  .object({
    message: z.string(),
    status: z.literal(0),
    data: z.object({
      positionList: z.array(tencentListItemSchema),
      count: z.number().int().nonnegative(),
    }),
  })
  .passthrough();

const departmentSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    bgid: z.number().int(),
    comment: z.string().nullable(),
    ordering: z.number().int(),
    enableFlag: z.number().int(),
    workCity: z.string(),
    workCityList: z.array(z.string()),
  })
  .passthrough();

const businessGroupSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    showTitle: z.string(),
    showTxt: z.string(),
    departmentList: z.array(departmentSchema),
  })
  .passthrough();

export const tencentDetailResponseSchema = z
  .object({
    message: z.string(),
    status: z.literal(0),
    data: z
      .object({
        postId: sourceIdentifier,
        id: z.number().int(),
        tid: z.number().int(),
        tidName: z.string(),
        fid: z.number().int(),
        title: z.string().min(1),
        desc: z.string(),
        request: z.string(),
        workCity: z.string(),
        workCityList: z.array(z.string()),
        intentionBGDList: z.array(businessGroupSchema),
        projectId: z.number().int(),
        projectName: z.string().nullable(),
        recruitType: z.number().int(),
        recruitLabelName: z.string().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

export type TencentListItem = z.infer<typeof tencentListItemSchema>;
export type TencentSearchResponse = z.infer<typeof tencentSearchResponseSchema>;
export type TencentDetailResponse = z.infer<typeof tencentDetailResponseSchema>;
export type TencentDetail = TencentDetailResponse["data"];

export function isTencentStablePostId(postId: string): boolean {
  return /^[1-9]\d+$/.test(postId);
}

export interface TencentSearchRequest {
  projectIdList: [];
  projectMappingIdList: number[];
  keyword: string;
  bgList: [];
  workCountryType: 0;
  workCityList: [];
  recruitCityList: [];
  positionFidList: number[];
  pageIndex: number;
  pageSize: number;
}

type EvidenceField<T> =
  | { state: "known"; value: T; evidenceRefs: string[] }
  | {
      state: "unknown";
      reason: "source_not_stated" | "parse_failed" | "not_yet_verified";
    }
  | { state: "conflict"; rawValues: string[]; evidenceRefs: string[] };

export interface NormalizedTencentJob {
  sourceJobId: string;
  companyName: string;
  title: string;
  jobFamily: EvidenceField<"product" | "operations" | "other">;
  locations: EvidenceField<string[]>;
  businessGroups: string[];
  entryScope: string;
  sourceProjectName: string | null;
  recruitLabelName: string | null;
  recruitmentType: EvidenceField<string>;
  responsibilities: string;
  requirements: string;
  structuredFields: {
    arrivalTime: EvidenceField<string>;
    weeklyAttendanceDays: EvidenceField<number>;
    durationMonths: EvidenceField<number>;
    graduationYears: EvidenceField<string[]>;
    recruitmentBatch: EvidenceField<string>;
    publishedAt: EvidenceField<string>;
    deadline: EvidenceField<string>;
  };
  ingestionState: "validated";
  publicationState: "review";
  activityState: "active";
  sourceUrl: string;
  applyUrl: string;
  qualityFlags: Array<{ code: string; detail: string }>;
  reviewReasons: Array<{ code: string; details: Record<string, unknown> }>;
  revisionContentHash: string;
  evidence: Array<{
    role: "list" | "detail";
    fieldName: string;
    jsonPointer: string;
    rawValueHash: string;
  }>;
}

function semanticRevisionValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(semanticRevisionValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "evidenceRefs")
        .map(([key, nestedValue]) => [key, semanticRevisionValue(nestedValue)]),
    );
  }
  return value;
}

export function buildTencentSearchRequest(
  stream: ProbeQueryStream,
  pageIndex: number,
  pageSize: number,
): TencentSearchRequest {
  return {
    projectIdList: [],
    projectMappingIdList: [104],
    keyword: stream.keyword,
    bgList: [],
    workCountryType: 0,
    workCityList: [],
    recruitCityList: [],
    positionFidList: stream.positionFamilyIds,
    pageIndex,
    pageSize,
  };
}

export function buildTencentDetailUrl(postId: string): string {
  if (!/^\d+$/.test(postId)) {
    throw new Error("INVALID_TENCENT_POST_ID");
  }
  const url = new URL("https://join.qq.com/api/v1/jobDetails/getJobDetailsByPostId");
  url.searchParams.set("postId", postId);
  return url.toString();
}

export function buildTencentOfficialJobUrl(postId: string): string {
  if (!/^\d+$/.test(postId)) {
    throw new Error("INVALID_TENCENT_POST_ID");
  }
  const url = new URL("https://join.qq.com/post_detail.html");
  url.searchParams.set("postid", postId);
  return url.toString();
}

function known<T>(value: T, evidenceRefs: string[]): EvidenceField<T> {
  return { state: "known", value, evidenceRefs };
}

function unknown<T>(
  reason: "source_not_stated" | "parse_failed" | "needs_manual_review" = "source_not_stated",
): EvidenceField<T> {
  return {
    state: "unknown",
    reason: reason === "needs_manual_review" ? "not_yet_verified" : reason,
  };
}

function recruitmentType(
  entryScope: string,
  list: TencentListItem,
  detail: TencentDetail,
  listEvidenceRef: string,
  detailEvidenceRef: string,
): EvidenceField<string> {
  const rawValues = [
    entryScope,
    list.projectName,
    list.recruitLabelName,
    detail.projectName,
    detail.recruitLabelName,
  ]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index);

  if (rawValues.length === 1) {
    return known(rawValues[0] ?? entryScope, [listEvidenceRef, detailEvidenceRef]);
  }
  return {
    state: "conflict",
    rawValues,
    evidenceRefs: [listEvidenceRef, detailEvidenceRef],
  };
}

function classifyJobFamily(
  detail: TencentDetail,
  detailEvidenceRef: string,
): {
  value: EvidenceField<"product" | "operations" | "other">;
  requiresManualReview: boolean;
} {
  const sourceFamily =
    detail.tidName === "产品"
      ? "product"
      : detail.tidName === "运营" || detail.tidName === "市场"
        ? "operations"
        : undefined;
  const titleLooksOperational = detail.title.includes("运营");
  const titleLooksTechnical = /(开发|算法|工程|测试|运维)/.test(detail.title);

  if (titleLooksOperational && titleLooksTechnical) {
    return { value: unknown("needs_manual_review"), requiresManualReview: true };
  }
  if (sourceFamily === "product" && titleLooksOperational) {
    return {
      value: {
        state: "conflict",
        rawValues: ["product", "operations"],
        evidenceRefs: [`${detailEvidenceRef}#/data/tidName`, `${detailEvidenceRef}#/data/title`],
      },
      requiresManualReview: true,
    };
  }
  if (sourceFamily) {
    return {
      value: known(sourceFamily, [detailEvidenceRef]),
      requiresManualReview: sourceFamily === "operations",
    };
  }
  if (titleLooksOperational) {
    return {
      value: known("operations", [detailEvidenceRef]),
      requiresManualReview: true,
    };
  }
  return { value: unknown("needs_manual_review"), requiresManualReview: true };
}

export function normalizeTencentJob(input: {
  list: TencentListItem;
  detail: TencentDetail;
  listItemIndex: number;
  entryScope: string;
  listEvidenceRef: string;
  detailEvidenceRef: string;
}): NormalizedTencentJob {
  const { list, detail, entryScope, listEvidenceRef, detailEvidenceRef } = input;
  if (list.postId !== detail.postId) {
    throw new Error("TENCENT_POST_ID_MISMATCH");
  }

  const recruitment = recruitmentType(entryScope, list, detail, listEvidenceRef, detailEvidenceRef);
  const family = classifyJobFamily(detail, detailEvidenceRef);
  const qualityFlags: NormalizedTencentJob["qualityFlags"] = [];
  const reviewReasons: NormalizedTencentJob["reviewReasons"] = [
    {
      code: "SOURCE_POLICY_PENDING",
      details: { source: "tencent-campus" },
    },
    {
      code: "STRUCTURED_FIELDS_MISSING",
      details: {
        fields: [
          "arrivalTime",
          "weeklyAttendanceDays",
          "durationMonths",
          "graduationYears",
          "publishedAt",
          "deadline",
        ],
      },
    },
  ];

  if (recruitment.state === "conflict") {
    qualityFlags.push({
      code: "RECRUITMENT_LABEL_CONFLICT",
      detail: recruitment.rawValues.join(" / "),
    });
    reviewReasons.push({
      code: "RECRUITMENT_LABEL_CONFLICT",
      details: { rawValues: recruitment.rawValues },
    });
  }
  if (family.requiresManualReview) {
    qualityFlags.push({
      code: "TARGET_SCOPE_REVIEW_REQUIRED",
      detail: "岗位方向需要人工确认，不能仅凭标题自动发布。",
    });
    reviewReasons.push({
      code: "TARGET_SCOPE_REVIEW_REQUIRED",
      details: { title: detail.title, sourceFamily: detail.tidName },
    });
  }

  const businessGroups = detail.intentionBGDList
    .map((group) => group.showTitle.trim())
    .filter(Boolean);
  const locations = detail.workCityList.map((location) => location.trim()).filter(Boolean);
  const sourceUrl = buildTencentOfficialJobUrl(detail.postId);
  const normalizedWithoutHash = {
    sourceJobId: detail.postId,
    companyName: "腾讯",
    title: detail.title,
    jobFamily: family.value,
    locations: locations.length > 0 ? known(locations, [detailEvidenceRef]) : unknown<string[]>(),
    businessGroups,
    entryScope,
    sourceProjectName: detail.projectName,
    recruitLabelName: detail.recruitLabelName,
    recruitmentType: recruitment,
    responsibilities: detail.desc,
    requirements: detail.request,
    structuredFields: {
      arrivalTime: unknown<string>(),
      weeklyAttendanceDays: unknown<number>(),
      durationMonths: unknown<number>(),
      graduationYears: unknown<string[]>(),
      recruitmentBatch: detail.recruitLabelName
        ? known(detail.recruitLabelName, [detailEvidenceRef])
        : unknown<string>(),
      publishedAt: unknown<string>(),
      deadline: unknown<string>(),
    },
    ingestionState: "validated" as const,
    publicationState: "review" as const,
    activityState: "active" as const,
    sourceUrl,
    applyUrl: sourceUrl,
    qualityFlags,
    reviewReasons,
  };

  const listPointer = `/data/positionList/${input.listItemIndex}`;
  const evidence: NormalizedTencentJob["evidence"] = [
    {
      role: "list",
      fieldName: "sourceJobId",
      jsonPointer: `${listPointer}/postId`,
      rawValueHash: sha256(list.postId),
    },
    {
      role: "list",
      fieldName: "sourceProjectName",
      jsonPointer: `${listPointer}/projectName`,
      rawValueHash: hashCanonicalJson(list.projectName),
    },
    {
      role: "detail",
      fieldName: "title",
      jsonPointer: "/data/title",
      rawValueHash: sha256(detail.title),
    },
    {
      role: "detail",
      fieldName: "jobFamily",
      jsonPointer: "/data/tidName",
      rawValueHash: sha256(detail.tidName),
    },
    {
      role: "detail",
      fieldName: "locations",
      jsonPointer: "/data/workCityList",
      rawValueHash: hashCanonicalJson(detail.workCityList),
    },
    {
      role: "detail",
      fieldName: "responsibilities",
      jsonPointer: "/data/desc",
      rawValueHash: sha256(detail.desc),
    },
    {
      role: "detail",
      fieldName: "requirements",
      jsonPointer: "/data/request",
      rawValueHash: sha256(detail.request),
    },
    {
      role: "detail",
      fieldName: "recruitmentType",
      jsonPointer: "/data/recruitLabelName",
      rawValueHash: hashCanonicalJson(detail.recruitLabelName),
    },
  ];

  return {
    ...normalizedWithoutHash,
    revisionContentHash: hashCanonicalJson({
      normalized: semanticRevisionValue(normalizedWithoutHash),
      adapterVersion: TENCENT_ADAPTER_VERSION,
      normalizerVersion: TENCENT_NORMALIZER_VERSION,
    }),
    evidence,
  };
}
