import { describe, expect, it } from "vitest";
import { JobFamilySchema } from "./enums.js";
import { JobSearchQuerySchema } from "./jobs.js";
import { JobPreferenceSchema } from "./profile.js";

const allJobFamilies = [
  "product",
  "operations",
  "engineering",
  "data_ai",
  "design",
  "marketing",
  "sales_business",
  "finance",
  "people_admin_legal",
  "research_consulting",
  "supply_chain_manufacturing",
  "other",
] as const;

describe("all-function job-family contract", () => {
  it("accepts the twelve stable values", () => {
    expect(JobFamilySchema.options).toEqual(allJobFamilies);
    expect(JobSearchQuerySchema.parse({ jobFamilies: allJobFamilies }).jobFamilies).toEqual(
      allJobFamilies,
    );
    expect(
      JobPreferenceSchema.parse({
        cities: [],
        jobFamilies: allJobFamilies,
        companyNames: [],
        workModes: [],
      }).jobFamilies,
    ).toEqual(allJobFamilies);
  });

  it("rejects unversioned aliases instead of guessing", () => {
    expect(JobFamilySchema.safeParse("technology").success).toBe(false);
  });
});
