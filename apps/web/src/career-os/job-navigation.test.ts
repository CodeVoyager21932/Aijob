import { describe, expect, it } from "vitest";
import {
  emptyJobFilters,
  jobDetailPath,
  jobFiltersFromSearchParams,
  jobFiltersToSearchParams,
  recommendationRequestFromFilters,
  safeJobReturnPath,
} from "./job-navigation";

describe("Career OS job URL state", () => {
  it("round-trips canonical filters and omits default noise", () => {
    const filters = {
      ...emptyJobFilters,
      keyword: " 产品实习生 ",
      cities: ["深圳", "上海"],
      jobFamilies: ["product"],
      availableWeeklyAttendanceDays: "4",
      includeUnknownHardConditions: false,
      cursor: "next-page",
    };
    const params = jobFiltersToSearchParams(filters, { includeCursor: true });
    expect(params.toString()).toContain("keyword=%E4%BA%A7%E5%93%81%E5%AE%9E%E4%B9%A0%E7%94%9F");
    expect(jobFiltersFromSearchParams(params)).toMatchObject({
      keyword: "产品实习生",
      cities: ["深圳", "上海"],
      jobFamilies: ["product"],
      availableWeeklyAttendanceDays: "4",
      includeUnknownHardConditions: false,
      cursor: "next-page",
    });
    expect(jobFiltersToSearchParams(emptyJobFilters).toString()).toBe("");
  });

  it("converts URL strings into the strict recommendation scope", () => {
    expect(
      recommendationRequestFromFilters({
        ...emptyJobFilters,
        cities: ["深圳"],
        jobFamilies: ["product"],
        graduationYears: ["2027"],
        minimumSalary: "180",
      }),
    ).toEqual({
      scope: {
        cities: ["深圳"],
        jobFamilies: ["product"],
        graduationYears: [2027],
        minimumSalary: 180,
        includeUnknownHardConditions: true,
      },
    });
  });

  it("keeps detail return navigation inside the jobs workspace", () => {
    const path = jobDetailPath("job-one", "/jobs?cities=深圳");
    expect(path).toContain("from=%2Fjobs%3Fcities%3D");
    expect(safeJobReturnPath("/jobs/recommended/run-one?group=evidence")).toBe(
      "/jobs/recommended/run-one?group=evidence",
    );
    expect(safeJobReturnPath("https://attacker.example/jobs")).toBe("/jobs");
    expect(safeJobReturnPath("/applications")).toBe("/jobs");
    expect(safeJobReturnPath("/jobshop?keyword=trap")).toBe("/jobs");
  });
});
