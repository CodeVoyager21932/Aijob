import { describe, expect, it } from "vitest";
import {
  emptyResearchFilters,
  parseResearchFilters,
  searchResearchJobs,
  serializeResearchFilters,
} from "./search";
import type { ResearchFilters, ResearchJob } from "./types";

function researchJob(overrides: Partial<ResearchJob> = {}): ResearchJob {
  return {
    id: "job-default",
    organizationSlug: "tencent",
    organizationName: "腾讯",
    title: "用户运营实习生",
    family: { state: "known", value: "operations" },
    cities: { state: "known", value: [{ key: "shenzhen", label: "深圳" }] },
    weeklyAttendanceDays: { state: "known", value: 4 },
    durationMonths: { state: "known", value: 3 },
    recruitmentBatch: { state: "unknown", reason: "官方页面未说明" },
    earliestStartDate: { state: "unknown", reason: "官方页面未说明" },
    graduationYears: { state: "unknown", reason: "官方页面未说明" },
    responsibilitiesExcerpt: "维护内容社区",
    requirementsExcerpt: "沟通能力良好",
    sourceType: "企业官网",
    sourceUrl: "https://example.com/jobs/default",
    officialTarget: {
      scheme: "https",
      host: "example.com",
      port: 443,
      pathPrefix: "/jobs/",
      allowedQueryParameters: [],
    },
    activityState: { state: "known", value: "active" },
    lastVerifiedAt: "2026-07-17T05:00:00.000Z",
    reviewedAt: "2026-07-17T05:00:00.000Z",
    ...overrides,
  };
}

function filters(overrides: Partial<ResearchFilters> = {}): ResearchFilters {
  return { ...emptyResearchFilters, ...overrides };
}

describe("research filter URL state", () => {
  it("normalizes the keyword and keeps only valid deduplicated repeated filters", () => {
    const params = new URLSearchParams();
    params.set("q", "  Ｔｅｎｃｅｎｔ   运营  ");
    params.append("city", "shenzhen");
    params.append("city", "shenzhen");
    params.append("company", "tencent");
    params.append("family", "operations");
    params.append("family", "engineering");
    params.set("availableDaysPerWeek", "4");
    params.set("availableMonths", "0");
    params.append("includeUnknown", "attendance");
    params.append("includeUnknown", "salary");

    expect(parseResearchFilters(params)).toEqual({
      q: "Tencent 运营",
      cities: ["shenzhen"],
      companies: ["tencent"],
      families: ["operations"],
      availableDaysPerWeek: 4,
      availableMonths: null,
      includeUnknown: ["attendance"],
    });

    expect(
      parseResearchFilters(new URLSearchParams("availableDaysPerWeek=1&availableMonths=8")),
    ).toMatchObject({
      availableDaysPerWeek: null,
      availableMonths: null,
    });
  });

  it("round-trips Chinese multi-select values without writing empty defaults", () => {
    const original = filters({
      cities: ["深圳", "广州", "深圳"],
      companies: ["腾讯"],
      families: ["product", "operations"],
      availableMonths: 6,
      includeUnknown: ["city", "duration", "city"],
    });

    const serialized = serializeResearchFilters(original);

    expect(serialized.has("q")).toBe(false);
    expect(serialized.has("availableDaysPerWeek")).toBe(false);
    expect(serialized.getAll("city")).toEqual(["深圳", "广州"]);
    expect(parseResearchFilters(serialized)).toEqual({
      ...original,
      cities: ["深圳", "广州"],
      includeUnknown: ["city", "duration"],
    });
  });
});

describe("research job filtering", () => {
  const jobs = [
    researchJob({ id: "ops-shenzhen", lastVerifiedAt: "2026-07-17T06:00:00.000Z" }),
    researchJob({
      id: "product-guangzhou",
      organizationSlug: "bytedance",
      organizationName: "字节跳动",
      title: "产品经理实习生",
      family: { state: "known", value: "product" },
      cities: { state: "known", value: [{ key: "guangzhou", label: "广州" }] },
      weeklyAttendanceDays: { state: "known", value: 5 },
      durationMonths: { state: "known", value: 6 },
      requirementsExcerpt: "Tencent 生态经验优先",
      lastVerifiedAt: "2026-07-17T07:00:00.000Z",
    }),
    researchJob({
      id: "unknown-conditions",
      title: "产品运营",
      family: { state: "conflict", rawValues: ["product", "operations"] },
      cities: { state: "unknown", reason: "官方页面未说明" },
      weeklyAttendanceDays: { state: "unknown", reason: "官方页面未说明" },
      durationMonths: { state: "unknown", reason: "官方页面未说明" },
      lastVerifiedAt: "2026-07-17T08:00:00.000Z",
    }),
  ] satisfies ResearchJob[];

  it("searches only normalized title and company text", () => {
    expect(searchResearchJobs(jobs, filters({ q: "  ＴＥＮＣＥＮＴ " })).items).toEqual([]);
    expect(searchResearchJobs(jobs, filters({ q: "腾讯" })).items.map((job) => job.id)).toEqual([
      "unknown-conditions",
      "ops-shenzhen",
    ]);
  });

  it("uses OR within a dimension and AND across dimensions", () => {
    const result = searchResearchJobs(
      jobs,
      filters({
        cities: ["shenzhen", "guangzhou"],
        companies: ["tencent"],
        families: ["operations"],
      }),
    );

    expect(result.items.map((job) => job.id)).toEqual(["ops-shenzhen"]);
  });

  it("treats availability as an upper bound on job requirements", () => {
    expect(
      searchResearchJobs(jobs, filters({ availableDaysPerWeek: 4, availableMonths: 3 })).items.map(
        (job) => job.id,
      ),
    ).toEqual(["ops-shenzhen"]);
  });

  it("never infers unknown or conflict values and includes them only when explicitly requested", () => {
    const constrained = filters({
      cities: ["shenzhen"],
      families: ["operations"],
      availableDaysPerWeek: 4,
      availableMonths: 3,
    });

    const hidden = searchResearchJobs(jobs, constrained);
    expect(hidden.items.map((job) => job.id)).toEqual(["ops-shenzhen"]);
    expect(
      searchResearchJobs(jobs, filters({ cities: ["shenzhen"] })).facets.unknownCounts.city,
    ).toBe(1);
    expect(
      searchResearchJobs(jobs, filters({ families: ["operations"] })).facets.unknownCounts.family,
    ).toBe(1);
    expect(
      searchResearchJobs(jobs, filters({ availableDaysPerWeek: 4 })).facets.unknownCounts
        .attendance,
    ).toBe(1);
    expect(
      searchResearchJobs(jobs, filters({ availableMonths: 3 })).facets.unknownCounts.duration,
    ).toBe(1);

    const shown = searchResearchJobs(jobs, {
      ...constrained,
      includeUnknown: ["city", "family", "attendance", "duration"],
    });
    expect(shown.items.map((job) => job.id)).toEqual(["unknown-conditions", "ops-shenzhen"]);
  });

  it("keeps disjunctive facet counts within the other active filters", () => {
    const result = searchResearchJobs(
      jobs,
      filters({ companies: ["tencent"], families: ["product"] }),
    );

    expect(result.totalCount).toBe(0);
    expect(result.facets.families).toEqual([{ key: "operations", label: "运营", count: 1 }]);
    expect(result.facets.companies).toEqual([{ key: "bytedance", label: "字节跳动", count: 1 }]);
  });
});
