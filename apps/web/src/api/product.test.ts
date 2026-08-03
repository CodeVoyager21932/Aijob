import type { JobSearchResponse } from "@aijob/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  collectRecommendationCandidateJobs,
  type JobFilters,
  jobSearchPath,
  recommendationCandidateVersionIds,
} from "./product";

function filters(): JobFilters {
  return {
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
}

describe("formal job search API query", () => {
  it("keeps unknown hard conditions by default and encodes selected filters", () => {
    const path = jobSearchPath({
      ...filters(),
      keyword: "用户运营",
      cities: ["深圳", "广州"],
      jobFamilies: ["operations"],
      availableWeeklyAttendanceDays: "4",
      graduationYears: ["2027"],
      minimumSalary: "180",
      salaryPeriods: ["day"],
      sources: ["腾讯官方招聘"],
    });
    const url = new URL(path, "http://aijob.local");
    expect(url.pathname).toBe("/v1/jobs");
    expect(url.searchParams.get("keyword")).toBe("用户运营");
    expect(url.searchParams.get("cities")).toBe("深圳,广州");
    expect(url.searchParams.get("jobFamilies")).toBe("operations");
    expect(url.searchParams.get("availableWeeklyAttendanceDays")).toBe("4");
    expect(url.searchParams.get("graduationYears")).toBe("2027");
    expect(url.searchParams.get("minimumSalary")).toBe("180");
    expect(url.searchParams.get("salaryPeriods")).toBe("day");
    expect(url.searchParams.get("sources")).toBe("腾讯官方招聘");
    expect(url.searchParams.get("includeUnknownHardConditions")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it("does not manufacture empty query dimensions", () => {
    const url = new URL(jobSearchPath(filters()), "http://aijob.local");
    expect(url.searchParams.has("cities")).toBe(false);
    expect(url.searchParams.has("educationLevels")).toBe(false);
    expect(url.searchParams.has("freshness")).toBe(false);
  });

  it("passes the catalog cursor only when loading a later page", () => {
    const firstPage = new URL(jobSearchPath(filters()), "http://aijob.local");
    const laterPage = new URL(
      jobSearchPath({ ...filters(), cursor: "catalog-page-two" }),
      "http://aijob.local",
    );

    expect(firstPage.searchParams.has("cursor")).toBe(false);
    expect(laterPage.searchParams.get("cursor")).toBe("catalog-page-two");
    expect(laterPage.searchParams.get("limit")).toBe("100");
  });
});

function recommendationJob(index: number): JobSearchResponse["items"][number] {
  return {
    id: `job-${index}`,
    publishedJobVersionId: `version-${index}`,
  } as JobSearchResponse["items"][number];
}

function recommendationPage(
  items: JobSearchResponse["items"],
  nextCursor: string | null,
): JobSearchResponse {
  return {
    items,
    nextCursor,
    facets: [],
    totalKnown: items.length,
    totalUnknown: 0,
  };
}

describe("recommendation catalog pagination", () => {
  it("collects all 1000 candidates instead of stopping at the first 100", async () => {
    const loadPage = vi.fn(async (cursor: string | undefined) => {
      const pageIndex = cursor ? Number(cursor.replace("page-", "")) : 0;
      const start = pageIndex * 100;
      return recommendationPage(
        Array.from({ length: 100 }, (_, index) => recommendationJob(start + index)),
        pageIndex === 9 ? null : `page-${pageIndex + 1}`,
      );
    });

    const jobs = await collectRecommendationCandidateJobs(loadPage);

    expect(jobs).toHaveLength(1_000);
    expect(loadPage).toHaveBeenCalledTimes(10);
    expect(recommendationCandidateVersionIds(jobs)).toHaveLength(1_000);
  });

  it("fails explicitly when the catalog exceeds the 1100-job buffer", async () => {
    await expect(
      collectRecommendationCandidateJobs(async (cursor) => {
        const pageIndex = cursor ? Number(cursor.replace("page-", "")) : 0;
        const start = pageIndex * 100;
        return recommendationPage(
          Array.from({ length: 100 }, (_, index) => recommendationJob(start + index)),
          `page-${pageIndex + 1}`,
        );
      }),
    ).rejects.toThrow("超过 1100 条推荐容量");
  });

  it("rejects repeated cursors, missing versions and duplicate versions", async () => {
    let pageIndex = 0;
    await expect(
      collectRecommendationCandidateJobs(async () => {
        pageIndex += 1;
        return recommendationPage([recommendationJob(pageIndex)], "same-cursor");
      }),
    ).rejects.toThrow("分页游标没有前进");

    expect(() =>
      recommendationCandidateVersionIds([
        { ...recommendationJob(1), publishedJobVersionId: null },
      ]),
    ).toThrow("未物化版本");
    expect(() =>
      recommendationCandidateVersionIds([
        recommendationJob(1),
        { ...recommendationJob(2), publishedJobVersionId: "version-1" },
      ]),
    ).toThrow("重复岗位版本");
  });
});
