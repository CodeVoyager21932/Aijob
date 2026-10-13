import { load } from "cheerio";
import { z } from "zod";
import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import { classifyOfficialJobFamily } from "./job-family-classifier.js";
import {
  type NormalizedOfficialJob,
  unknown,
  semanticRevisionValue,
} from "./normalized-official-job.js";

export const ConfiguredWebOptionsSchema = z
  .object({
    configurationVersion: z.string().min(1),
    render: z.boolean().default(false),
    list: z
      .object({
        row: z.string().min(1),
        detailLink: z.string().min(1),
        nextLink: z.string().min(1).nullable(),
        terminalMarker: z.string().min(1),
        emptyMarker: z.string().min(1).nullable(),
      })
      .strict(),
    detail: z
      .object({
        title: z.string().min(1),
        responsibilities: z.string().min(1).nullable(),
        requirements: z.string().min(1).nullable(),
        applyLink: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();
export type ConfiguredWebOptions = z.infer<typeof ConfiguredWebOptionsSchema>;

function resolveLink(value: string | undefined, base: string): string | null {
  if (!value?.trim()) return null;
  const url = new URL(value, base);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("CONFIGURED_WEB_LINK_INVALID");
  url.hash = "";
  return url.href;
}
export function parseConfiguredList(html: string, url: string, config: ConfiguredWebOptions) {
  const $ = load(html);
  const links = $(config.list.row)
    .toArray()
    .map((row) => {
      const item = $(row);
      const link = item.is(config.list.detailLink) ? item : item.find(config.list.detailLink);
      const value = resolveLink(link.first().attr("href"), url);
      if (!value) throw new Error("CONFIGURED_WEB_DETAIL_LINK_MISSING");
      return value;
    });
  if (links.length !== new Set(links).size) throw new Error("CONFIGURED_WEB_DUPLICATE_LINK");
  const nextUrl = config.list.nextLink
    ? resolveLink($(config.list.nextLink).first().attr("href"), url)
    : null;
  const terminal = $(config.list.terminalMarker).length > 0;
  const explicitEmpty = !!config.list.emptyMarker && $(config.list.emptyMarker).length > 0;
  if (!links.length && !explicitEmpty) throw new Error("CONFIGURED_WEB_UNEXPECTED_EMPTY");
  if ((!nextUrl && !terminal) || (nextUrl && terminal))
    throw new Error("CONFIGURED_WEB_PAGINATION_AMBIGUOUS");
  return { links, nextUrl, terminal, explicitEmpty };
}

export function normalizeConfiguredDetail(input: {
  html: string;
  url: string;
  companyName: string;
  evidenceRef: string;
  options: ConfiguredWebOptions;
}): NormalizedOfficialJob {
  const $ = load(input.html);
  $("script,style,noscript,iframe").remove();
  const text = (selector: string | null) => (selector ? $(selector).first().text().trim() : "");
  const title = text(input.options.detail.title);
  const responsibilities = text(input.options.detail.responsibilities);
  const requirements = text(input.options.detail.requirements);
  if (!title || (!responsibilities && !requirements))
    throw new Error("CONFIGURED_WEB_BODY_MISSING");
  const applyUrl = input.options.detail.applyLink
    ? resolveLink($(input.options.detail.applyLink).first().attr("href"), input.url)
    : null;
  const family = classifyOfficialJobFamily({ title, sourceEvidenceRef: input.evidenceRef });
  const semantic = {
    sourceJobId: sha256(input.url),
    companyName: input.companyName,
    title,
    jobFamily: family.value,
    locations: unknown<string[]>(),
    businessGroups: [],
    entryScope: "官方招聘",
    sourceProjectName: null,
    recruitLabelName: null,
    recruitmentType: unknown<string>(),
    responsibilities,
    requirements,
    structuredFields: {
      arrivalTime: unknown<string>(),
      weeklyAttendanceDays: unknown<number>(),
      durationMonths: unknown<number>(),
      graduationYears: unknown<number[]>(),
      recruitmentBatch: unknown<string>(),
      publishedAt: unknown<string>(),
      deadline: unknown<string>(),
    },
    ingestionState: "validated" as const,
    publicationState: "review" as const,
    activityState: "active" as const,
    sourceUrl: input.url,
    applyUrl,
    applicationLinkKind: applyUrl ? ("exact" as const) : ("missing" as const),
    qualityFlags: [],
    reviewReasons: applyUrl ? [] : [{ code: "OFFICIAL_APPLY_URL_MISSING", details: {} }],
  };
  return {
    ...semantic,
    revisionContentHash: hashCanonicalJson(semanticRevisionValue(semantic)),
    evidence: ["title", "responsibilities", "requirements"].map((fieldName) => ({
      role: "detail" as const,
      fieldName,
      jsonPointer: `/html/${fieldName}`,
      rawValueHash: sha256(
        fieldName === "title"
          ? title
          : fieldName === "requirements"
            ? requirements
            : responsibilities,
      ),
    })),
  };
}
