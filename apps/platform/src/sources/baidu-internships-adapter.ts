import { z } from "zod";
import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import { classifyOfficialJobFamily } from "./job-family-classifier.js";
import {
  known,
  type NormalizedOfficialJob,
  semanticRevisionValue,
  unknown,
} from "./normalized-official-job.js";

export const BAIDU_INTERNSHIPS_ADAPTER_VERSION = "0.1.1";
export const BAIDU_INTERNSHIPS_NORMALIZER_VERSION = "0.1.0";
export const BAIDU_INTERNSHIPS_LIST_URL = "https://talent.baidu.com/jobs/list?recruitType=INTERN";

const baiduInternshipSchema = z
  .object({
    education: z.string().default(""),
    name: z.string().trim().min(1),
    orgName: z.string().trim().default(""),
    postId: z.string().uuid(),
    jobId: z.string().uuid(),
    postType: z.string().trim().min(1),
    publishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    updateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    recruitNum: z.string().trim().default(""),
    serviceCondition: z.string().default(""),
    workContent: z.string().default(""),
    workPlace: z.string().trim().min(1),
    projectType: z.string().trim().min(1),
    projectTypeCode: z.string().trim().min(1),
    hotFlag: z.boolean().default(false),
    bgShortName: z.string().trim().optional(),
  })
  .passthrough();

const initialDataSchema = z
  .object({
    listData: z
      .object({
        listDetailData: z.array(baiduInternshipSchema).min(1).max(20),
        pageNum: z.number().int().positive(),
        pageSize: z.number().int().min(1).max(20),
        total: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

export type BaiduInternship = z.infer<typeof baiduInternshipSchema>;

export interface BaiduInternshipPage {
  jobs: BaiduInternship[];
  pageNum: number;
  pageSize: number;
  total: number;
}

function extractInitialDataJson(html: string): string {
  const marker = "window.__INITIAL_DATA__";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error("BAIDU_INITIAL_DATA_MISSING");
  const assignmentIndex = html.indexOf("=", markerIndex + marker.length);
  if (assignmentIndex < 0) throw new Error("BAIDU_INITIAL_DATA_ASSIGNMENT_MISSING");
  const scriptEndIndex = html.indexOf("</script>", assignmentIndex + 1);
  if (scriptEndIndex < 0) throw new Error("BAIDU_INITIAL_DATA_SCRIPT_UNCLOSED");
  let cursor = assignmentIndex + 1;
  while (/\s/.test(html[cursor] ?? "")) cursor += 1;
  if (html[cursor] !== "{") throw new Error("BAIDU_INITIAL_DATA_INVALID_BOUNDARY");
  const jsonStartIndex = cursor;
  let depth = 0;
  let insideString = false;
  let escaped = false;
  for (; cursor < scriptEndIndex; cursor += 1) {
    const character = html[cursor];
    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
      continue;
    }
    if (character === '"') {
      insideString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(jsonStartIndex, cursor + 1);
      if (depth < 0) break;
    }
  }
  throw new Error("BAIDU_INITIAL_DATA_INVALID_BOUNDARY");
}

export function parseBaiduInternshipPage(html: string): BaiduInternshipPage {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractInitialDataJson(html));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("BAIDU_")) throw error;
    throw new Error("BAIDU_INITIAL_DATA_INVALID_JSON");
  }
  const initialData = initialDataSchema.parse(parsedJson);
  const { listDetailData, pageNum, pageSize, total } = initialData.listData;
  if (pageNum !== 1) throw new Error("BAIDU_UNEXPECTED_INITIAL_PAGE");
  if (listDetailData.length > pageSize || listDetailData.length > total) {
    throw new Error("BAIDU_LIST_COUNT_INCONSISTENT");
  }
  if (new Set(listDetailData.map((job) => job.jobId)).size !== listDetailData.length) {
    throw new Error("BAIDU_DUPLICATE_JOB_ID");
  }
  if (new Set(listDetailData.map((job) => job.postId)).size !== listDetailData.length) {
    throw new Error("BAIDU_DUPLICATE_POST_ID");
  }
  return { jobs: listDetailData, pageNum, pageSize, total };
}

export function buildBaiduInternshipApplyUrl(jobId: string): string {
  const parsedId = z.string().uuid().parse(jobId);
  return `https://talent.baidu.com/jobs/detail/INTERN/${parsedId}`;
}

function splitLocations(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[、,，/]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function captureMinimum(value: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}

export function normalizeBaiduInternship(input: {
  job: BaiduInternship;
  listItemIndex: number;
  pageEvidenceRef: string;
}): NormalizedOfficialJob {
  const { job, listItemIndex, pageEvidenceRef } = input;
  const pointer = `/listData/listDetailData/${listItemIndex}`;
  const family = classifyOfficialJobFamily({
    title: job.name,
    sourceLabels: [job.postType],
    sourceEvidenceRef: pageEvidenceRef,
    titleEvidenceRef: pageEvidenceRef,
  });
  const locations = splitLocations(job.workPlace);
  const durationMonths = captureMinimum(job.serviceCondition, [
    /至少\s*(\d+)\s*个月/,
    /(\d+)\s*个月(?:以上|及以上)/,
  ]);
  const weeklyAttendanceDays = captureMinimum(job.serviceCondition, [
    /每周(?:至少|不少于|可实习)?\s*(\d+)\s*天/,
    /一周(?:至少|不少于|可实习)?\s*(\d+)\s*天/,
  ]);
  const applyUrl = buildBaiduInternshipApplyUrl(job.jobId);
  const businessGroups = [...new Set([job.bgShortName, job.orgName].filter(Boolean))] as string[];
  const qualityFlags: NormalizedOfficialJob["qualityFlags"] = [];
  const reviewReasons: NormalizedOfficialJob["reviewReasons"] = [
    { code: "SOURCE_POLICY_PENDING", details: { source: "baidu-internships" } },
  ];
  if (family.requiresManualReview) {
    qualityFlags.push({ code: "JOB_FAMILY_REVIEW_REQUIRED", detail: job.postType });
    reviewReasons.push({
      code: "JOB_FAMILY_REVIEW_REQUIRED",
      details: { officialCategory: job.postType, title: job.name },
    });
  }
  for (const [field, value] of [
    ["responsibilities", job.workContent],
    ["requirements", job.serviceCondition],
  ] as const) {
    if (!value.trim()) qualityFlags.push({ code: "SOURCE_FIELD_EMPTY", detail: field });
  }

  const normalizedWithoutHash = {
    sourceJobId: job.jobId,
    companyName: "百度",
    title: job.name,
    jobFamily: family.value,
    locations: locations.length > 0 ? known(locations, [pageEvidenceRef]) : unknown<string[]>(),
    businessGroups,
    entryScope: job.projectType,
    sourceProjectName: "百度实习生招聘",
    recruitLabelName: job.projectType,
    recruitmentType: known(job.projectType, [pageEvidenceRef]),
    responsibilities: job.workContent.trim(),
    requirements: job.serviceCondition.trim(),
    structuredFields: {
      arrivalTime: unknown<string>(),
      weeklyAttendanceDays:
        weeklyAttendanceDays === undefined
          ? unknown<number>()
          : known(weeklyAttendanceDays, [pageEvidenceRef]),
      durationMonths:
        durationMonths === undefined ? unknown<number>() : known(durationMonths, [pageEvidenceRef]),
      graduationYears: unknown<number[]>(),
      recruitmentBatch: known(job.projectType, [pageEvidenceRef]),
      publishedAt: known(job.publishDate, [pageEvidenceRef]),
      deadline: unknown<string>(),
    },
    ingestionState: "validated" as const,
    publicationState: "review" as const,
    activityState: "active" as const,
    sourceUrl: applyUrl,
    applyUrl,
    qualityFlags,
    reviewReasons,
  };
  const evidenceFields: Array<[string, string, string]> = [
    ["title", `${pointer}/name`, job.name],
    ["jobFamily", `${pointer}/postType`, job.postType],
    ["locations", `${pointer}/workPlace`, job.workPlace],
    ["responsibilities", `${pointer}/workContent`, job.workContent],
    ["requirements", `${pointer}/serviceCondition`, job.serviceCondition],
    ["publishedAt", `${pointer}/publishDate`, job.publishDate],
    ["applyUrl", `${pointer}/jobId`, job.jobId],
  ];
  const evidence: NormalizedOfficialJob["evidence"] = evidenceFields.map(
    ([fieldName, jsonPointer, rawValue]) => ({
      role: "list" as const,
      fieldName,
      jsonPointer,
      rawValueHash: sha256(rawValue),
    }),
  );

  return {
    ...normalizedWithoutHash,
    revisionContentHash: hashCanonicalJson({
      normalized: semanticRevisionValue(normalizedWithoutHash),
      adapterVersion: BAIDU_INTERNSHIPS_ADAPTER_VERSION,
      normalizerVersion: BAIDU_INTERNSHIPS_NORMALIZER_VERSION,
    }),
    evidence,
  };
}
