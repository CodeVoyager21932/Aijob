import type {
  ResearchFamily,
  ResearchFilters,
  ResearchJob,
  ResearchSearchResult,
  ResearchUnknownDimension,
} from "./types";

const allowedFamilies = new Set<ResearchFamily>(["product", "operations"]);
const allowedUnknownDimensions = new Set<ResearchUnknownDimension>([
  "city",
  "family",
  "attendance",
  "duration",
]);

export const researchAvailableDaysOptions = [2, 3, 4, 5, 6, 7] as const;
export const researchAvailableMonthsOptions = [1, 2, 3, 4, 5, 6, 9, 12] as const;

export const emptyResearchFilters: ResearchFilters = {
  q: "",
  cities: [],
  companies: [],
  families: [],
  availableDaysPerWeek: null,
  availableMonths: null,
  includeUnknown: [],
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizedKeyword(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 80);
}

function validOption(value: string | null, allowedValues: readonly number[]): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && allowedValues.includes(parsed) ? parsed : null;
}

export function parseResearchFilters(searchParams: URLSearchParams): ResearchFilters {
  const filters: ResearchFilters = {
    q: normalizedKeyword(searchParams.get("q") ?? ""),
    cities: unique(searchParams.getAll("city").filter(Boolean)),
    companies: unique(searchParams.getAll("company").filter(Boolean)),
    families: unique(
      searchParams
        .getAll("family")
        .filter((value): value is ResearchFamily => allowedFamilies.has(value as ResearchFamily)),
    ),
    availableDaysPerWeek: validOption(
      searchParams.get("availableDaysPerWeek"),
      researchAvailableDaysOptions,
    ),
    availableMonths: validOption(
      searchParams.get("availableMonths"),
      researchAvailableMonthsOptions,
    ),
    includeUnknown: unique(
      searchParams
        .getAll("includeUnknown")
        .filter((value): value is ResearchUnknownDimension =>
          allowedUnknownDimensions.has(value as ResearchUnknownDimension),
        ),
    ),
  };

  return {
    ...filters,
    includeUnknown: filters.includeUnknown.filter((dimension) =>
      isUnknownSelectionRelevant(filters, dimension),
    ),
  };
}

export function serializeResearchFilters(filters: ResearchFilters): URLSearchParams {
  const searchParams = new URLSearchParams();
  const q = normalizedKeyword(filters.q);
  if (q) searchParams.set("q", q);
  for (const city of unique(filters.cities)) searchParams.append("city", city);
  for (const company of unique(filters.companies)) searchParams.append("company", company);
  for (const family of unique(filters.families)) searchParams.append("family", family);
  if (filters.availableDaysPerWeek !== null) {
    searchParams.set("availableDaysPerWeek", String(filters.availableDaysPerWeek));
  }
  if (filters.availableMonths !== null) {
    searchParams.set("availableMonths", String(filters.availableMonths));
  }
  for (const dimension of unique(filters.includeUnknown).filter((candidate) =>
    isUnknownSelectionRelevant(filters, candidate),
  )) {
    searchParams.append("includeUnknown", dimension);
  }
  return searchParams;
}

type FilterDimension = ResearchUnknownDimension | "company" | "keyword";

function includesUnknown(filters: ResearchFilters, dimension: ResearchUnknownDimension): boolean {
  return filters.includeUnknown.includes(dimension);
}

function isUnknownSelectionRelevant(
  filters: ResearchFilters,
  dimension: ResearchUnknownDimension,
): boolean {
  if (dimension === "city") return filters.cities.length > 0;
  if (dimension === "family") return filters.families.length > 0;
  if (dimension === "attendance") return filters.availableDaysPerWeek !== null;
  return filters.availableMonths !== null;
}

function matchesJob(
  job: ResearchJob,
  filters: ResearchFilters,
  ignoredDimension?: FilterDimension,
): boolean {
  if (ignoredDimension !== "keyword" && filters.q) {
    const q = normalizedKeyword(filters.q).toLocaleLowerCase("zh-CN");
    const haystack = `${job.title} ${job.organizationName}`
      .normalize("NFKC")
      .toLocaleLowerCase("zh-CN");
    if (!haystack.includes(q)) return false;
  }

  if (ignoredDimension !== "city" && filters.cities.length > 0) {
    if (job.cities.state === "known") {
      if (!job.cities.value.some((city) => filters.cities.includes(city.key))) return false;
    } else if (!includesUnknown(filters, "city")) {
      return false;
    }
  }

  if (
    ignoredDimension !== "company" &&
    filters.companies.length > 0 &&
    !filters.companies.includes(job.organizationSlug)
  ) {
    return false;
  }

  if (ignoredDimension !== "family" && filters.families.length > 0) {
    if (job.family.state === "known") {
      if (!filters.families.includes(job.family.value)) return false;
    } else if (!includesUnknown(filters, "family")) {
      return false;
    }
  }

  if (ignoredDimension !== "attendance" && filters.availableDaysPerWeek !== null) {
    if (job.weeklyAttendanceDays.state === "known") {
      if (job.weeklyAttendanceDays.value > filters.availableDaysPerWeek) return false;
    } else if (!includesUnknown(filters, "attendance")) {
      return false;
    }
  }

  if (ignoredDimension !== "duration" && filters.availableMonths !== null) {
    if (job.durationMonths.state === "known") {
      if (job.durationMonths.value > filters.availableMonths) return false;
    } else if (!includesUnknown(filters, "duration")) {
      return false;
    }
  }

  return true;
}

function familyLabel(family: ResearchFamily): string {
  return family === "product" ? "产品" : "运营";
}

export function searchResearchJobs(
  jobs: readonly ResearchJob[],
  filters: ResearchFilters,
): ResearchSearchResult {
  const items = jobs
    .filter((job) => matchesJob(job, filters))
    .sort((left, right) => {
      const verifiedOrder = right.lastVerifiedAt.localeCompare(left.lastVerifiedAt);
      return verifiedOrder || left.id.localeCompare(right.id);
    });

  const cityCounts = new Map<string, { label: string; count: number }>();
  const companyCounts = new Map<string, { label: string; count: number }>();
  const familyCounts = new Map<ResearchFamily, number>();
  const unknownCounts: Record<ResearchUnknownDimension, number> = {
    city: 0,
    family: 0,
    attendance: 0,
    duration: 0,
  };

  for (const job of jobs) {
    if (matchesJob(job, filters, "city")) {
      if (job.cities.state === "known") {
        for (const city of job.cities.value) {
          const current = cityCounts.get(city.key);
          cityCounts.set(city.key, { label: city.label, count: (current?.count ?? 0) + 1 });
        }
      } else {
        unknownCounts.city += 1;
      }
    }

    if (matchesJob(job, filters, "company")) {
      const current = companyCounts.get(job.organizationSlug);
      companyCounts.set(job.organizationSlug, {
        label: job.organizationName,
        count: (current?.count ?? 0) + 1,
      });
    }

    if (matchesJob(job, filters, "family")) {
      if (job.family.state === "known") {
        familyCounts.set(job.family.value, (familyCounts.get(job.family.value) ?? 0) + 1);
      } else {
        unknownCounts.family += 1;
      }
    }

    if (matchesJob(job, filters, "attendance") && job.weeklyAttendanceDays.state !== "known") {
      unknownCounts.attendance += 1;
    }
    if (matchesJob(job, filters, "duration") && job.durationMonths.state !== "known") {
      unknownCounts.duration += 1;
    }
  }

  return {
    items,
    totalCount: items.length,
    facets: {
      cities: [...cityCounts.entries()]
        .map(([key, value]) => ({ key, ...value }))
        .sort((left, right) => left.label.localeCompare(right.label, "zh-CN")),
      companies: [...companyCounts.entries()]
        .map(([key, value]) => ({ key, ...value }))
        .sort((left, right) => left.label.localeCompare(right.label, "zh-CN")),
      families: [...familyCounts.entries()]
        .map(([key, count]) => ({ key, label: familyLabel(key), count }))
        .sort((left, right) => left.label.localeCompare(right.label, "zh-CN")),
      unknownCounts,
    },
  };
}

export function countAppliedResearchFilters(filters: ResearchFilters): number {
  return (
    (filters.q ? 1 : 0) +
    filters.cities.length +
    filters.companies.length +
    filters.families.length +
    (filters.availableDaysPerWeek === null ? 0 : 1) +
    (filters.availableMonths === null ? 0 : 1) +
    filters.includeUnknown.filter((dimension) => isUnknownSelectionRelevant(filters, dimension))
      .length
  );
}
