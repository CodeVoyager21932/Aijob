import { describe, expect, it } from "vitest";
import { parseJobSearchQuery } from "./routes.js";

describe("catalog query parsing", () => {
  it("accepts repeated and comma-separated list values", () => {
    expect(
      parseJobSearchQuery({
        cities: ["深圳,上海", "北京"],
        graduationYears: "2027,2028",
        includeUnknownHardConditions: "false",
        availableWeeklyAttendanceDays: "4",
        minimumSalary: "180",
        salaryPeriods: "day,month",
        sources: "腾讯校招,南开大学就业网",
        limit: "10",
      }),
    ).toMatchObject({
      cities: ["深圳", "上海", "北京"],
      graduationYears: [2027, 2028],
      includeUnknownHardConditions: false,
      availableWeeklyAttendanceDays: 4,
      minimumSalary: 180,
      salaryPeriods: ["day", "month"],
      sources: ["腾讯校招", "南开大学就业网"],
      limit: 10,
    });
  });

  it("rejects invalid numeric and boolean values", () => {
    expect(() => parseJobSearchQuery({ availableDurationMonths: "many" })).toThrow();
    expect(() => parseJobSearchQuery({ includeUnknownHardConditions: "yes" })).toThrow();
  });
});
