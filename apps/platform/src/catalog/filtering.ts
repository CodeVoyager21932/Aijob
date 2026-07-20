import { createHash } from "node:crypto";
import type {
  FieldValue,
  JobDetail,
  JobFacet,
  JobSearchQuery,
  JobSearchResponse,
  JobSummary,
} from "@aijob/contracts";
import { JobSearchResponseSchema } from "@aijob/contracts";
import { z } from "zod";

export type CatalogFilterMatch = "explicit_match" | "information_unknown" | "mismatch";

export interface CatalogSearchRecord {
  detail: JobDetail;
  freshness: "fresh" | "due" | "stale" | "unknown";
}

const CursorSchema = z.object({
  version: z.literal(1),
  query: z.string().regex(/^[a-f0-9]{16}$/),
  rank: z.union([z.literal(0), z.literal(1)]),
  verifiedAt: z.string().datetime({ offset: true }),
  id: z.string().min(1),
});

type CatalogCursor = z.infer<typeof CursorSchema>;

export class InvalidCatalogCursorError extends Error {
  constructor() {
    super("The catalog cursor is invalid or belongs to another query");
    this.name = "InvalidCatalogCursorError";
  }
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

function includesNormalized(haystack: string, needle: string): boolean {
  return normalized(haystack).includes(normalized(needle));
}

function asSummary(detail: JobDetail): JobSummary {
  return {
    id: detail.id,
    publishedJobVersionId: detail.publishedJobVersionId,
    activeRequirementSetId: detail.activeRequirementSetId,
    companyName: detail.companyName,
    title: detail.title,
    jobFamily: detail.jobFamily,
    locations: detail.locations,
    weeklyAttendanceDays: detail.weeklyAttendanceDays,
    durationMonths: detail.durationMonths,
    studentStatus: detail.studentStatus,
    recruitmentBatch: detail.recruitmentBatch,
    graduationYears: detail.graduationYears,
    educationLevels: detail.educationLevels,
    majors: detail.majors,
    workMode: detail.workMode,
    salary: detail.salary,
    postedAt: detail.postedAt,
    deadlineAt: detail.deadlineAt,
    source: {
      sourceId: detail.source.sourceId,
      type: detail.source.type,
      provenanceLevel: detail.source.provenanceLevel,
      displayName: detail.source.displayName,
      domain: detail.source.domain,
      lastVerifiedAt: detail.source.lastVerifiedAt,
    },
    publicationState: detail.publicationState,
    activityState: detail.activityState,
    displayStatus: detail.displayStatus,
    ...(detail.internalPreview ? { internalPreview: detail.internalPreview } : {}),
  };
}

function fieldState<T>(
  field: FieldValue<T> | undefined,
  predicate: (value: T) => boolean,
): CatalogFilterMatch {
  if (!field || field.state !== "known") return "information_unknown";
  return predicate(field.value) ? "explicit_match" : "mismatch";
}

function combine(states: CatalogFilterMatch[]): CatalogFilterMatch {
  if (states.includes("mismatch")) return "mismatch";
  if (states.includes("information_unknown")) return "information_unknown";
  return "explicit_match";
}

function stringListIntersects(values: string[], selected: string[]): boolean {
  const normalizedSelected = new Set(selected.map(normalized));
  return values.some((value) => normalizedSelected.has(normalized(value)));
}

const canonicalCityNames = [
  "北京",
  "上海",
  "天津",
  "重庆",
  "深圳",
  "广州",
  "杭州",
  "成都",
  "武汉",
  "南京",
  "苏州",
  "西安",
  "长沙",
  "厦门",
  "青岛",
  "郑州",
  "合肥",
  "济南",
  "福州",
  "东莞",
  "佛山",
  "珠海",
  "宁波",
  "无锡",
  "昆明",
] as const;

export function canonicalCity(value: string): string {
  const trimmed = value.trim();
  if (/^(?:中国)?香港/.test(trimmed)) return "香港";
  const matched = canonicalCityNames.find((city) =>
    new RegExp(`^(?:中国)?${city}(?:市|总部|$)`).test(trimmed),
  );
  return matched ?? trimmed.replace(/市$/, "");
}

function cityListIntersects(values: string[], selected: string[]): boolean {
  const normalizedSelected = new Set(selected.map((value) => normalized(canonicalCity(value))));
  return values.some((value) => normalizedSelected.has(normalized(canonicalCity(value))));
}

function scalarIntersects(value: string, selected: string[]): boolean {
  return selected.map(normalized).includes(normalized(value));
}

export function classifyCatalogRecord(
  record: CatalogSearchRecord,
  query: JobSearchQuery,
): CatalogFilterMatch {
  const { detail } = record;
  const states: CatalogFilterMatch[] = [];

  if (query.keyword) {
    const corpus = [
      detail.title,
      detail.companyName,
      detail.responsibilitiesText.state === "known" ? detail.responsibilitiesText.value : "",
      detail.requirementsText.state === "known" ? detail.requirementsText.value : "",
    ].join("\n");
    states.push(includesNormalized(corpus, query.keyword) ? "explicit_match" : "mismatch");
  }

  if (query.companies?.length) {
    states.push(
      query.companies.some((company) => normalized(company) === normalized(detail.companyName))
        ? "explicit_match"
        : "mismatch",
    );
  }
  const cities = query.cities;
  if (cities?.length) {
    states.push(fieldState(detail.locations, (values) => cityListIntersects(values, cities)));
  }
  const jobFamilies = query.jobFamilies;
  if (jobFamilies?.length) {
    states.push(fieldState(detail.jobFamily, (value) => jobFamilies.includes(value)));
  }
  const recruitmentBatches = query.recruitmentBatches;
  if (recruitmentBatches?.length) {
    states.push(
      fieldState(detail.recruitmentBatch, (value) => scalarIntersects(value, recruitmentBatches)),
    );
  }
  const availableWeeklyAttendanceDays = query.availableWeeklyAttendanceDays;
  if (availableWeeklyAttendanceDays !== undefined) {
    states.push(
      fieldState(detail.weeklyAttendanceDays, (value) => value <= availableWeeklyAttendanceDays),
    );
  }
  const availableDurationMonths = query.availableDurationMonths;
  if (availableDurationMonths !== undefined) {
    states.push(fieldState(detail.durationMonths, (value) => value <= availableDurationMonths));
  }
  const latestStartDate = query.latestStartDate;
  if (latestStartDate) {
    states.push(fieldState(detail.earliestStartDate, (value) => value <= latestStartDate));
  }
  const graduationYears = query.graduationYears;
  if (graduationYears?.length) {
    states.push(
      fieldState(detail.graduationYears, (values) =>
        values.some((value) => graduationYears.includes(value)),
      ),
    );
  }
  const educationLevels = query.educationLevels;
  if (educationLevels?.length) {
    states.push(
      fieldState(detail.educationLevels, (values) => stringListIntersects(values, educationLevels)),
    );
  }
  const majors = query.majors;
  if (majors?.length) {
    states.push(fieldState(detail.majors, (values) => stringListIntersects(values, majors)));
  }
  const minimumSalary = query.minimumSalary;
  if (minimumSalary !== undefined) {
    if (!detail.salary || detail.salary.state !== "known") {
      states.push("information_unknown");
    } else if (detail.salary.value.minimum === null) {
      states.push("information_unknown");
    } else {
      states.push(detail.salary.value.minimum >= minimumSalary ? "explicit_match" : "mismatch");
    }
  }
  const salaryPeriods = query.salaryPeriods;
  if (salaryPeriods?.length) {
    states.push(fieldState(detail.salary, (value) => salaryPeriods.includes(value.period)));
  }
  const workModes = query.workModes;
  if (workModes?.length) {
    states.push(fieldState(detail.workMode, (value) => scalarIntersects(value, workModes)));
  }
  if (query.sourceTypes?.length) {
    states.push(query.sourceTypes.includes(detail.source.type) ? "explicit_match" : "mismatch");
  }
  if (query.sources?.length) {
    states.push(
      query.sources.some((source) => normalized(source) === normalized(detail.source.displayName))
        ? "explicit_match"
        : "mismatch",
    );
  }
  if (query.freshness) {
    states.push(record.freshness === query.freshness ? "explicit_match" : "mismatch");
  }

  return combine(states);
}

interface RankedRecord {
  record: CatalogSearchRecord;
  match: Exclude<CatalogFilterMatch, "mismatch">;
  rank: 0 | 1;
}

function compareRanked(left: RankedRecord, right: RankedRecord): number {
  if (left.rank !== right.rank) return left.rank - right.rank;
  const verified = right.record.detail.source.lastVerifiedAt.localeCompare(
    left.record.detail.source.lastVerifiedAt,
  );
  if (verified !== 0) return verified;
  return left.record.detail.id.localeCompare(right.record.detail.id);
}

function canonicalQuery(query: JobSearchQuery): string {
  const stable = {
    ...query,
    cursor: undefined,
    companies: query.companies?.map(normalized).sort(),
    cities: query.cities?.map(normalized).sort(),
    jobFamilies: query.jobFamilies?.slice().sort(),
    recruitmentBatches: query.recruitmentBatches?.map(normalized).sort(),
    graduationYears: query.graduationYears?.slice().sort((left, right) => left - right),
    educationLevels: query.educationLevels?.map(normalized).sort(),
    majors: query.majors?.map(normalized).sort(),
    salaryPeriods: query.salaryPeriods?.slice().sort(),
    workModes: query.workModes?.map(normalized).sort(),
    sources: query.sources?.map(normalized).sort(),
    sourceTypes: query.sourceTypes?.slice().sort(),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

function encodeCursor(record: RankedRecord, queryHash: string): string {
  const cursor: CatalogCursor = {
    version: 1,
    query: queryHash,
    rank: record.rank,
    verifiedAt: record.record.detail.source.lastVerifiedAt,
    id: record.record.detail.id,
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string, queryHash: string): CatalogCursor {
  try {
    const parsed = CursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (parsed.query !== queryHash) throw new InvalidCatalogCursorError();
    return parsed;
  } catch (error) {
    if (error instanceof InvalidCatalogCursorError) throw error;
    throw new InvalidCatalogCursorError();
  }
}

function isAfterCursor(record: RankedRecord, cursor: CatalogCursor): boolean {
  if (record.rank !== cursor.rank) return record.rank > cursor.rank;
  const verifiedComparison = record.record.detail.source.lastVerifiedAt.localeCompare(
    cursor.verifiedAt,
  );
  if (verifiedComparison !== 0) return verifiedComparison < 0;
  return record.record.detail.id.localeCompare(cursor.id) > 0;
}

type FacetExtractor = (record: CatalogSearchRecord) => FieldValue<string[]>;

function knownStrings(values: string[], evidenceRef: string): FieldValue<string[]> {
  return values.length > 0
    ? { state: "known", value: values, evidenceRefs: [evidenceRef] }
    : { state: "unknown", reason: "source_not_stated" };
}

function scalarField(field: FieldValue<string> | undefined): FieldValue<string[]> {
  if (!field || field.state === "unknown") {
    return {
      state: "unknown",
      reason: field?.reason ?? "source_not_stated",
    };
  }
  if (field.state === "conflict") {
    return {
      state: "conflict",
      rawValues: field.rawValues,
      evidenceRefs: field.evidenceRefs,
    };
  }
  return {
    state: "known",
    value: [field.value],
    evidenceRefs: field.evidenceRefs,
  };
}

function numberField(field: FieldValue<number> | undefined): FieldValue<string[]> {
  if (!field || field.state === "unknown") {
    return {
      state: "unknown",
      reason: field?.reason ?? "source_not_stated",
    };
  }
  if (field.state === "conflict") {
    return {
      state: "conflict",
      rawValues: field.rawValues,
      evidenceRefs: field.evidenceRefs,
    };
  }
  return {
    state: "known",
    value: [String(field.value)],
    evidenceRefs: field.evidenceRefs,
  };
}

function listField(field: FieldValue<string[]> | undefined): FieldValue<string[]> {
  return (
    field ?? {
      state: "unknown",
      reason: "source_not_stated",
    }
  );
}

function yearField(field: FieldValue<number[]> | undefined): FieldValue<string[]> {
  if (!field || field.state === "unknown") {
    return {
      state: "unknown",
      reason: field?.reason ?? "source_not_stated",
    };
  }
  if (field.state === "conflict") {
    return {
      state: "conflict",
      rawValues: field.rawValues,
      evidenceRefs: field.evidenceRefs,
    };
  }
  return {
    state: "known",
    value: field.value.map(String),
    evidenceRefs: field.evidenceRefs,
  };
}

function salaryPeriodField(field: JobDetail["salary"]): FieldValue<string[]> {
  if (!field || field.state === "unknown") {
    return { state: "unknown", reason: field?.reason ?? "source_not_stated" };
  }
  if (field.state === "conflict") {
    return {
      state: "conflict",
      rawValues: field.rawValues,
      evidenceRefs: field.evidenceRefs,
    };
  }
  return {
    state: "known",
    value: [field.value.period],
    evidenceRefs: field.evidenceRefs,
  };
}

const facetExtractors: Array<{ key: string; extract: FacetExtractor }> = [
  {
    key: "company",
    extract: (record) =>
      knownStrings([record.detail.companyName], `${record.detail.id}#companyName`),
  },
  {
    key: "city",
    extract: (record) => {
      const locations = listField(record.detail.locations);
      return locations.state === "known"
        ? { ...locations, value: locations.value.map(canonicalCity) }
        : locations;
    },
  },
  {
    key: "jobFamily",
    extract: (record) => scalarField(record.detail.jobFamily),
  },
  {
    key: "recruitmentBatch",
    extract: (record) => scalarField(record.detail.recruitmentBatch),
  },
  {
    key: "weeklyAttendanceDays",
    extract: (record) => numberField(record.detail.weeklyAttendanceDays),
  },
  {
    key: "durationMonths",
    extract: (record) => numberField(record.detail.durationMonths),
  },
  {
    key: "earliestStartDate",
    extract: (record) => scalarField(record.detail.earliestStartDate),
  },
  {
    key: "graduationYear",
    extract: (record) => yearField(record.detail.graduationYears),
  },
  {
    key: "educationLevel",
    extract: (record) => listField(record.detail.educationLevels),
  },
  { key: "major", extract: (record) => listField(record.detail.majors) },
  {
    key: "salaryPeriod",
    extract: (record) => salaryPeriodField(record.detail.salary),
  },
  {
    key: "workMode",
    extract: (record) => scalarField(record.detail.workMode),
  },
  {
    key: "source",
    extract: (record) =>
      knownStrings([record.detail.source.displayName], `${record.detail.id}#sourceDisplayName`),
  },
  {
    key: "sourceType",
    extract: (record) =>
      knownStrings([record.detail.source.type], `${record.detail.id}#sourceType`),
  },
  {
    key: "freshness",
    extract: (record) =>
      record.freshness === "unknown"
        ? { state: "unknown", reason: "not_yet_verified" }
        : knownStrings([record.freshness], `${record.detail.id}#freshness`),
  },
];

export function buildCatalogFacets(records: CatalogSearchRecord[]): JobFacet[] {
  return facetExtractors.map(({ key, extract }) => {
    let knownCount = 0;
    let unknownCount = 0;
    const counts = new Map<string, number>();

    for (const record of records) {
      const field = extract(record);
      if (field.state !== "known") {
        unknownCount += 1;
        continue;
      }
      knownCount += 1;
      for (const value of new Set(field.value)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }

    return {
      key,
      knownCount,
      unknownCount,
      values: [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value)),
    };
  });
}

export function searchCatalogRecords(
  records: CatalogSearchRecord[],
  query: JobSearchQuery,
): JobSearchResponse {
  const candidates: RankedRecord[] = [];
  for (const record of records) {
    const match = classifyCatalogRecord(record, query);
    if (match === "mismatch") continue;
    candidates.push({
      record,
      match,
      rank: match === "explicit_match" ? 0 : 1,
    });
  }
  const ranked = query.includeUnknownHardConditions
    ? candidates
    : candidates.filter(({ match }) => match === "explicit_match");
  ranked.sort(compareRanked);

  const queryHash = canonicalQuery(query);
  const cursor = query.cursor ? decodeCursor(query.cursor, queryHash) : null;
  const afterCursor = cursor ? ranked.filter((record) => isAfterCursor(record, cursor)) : ranked;
  const page = afterCursor.slice(0, query.limit);
  const hasMore = afterCursor.length > page.length;
  const lastPageItem = page.at(-1);

  return JobSearchResponseSchema.parse({
    items: page.map(({ record, match }) => ({
      ...asSummary(record.detail),
      conditionState: match,
    })),
    nextCursor: hasMore && lastPageItem ? encodeCursor(lastPageItem, queryHash) : null,
    facets: buildCatalogFacets(ranked.map(({ record }) => record)),
    totalKnown: candidates.filter(({ match }) => match === "explicit_match").length,
    totalUnknown: candidates.filter(({ match }) => match === "information_unknown").length,
  });
}
