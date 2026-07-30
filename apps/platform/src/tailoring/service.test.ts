import type { JobRequirement, ResumeDocumentSection, ResumeEvidence } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  createTemplateTailoringSegments,
  renderStructuredTailoringRewrites,
  validateTailoringSegments,
} from "./service.js";

const blockId = "10000000-0000-4000-8000-000000000001";
const untouchedBlockId = "10000000-0000-4000-8000-000000000002";
const sectionId = "20000000-0000-4000-8000-000000000001";

const requirement: JobRequirement = {
  id: "requirement-1",
  kind: "skill",
  operator: "contains",
  expectedValue: ["用户访谈"],
  sourceText: "具备用户访谈能力",
  evidenceRefs: ["source:requirements:1"],
  necessity: "required",
  sourceSpan: null,
};

const evidence: ResumeEvidence = {
  id: "evidence-1",
  resumeAnalysisId: "analysis-1",
  sourceBlockId: blockId,
  section: "项目经历",
  evidenceType: "project",
  statement: "负责 3 次用户访谈并整理结论",
  skills: ["用户访谈"],
  outcomes: ["输出访谈结论"],
  confirmed: true,
};

const sections: ResumeDocumentSection[] = [
  {
    id: sectionId,
    title: "项目经历",
    ordinal: 0,
    blocks: [
      { id: blockId, ordinal: 0, text: evidence.statement },
      { id: untouchedBlockId, ordinal: 1, text: "负责维护项目周报" },
    ],
  },
];

function segment(suggestedText: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceBlockId: blockId,
    sectionId,
    sectionTitle: "项目经历",
    originalText: evidence.statement,
    suggestedText,
    reason: "突出已确认的用户研究动作",
    requirementIds: [requirement.id],
    evidenceIds: [evidence.id],
    ...overrides,
  };
}

function expectServiceCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("resume tailoring evidence guard", () => {
  it("accepts a traceable real rewrite without inventing facts", () => {
    expect(
      validateTailoringSegments({
        requirementIds: new Set([requirement.id]),
        evidence: [evidence],
        segments: [segment("完成 3 次用户访谈，整理并输出访谈结论")],
      }),
    ).toHaveLength(1);
  });

  it("rejects a hallucinated number", () => {
    expectServiceCode(
      () =>
        validateTailoringSegments({
          requirementIds: new Set([requirement.id]),
          evidence: [evidence],
          segments: [segment("完成 30 次用户访谈并整理结论")],
        }),
      "AI_UNSUPPORTED_NUMERIC_CLAIM",
    );
  });

  it("rejects unknown requirement references", () => {
    expectServiceCode(
      () =>
        validateTailoringSegments({
          requirementIds: new Set([requirement.id]),
          evidence: [evidence],
          segments: [segment("完成 3 次用户访谈并整理结论", { requirementIds: ["missing"] })],
        }),
      "AI_REQUIREMENT_REFERENCE_INVALID",
    );
  });

  it("rejects evidence that cannot trace back to the rewritten block", () => {
    expectServiceCode(
      () =>
        validateTailoringSegments({
          requirementIds: new Set([requirement.id]),
          evidence: [{ ...evidence, sourceBlockId: untouchedBlockId }],
          segments: [segment("完成 3 次用户访谈并整理结论")],
        }),
      "AI_SOURCE_BLOCK_UNTRACEABLE",
    );
  });

  it("rejects an unsupported protected skill claim", () => {
    expectServiceCode(
      () =>
        validateTailoringSegments({
          requirementIds: new Set([requirement.id]),
          evidence: [evidence],
          segments: [segment("使用 Python 完成 3 次用户访谈并整理结论")],
        }),
      "AI_UNSUPPORTED_FACTUAL_CLAIM",
    );
  });
});

describe("deterministic tailoring fallback", () => {
  it("preserves every document block in section order", () => {
    const result = createTemplateTailoringSegments({
      requirements: [requirement],
      evidence: [evidence],
      sections,
    });

    expect(result.map(({ sourceBlockId }) => sourceBlockId)).toEqual([blockId, untouchedBlockId]);
    expect(result.map(({ suggestedText }) => suggestedText)).toEqual([
      evidence.statement,
      "负责维护项目周报",
    ]);
    expect(result[0]?.requirementIds).toEqual([requirement.id]);
    expect(result[1]?.requirementIds).toEqual([]);
  });
});

describe("structured AI block rewrite rendering", () => {
  it("uses the model's actual suggestedText and leaves unselected blocks unchanged", () => {
    const result = renderStructuredTailoringRewrites({
      rewrites: [
        {
          sourceBlockId: blockId,
          suggestedText: "完成 3 次用户访谈，整理并输出访谈结论",
          reason: "突出用户研究动作",
          requirementIds: [requirement.id],
          evidenceIds: [evidence.id],
        },
      ],
      requirements: [requirement],
      evidence: [evidence],
      sections,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      sourceBlockId: blockId,
      originalText: evidence.statement,
      suggestedText: "完成 3 次用户访谈，整理并输出访谈结论",
      requirementIds: [requirement.id],
      evidenceIds: [evidence.id],
    });
    expect(result[1]).toMatchObject({
      sourceBlockId: untouchedBlockId,
      originalText: "负责维护项目周报",
      suggestedText: "负责维护项目周报",
      requirementIds: [],
      evidenceIds: [],
    });
  });
});
