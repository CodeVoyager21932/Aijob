import { z } from "zod";
import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import { classifyOfficialJobFamily } from "./job-family-classifier.js";
import {
  known,
  type NormalizedOfficialJob,
  semanticRevisionValue,
  unknown,
} from "./normalized-official-job.js";

export const FANRUAN_TRAINEE_ADAPTER_VERSION = "0.1.0";
export const FANRUAN_TRAINEE_NORMALIZER_VERSION = "0.1.0";
export const FANRUAN_TRAINEE_LIST_URL = "https://join.fanruan.com/trainee";

const fanruanTraineeJobSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    recruit_type: z.string().trim().default(""),
    job_name: z.string().trim().min(1),
    apartment: z
      .string()
      .trim()
      .nullish()
      .transform((value) => value ?? ""),
    job_type: z
      .string()
      .trim()
      .nullish()
      .transform((value) => value ?? ""),
    base: z
      .string()
      .trim()
      .nullish()
      .transform((value) => value ?? ""),
    mode: z.string().trim().min(1),
    description: z
      .string()
      .nullish()
      .transform((value) => value ?? ""),
    duty: z
      .string()
      .nullish()
      .transform((value) => value ?? ""),
    requirement: z
      .string()
      .nullish()
      .transform((value) => value ?? ""),
    update_date: z.string().nullish(),
  })
  .passthrough();

const fanruanTraineePageSchema = z
  .object({
    list: z.array(fanruanTraineeJobSchema),
    pageTotal: z.coerce.number().int().positive(),
    curPage: z.coerce.number().int().positive(),
    pageSize: z.coerce.number().int().min(1).max(50),
    dataTotal: z.coerce.number().int().nonnegative(),
  })
  .passthrough();

export type FanruanTraineeJob = z.infer<typeof fanruanTraineeJobSchema>;

export interface FanruanTraineePage {
  jobs: FanruanTraineeJob[];
  pageTotal: number;
  curPage: number;
  pageSize: number;
  dataTotal: number;
}

export function buildFanruanTraineeListFormBody(page: number): Record<string, string> {
  const parsedPage = z.number().int().positive().parse(page);
  return { filter: "1", page: String(parsedPage), w: "" };
}

export function parseFanruanTraineePage(text: string): FanruanTraineePage {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    throw new Error("FANRUAN_LIST_INVALID_JSON");
  }
  const parsed = fanruanTraineePageSchema.parse(parsedJson);
  if (parsed.list.length > parsed.pageSize || parsed.list.length > parsed.dataTotal) {
    throw new Error("FANRUAN_LIST_COUNT_INCONSISTENT");
  }
  if (new Set(parsed.list.map((job) => job.id)).size !== parsed.list.length) {
    throw new Error("FANRUAN_DUPLICATE_JOB_ID");
  }
  return {
    jobs: parsed.list,
    pageTotal: parsed.pageTotal,
    curPage: parsed.curPage,
    pageSize: parsed.pageSize,
    dataTotal: parsed.dataTotal,
  };
}

/**
 * ADR-0035 第一条：这个判定**只用于观察**，不再决定去留。帆软的 `mode` 字段同时出现「实习」
 * 与校招/应届口径，按旧规则后者会被整条丢弃，而在校生临近毕业时校招才是主场。筛选已上移到
 * 资格层的 `catalog.job_reachability_verdict`。
 */
export function isFanruanInternship(job: FanruanTraineeJob): boolean {
  return job.mode.normalize("NFKC") === "实习";
}

export function buildFanruanTraineeApplyUrl(jobId: string): string {
  const parsedId = z.string().regex(/^\d+$/).parse(jobId);
  return `https://join.fanruan.com/trainee/detail?id=${parsedId}`;
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

export function normalizeFanruanTraineeJob(input: {
  job: FanruanTraineeJob;
  listItemIndex: number;
  pageEvidenceRef: string;
}): NormalizedOfficialJob {
  const { job, listItemIndex, pageEvidenceRef } = input;
  // ADR-0035 第一条：此处原有 `FANRUAN_NOT_EXPLICIT_INTERNSHIP`，`mode` 不等于「实习」即整条
  // 丢弃。适配器只负责忠实解析，不负责裁剪供给范围。
  const pointer = `/list/${listItemIndex}`;
  const family = classifyOfficialJobFamily({
    title: job.job_name,
    sourceLabels: job.job_type ? [job.job_type] : [],
    sourceEvidenceRef: pageEvidenceRef,
    titleEvidenceRef: pageEvidenceRef,
  });
  const locations = splitLocations(job.base);
  const requirementText = job.requirement.trim();
  const combinedConditionText = `${requirementText}\n${job.description.trim()}`;
  const durationMonths = captureMinimum(combinedConditionText, [
    /(?:至少|不少于|连续实习)\s*(\d+)\s*个?月/u,
    /(\d+)\s*个?月(?:以上|及以上)/u,
  ]);
  const weeklyAttendanceDays = captureMinimum(combinedConditionText, [
    /每周(?:至少|不少于|可实习|到岗)?\s*(\d+)\s*天/u,
    /一周(?:至少|不少于|可实习|到岗)?\s*(\d+)\s*天/u,
  ]);
  const applyUrl = buildFanruanTraineeApplyUrl(job.id);
  const qualityFlags: NormalizedOfficialJob["qualityFlags"] = [];
  const reviewReasons: NormalizedOfficialJob["reviewReasons"] = [
    { code: "SOURCE_POLICY_PENDING", details: { source: "fanruan-trainee-internships" } },
  ];
  if (family.requiresManualReview) {
    qualityFlags.push({ code: "JOB_FAMILY_REVIEW_REQUIRED", detail: job.job_type || job.job_name });
    reviewReasons.push({
      code: "JOB_FAMILY_REVIEW_REQUIRED",
      details: { officialCategory: job.job_type, title: job.job_name },
    });
  }
  for (const [field, value] of [
    ["responsibilities", job.duty],
    ["requirements", job.requirement],
  ] as const) {
    if (!value.trim()) qualityFlags.push({ code: "SOURCE_FIELD_EMPTY", detail: field });
  }
  if (locations.length === 0) {
    qualityFlags.push({ code: "SOURCE_FIELD_EMPTY", detail: "locations" });
  }

  const normalizedWithoutHash = {
    sourceJobId: job.id,
    companyName: "帆软",
    title: job.job_name,
    jobFamily: family.value,
    locations: locations.length > 0 ? known(locations, [pageEvidenceRef]) : unknown<string[]>(),
    businessGroups: job.apartment ? [job.apartment] : [],
    entryScope: "实习生",
    sourceProjectName: null,
    recruitLabelName: job.mode,
    recruitmentType: known(job.mode, [pageEvidenceRef]),
    responsibilities: job.duty.trim(),
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
      recruitmentBatch: known(job.mode, [pageEvidenceRef]),
      publishedAt: unknown<string>(),
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
    ["title", `${pointer}/job_name`, job.job_name],
    ["jobFamily", `${pointer}/job_type`, job.job_type],
    ["locations", `${pointer}/base`, job.base],
    ["recruitmentType", `${pointer}/mode`, job.mode],
    ["responsibilities", `${pointer}/duty`, job.duty],
    ["requirements", `${pointer}/requirement`, job.requirement],
    ["applyUrl", `${pointer}/id`, job.id],
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
      adapterVersion: FANRUAN_TRAINEE_ADAPTER_VERSION,
      normalizerVersion: FANRUAN_TRAINEE_NORMALIZER_VERSION,
    }),
    evidence,
  };
}
