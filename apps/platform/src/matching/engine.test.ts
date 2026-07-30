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
    necessity: "required",
    sourceSpan: null,
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

  it("does not turn an unknown preferred condition into a hard eligibility gap", () => {
    const result = run({
      requirements: [
        requirement({
          id: "preferred-experience",
          kind: "experience",
          operator: "unknown",
          expectedValue: [],
          necessity: "preferred",
        }),
      ],
    });

    expect(result.eligibility.status).toBe("no_explicit_conflict");
    expect(result.unknownRequirementIds).toEqual([]);
    expect(result.gaps.filter(({ axis }) => axis === "eligibility")).toEqual([]);
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
          sourceBlockId: "00000000-0000-4000-8000-000000000001",
          section: "项目经历",
          evidenceType: "project",
          statement: "使用 SQL 分析转化漏斗",
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
          sourceBlockId: "00000000-0000-4000-8000-000000000002",
          section: "项目经历",
          evidenceType: "project",
          statement: originalText,
          skills: [],
          outcomes: [],
          confirmed: true,
        },
      ],
    });
    expect(result.evidence.status).toBe("not_in_resume");
  });

  it("uses deterministic capability equivalence for behavior evidence", () => {
    const result = run({
      requirements: [
        requirement({
          id: "experience-user-research",
          kind: "experience",
          operator: "unknown",
          expectedValue: [],
          sourceText: "能够独立开展用户调研并分析用户反馈",
        }),
      ],
      evidence: [
        {
          id: "evidence-user-interviews",
          resumeAnalysisId: null,
          sourceBlockId: "00000000-0000-4000-8000-000000000003",
          section: "项目经历",
          evidenceType: "project",
          statement: "完成 8 次用户访谈，整理核心痛点并推动产品迭代。",
          skills: [],
          outcomes: ["完成 8 次用户访谈"],
          confirmed: true,
        },
      ],
    });

    expect(result.evidence.status).toBe("explicit_evidence");
    expect(result.evidence.reasons[0]).toMatchObject({
      code: "RESUME_SEMANTIC_EVIDENCE_FOUND",
      evidenceIds: ["evidence-user-interviews"],
    });
    expect(result.evidence.reasons[0]?.explanation).toContain("用户研究");
  });

  it("does not treat a related capability as proof of a named tool", () => {
    const result = run({
      requirements: [
        requirement({
          id: "skill-sql-explicit",
          kind: "skill",
          operator: "contains",
          expectedValue: ["SQL"],
          sourceText: "熟练使用 SQL",
        }),
      ],
      evidence: [
        {
          id: "evidence-excel-analysis",
          resumeAnalysisId: null,
          sourceBlockId: "00000000-0000-4000-8000-000000000004",
          section: "项目经历",
          evidenceType: "project",
          statement: "使用 Excel 完成数据分析和周报看板。",
          skills: ["Excel"],
          outcomes: [],
          confirmed: true,
        },
      ],
    });

    expect(result.evidence.status).toBe("not_in_resume");
    expect(result.coverage.evidence).toMatchObject({ supported: 0, partial: 0, missing: 1 });
  });

  it("keeps subjective requirements unknown when no capability rule applies", () => {
    const result = run({
      requirements: [
        requirement({
          id: "other-responsibility",
          kind: "other",
          operator: "unknown",
          expectedValue: [],
          sourceText: "有责任心和热情",
        }),
      ],
      evidence: [
        {
          id: "evidence-generic",
          resumeAnalysisId: null,
          sourceBlockId: "00000000-0000-4000-8000-000000000005",
          section: "项目经历",
          evidenceType: "project",
          statement: "按期完成项目。",
          skills: [],
          outcomes: [],
          confirmed: true,
        },
      ],
    });

    expect(result.evidence.status).toBe("insufficient_information");
    expect(result.coverage.evidence.unknown).toBe(1);
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

  it("treats a legacy 都可以 city value as no city preference", () => {
    const result = run({
      requirements: [],
      preferences: {
        cities: ["都可以"],
        jobFamilies: [],
        companyNames: [],
        workModes: [],
      },
    });

    expect(result.preference.status).toBe("not_set");
    expect(result.coverage.preference.configured).toBe(0);
  });
});
