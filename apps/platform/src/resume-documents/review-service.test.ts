import { randomUUID } from "node:crypto";
import type { ResumeEvidenceRevision, ResumeSemanticContent } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { createTemplateReviewDrafts } from "./review-service.js";

function content(
  blocks: ResumeSemanticContent["sections"][number]["blocks"],
): ResumeSemanticContent {
  return {
    schemaVersion: "resume-content-v1",
    sections: [
      {
        id: randomUUID(),
        ordinal: 0,
        title: "项目经历",
        blocks,
      },
    ],
  };
}

describe("deterministic resume review", () => {
  it("rewrites only from evidence explicitly linked to the block", () => {
    const blockId = randomUUID();
    const evidence: ResumeEvidenceRevision["evidence"] = [
      {
        id: "evidence-1",
        resumeAnalysisId: null,
        section: "项目经历",
        originalText: "完成用户访谈并形成结论",
        claim: "完成用户访谈并形成结论",
        skills: ["用户研究"],
        outcomes: ["输出访谈结论"],
        confirmed: true,
      },
    ];
    const drafts = createTemplateReviewDrafts({
      content: content([
        {
          id: blockId,
          ordinal: 0,
          text: "负责用户研究",
          evidenceIds: ["evidence-1"],
        },
      ]),
      evidence,
    });

    expect(drafts).toEqual([
      expect.objectContaining({
        sourceBlockId: blockId,
        category: "ats_readability",
        evidenceIds: ["evidence-1"],
        reasonCode: "EVIDENCE_BACKED_ATS_REWRITE",
        suggestion: {
          changeType: "rewrite_block",
          suggestedText: "完成用户访谈并形成结论；技能：用户研究；结果：输出访谈结论",
          evidenceIds: ["evidence-1"],
        },
      }),
    ]);
  });

  it("offers removal only when an unsupported block can be removed safely", () => {
    const unsupportedId = randomUUID();
    const supportedId = randomUUID();
    const drafts = createTemplateReviewDrafts({
      content: content([
        { id: unsupportedId, ordinal: 0, text: "待确认内容", evidenceIds: [] },
        { id: supportedId, ordinal: 1, text: "保留内容", evidenceIds: [] },
      ]),
      evidence: [],
    });
    expect(drafts[0]).toMatchObject({
      sourceBlockId: unsupportedId,
      severity: "warning",
      reasonCode: "BLOCK_WITHOUT_CONFIRMED_EVIDENCE",
      suggestion: { changeType: "remove_block", suggestedText: null, evidenceIds: [] },
    });
  });

  it("does not suggest deleting the only block in a section", () => {
    const drafts = createTemplateReviewDrafts({
      content: content([{ id: randomUUID(), ordinal: 0, text: "待确认内容", evidenceIds: [] }]),
      evidence: [],
    });
    expect(drafts[0]).toMatchObject({
      reasonCode: "BLOCK_WITHOUT_CONFIRMED_EVIDENCE",
      suggestion: null,
    });
  });
});
