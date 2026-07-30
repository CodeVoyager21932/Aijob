import { describe, expect, it } from "vitest";
import { type JobFilters, jobSearchPath } from "./product";

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
