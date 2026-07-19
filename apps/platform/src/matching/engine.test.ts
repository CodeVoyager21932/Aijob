import type { JobPreference, JobRequirement, ProfileFact, ResumeEvidence } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { evaluateThreeAxisMatch, type MatchableJob } from "./engine.js";

const evidenceRef = "job-source#requirements";

const baseJob: MatchableJob = {
  companyName: "示例公司",
  jobFamily: { state: "known", value: "product", evidenceRefs: ["job#family"] },
  locations: { state: "known", value: ["深圳"], evidenceRefs: ["job#locations"] },
  weeklyAttendanceDays: { state: "known", value: 4, evidenceRefs: ["job#attendance"] },
  durationMonths: { state: "known", value: 3, evidenceRefs: ["job#duration"] },
  workMode: { state: "unknown", reason: "source_not_stated" },
};

const basePreferences: JobPreference = {
  cities: ["深圳"],
  jobFamilies: ["product"],
  companyNames: [],
  workModes: [],
};

function requirement(
  input: Partial<JobRequirement> & Pick<JobRequirement, "id" | "kind" | "expectedValue">,
): JobRequirement {
  return {
    operator: "equals",
    sourceText: "岗位原文",
    evidenceRefs: [evidenceRef],
    required: true,
    ...input,
  };
}

function run(input: {
  requirements: JobRequirement[];
  facts?: ProfileFact[];
  evidence?: ResumeEvidence[];
  preferences?: JobPreference;
}) {
  return evaluateThreeAxisMatch({
    requirements: input.requirements,
    confirmedFacts: input.facts ?? [],
    preferences: input.preferences ?? basePreferences,
    confirmedEvidence: input.evidence ?? [],
    job: baseJob,
  });
}

describe("three-axis matching", () => {
  it("never calls a missing hard fact a match", () => {
    const result = run({
      requirements: [
        requirement({
          id: "graduation-2027",
          kind: "graduation_year",
          operator: "one_of",
          expectedValue: [2027],
        }),
      ],
    });

    expect(result.eligibility.status).toBe("needs_information");
    expect(result.unknownRequirementIds).toEqual(["graduation-2027"]);
  });

  it("reports an explicit hard conflict without hiding the job", () => {
    const result = run({
      requirements: [
        requirement({
          id: "attendance-5",
          kind: "weekly_attendance",
          operator: "at_least",
          expectedValue: 5,
        }),
      ],
      facts: [{ key: "weekly_attendance_days", value: 4 }],
    });

    expect(result.eligibility.status).toBe("explicit_conflict");
    expect(result.eligibility.reasons[0]?.code).toBe("CONFIRMED_FACT_CONFLICT");
  });

  it("uses only confirmed evidence supplied by the caller", () => {
    const result = run({
      requirements: [
        requirement({
          id: "skill-research",
          kind: "skill",
          operator: "contains",
          expectedValue: ["用户研究"],
        }),
      ],
      evidence: [],
    });

    expect(result.evidence.status).toBe("not_in_resume");
    expect(result.evidence.reasons[0]?.evidenceIds).toEqual([]);
  });

  it("keeps evidence and eligibility separate", () => {
    const result = run({
      requirements: [
        requirement({
          id: "graduation-2027",
          kind: "graduation_year",
          operator: "one_of",
          expectedValue: [2027],
        }),
        requirement({
          id: "skill-sql",
          kind: "skill",
          operator: "contains",
          expectedValue: ["SQL"],
        }),
      ],
      facts: [{ key: "graduation_year", value: 2027 }],
      evidence: [
        {
          id: "evidence-1",
          resumeAnalysisId: null,
          section: "项目经历",
          originalText: "使用 SQL 分析转化漏斗",
          claim: "分析转化漏斗",
          skills: ["SQL"],
          outcomes: [],
          confirmed: true,
        },
      ],
    });

    expect(result.eligibility.status).toBe("no_explicit_conflict");
    expect(result.evidence.status).toBe("explicit_evidence");
    expect(result.preference.status).toBe("fits");
  });

  it.each([
    ["SQL", "使用 NoSQL 数据库"],
    ["Java", "使用 JavaScript 开发页面"],
  ])("does not match an ASCII skill inside another token: %s", (skill, originalText) => {
    const result = run({
      requirements: [
        requirement({
          id: `skill-${skill}`,
          kind: "skill",
          operator: "contains",
          expectedValue: [skill],
        }),
      ],
      evidence: [
        {
          id: "evidence-token-boundary",
          resumeAnalysisId: null,
          section: "项目经历",
          originalText,
          claim: originalText,
          skills: [],
          outcomes: [],
          confirmed: true,
        },
      ],
    });
    expect(result.evidence.status).toBe("not_in_resume");
  });

  it("does not label an unknown job preference field as fitting", () => {
    const result = run({
      requirements: [],
      preferences: {
        ...basePreferences,
        cities: [],
        jobFamilies: [],
        workModes: ["remote"],
      },
    });

    expect(result.preference.status).toBe("not_set");
  });
});
