import { randomUUID } from "node:crypto";
import type { JobRequirement, ResumeEvidence } from "@aijob/contracts";
import { JobRequirementSchema } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { buildJobInsightResult, type InsightJobRecord } from "./service.js";

function requirement(
  id: string,
  input: Pick<JobRequirement, "kind" | "operator" | "expectedValue" | "sourceText" | "necessity">,
): JobRequirement {
  return JobRequirementSchema.parse({
    id,
    ...input,
    evidenceRefs: [`evidence:${id}`],
    sourceSpan: null,
  });
}

function records(count = 20): InsightJobRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    jobId: `job-${index}`,
    jobVersionId: `version-${index}`,
    requirementSetId: `set-${index}`,
    sourceId: `source-${index % 5}`,
    companyId: `company-${index % 5}`,
    companyName: `公司${index % 5}`,
    companyScaleBand: index % 2 === 0 ? "medium" : "small",
    title: `产品岗位 ${index}`,
    jobFamily: "product",
    locations: ["上海"],
    lastVerifiedAt: "2026-07-21T00:00:00.000Z",
    requirements: [
      requirement(`education-${index}`, {
        kind: "education",
        operator: "one_of",
        expectedValue: ["本科", "硕士", "博士"],
        sourceText: "本科及以上学历",
        necessity: "required",
      }),
      requirement(`sql-${index}`, {
        kind: "skill",
        operator: "contains",
        expectedValue: ["SQL"],
        sourceText: "熟悉 SQL，能够完成数据分析",
        necessity: "required",
      }),
      requirement(`research-${index}`, {
        kind: "experience",
        operator: "contains",
        expectedValue: ["竞品分析"],
        sourceText: "具备市场研究或竞品分析经验优先",
        necessity: "preferred",
      }),
    ],
  }));
}

describe("deterministic job market insight", () => {
  it("separates hard requirements, capabilities and preferred items", () => {
    const result = buildJobInsightResult(records(), null);

    expect(result.dataSufficient).toBe(true);
    expect(result.sample).toMatchObject({
      jobCount: 20,
      companyCount: 5,
      knownScaleCompanyCount: 5,
      structuredRequirementJobCount: 20,
      requirementCoverage: 1,
    });
    expect(result.commonHardRequirements).toEqual([
      expect.objectContaining({ label: "本科及以上学历", jobCount: 20, companyCount: 5 }),
    ]);
    expect(result.frequentCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "tool:sql", jobCount: 20, companyCount: 5 }),
        expect.objectContaining({ key: "capability:data_analysis" }),
      ]),
    );
    expect(result.preferredRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "capability:market_research",
          primaryNecessity: "preferred",
        }),
      ]),
    );
  });

  it("does not publish rankings below the sample thresholds", () => {
    const result = buildJobInsightResult(records(19), null);
    expect(result.dataSufficient).toBe(false);
    expect(result.insufficiencyReasons).toContain("too_few_jobs");
    expect(result.commonHardRequirements).toEqual([]);
    expect(result.frequentCapabilities).toEqual([]);
    expect(result.preferredRequirements).toEqual([]);
  });

  it("counts jobs without atomic requirements in coverage and excludes unknown necessity", () => {
    const sample = records().map((record, index) => ({
      ...record,
      requirementSetId: index < 7 ? null : record.requirementSetId,
      requirements:
        index < 7
          ? []
          : [
              ...record.requirements,
              requirement(`unknown-${index}`, {
                kind: "skill",
                operator: "contains",
                expectedValue: ["未核验能力"],
                sourceText: "该项是否必须尚未核验",
                necessity: "unknown",
              }),
            ],
    }));
    const result = buildJobInsightResult(sample, null);
    expect(result.sample).toMatchObject({
      jobCount: 20,
      structuredRequirementJobCount: 13,
      requirementCoverage: 0.65,
    });
    expect(result.insufficiencyReasons).toContain("low_requirement_coverage");
    expect(result.commonHardRequirements).toEqual([]);
    expect(result.frequentCapabilities).toEqual([]);
    expect(result.preferredRequirements).toEqual([]);
  });

  it("compares only confirmed resume evidence and keeps profile facts as needs confirmation", () => {
    const sourceBlockId = randomUUID();
    const evidence: ResumeEvidence[] = [
      {
        id: "resume-evidence-sql",
        resumeAnalysisId: null,
        sourceBlockId,
        section: "项目经历",
        evidenceType: "project",
        statement: "使用 SQL 分析用户反馈并完成数据看板",
        skills: ["SQL"],
        outcomes: [],
        confirmed: true,
      },
    ];
    const result = buildJobInsightResult(records(), evidence);
    expect(result.frequentCapabilities.find(({ key }) => key === "tool:sql")).toMatchObject({
      personalStatus: "confirmed_evidence",
      evidenceIds: ["resume-evidence-sql"],
      sourceBlockIds: [sourceBlockId],
    });
    expect(
      result.preferredRequirements.find(({ key }) => key === "capability:market_research"),
    ).toMatchObject({ personalStatus: "not_in_resume" });
    expect(result.commonHardRequirements[0]).toMatchObject({
      personalStatus: "needs_confirmation",
    });
  });
});
