import type {
  ResearchFamily,
  ResearchField,
  ResearchFilters,
  ResearchJob,
  ResearchSearchResult,
  ResearchSourceType,
  ResearchUnknownDimension,
} from "./types";

const allowedFamilies = new Set<ResearchFamily>(["product", "operations"]);
const researchSourceTypes = [
  "企业官网",
  "官方 ATS",
  "高校就业网",
] as const satisfies readonly ResearchSourceType[];
const allowedSourceTypes = new Set<ResearchSourceType>(researchSourceTypes);
const allowedUnknownDimensions = new Set<ResearchUnknownDimension>([
  "city",
  "family",
  "attendance",
  "duration",
  "batch",
  "arrival",
  "graduation",
]);

const maxRepeatedValues = 40;
const maxFacetValueLength = 80;
const minimumGraduationYear = 2000;
const maximumGraduationYear = 2100;

export const researchAvailableDaysOptions = [2, 3, 4, 5, 6, 7] as const;
export const researchAvailableMonthsOptions = [1, 2, 3, 4, 5, 6, 9, 12] as const;

export const emptyResearchFilters: ResearchFilters = {
  q: "",
  cities: [],
  companies: [],
  families: [],
  availableDaysPerWeek: null,
  availableMonths: null,
  recruitmentBatches: [],
  arrivalRequirements: [],
  graduationYears: [],
  sourceTypes: [],
  includeUnknown: [],
};

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function normalizedKeyword(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 80);
}

function normalizedFacetValue(value: string): string | null {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (
    !normalized ||
    normalized.length > maxFacetValueLength ||
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    return null;
  }
  return normalized;
}

function validRepeatedText(values: readonly string[]): string[] {
  const normalized = values
    .map(normalizedFacetValue)
    .filter((value): value is string => value !== null);
  return unique(normalized).slice(0, maxRepeatedValues);
}

function validOption(value: string | null, allowedValues: readonly number[]): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && allowedValues.includes(parsed) ? parsed : null;
}

function validGraduationYear(value: string): number | null {
  if (!/^\d{4}$/u.test(value)) return null;
  const parsed = Number(value);
  return parsed >= minimumGraduationYear && parsed <= maximumGraduationYear ? parsed : null;
}

function validGraduationYears(values: readonly string[]): number[] {
  return unique(
    values.map(validGraduationYear).filter((value): value is number => value !== null),
  ).slice(0, maxRepeatedValues);
}

function isAllowedNumber(value: number | null, allowedValues: readonly number[]): value is number {
  return value !== null && Number.isInteger(value) && allowedValues.includes(value);
}

export function parseResearchFilters(searchParams: URLSearchParams): ResearchFilters {
  return {
    q: normalizedKeyword(searchParams.get("q") ?? ""),
    cities: validRepeatedText(searchParams.getAll("city")),
    companies: validRepeatedText(searchParams.getAll("company")),
    families: unique(
      searchParams
        .getAll("family")
        .filter((value): value is ResearchFamily => allowedFamilies.has(value as ResearchFamily)),
    ).slice(0, maxRepeatedValues),
    availableDaysPerWeek: validOption(
      searchParams.get("availableDaysPerWeek"),
      researchAvailableDaysOptions,
    ),
    availableMonths: validOption(
      searchParams.get("availableMonths"),
      researchAvailableMonthsOptions,
    ),
    recruitmentBatches: validRepeatedText(searchParams.getAll("recruitmentBatch")),
    arrivalRequirements: validRepeatedText(searchParams.getAll("arrivalRequirement")),
    graduationYears: validGraduationYears(searchParams.getAll("graduationYear")),
    sourceTypes: unique(
      searchParams
        .getAll("sourceType")
        .filter((value): value is ResearchSourceType =>
          allowedSourceTypes.has(value as ResearchSourceType),
        ),
    ).slice(0, maxRepeatedValues),
    includeUnknown: unique(
      searchParams
        .getAll("includeUnknown")
        .filter((value): value is ResearchUnknownDimension =>
          allowedUnknownDimensions.has(value as ResearchUnknownDimension),
        ),
    ).slice(0, maxRepeatedValues),
  };
}

export function serializeResearchFilters(filters: ResearchFilters): URLSearchParams {
  const searchParams = new URLSearchParams();
  const q = normalizedKeyword(filters.q);
  if (q) searchParams.set("q", q);
  for (const city of validRepeatedText(filters.cities)) searchParams.append("city", city);
  for (const company of validRepeatedText(filters.companies)) {
    searchParams.append("company", company);
  }
  for (const family of unique(filters.families).filter((value) => allowedFamilies.has(value))) {
    searchParams.append("family", family);
  }
  if (isAllowedNumber(filters.availableDaysPerWeek, researchAvailableDaysOptions)) {
    searchParams.set("availableDaysPerWeek", String(filters.availableDaysPerWeek));
  }
  if (isAllowedNumber(filters.availableMonths, researchAvailableMonthsOptions)) {
    searchParams.set("availableMonths", String(filters.availableMonths));
  }
  for (const batch of validRepeatedText(filters.recruitmentBatches)) {
    searchParams.append("recruitmentBatch", batch);
  }
  for (const arrival of validRepeatedText(filters.arrivalRequirements)) {
    searchParams.append("arrivalRequirement", arrival);
  }
  for (const graduationYear of unique(filters.graduationYears).filter(
    (value) =>
      Number.isInteger(value) && value >= minimumGraduationYear && value <= maximumGraduationYear,
  )) {
    searchParams.append("graduationYear", String(graduationYear));
  }
  for (const sourceType of unique(filters.sourceTypes).filter((value) =>
    allowedSourceTypes.has(value),
  )) {
    searchParams.append("sourceType", sourceType);
  }
  for (const dimension of unique(filters.includeUnknown).filter((value) =>
    allowedUnknownDimensions.has(value),
  )) {
    searchParams.append("includeUnknown", dimension);
  }
  return searchParams;
}

type FilterDimension = ResearchUnknownDimension | "company" | "keyword" | "source";

function includesUnknown(filters: ResearchFilters, dimension: ResearchUnknownDimension): boolean {
  return filters.includeUnknown.includes(dimension);
}

function matchesField<T>(
  field: ResearchField<T>,
  hasKnownSelection: boolean,
  includeUnknown: boolean,
  matchesKnownValue: (value: T) => boolean,
): boolean {
  if (!hasKnownSelection && !includeUnknown) return true;
  if (field.state !== "known") return includeUnknown;
  return hasKnownSelection && matchesKnownValue(field.value);
}

function matchesJob(
  job: ResearchJob,
  filters: ResearchFilters,
  ignoredDimension?: FilterDimension,
): boolean {
  if (ignoredDimension !== "keyword" && filters.q) {
    const q = normalizedKeyword(filters.q).toLocaleLowerCase("zh-CN");
    const haystack = [
      job.title,
      job.organizationName,
      job.responsibilitiesExcerpt,
      job.requirementsExcerpt,
    ]
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase("zh-CN");
    if (!haystack.includes(q)) return false;
  }

  if (
    ignoredDimension !== "city" &&
    !matchesField(
      job.cities,
      filters.cities.length > 0,
      includesUnknown(filters, "city"),
      (cities) => cities.some((city) => filters.cities.includes(city.key)),
    )
  ) {
    return false;
  }

  if (
    ignoredDimension !== "company" &&
    filters.companies.length > 0 &&
    !filters.companies.includes(job.organizationSlug)
  ) {
    return false;
  }

  if (
    ignoredDimension !== "family" &&
    !matchesField(
      job.family,
      filters.families.length > 0,
      includesUnknown(filters, "family"),
      (family) => filters.families.includes(family),
    )
  ) {
    return false;
  }

  if (
    ignoredDimension !== "attendance" &&
    !matchesField(
      job.weeklyAttendanceDays,
      filters.availableDaysPerWeek !== null,
      includesUnknown(filters, "attendance"),
      (requiredDays) =>
        filters.availableDaysPerWeek !== null && requiredDays <= filters.availableDaysPerWeek,
    )
  ) {
    return false;
  }

  if (
    ignoredDimension !== "duration" &&
    !matchesField(
      job.durationMonths,
      filters.availableMonths !== null,
      includesUnknown(filters, "duration"),
      (requiredMonths) =>
        filters.availableMonths !== null && requiredMonths <= filters.availableMonths,
    )
  ) {
    return false;
  }

  if (
    ignoredDimension !== "batch" &&
    !matchesField(
      job.recruitmentBatch,
      filters.recruitmentBatches.length > 0,
      includesUnknown(filters, "batch"),
      (batch) => filters.recruitmentBatches.includes(batch),
    )
  ) {
    return false;
  }

  if (
    ignoredDimension !== "arrival" &&
    !matchesField(
      job.earliestStartDate,
      filters.arrivalRequirements.length > 0,
      includesUnknown(filters, "arrival"),
      (arrival) => filters.arrivalRequirements.includes(arrival),
    )
  ) {
    return false;
  }

  if (
    ignoredDimension !== "graduation" &&
    !matchesField(
      job.graduationYears,
      filters.graduationYears.length > 0,
      includesUnknown(filters, "graduation"),
      (graduationYears) => graduationYears.some((year) => filters.graduationYears.includes(year)),
    )
  ) {
    return false;
  }

  if (
    ignoredDimension !== "source" &&
    filters.sourceTypes.length > 0 &&
    !filters.sourceTypes.includes(job.sourceType)
  ) {
    return false;
  }

  return true;
}

function hasInformationUnknownMatch(job: ResearchJob, filters: ResearchFilters): boolean {
  return (
    (includesUnknown(filters, "city") && job.cities.state !== "known") ||
    (includesUnknown(filters, "family") && job.family.state !== "known") ||
    (includesUnknown(filters, "attendance") && job.weeklyAttendanceDays.state !== "known") ||
    (includesUnknown(filters, "duration") && job.durationMonths.state !== "known") ||
    (includesUnknown(filters, "batch") && job.recruitmentBatch.state !== "known") ||
    (includesUnknown(filters, "arrival") && job.earliestStartDate.state !== "known") ||
    (includesUnknown(filters, "graduation") && job.graduationYears.state !== "known")
  );
}

function familyLabel(family: ResearchFamily): string {
  return family === "product" ? "产品" : "运营";
}

type FacetCounts = Map<string, { label: string; count: number }>;

function incrementFacet(counts: FacetCounts, key: string, label = key): void {
  const current = counts.get(key);
  counts.set(key, { label, count: (current?.count ?? 0) + 1 });
}

function sortedFacetOptions(counts: FacetCounts) {
  return [...counts.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
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
  const clearlyMatchingItems = items.filter((job) => !hasInformationUnknownMatch(job, filters));
  const informationUnknownItems = items.filter((job) => hasInformationUnknownMatch(job, filters));

  const cityCounts: FacetCounts = new Map();
  const companyCounts: FacetCounts = new Map();
  const familyCounts: FacetCounts = new Map();
  const recruitmentBatchCounts: FacetCounts = new Map();
  const arrivalRequirementCounts: FacetCounts = new Map();
  const graduationYearCounts: FacetCounts = new Map();
  const sourceTypeCounts: FacetCounts = new Map();
  const unknownCounts: Record<ResearchUnknownDimension, number> = {
    city: 0,
    family: 0,
    attendance: 0,
    duration: 0,
    batch: 0,
    arrival: 0,
    graduation: 0,
  };

  for (const job of jobs) {
    if (matchesJob(job, filters, "city")) {
      if (job.cities.state === "known") {
        const uniqueCities = new Map(job.cities.value.map((city) => [city.key, city.label]));
        for (const [key, label] of uniqueCities) incrementFacet(cityCounts, key, label);
      } else {
        unknownCounts.city += 1;
      }
    }

    if (matchesJob(job, filters, "company")) {
      incrementFacet(companyCounts, job.organizationSlug, job.organizationName);
    }

    if (matchesJob(job, filters, "family")) {
      if (job.family.state === "known") {
        incrementFacet(familyCounts, job.family.value, familyLabel(job.family.value));
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

    if (matchesJob(job, filters, "batch")) {
      if (job.recruitmentBatch.state === "known") {
        incrementFacet(recruitmentBatchCounts, job.recruitmentBatch.value);
      } else {
        unknownCounts.batch += 1;
      }
    }

    if (matchesJob(job, filters, "arrival")) {
      if (job.earliestStartDate.state === "known") {
        incrementFacet(arrivalRequirementCounts, job.earliestStartDate.value);
      } else {
        unknownCounts.arrival += 1;
      }
    }

    if (matchesJob(job, filters, "graduation")) {
      if (job.graduationYears.state === "known") {
        for (const year of unique(job.graduationYears.value)) {
          incrementFacet(graduationYearCounts, String(year), `${year} 届`);
        }
      } else {
        unknownCounts.graduation += 1;
      }
    }

    if (matchesJob(job, filters, "source")) {
      incrementFacet(sourceTypeCounts, job.sourceType);
    }
  }

  return {
    items,
    clearlyMatchingItems,
    informationUnknownItems,
    totalCount: items.length,
    facets: {
      cities: sortedFacetOptions(cityCounts),
      companies: sortedFacetOptions(companyCounts),
      families: sortedFacetOptions(familyCounts),
      recruitmentBatches: sortedFacetOptions(recruitmentBatchCounts),
      arrivalRequirements: sortedFacetOptions(arrivalRequirementCounts),
      graduationYears: sortedFacetOptions(graduationYearCounts).sort(
        (left, right) => Number(left.key) - Number(right.key),
      ),
      sourceTypes: sortedFacetOptions(sourceTypeCounts),
      unknownCounts,
    },
  };
}

export function countAppliedResearchFilters(filters: ResearchFilters): number {
  const dimensions = [
    normalizedKeyword(filters.q).length > 0,
    filters.cities.length > 0 || includesUnknown(filters, "city"),
    filters.companies.length > 0,
    filters.families.length > 0 || includesUnknown(filters, "family"),
    filters.availableDaysPerWeek !== null || includesUnknown(filters, "attendance"),
    filters.availableMonths !== null || includesUnknown(filters, "duration"),
    filters.recruitmentBatches.length > 0 || includesUnknown(filters, "batch"),
    filters.arrivalRequirements.length > 0 || includesUnknown(filters, "arrival"),
    filters.graduationYears.length > 0 || includesUnknown(filters, "graduation"),
    filters.sourceTypes.length > 0,
  ];
  return dimensions.filter(Boolean).length;
}
