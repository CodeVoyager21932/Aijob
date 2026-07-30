import type { FieldValue, JobDetail } from "@aijob/contracts";
import { JobSearchQuerySchema } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  buildCatalogFacets,
  type CatalogSearchRecord,
  classifyCatalogRecord,
  InvalidCatalogCursorError,
  searchCatalogRecords,
} from "./filtering.js";

function known<T>(value: T, field = "field"): FieldValue<T> {
  return { state: "known", value, evidenceRefs: [`revision#${field}`] };
}

function unknown<T>(): FieldValue<T> {
  return { state: "unknown", reason: "source_not_stated" };
}

function job(id: string, overrides: Partial<JobDetail> = {}): CatalogSearchRecord {
  const detail: JobDetail = {
    id,
    publishedJobVersionId: `version-${id}`,
    companyName: "示例科技",
    title: "产品实习生",
    jobFamily: known("product", "jobFamily"),
    locations: known(["深圳"], "locations"),
    weeklyAttendanceDays: known(4, "attendance"),
    durationMonths: known(3, "duration"),
    recruitmentBatch: known("日常实习", "batch"),
    graduationYears: known([2027], "graduation"),
    educationLevels: known(["本科"], "education"),
    majors: unknown(),
    workMode: known("线下", "workMode"),
    salary: unknown(),
    postedAt: known("2026-07-10T00:00:00.000Z", "postedAt"),
    deadlineAt: unknown(),
    source: {
      sourceId: `source-${id}`,
      type: "organization_career_site",
      provenanceLevel: "organization_owned",
      displayName: "示例官方招聘",
      domain: "example.com",
      lastVerifiedAt: "2026-07-18T08:00:00.000Z",
      originalUrl: `https://example.com/jobs/${id}`,
    },
    publicationState: "published",
    activityState: "active",
    displayStatus: "recruiting",
    department: unknown(),
    jobCode: known(id, "jobCode"),
    recruitmentType: known("实习", "recruitmentType"),
    employmentType: known("实习", "employmentType"),
    earliestStartDate: unknown(),
    languages: unknown(),
    responsibilitiesText: known("负责产品需求分析", "responsibilities"),
    requirementsText: known("每周至少到岗四天", "requirements"),
    officialLink: `https://example.com/jobs/${id}/apply`,
    ...overrides,
  };
  return { detail, freshness: "fresh" };
}

describe("catalog hard-filter semantics", () => {
  it("orders explicit matches before information-unknown jobs without calling unknown a match", () => {
    const explicit = job("explicit");
    const informationUnknown = job("unknown", {
      weeklyAttendanceDays: unknown(),
      source: {
        ...job("base").detail.source,
        sourceId: "source-unknown",
        lastVerifiedAt: "2026-07-19T08:00:00.000Z",
      },
    });
    const mismatch = job("mismatch", {
      weeklyAttendanceDays: known(5, "attendance"),
    });
    const query = JobSearchQuerySchema.parse({
      availableWeeklyAttendanceDays: 4,
      limit: 20,
    });

    expect(classifyCatalogRecord(explicit, query)).toBe("explicit_match");
    expect(classifyCatalogRecord(informationUnknown, query)).toBe("information_unknown");
    expect(classifyCatalogRecord(mismatch, query)).toBe("mismatch");

    const result = searchCatalogRecords([informationUnknown, mismatch, explicit], query);
    expect(result.items.map(({ id }) => id)).toEqual(["explicit", "unknown"]);
    expect(result.totalKnown).toBe(1);
    expect(result.totalUnknown).toBe(1);
    expect(result.items.map(({ conditionState }) => conditionState)).toEqual([
      "explicit_match",
      "information_unknown",
    ]);
  });

  it("can hide unknown hard conditions only when explicitly requested", () => {
    const query = JobSearchQuerySchema.parse({
      cities: ["上海"],
      includeUnknownHardConditions: false,
    });
    const result = searchCatalogRecords([job("unknown-city", { locations: unknown() })], query);
    expect(result.items).toEqual([]);
    expect(result.totalKnown).toBe(0);
    expect(result.totalUnknown).toBe(1);
  });

  it("uses a query-bound stable cursor", () => {
    const jobs = [
      job("a"),
      job("b", {
        source: {
          ...job("base").detail.source,
          sourceId: "source-b",
          lastVerifiedAt: "2026-07-17T08:00:00.000Z",
        },
      }),
    ];
    const firstQuery = JobSearchQuerySchema.parse({ limit: 1 });
    const first = searchCatalogRecords(jobs, firstQuery);
    expect(first.items.map(({ id }) => id)).toEqual(["a"]);
    expect(first.nextCursor).not.toBeNull();
    const cursor = first.nextCursor;
    if (!cursor) throw new Error("Expected the first page to have a cursor");

    const second = searchCatalogRecords(
      jobs,
      JobSearchQuerySchema.parse({
        limit: 1,
        cursor,
      }),
    );
    expect(second.items.map(({ id }) => id)).toEqual(["b"]);
    expect(second.nextCursor).toBeNull();

    expect(() =>
      searchCatalogRecords(
        jobs,
        JobSearchQuerySchema.parse({
          companies: ["另一家公司"],
          limit: 1,
          cursor,
        }),
      ),
    ).toThrow(InvalidCatalogCursorError);
  });

  it("keeps the condition state correct when a page crosses into unknown results", () => {
    const records = [job("known-page"), job("unknown-page", { weeklyAttendanceDays: unknown() })];
    const query = JobSearchQuerySchema.parse({
      availableWeeklyAttendanceDays: 4,
      limit: 1,
    });
    const first = searchCatalogRecords(records, query);
    expect(first.items[0]?.conditionState).toBe("explicit_match");
    expect(first.nextCursor).not.toBeNull();
    if (!first.nextCursor) throw new Error("Expected boundary page cursor");
    const second = searchCatalogRecords(
      records,
      JobSearchQuerySchema.parse({
        availableWeeklyAttendanceDays: 4,
        limit: 1,
        cursor: first.nextCursor,
      }),
    );
    expect(second.items[0]?.conditionState).toBe("information_unknown");
  });

  it("keeps unstated salary as information unknown and filters by an explicit source", () => {
    const explicit = job("salary-explicit", {
      salary: known(
        {
          minimum: 180,
          maximum: 220,
          currency: "CNY",
          period: "day",
          rawText: "180-220 元/天",
        },
        "salary",
      ),
    });
    const unknownSalary = job("salary-unknown", { salary: unknown() });
    const belowThreshold = job("salary-low", {
      salary: known(
        {
          minimum: 120,
          maximum: 160,
          currency: "CNY",
          period: "day",
          rawText: "120-160 元/天",
        },
        "salary",
      ),
    });
    const query = JobSearchQuerySchema.parse({
      minimumSalary: 180,
      salaryPeriods: ["day"],
      sources: ["示例官方招聘"],
    });

    expect(classifyCatalogRecord(explicit, query)).toBe("explicit_match");
    expect(classifyCatalogRecord(unknownSalary, query)).toBe("information_unknown");
    expect(classifyCatalogRecord(belowThreshold, query)).toBe("mismatch");
    expect(
      searchCatalogRecords([unknownSalary, belowThreshold, explicit], query).items,
    ).toHaveLength(2);
  });
});

describe("catalog facets", () => {
  it("groups official addresses and municipality suffixes under a canonical city", () => {
    const records = [
      job("beijing-address", { locations: known(["北京市昌平区好未来大楼"]) }),
      job("beijing-city", { locations: known(["北京市"]) }),
    ];
    const result = searchCatalogRecords(
      records,
      JobSearchQuerySchema.parse({ cities: ["北京"], limit: 20 }),
    );
    expect(result.items).toHaveLength(2);
    expect(result.facets.find(({ key }) => key === "city")?.values).toEqual([
      { value: "北京", count: 2 },
    ]);
  });

  it("reports known coverage separately from unknown values", () => {
    const facets = buildCatalogFacets([
      job("known"),
      job("unknown", {
        weeklyAttendanceDays: unknown(),
        locations: unknown(),
      }),
    ]);
    expect(facets.find(({ key }) => key === "weeklyAttendanceDays")).toMatchObject({
      knownCount: 1,
      unknownCount: 1,
      values: [{ value: "4", count: 1 }],
    });
    expect(facets.find(({ key }) => key === "city")).toMatchObject({
      knownCount: 1,
      unknownCount: 1,
      values: [{ value: "深圳", count: 1 }],
    });
    expect(facets.find(({ key }) => key === "source")).toMatchObject({
      knownCount: 2,
      unknownCount: 0,
      values: [{ value: "示例官方招聘", count: 2 }],
    });
  });

  it("does not present unknown freshness as a known facet value", () => {
    const unknownFreshness = job("unknown-freshness");
    unknownFreshness.freshness = "unknown";
    const facet = buildCatalogFacets([unknownFreshness]).find(({ key }) => key === "freshness");
    expect(facet).toMatchObject({
      knownCount: 0,
      unknownCount: 1,
      values: [],
    });
  });
});
