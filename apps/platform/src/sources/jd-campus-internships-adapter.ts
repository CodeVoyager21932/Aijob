import { z } from "zod";
import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import { classifyOfficialJobFamily } from "./job-family-classifier.js";
import {
  known,
  type NormalizedOfficialJob,
  semanticRevisionValue,
  unknown,
} from "./normalized-official-job.js";

export const JD_CAMPUS_INTERNSHIPS_ADAPTER_VERSION = "0.1.0";
export const JD_CAMPUS_INTERNSHIPS_NORMALIZER_VERSION = "0.1.0";
export const JD_CAMPUS_INTERNSHIPS_LIST_URL =
  "https://campus.jd.com/api/wx/position/page?type=internship";

const jdRequirementSchema = z
  .object({
    reqId: z.number().int().positive().optional(),
    workCity: z.string().trim().default(""),
    workCityCode: z.string().trim().default(""),
    positionBg: z.string().trim().default(""),
  })
  .passthrough();

const jdCampusInternshipSchema = z
  .object({
    publishId: z.number().int().positive(),
    reqId: z.number().int().positive(),
    positionName: z.string().trim().min(1),
    publishTime: z.number().finite().optional(),
    jobDirection: z.string().trim().default(""),
    jobDirectionCode: z.string().trim().default(""),
    workContent: z.string().default(""),
    qualification: z.string().default(""),
    requirementVoList: z.array(jdRequirementSchema).default([]),
    jobCategory: z.string().trim().default(""),
    jobCategoryCode: z.string().trim().default(""),
    planId: z.number().int().positive(),
    isHot: z.boolean().default(false),
  })
  .passthrough();

const jdCampusInternshipPageSchema = z
  .object({
    success: z.literal(true),
    body: z
      .object({
        totalNumber: z.number().int().nonnegative(),
        items: z.array(jdCampusInternshipSchema).min(1).max(20),
      })
      .passthrough(),
  })
  .passthrough();

export type JdCampusInternship = z.infer<typeof jdCampusInternshipSchema>;

export interface JdCampusInternshipPage {
  jobs: JdCampusInternship[];
  total: number;
}

export function buildJdCampusInternshipListRequest(input: {
  pageIndex?: number;
  pageSize: number;
}): Record<string, unknown> {
  return {
    pageSize: z.number().int().min(1).max(10).parse(input.pageSize),
    pageIndex: z.number().int().nonnegative().default(0).parse(input.pageIndex),
    parameter: {
      positionName: "",
      planIdList: [],
      jobDirectionCodeList: [],
      workCityCodeList: [],
      positionDeptList: [],
    },
  };
}

export function parseJdCampusInternshipPage(value: unknown): JdCampusInternshipPage {
  const parsed = jdCampusInternshipPageSchema.parse(value);
  const { items, totalNumber } = parsed.body;
  if (items.length > totalNumber) throw new Error("JD_LIST_COUNT_INCONSISTENT");
  if (new Set(items.map((job) => job.publishId)).size !== items.length) {
    throw new Error("JD_DUPLICATE_PUBLISH_ID");
  }
  if (new Set(items.map((job) => job.reqId)).size !== items.length) {
    throw new Error("JD_DUPLICATE_REQ_ID");
  }
  return { jobs: items, total: totalNumber };
}

export function buildJdCampusInternshipApplyUrl(publishId: number): string {
  const parsedId = z.number().int().positive().parse(publishId);
  return `https://campus.jd.com/api/wx/position/index?type=internship#/details?type=internship&id=${parsedId}`;
}

function sourceLabel(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/(?:职类|类别|方向|类)$/u, "");
}

function normalizedLocation(value: string): string {
  const segments = value
    .normalize("NFKC")
    .split("-")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.at(-1) ?? "";
}

function captureMinimum(value: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}

function publishedAt(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

const projectNames: Readonly<Record<number, string>> = {
  45: "JD YOUNG-实习生计划",
  51: "新锐之星实习生",
  55: "TGT-顶尖青年技术实习生",
};

export function normalizeJdCampusInternship(input: {
  job: JdCampusInternship;
  listItemIndex: number;
  pageEvidenceRef: string;
}): NormalizedOfficialJob {
  const { job, listItemIndex, pageEvidenceRef } = input;
  const pointer = `/body/items/${listItemIndex}`;
  const labels = [job.jobCategory, job.jobDirection].map(sourceLabel).filter(Boolean);
  const family = classifyOfficialJobFamily({
    title: job.positionName,
    sourceLabels: labels,
    sourceEvidenceRef: pageEvidenceRef,
    titleEvidenceRef: pageEvidenceRef,
  });
  const locations = [
    ...new Set(
      job.requirementVoList.map((item) => normalizedLocation(item.workCity)).filter(Boolean),
    ),
  ];
  const businessGroups = [
    ...new Set(job.requirementVoList.map((item) => item.positionBg.trim()).filter(Boolean)),
  ];
  const requirementText = job.qualification.trim();
  const durationMonths = captureMinimum(requirementText, [
    /(?:至少|不少于|连续实习)\s*(\d+)\s*个?月/u,
    /(\d+)\s*个?月(?:以上|及以上)/u,
  ]);
  const weeklyAttendanceDays = captureMinimum(requirementText, [
    /每周(?:至少|不少于|可实习)?\s*(\d+)\s*天/u,
    /一周(?:至少|不少于|可实习)?\s*(\d+)\s*天/u,
  ]);
  const applyUrl = buildJdCampusInternshipApplyUrl(job.publishId);
  const projectName = projectNames[job.planId];
  const publishedAtValue = publishedAt(job.publishTime);
  const qualityFlags: NormalizedOfficialJob["qualityFlags"] = [];
  const reviewReasons: NormalizedOfficialJob["reviewReasons"] = [
    { code: "SOURCE_POLICY_PENDING", details: { source: "jd-campus-internships" } },
  ];
  if (family.requiresManualReview) {
    qualityFlags.push({
      code: "JOB_FAMILY_REVIEW_REQUIRED",
      detail: [job.jobCategory, job.jobDirection].filter(Boolean).join(" / ") || job.positionName,
    });
    reviewReasons.push({
      code: "JOB_FAMILY_REVIEW_REQUIRED",
      details: {
        officialCategory: job.jobCategory,
        officialDirection: job.jobDirection,
        title: job.positionName,
      },
    });
  }
  if (!projectName) {
    qualityFlags.push({ code: "SOURCE_PROJECT_REVIEW_REQUIRED", detail: String(job.planId) });
    reviewReasons.push({
      code: "SOURCE_PROJECT_REVIEW_REQUIRED",
      details: { planId: job.planId },
    });
  }
  for (const [field, value] of [
    ["responsibilities", job.workContent],
    ["requirements", job.qualification],
  ] as const) {
    if (!value.trim()) qualityFlags.push({ code: "SOURCE_FIELD_EMPTY", detail: field });
  }
  if (locations.length === 0) {
    qualityFlags.push({ code: "SOURCE_FIELD_EMPTY", detail: "locations" });
  }

  const normalizedWithoutHash = {
    sourceJobId: String(job.publishId),
    companyName: "京东",
    title: job.positionName,
    jobFamily: family.value,
    locations: locations.length > 0 ? known(locations, [pageEvidenceRef]) : unknown<string[]>(),
    businessGroups,
    entryScope: "实习生",
    sourceProjectName: projectName ?? null,
    recruitLabelName: projectName ?? "实习生",
    recruitmentType: known("实习生", [pageEvidenceRef]),
    responsibilities: job.workContent.trim(),
    requirements: requirementText,
    structuredFields: {
      arrivalTime: unknown<string>(),
      weeklyAttendanceDays:
        weeklyAttendanceDays === undefined
          ? unknown<number>()
          : known(weeklyAttendanceDays, [pageEvidenceRef]),
      durationMonths:
        durationMonths === undefined ? unknown<number>() : known(durationMonths, [pageEvidenceRef]),
      graduationYears: unknown<number[]>(),
      recruitmentBatch: known(projectName ?? "实习生", [pageEvidenceRef]),
      publishedAt:
        publishedAtValue === undefined
          ? unknown<string>(job.publishTime === undefined ? "source_not_stated" : "parse_failed")
          : known(publishedAtValue, [pageEvidenceRef]),
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
    ["title", `${pointer}/positionName`, sha256(job.positionName)],
    ["jobFamily", `${pointer}/jobCategory`, sha256(job.jobCategory)],
    ["locations", `${pointer}/requirementVoList`, hashCanonicalJson(job.requirementVoList)],
    ["responsibilities", `${pointer}/workContent`, sha256(job.workContent)],
    ["requirements", `${pointer}/qualification`, sha256(job.qualification)],
    ["publishedAt", `${pointer}/publishTime`, sha256(String(job.publishTime ?? ""))],
    ["applyUrl", `${pointer}/publishId`, sha256(String(job.publishId))],
  ];
  const evidence: NormalizedOfficialJob["evidence"] = evidenceFields.map(
    ([fieldName, jsonPointer, rawValueHash]) => ({
      role: "list" as const,
      fieldName,
      jsonPointer,
      rawValueHash,
    }),
  );

  return {
    ...normalizedWithoutHash,
    revisionContentHash: hashCanonicalJson({
      normalized: semanticRevisionValue(normalizedWithoutHash),
      adapterVersion: JD_CAMPUS_INTERNSHIPS_ADAPTER_VERSION,
      normalizerVersion: JD_CAMPUS_INTERNSHIPS_NORMALIZER_VERSION,
    }),
    evidence,
  };
}
