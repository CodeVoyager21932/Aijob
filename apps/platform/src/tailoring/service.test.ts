import { describe, expect, it } from "vitest";
import {
  createTemplateTailoringSegments,
  renderStructuredTailoringSelections,
  validateTailoringSegments,
} from "./service.js";

const evidence = [{ id: "evidence-1", originalText: "负责 3 次用户访谈并整理结论" }];
const requirementIds = new Set(["requirement-1"]);

describe("resume tailoring evidence guard", () => {
  it("accepts a traceable wording change without new numbers", () => {
    const segments = validateTailoringSegments({
      requirementIds,
      evidence,
      segments: [
        {
          originalText: evidence[0]?.originalText ?? "",
          suggestedText: "完成 3 次用户访谈，归纳并输出关键结论",
          reason: "突出用户研究动作",
          requirementIds: ["requirement-1"],
          evidenceIds: ["evidence-1"],
        },
      ],
    });

    expect(segments).toHaveLength(1);
  });

  it("rejects a hallucinated number", () => {
    expect(() =>
      validateTailoringSegments({
        requirementIds,
        evidence,
        segments: [
          {
            originalText: evidence[0]?.originalText ?? "",
            suggestedText: "完成 30 次用户访谈，显著提升转化",
            reason: "量化成果",
            requirementIds: ["requirement-1"],
            evidenceIds: ["evidence-1"],
          },
        ],
      }),
    ).toThrow("模型建议加入了简历证据中不存在的数字");
  });

  it.each([
    ["负责 3 次用户访谈并整理结论", "负责5人团队并整理结论"],
    ["推动用户访谈并整理结论", "推动用户访谈并提升20%留存"],
  ])("rejects a new number even when it touches Chinese text", (originalText, suggestedText) => {
    expect(() =>
      validateTailoringSegments({
        requirementIds,
        evidence: [{ id: "evidence-1", originalText }],
        segments: [
          {
            originalText,
            suggestedText,
            reason: "测试紧邻数字",
            requirementIds: ["requirement-1"],
            evidenceIds: ["evidence-1"],
          },
        ],
      }),
    ).toThrow("模型建议加入了简历证据中不存在的数字");
  });

  it("rejects changing a confirmed number into another unit", () => {
    expect(() =>
      validateTailoringSegments({
        requirementIds,
        evidence: [{ id: "evidence-1", originalText: "访谈 20 人" }],
        segments: [
          {
            originalText: "访谈 20 人",
            suggestedText: "提升 20%",
            reason: "单位替换",
            requirementIds: ["requirement-1"],
            evidenceIds: ["evidence-1"],
          },
        ],
      }),
    ).toThrow("模型建议加入了简历证据中不存在的数字");
  });

  it("rejects unknown requirement and evidence references", () => {
    expect(() =>
      validateTailoringSegments({
        requirementIds,
        evidence,
        segments: [
          {
            originalText: evidence[0]?.originalText ?? "",
            suggestedText: evidence[0]?.originalText ?? "",
            reason: "测试",
            requirementIds: ["invented-requirement"],
            evidenceIds: ["evidence-1"],
          },
        ],
      }),
    ).toThrow("模型建议引用了不存在的岗位要求");
  });

  it.each([
    ["使用 Python 建模并输出结论", "新技能"],
    ["主导星河项目并输出结论", "新项目"],
    ["整理用户访谈结论并显著提升留存率", "新结果"],
  ])("rejects an unsupported %s claim (%s)", (suggestedText) => {
    expect(() =>
      validateTailoringSegments({
        requirementIds,
        evidence,
        segments: [
          {
            originalText: evidence[0]?.originalText ?? "",
            suggestedText,
            reason: "测试事实守卫",
            requirementIds: ["requirement-1"],
            evidenceIds: ["evidence-1"],
          },
        ],
      }),
    ).toThrow("模型建议加入了简历证据中不存在的技能、主体、项目或结果");
  });

  it("accepts a protected skill when the confirmed evidence explicitly contains it", () => {
    expect(
      validateTailoringSegments({
        requirementIds,
        evidence: [
          {
            id: "evidence-1",
            originalText: "负责 3 次用户访谈并整理结论",
            skills: ["Python"],
          },
        ],
        segments: [
          {
            originalText: evidence[0]?.originalText ?? "",
            suggestedText: "使用 Python 整理 3 次用户访谈结论",
            reason: "突出已确认技能",
            requirementIds: ["requirement-1"],
            evidenceIds: ["evidence-1"],
          },
        ],
      }),
    ).toHaveLength(1);
  });
});

describe("deterministic tailoring fallback", () => {
  it("never cites a city condition as the basis for rewriting experience", () => {
    const [segment] = createTemplateTailoringSegments({
      requirements: [
        {
          id: "requirement-city",
          kind: "city",
          operator: "one_of",
          expectedValue: ["深圳"],
          sourceText: "工作地点：深圳",
          evidenceRefs: ["source:city"],
          required: false,
        },
        {
          id: "requirement-skill",
          kind: "skill",
          operator: "contains",
          expectedValue: ["用户访谈", "沟通"],
          sourceText: "具备用户访谈和沟通能力",
          evidenceRefs: ["source:requirements:1"],
          required: true,
        },
      ],
      evidence: [
        {
          id: "evidence-1",
          resumeAnalysisId: "analysis-1",
          section: "项目经历",
          originalText: "负责 3 次用户访谈并整理结论",
          claim: "完成用户访谈",
          skills: ["用户访谈"],
          outcomes: [],
          confirmed: true,
        },
      ],
    });

    expect(segment?.requirementIds).toEqual(["requirement-skill"]);
    expect(segment?.reason).toContain("直接词项重合");
  });

  it("refuses to fabricate an expressive link when the job only has structural conditions", () => {
    expect(() =>
      createTemplateTailoringSegments({
        requirements: [
          {
            id: "requirement-city",
            kind: "city",
            operator: "one_of",
            expectedValue: ["深圳"],
            sourceText: "工作地点：深圳",
            evidenceRefs: ["source:city"],
            required: false,
          },
        ],
        evidence: [
          {
            id: "evidence-1",
            resumeAnalysisId: "analysis-1",
            section: "项目经历",
            originalText: "负责用户访谈",
            claim: "完成用户访谈",
            skills: ["用户访谈"],
            outcomes: [],
            confirmed: true,
          },
        ],
      }),
    ).toThrow("请先确认至少一段简历证据，并选择已拆解经历或能力要求的岗位。");
  });
});

describe("structured AI tailoring rendering", () => {
  it("lets the model select only confirmed atoms and renders text on the server", () => {
    const [segment] = renderStructuredTailoringSelections({
      selections: [
        {
          evidenceId: "evidence-1",
          requirementIds: ["requirement-1"],
          emphasis: ["claim", "skills", "outcomes"],
        },
      ],
      requirements: [
        {
          id: "requirement-1",
          kind: "skill",
          operator: "contains",
          expectedValue: ["用户访谈"],
          sourceText: "具备用户访谈能力",
          evidenceRefs: ["source:requirements:1"],
          required: true,
        },
      ],
      evidence: [
        {
          id: "evidence-1",
          resumeAnalysisId: "analysis-1",
          section: "项目经历",
          originalText: "负责 3 次用户访谈并整理结论",
          claim: "完成用户访谈",
          skills: ["用户研究"],
          outcomes: ["输出访谈结论"],
          confirmed: true,
        },
      ],
    });
    expect(segment).toMatchObject({
      originalText: "负责 3 次用户访谈并整理结论",
      suggestedText: "完成用户访谈；相关能力：用户研究；已确认结果：输出访谈结论",
      requirementIds: ["requirement-1"],
      evidenceIds: ["evidence-1"],
    });
  });
});
