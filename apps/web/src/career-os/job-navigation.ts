import type {
  CreateRecommendationRunFromSearchRequest,
  JobFamily,
  SalaryPeriod,
  SourceType,
} from "@aijob/contracts";
import type { JobFilters } from "../api/product";

export const emptyJobFilters: JobFilters = {
  keyword: "",
  companies: [],
  cities: [],
  jobFamilies: [],
  recruitmentBatches: [],
  availableWeeklyAttendanceDays: "",
  availableDurationMonths: "",
  latestStartDate: "",
  graduationYears: [],
  educationLevels: [],
  majors: [],
  minimumSalary: "",
  salaryPeriods: [],
  workModes: [],
  sources: [],
  sourceTypes: [],
  freshness: "",
  includeUnknownHardConditions: true,
};

const listKeys = [
  "companies",
  "cities",
  "jobFamilies",
  "recruitmentBatches",
  "graduationYears",
  "educationLevels",
  "majors",
  "salaryPeriods",
  "workModes",
  "sources",
  "sourceTypes",
] as const;

function listValue(params: URLSearchParams, key: (typeof listKeys)[number]): string[] {
  return [...new Set(params.getAll(key).flatMap((value) => value.split(",")))]
    .map((value) => value.trim())
    .filter(Boolean);
}

export function jobFiltersFromSearchParams(params: URLSearchParams): JobFilters {
  return {
    keyword: params.get("keyword")?.trim() ?? "",
    companies: listValue(params, "companies"),
    cities: listValue(params, "cities"),
    jobFamilies: listValue(params, "jobFamilies"),
    recruitmentBatches: listValue(params, "recruitmentBatches"),
    availableWeeklyAttendanceDays: params.get("availableWeeklyAttendanceDays") ?? "",
    availableDurationMonths: params.get("availableDurationMonths") ?? "",
    latestStartDate: params.get("latestStartDate") ?? "",
    graduationYears: listValue(params, "graduationYears"),
    educationLevels: listValue(params, "educationLevels"),
    majors: listValue(params, "majors"),
    minimumSalary: params.get("minimumSalary") ?? "",
    salaryPeriods: listValue(params, "salaryPeriods"),
    workModes: listValue(params, "workModes"),
    sources: listValue(params, "sources"),
    sourceTypes: listValue(params, "sourceTypes"),
    freshness: params.get("freshness") ?? "",
    includeUnknownHardConditions: params.get("includeUnknownHardConditions") !== "false",
    ...(params.get("cursor") ? { cursor: params.get("cursor") ?? undefined } : {}),
  };
}

function setList(params: URLSearchParams, key: string, values: string[]) {
  if (values.length > 0) params.set(key, [...new Set(values)].join(","));
}

export function jobFiltersToSearchParams(
  filters: JobFilters,
  options: { includeCursor?: boolean } = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  for (const key of listKeys) setList(params, key, filters[key]);
  if (filters.availableWeeklyAttendanceDays) {
    params.set("availableWeeklyAttendanceDays", filters.availableWeeklyAttendanceDays);
  }
  if (filters.availableDurationMonths) {
    params.set("availableDurationMonths", filters.availableDurationMonths);
  }
  if (filters.latestStartDate) params.set("latestStartDate", filters.latestStartDate);
  if (filters.minimumSalary) params.set("minimumSalary", filters.minimumSalary);
  if (filters.freshness) params.set("freshness", filters.freshness);
  if (!filters.includeUnknownHardConditions) {
    params.set("includeUnknownHardConditions", "false");
  }
  if (options.includeCursor && filters.cursor) params.set("cursor", filters.cursor);
  return params;
}

function optionalNumber(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalNumbers(values: string[]): number[] | undefined {
  const parsed = values.map(Number).filter(Number.isFinite);
  return parsed.length > 0 ? parsed : undefined;
}

function optionalList<T>(values: T[]): T[] | undefined {
  return values.length > 0 ? values : undefined;
}

export function recommendationRequestFromFilters(
  filters: JobFilters,
): CreateRecommendationRunFromSearchRequest {
  return {
    scope: {
      ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}),
      ...(optionalList(filters.companies) ? { companies: filters.companies } : {}),
      ...(optionalList(filters.cities) ? { cities: filters.cities } : {}),
      ...(optionalList(filters.jobFamilies)
        ? { jobFamilies: filters.jobFamilies as JobFamily[] }
        : {}),
      ...(optionalList(filters.recruitmentBatches)
        ? { recruitmentBatches: filters.recruitmentBatches }
        : {}),
      ...(optionalNumber(filters.availableWeeklyAttendanceDays) !== undefined
        ? { availableWeeklyAttendanceDays: optionalNumber(filters.availableWeeklyAttendanceDays) }
        : {}),
      ...(optionalNumber(filters.availableDurationMonths) !== undefined
        ? { availableDurationMonths: optionalNumber(filters.availableDurationMonths) }
        : {}),
      ...(filters.latestStartDate ? { latestStartDate: filters.latestStartDate } : {}),
      ...(optionalNumbers(filters.graduationYears)
        ? { graduationYears: optionalNumbers(filters.graduationYears) }
        : {}),
      ...(optionalList(filters.educationLevels)
        ? { educationLevels: filters.educationLevels }
        : {}),
      ...(optionalList(filters.majors) ? { majors: filters.majors } : {}),
      ...(optionalNumber(filters.minimumSalary) !== undefined
        ? { minimumSalary: optionalNumber(filters.minimumSalary) }
        : {}),
      ...(optionalList(filters.salaryPeriods)
        ? { salaryPeriods: filters.salaryPeriods as SalaryPeriod[] }
        : {}),
      ...(optionalList(filters.workModes) ? { workModes: filters.workModes } : {}),
      ...(optionalList(filters.sources) ? { sources: filters.sources } : {}),
      ...(optionalList(filters.sourceTypes)
        ? { sourceTypes: filters.sourceTypes as SourceType[] }
        : {}),
      ...(filters.freshness
        ? { freshness: filters.freshness as "fresh" | "due" | "stale" | "unknown" }
        : {}),
      includeUnknownHardConditions: filters.includeUnknownHardConditions,
    },
  };
}

export function jobDiscoveryPath(filters: JobFilters): string {
  const query = jobFiltersToSearchParams(filters, { includeCursor: true }).toString();
  return query ? `/jobs?${query}` : "/jobs";
}

export function recommendedJobsPath(filters: JobFilters): string {
  const query = jobFiltersToSearchParams(filters).toString();
  return query ? `/jobs/recommended?${query}` : "/jobs/recommended";
}

export function jobDetailPath(jobId: string, from: string): string {
  const params = new URLSearchParams({ from });
  return `/jobs/${encodeURIComponent(jobId)}?${params.toString()}`;
}

export function safeJobReturnPath(value: string | null): string {
  if (!value) return "/jobs";
  try {
    const url = new URL(value, "https://aijob.local");
    if (
      url.origin !== "https://aijob.local" ||
      (url.pathname !== "/jobs" && !url.pathname.startsWith("/jobs/"))
    ) {
      return "/jobs";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/jobs";
  }
}

export function hasActiveJobFilters(filters: JobFilters): boolean {
  const { cursor: _cursor, includeUnknownHardConditions, ...values } = filters;
  return (
    !includeUnknownHardConditions ||
    Object.values(values).some((value) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    )
  );
}
