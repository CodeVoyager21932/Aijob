import { z } from "zod";
import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import { classifyOfficialJobFamily } from "./job-family-classifier.js";
import {
  known,
  type NormalizedOfficialJob,
  semanticRevisionValue,
  unknown,
} from "./normalized-official-job.js";
import { scopeOfficialDutyText } from "./official-job-body-scope.js";

export const BYTEDANCE_MANUAL_BROWSER_ADAPTER_VERSION = "0.1.2";
export const BYTEDANCE_MANUAL_BROWSER_NORMALIZER_VERSION = "0.1.2";
export const BYTEDANCE_CAMPUS_POSITION_URL = "https://jobs.bytedance.com/campus/position";

const bytedanceDetailUrlSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "jobs.bytedance.com" ||
      url.port ||
      url.search ||
      url.hash ||
      !/^\/campus\/position\/\d{16,20}\/detail$/.test(url.pathname)
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "INVALID_BYTEDANCE_DETAIL_URL" });
    }
  });

const bytedanceManualJobSchema = z
  .object({
    sourceJobId: z.string().regex(/^\d{16,20}$/),
    jobCode: z
      .string()
      .trim()
      .regex(/^A[A-Z0-9]+$/),
    title: z.string().trim().min(1).max(300),
    locations: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    employmentType: z.literal("实习"),
    jobCategory: z.string().trim().min(1).max(200),
    projectName: z.string().trim().min(1).max(200),
    responsibilities: z.string().trim().min(1).max(50_000),
    requirements: z.string().trim().min(1).max(50_000),
    detailUrl: bytedanceDetailUrlSchema,
    listItemIndex: z.number().int().min(0).max(9),
  })
  .strict();

const bytedanceManualSnapshotSchema = z
  .object({
    schemaVersion: z.literal("bytedance-manual-browser-snapshot-v1"),
    captureMode: z.literal("manual-browser-visible-dom"),
    sourcePageUrl: z.literal(BYTEDANCE_CAMPUS_POSITION_URL),
    capturedAt: z.string().datetime({ offset: true }),
    reportedTotal: z.number().int().positive(),
    pageIndex: z.number().int().positive(),
    jobs: z.array(bytedanceManualJobSchema).min(1).max(10),
  })
  .strict();

export type BytedanceManualBrowserSnapshot = z.infer<typeof bytedanceManualSnapshotSchema>;
export type BytedanceManualBrowserJob = z.infer<typeof bytedanceManualJobSchema>;

function assertUnique(values: string[], code: string): void {
  if (new Set(values).size !== values.length) throw new Error(code);
}

export function parseBytedanceManualBrowserSnapshot(
  value: unknown,
): BytedanceManualBrowserSnapshot {
  const snapshot = bytedanceManualSnapshotSchema.parse(value);
  assertUnique(
    snapshot.jobs.map((job) => job.sourceJobId),
    "BYTEDANCE_DUPLICATE_SOURCE_JOB_ID",
  );
  assertUnique(
    snapshot.jobs.map((job) => job.jobCode),
    "BYTEDANCE_DUPLICATE_JOB_CODE",
  );
  assertUnique(
    snapshot.jobs.map((job) => String(job.listItemIndex)),
    "BYTEDANCE_DUPLICATE_LIST_ITEM_INDEX",
  );
  for (const job of snapshot.jobs) {
    if (new URL(job.detailUrl).pathname.split("/")[3] !== job.sourceJobId) {
      throw new Error("BYTEDANCE_DETAIL_ID_MISMATCH");
    }
    assertUnique(job.locations, "BYTEDANCE_DUPLICATE_LOCATION");
  }
  return snapshot;
}

function captureMinimum(value: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}

function graduationYears(value: string): number[] {
  return [
    ...new Set(
      [...value.matchAll(/(20\d{2})\s*届/gu)]
        .map((match) => Number(match[1]))
        .filter((year) => Number.isInteger(year)),
    ),
  ];
}

export function normalizeBytedanceManualBrowserJob(input: {
  job: BytedanceManualBrowserJob;
  snapshotEvidenceRef: string;
}): NormalizedOfficialJob {
  const { job, snapshotEvidenceRef } = input;
  const pointer = `/jobs/${job.listItemIndex}`;
  const sourceLabels = job.jobCategory
    .split(/\s*-\s*/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const family = classifyOfficialJobFamily({
    title: job.title,
    sourceLabels,
    sourceEvidenceRef: snapshotEvidenceRef,
    titleEvidenceRef: snapshotEvidenceRef,
  });
  const sourceText = `${job.responsibilities}\n${job.requirements}`;
  const durationMonths = captureMinimum(sourceText, [
    /(?:至少|不少于|为期|连续实习)\s*(\d+)\s*个?月/u,
    /(\d+)\s*个?月(?:以上|及以上)/u,
  ]);
  const weeklyAttendanceDays = captureMinimum(sourceText, [
    /每周(?:至少|不少于|可实习)?\s*(\d+)\s*天/u,
    /一周(?:至少|不少于|可实习)?\s*(\d+)\s*天/u,
  ]);
  const years = graduationYears(sourceText);
  const qualityFlags: NormalizedOfficialJob["qualityFlags"] = [
    { code: "MANUAL_BROWSER_CAPTURE", detail: "manual-browser-visible-dom" },
  ];
  const reviewReasons: NormalizedOfficialJob["reviewReasons"] = [
    { code: "SOURCE_POLICY_PENDING", details: { source: "bytedance-campus-manual" } },
    {
      code: "MANUAL_BROWSER_IMPORT_REQUIRES_REVIEW",
      details: { jobCode: job.jobCode, sourceJobId: job.sourceJobId },
    },
  ];
  if (family.requiresManualReview) {
    qualityFlags.push({ code: "JOB_FAMILY_REVIEW_REQUIRED", detail: job.jobCategory });
    reviewReasons.push({
      code: "JOB_FAMILY_REVIEW_REQUIRED",
      details: { officialCategory: job.jobCategory, title: job.title },
    });
  }

  const normalizedWithoutHash = {
    sourceJobId: job.sourceJobId,
    companyName: "字节跳动",
    title: job.title,
    jobFamily: family.value,
    locations: known(job.locations, [snapshotEvidenceRef]),
    businessGroups: [],
    entryScope: "实习生",
    sourceProjectName: job.projectName,
    recruitLabelName: job.projectName,
    recruitmentType: known("实习", [snapshotEvidenceRef]),
    // 人工快照为粘贴文本，按 ADR-0033 的 D1 裁剪到职责范围，避免带入公司简介与福利文案。
    responsibilities: scopeOfficialDutyText(job.responsibilities),
    requirements: job.requirements,
    structuredFields: {
      arrivalTime: unknown<string>(),
      weeklyAttendanceDays:
        weeklyAttendanceDays === undefined
          ? unknown<number>()
          : known(weeklyAttendanceDays, [snapshotEvidenceRef]),
      durationMonths:
        durationMonths === undefined
          ? unknown<number>()
          : known(durationMonths, [snapshotEvidenceRef]),
      graduationYears:
        years.length === 0 ? unknown<number[]>() : known(years, [snapshotEvidenceRef]),
      recruitmentBatch: known(job.projectName, [snapshotEvidenceRef]),
      publishedAt: unknown<string>(),
      deadline: unknown<string>(),
    },
    ingestionState: "validated" as const,
    publicationState: "review" as const,
    activityState: "active" as const,
    sourceUrl: job.detailUrl,
    applyUrl: job.detailUrl,
    qualityFlags,
    reviewReasons,
  };
  const evidenceFields: Array<["list" | "detail", string, string, string]> = [
    ["list", "title", `${pointer}/title`, sha256(job.title)],
    ["list", "jobFamily", `${pointer}/jobCategory`, sha256(job.jobCategory)],
    ["list", "locations", `${pointer}/locations`, hashCanonicalJson(job.locations)],
    ["list", "recruitmentBatch", `${pointer}/projectName`, sha256(job.projectName)],
    ["detail", "responsibilities", `${pointer}/responsibilities`, sha256(job.responsibilities)],
    ["detail", "requirements", `${pointer}/requirements`, sha256(job.requirements)],
    ["detail", "applyUrl", `${pointer}/detailUrl`, sha256(job.detailUrl)],
  ];

  return {
    ...normalizedWithoutHash,
    revisionContentHash: hashCanonicalJson({
      normalized: semanticRevisionValue(normalizedWithoutHash),
      adapterVersion: BYTEDANCE_MANUAL_BROWSER_ADAPTER_VERSION,
      normalizerVersion: BYTEDANCE_MANUAL_BROWSER_NORMALIZER_VERSION,
    }),
    evidence: evidenceFields.map(([role, fieldName, jsonPointer, rawValueHash]) => ({
      role,
      fieldName,
      jsonPointer,
      rawValueHash,
    })),
  };
}
