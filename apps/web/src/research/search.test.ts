import { describe, expect, it } from "vitest";
import {
  countAppliedResearchFilters,
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
  it("normalizes values and keeps only valid deduplicated filters", () => {
    const params = new URLSearchParams();
    params.set("q", "  Ｔｅｎｃｅｎｔ   运营  ");
    params.append("city", "shenzhen");
    params.append("city", "shenzhen");
    params.append("city", "x".repeat(81));
    params.append("company", "tencent");
    params.append("family", "operations");
    params.append("family", "engineering");
    params.set("availableDaysPerWeek", "4");
    params.set("availableMonths", "0");
    params.append("recruitmentBatch", "  2027届暑期实习  ");
    params.append("arrivalRequirement", "2026-08-01");
    params.append("graduationYear", "2027");
    params.append("graduationYear", "2027");
    params.append("graduationYear", "2027.5");
    params.append("graduationYear", "2200");
    params.append("sourceType", "官方 ATS");
    params.append("sourceType", "招聘平台");
    params.append("includeUnknown", "attendance");
    params.append("includeUnknown", "graduation");
    params.append("includeUnknown", "salary");

    expect(parseResearchFilters(params)).toEqual({
      q: "Tencent 运营",
      cities: ["shenzhen"],
      companies: ["tencent"],
      families: ["operations"],
      availableDaysPerWeek: 4,
      availableMonths: null,
      recruitmentBatches: ["2027届暑期实习"],
      arrivalRequirements: ["2026-08-01"],
      graduationYears: [2027],
      sourceTypes: ["官方 ATS"],
      includeUnknown: ["attendance", "graduation"],
    });

    expect(
      parseResearchFilters(new URLSearchParams("availableDaysPerWeek=1&availableMonths=8")),
    ).toMatchObject({
      availableDaysPerWeek: null,
      availableMonths: null,
    });
  });

  it("round-trips multi-selects and preserves standalone unknown selections", () => {
    const original = filters({
      cities: ["深圳", "广州", "深圳"],
      companies: ["腾讯"],
      families: ["product", "operations"],
      availableMonths: 6,
      recruitmentBatches: ["暑期", "日常", "暑期"],
      arrivalRequirements: ["2026-08-01"],
      graduationYears: [2027, 2028, 2027],
      sourceTypes: ["企业官网", "官方 ATS", "企业官网"],
      includeUnknown: ["city", "duration", "batch", "city"],
    });

    const serialized = serializeResearchFilters(original);

    expect(serialized.has("q")).toBe(false);
    expect(serialized.has("availableDaysPerWeek")).toBe(false);
    expect(serialized.getAll("city")).toEqual(["深圳", "广州"]);
    expect(serialized.getAll("graduationYear")).toEqual(["2027", "2028"]);
    expect(parseResearchFilters(serialized)).toEqual({
      ...original,
      cities: ["深圳", "广州"],
      recruitmentBatches: ["暑期", "日常"],
      graduationYears: [2027, 2028],
      sourceTypes: ["企业官网", "官方 ATS"],
      includeUnknown: ["city", "duration", "batch"],
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
      recruitmentBatch: { state: "known", value: "2027届暑期实习" },
      earliestStartDate: { state: "known", value: "2026-08-01" },
      graduationYears: { state: "known", value: [2027, 2028] },
      responsibilitiesExcerpt: "规划增长产品",
      requirementsExcerpt: "Tencent 生态经验优先",
      sourceType: "官方 ATS",
      lastVerifiedAt: "2026-07-17T07:00:00.000Z",
    }),
    researchJob({
      id: "unknown-conditions",
      title: "产品运营",
      family: { state: "conflict", rawValues: ["product", "operations"] },
      cities: { state: "unknown", reason: "官方页面未说明" },
      weeklyAttendanceDays: { state: "unknown", reason: "官方页面未说明" },
      durationMonths: { state: "unknown", reason: "官方页面未说明" },
      recruitmentBatch: { state: "conflict", rawValues: ["秋招", "春招"] },
      earliestStartDate: { state: "unknown", reason: "官方页面未说明" },
      graduationYears: { state: "conflict", rawValues: [[2026], [2027]] },
      responsibilitiesExcerpt: "策划增长活动",
      requirementsExcerpt: "具备数据分析意识",
      sourceType: "高校就业网",
      lastVerifiedAt: "2026-07-17T08:00:00.000Z",
    }),
  ] satisfies ResearchJob[];

  it("searches normalized title, company, responsibility, and requirement text", () => {
    expect(
      searchResearchJobs(jobs, filters({ q: "  ＴＥＮＣＥＮＴ " })).items.map((job) => job.id),
    ).toEqual(["product-guangzhou"]);
    expect(searchResearchJobs(jobs, filters({ q: "内容社区" })).items.map((job) => job.id)).toEqual(
      ["ops-shenzhen"],
    );
    expect(searchResearchJobs(jobs, filters({ q: "字节" })).items.map((job) => job.id)).toEqual([
      "product-guangzhou",
    ]);
    expect(searchResearchJobs(jobs, filters({ q: "产品运营" })).items.map((job) => job.id)).toEqual(
      ["unknown-conditions"],
    );
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

  it("filters batch, arrival, graduation year, and source without deriving missing data", () => {
    expect(
      searchResearchJobs(jobs, filters({ recruitmentBatches: ["2027届暑期实习"] })).items.map(
        (job) => job.id,
      ),
    ).toEqual(["product-guangzhou"]);
    expect(
      searchResearchJobs(jobs, filters({ arrivalRequirements: ["2026-08-01"] })).items.map(
        (job) => job.id,
      ),
    ).toEqual(["product-guangzhou"]);
    expect(
      searchResearchJobs(jobs, filters({ graduationYears: [2028] })).items.map((job) => job.id),
    ).toEqual(["product-guangzhou"]);
    expect(
      searchResearchJobs(jobs, filters({ sourceTypes: ["高校就业网"] })).items.map((job) => job.id),
    ).toEqual(["unknown-conditions"]);

    // A conflicting raw value is not promoted into a known filter value.
    expect(searchResearchJobs(jobs, filters({ recruitmentBatches: ["秋招"] })).items).toEqual([]);
    expect(searchResearchJobs(jobs, filters({ graduationYears: [2026] })).items).toEqual([]);
  });

  it("allows unknown and conflict states to be selected on their own", () => {
    const unknownFamily = searchResearchJobs(jobs, filters({ includeUnknown: ["family"] }));
    expect(unknownFamily.items.map((job) => job.id)).toEqual(["unknown-conditions"]);
    expect(unknownFamily.clearlyMatchingItems).toEqual([]);
    expect(unknownFamily.informationUnknownItems.map((job) => job.id)).toEqual([
      "unknown-conditions",
    ]);
    expect(
      searchResearchJobs(jobs, filters({ includeUnknown: ["batch"] })).items.map((job) => job.id),
    ).toEqual(["unknown-conditions", "ops-shenzhen"]);

    const knownOrUncertain = searchResearchJobs(
      jobs,
      filters({
        recruitmentBatches: ["2027届暑期实习"],
        includeUnknown: ["batch"],
      }),
    );
    expect(knownOrUncertain.items.map((job) => job.id)).toEqual([
      "unknown-conditions",
      "product-guangzhou",
      "ops-shenzhen",
    ]);
    expect(knownOrUncertain.clearlyMatchingItems.map((job) => job.id)).toEqual([
      "product-guangzhou",
    ]);
    expect(knownOrUncertain.informationUnknownItems.map((job) => job.id)).toEqual([
      "unknown-conditions",
      "ops-shenzhen",
    ]);
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
    expect(hidden.clearlyMatchingItems.map((job) => job.id)).toEqual(["ops-shenzhen"]);
    expect(hidden.informationUnknownItems).toEqual([]);
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
    expect(shown.clearlyMatchingItems.map((job) => job.id)).toEqual(["ops-shenzhen"]);
    expect(shown.informationUnknownItems.map((job) => job.id)).toEqual(["unknown-conditions"]);
  });

  it("keeps jobs without active uncertainty in the clearly matching group", () => {
    const result = searchResearchJobs(jobs, filters());

    expect(result.clearlyMatchingItems.map((job) => job.id)).toEqual([
      "unknown-conditions",
      "product-guangzhou",
      "ops-shenzhen",
    ]);
    expect(result.informationUnknownItems).toEqual([]);
  });

  it("provides disjunctive facets for the added dimensions", () => {
    const result = searchResearchJobs(jobs, filters());

    expect(result.facets.recruitmentBatches).toEqual([
      { key: "2027届暑期实习", label: "2027届暑期实习", count: 1 },
    ]);
    expect(result.facets.arrivalRequirements).toEqual([
      { key: "2026-08-01", label: "2026-08-01", count: 1 },
    ]);
    expect(result.facets.graduationYears).toEqual([
      { key: "2027", label: "2027 届", count: 1 },
      { key: "2028", label: "2028 届", count: 1 },
    ]);
    expect(result.facets.sourceTypes).toEqual([
      { key: "高校就业网", label: "高校就业网", count: 1 },
      { key: "官方 ATS", label: "官方 ATS", count: 1 },
      { key: "企业官网", label: "企业官网", count: 1 },
    ]);
    expect(result.facets.unknownCounts).toMatchObject({
      batch: 2,
      arrival: 2,
      graduation: 2,
    });
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

describe("applied research filter count", () => {
  it("counts active dimensions instead of selected options", () => {
    expect(
      countAppliedResearchFilters(
        filters({
          q: "产品",
          cities: ["shenzhen", "guangzhou"],
          families: ["product", "operations"],
          recruitmentBatches: ["暑期", "日常"],
          sourceTypes: ["企业官网", "官方 ATS"],
          includeUnknown: ["city", "family", "batch", "graduation"],
        }),
      ),
    ).toBe(6);
  });
});
