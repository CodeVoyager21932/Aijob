export type ResearchFamily = "product" | "operations";

export type ResearchUnknownDimension = "city" | "family" | "attendance" | "duration";

export type ResearchField<T> =
  | { state: "known"; value: T }
  | { state: "unknown"; reason: string }
  | { state: "conflict"; rawValues: T[] };

export interface ResearchCity {
  key: string;
  label: string;
}

export interface ResearchOfficialTarget {
  scheme: "https";
  host: string;
  port: 443;
  pathPrefix: string;
  allowedQueryParameters: string[];
}

export interface ResearchJob {
  id: string;
  organizationSlug: string;
  organizationName: string;
  title: string;
  family: ResearchField<ResearchFamily>;
  cities: ResearchField<ResearchCity[]>;
  weeklyAttendanceDays: ResearchField<number>;
  durationMonths: ResearchField<number>;
  recruitmentBatch: ResearchField<string>;
  earliestStartDate: ResearchField<string>;
  graduationYears: ResearchField<number[]>;
  responsibilitiesExcerpt: string;
  requirementsExcerpt: string;
  sourceType: "企业官网" | "官方 ATS" | "高校就业网";
  sourceUrl: string;
  officialTarget: ResearchOfficialTarget;
  activityState: ResearchField<"active" | "closed">;
  lastVerifiedAt: string;
  reviewedAt: string;
}

export interface ResearchFilters {
  q: string;
  cities: string[];
  companies: string[];
  families: ResearchFamily[];
  availableDaysPerWeek: number | null;
  availableMonths: number | null;
  includeUnknown: ResearchUnknownDimension[];
}

export interface ResearchFacetOption {
  key: string;
  label: string;
  count: number;
}

export interface ResearchSearchResult {
  items: ResearchJob[];
  totalCount: number;
  facets: {
    cities: ResearchFacetOption[];
    companies: ResearchFacetOption[];
    families: ResearchFacetOption[];
    unknownCounts: Record<ResearchUnknownDimension, number>;
  };
}
