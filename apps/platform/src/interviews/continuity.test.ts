import { describe, it, expect } from "vitest";
import { JobRequirementSchema } from "@aijob/contracts";
import { buildContinuousInterviewPlan, continueFromAnswer } from "./continuity.js";
describe("continuous rule interview", () => {
  const requirement = JobRequirementSchema.parse({
    id: "sql",
    kind: "skill",
    operator: "contains",
    expectedValue: "SQL",
    sourceText: "熟悉 SQL",
    evidenceRefs: ["fixture#requirements"],
    necessity: "required",
  });
  it("uses the actual submitted quote, JD and past answer without inventing qualifications", () => {
    const plan = buildContinuousInterviewPlan({
      requirements: [requirement],
      persisted: new Set(["sql"]),
      materialKind: "submitted",
      quotes: ["分析过校园报名数据"],
      previousAnswers: ["尚未独立做过数据库建模"],
    });
    expect(plan[0]?.content).toContain("实际投递的简历");
    expect(plan[0]?.content).toContain("分析过校园报名数据");
    expect(plan.find((seed) => seed.requirementIds.includes("sql"))?.content).toContain("熟悉 SQL");
    expect(plan.at(-1)?.content).toContain("尚未独立做过数据库建模");
  });
  it("keeps unknown and unlinked JD text available without creating persisted requirement references", () => {
    const plan = buildContinuousInterviewPlan({
      requirements: [requirement],
      persisted: new Set(),
      materialKind: "working_resume",
      quotes: [],
      previousAnswers: [],
    });
    expect(plan[0]?.content).toContain("熟悉 SQL");
    expect(plan[0]?.requirementIds).toEqual([]);
  });
  it("asks for missing personal actions or outcomes using current and earlier answers", () => {
    const seed = { content: "谈谈岗位准备", requirementIds: ["sql"] };
    expect(continueFromAnswer(seed, "团队做完了报告", []).content).toContain("自己的职责");
    const next = continueFromAnswer(seed, "我负责清洗原始数据", ["此前样本有重复"]);
    expect(next.content).toContain("实际产物或结果");
    expect(next.content).toContain("此前样本有重复");
    expect(next.requirementIds).toEqual(["sql"]);
  });
});
