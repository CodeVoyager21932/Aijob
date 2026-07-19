import { z } from "zod";
import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import {
  type EvidenceField,
  known,
  type NormalizedOfficialJob,
  semanticRevisionValue,
  unknown,
} from "./normalized-official-job.js";
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

export interface NormalizedTencentJob extends NormalizedOfficialJob {}

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
      graduationYears: unknown<number[]>(),
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
