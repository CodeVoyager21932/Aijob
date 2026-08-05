import { describe, expect, it } from "vitest";
import type { CareerResumeBlock } from "./case-workspace-domain";
import {
  createResumeSuggestionSession,
  getResumeBlockBullets,
  reduceResumeSuggestion,
} from "./resume-suggestion-state";

const block: CareerResumeBlock = {
  id: "block-1",
  sectionId: "projects",
  title: "项目经历",
  meta: "静态示例",
  bullets: ["原始内容"],
  suggestion: {
    requirementId: "requirement-1",
    evidenceIds: ["evidence-1"],
    suggestedText: "建议内容",
  },
};

describe("resume suggestion session state", () => {
  it("accepts a suggestion without overwriting the original block", () => {
    const accepted = reduceResumeSuggestion(createResumeSuggestionSession("建议内容"), {
      type: "accept",
      suggestedText: "建议内容",
    });
    expect(accepted.decision).toBe("accepted");
    expect(getResumeBlockBullets(block, accepted)).toEqual(["建议内容"]);
    expect(block.bullets).toEqual(["原始内容"]);
  });

  it("uses trimmed edited text and can undo to the pending state", () => {
    const editedDraft = reduceResumeSuggestion(createResumeSuggestionSession("建议内容"), {
      type: "update_draft",
      value: "  编辑后内容  ",
    });
    const edited = reduceResumeSuggestion(editedDraft, { type: "accept_edit" });
    expect(edited).toMatchObject({ decision: "edited", appliedText: "编辑后内容" });

    const undone = reduceResumeSuggestion(edited, {
      type: "undo",
      suggestedText: "建议内容",
    });
    expect(undone).toEqual(createResumeSuggestionSession("建议内容"));
  });

  it("rejects a suggestion while keeping the original preview", () => {
    const rejected = reduceResumeSuggestion(createResumeSuggestionSession("建议内容"), {
      type: "reject",
    });
    expect(rejected.decision).toBe("rejected");
    expect(getResumeBlockBullets(block, rejected)).toEqual(["原始内容"]);
  });
});
