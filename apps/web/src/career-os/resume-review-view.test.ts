import { randomUUID } from "node:crypto";
import type {
  ResumeDocumentContentRevisionReadModel,
  ResumeReviewSuggestion,
} from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  orderResumeReviewSuggestions,
  resumeReviewBlockText,
  resumeReviewDecisionLabel,
  resumeReviewReasonLabel,
} from "./resume-review-view";

function suggestion(input: {
  id: string;
  targetId: string;
  decision?: ResumeReviewSuggestion["decision"];
  createdAt?: string;
}): ResumeReviewSuggestion {
  return {
    schemaVersion: "resume-review-suggestion-v1",
    id: input.id,
    ownerId: randomUUID(),
    ownerEpoch: 1,
    reviewRunId: randomUUID(),
    findingId: randomUUID(),
    targetType: "block",
    targetIds: [input.targetId],
    changeType: "rewrite_block",
    suggestedText: "建议表达",
    evidenceIds: ["evidence-1"],
    decision: input.decision ?? "pending",
    revision: 1,
    createdAt: input.createdAt ?? "2026-08-09T00:00:00.000Z",
    updatedAt: input.createdAt ?? "2026-08-09T00:00:00.000Z",
  };
}

describe("resume review view", () => {
  it("keeps readable labels without exposing raw reason codes", () => {
    expect(resumeReviewReasonLabel("EVIDENCE_BACKED_ATS_REWRITE")).toContain("HR 与 ATS");
    expect(resumeReviewDecisionLabel("rejected")).toBe("已保留原文");
  });

  it("reads the original block from the review's pinned content revision", () => {
    const blockId = randomUUID();
    const revision = {
      schemaVersion: "resume-content-revision-v1",
      id: randomUUID(),
      documentId: randomUUID(),
      ownerId: randomUUID(),
      ownerEpoch: 1,
      documentRevision: 1,
      baseDocumentRevisionId: null,
      contentHash: "a".repeat(64),
      confirmedAt: "2026-08-09T00:00:00.000Z",
      createdAt: "2026-08-09T00:00:00.000Z",
      content: {
        schemaVersion: "resume-content-v1",
        sections: [
          {
            id: randomUUID(),
            ordinal: 0,
            title: "项目经历",
            blocks: [{ id: blockId, ordinal: 0, text: "审阅时原文", evidenceIds: [] }],
          },
        ],
      },
    } satisfies ResumeDocumentContentRevisionReadModel;
    expect(resumeReviewBlockText(revision, blockId)).toBe("审阅时原文");
    expect(resumeReviewBlockText(revision, randomUUID())).toBeNull();
  });

  it("places the selected block and pending decisions first", () => {
    const selected = randomUUID();
    const other = randomUUID();
    const items = [
      suggestion({ id: randomUUID(), targetId: other }),
      suggestion({ id: randomUUID(), targetId: selected, decision: "accepted" }),
      suggestion({ id: randomUUID(), targetId: selected }),
    ];
    expect(orderResumeReviewSuggestions(items, selected).map((item) => item.decision)).toEqual([
      "pending",
      "accepted",
      "pending",
    ]);
  });
});
