import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import {
  known,
  type NormalizedOfficialJob,
  semanticRevisionValue,
  unknown,
} from "./normalized-official-job.js";

export const NANKAI_TAL_ADAPTER_VERSION = "0.1.0";
export const NANKAI_TAL_NORMALIZER_VERSION = "0.1.0";
export const NANKAI_TAL_SOURCE_URL =
  "https://career.nankai.edu.cn/correcruit/content/id/115842.html";
export const NANKAI_TAL_APPLY_URL =
  "https://app.mokahr.com/campus-recruitment/tal/95443?locale=zh-CN#/jobs";

const blockTagPattern =
  /<\/?(?:article|div|h[1-6]|li|ol|p|section|table|tbody|td|th|tr|ul)[^>]*>/gi;

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

export function htmlToDeterministicLines(html: string): string[] {
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(?:script|style)[^>]*>[\s\S]*?<\/(?:script|style)>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(blockTagPattern, "\n")
      .replace(/<[^>]+>/g, ""),
  );
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t\u3000 ]+/g, " ").trim())
    .filter(Boolean);
}

function section(lines: string[], start: string, end: string): string[] {
  const startIndex = lines.findIndex((line) => line === start);
  if (startIndex < 0) throw new Error("NANKAI_TAL_OPERATIONS_SECTION_MISSING");
  const endOffset = lines.slice(startIndex + 1).findIndex((line) => line === end);
  if (endOffset < 0) throw new Error("NANKAI_TAL_SECTION_BOUNDARY_MISSING");
  return lines.slice(startIndex + 1, startIndex + 1 + endOffset);
}

function firstFollowingValue(
  lines: string[],
  heading: string,
  stopHeadings: string[],
): string | undefined {
  const index = lines.findIndex((line) => line === heading);
  if (index < 0) return undefined;
  return lines
    .slice(index + 1)
    .find((line) => !stopHeadings.includes(line) && !line.endsWith("："));
}

export interface NankaiTalPage {
  roles: string[];
  audienceText: string | undefined;
  requirementText: string | undefined;
  locationText: string | undefined;
  applyUrl: string;
}

export function parseNankaiTalPage(html: string): NankaiTalPage {
  const lines = htmlToDeterministicLines(html);
  const roles = section(lines, "运营类", "市场与公关类")
    .filter((line) => line.length <= 60)
    .filter((line, index, values) => values.indexOf(line) === index);
  if (roles.length < 5) throw new Error("NANKAI_TAL_TARGET_SUPPLY_BELOW_FIVE");

  const applyMatch = html.match(
    /https:\/\/app\.mokahr\.com\/campus-recruitment\/tal\/95443\?locale=zh-CN#\/jobs/i,
  );
  if (!applyMatch) throw new Error("NANKAI_TAL_OFFICIAL_APPLY_LINK_MISSING");

  return {
    roles,
    audienceText: firstFollowingValue(lines, "招聘对象：", ["实习职位："]),
    requirementText: firstFollowingValue(lines, "实习要求：", ["实习地点：", "专属收获："]),
    locationText: firstFollowingValue(lines, "实习地点：", ["专属收获：", "网申流程"]),
    applyUrl: applyMatch[0],
  };
}

function captureNumber(value: string | undefined, pattern: RegExp): number | undefined {
  const match = value?.match(pattern);
  return match?.[1] ? Number(match[1]) : undefined;
}

export function normalizeNankaiTalRole(input: {
  role: string;
  page: NankaiTalPage;
  pageEvidenceRef: string;
}): NormalizedOfficialJob {
  const weeklyDays = captureNumber(input.page.requirementText, /每周\s*出勤\s*(\d+)天/);
  const durationMonths = captureNumber(input.page.requirementText, /实习(\d+)个月/);
  const arrivalTime = input.page.requirementText?.match(/^(\d+月-\d+月中旬)入职/)?.[1];
  const roleId = sha256(input.role).slice(0, 16);
  const normalizedWithoutHash = {
    sourceJobId: `115842-${roleId}`,
    companyName: "好未来",
    title: input.role,
    jobFamily: known<"operations">("operations", [input.pageEvidenceRef]),
    locations: input.page.locationText
      ? known([input.page.locationText], [input.pageEvidenceRef])
      : unknown<string[]>(),
    businessGroups: [],
    entryScope: "2027暑期实习",
    sourceProjectName: "好未来集团2027暑期实习生招聘",
    recruitLabelName: "2027暑期实习",
    recruitmentType: known("2027暑期实习", [input.pageEvidenceRef]),
    responsibilities: "",
    requirements: [input.page.audienceText, input.page.requirementText]
      .filter((value): value is string => Boolean(value))
      .join("\n"),
    structuredFields: {
      arrivalTime: arrivalTime ? known(arrivalTime, [input.pageEvidenceRef]) : unknown<string>(),
      weeklyAttendanceDays: weeklyDays
        ? known(weeklyDays, [input.pageEvidenceRef])
        : unknown<number>(),
      durationMonths: durationMonths
        ? known(durationMonths, [input.pageEvidenceRef])
        : unknown<number>(),
      graduationYears: known([2027], [input.pageEvidenceRef]),
      recruitmentBatch: known("2027暑期实习", [input.pageEvidenceRef]),
      publishedAt: known("2026-05-26", [input.pageEvidenceRef]),
      deadline: unknown<string>(),
    },
    ingestionState: "validated" as const,
    publicationState: "review" as const,
    activityState: "active" as const,
    sourceUrl: NANKAI_TAL_SOURCE_URL,
    applyUrl: input.page.applyUrl,
    qualityFlags: [
      { code: "ROLE_LEVEL_DUTIES_NOT_STATED", detail: input.role },
      { code: "SHARED_APPLY_LANDING_PAGE", detail: input.page.applyUrl },
    ],
    reviewReasons: [
      { code: "SOURCE_POLICY_PENDING", details: { source: "nankai-tal-2027" } },
      { code: "ROLE_LEVEL_DUTIES_NOT_STATED", details: { role: input.role } },
    ],
  };
  const evidence: NormalizedOfficialJob["evidence"] = [
    {
      role: "list",
      fieldName: "title",
      jsonPointer: "/text/运营类",
      rawValueHash: sha256(input.role),
    },
    {
      role: "detail",
      fieldName: "requirements",
      jsonPointer: "/text/实习要求",
      rawValueHash: hashCanonicalJson(input.page.requirementText ?? null),
    },
    {
      role: "detail",
      fieldName: "applyUrl",
      jsonPointer: "/links/moka",
      rawValueHash: sha256(input.page.applyUrl),
    },
  ];
  return {
    ...normalizedWithoutHash,
    revisionContentHash: hashCanonicalJson({
      normalized: semanticRevisionValue(normalizedWithoutHash),
      adapterVersion: NANKAI_TAL_ADAPTER_VERSION,
      normalizerVersion: NANKAI_TAL_NORMALIZER_VERSION,
    }),
    evidence,
  };
}
