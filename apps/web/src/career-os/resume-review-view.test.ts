import { randomUUID } from "node:crypto";
import type {
  ResumeDocumentContentRevisionReadModel,
  ResumeReviewRun,
  ResumeReviewSuggestion,
} from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  orderResumeReviewSuggestions,
  resumeReviewBlockText,
  resumeReviewDecisionLabel,
  resumeReviewGenerationLabel,
  resumeReviewReasonLabel,
  resumeReviewRequirementIds,
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

  it("does not forge provenance for v1 and explains a controlled AI fallback", () => {
    const ownerId = randomUUID();
    const v1 = {
      schemaVersion: "resume-review-run-v1",
      id: randomUUID(),
      ownerId,
      ownerEpoch: 1,
      caseId: randomUUID(),
      detachedFromCaseId: null,
      documentId: randomUUID(),
      contentRevisionId: randomUUID(),
      jobContext: {
        kind: "private",
        snapshotId: randomUUID(),
        ownerId,
        title: "合成岗位",
        companyName: null,
        sourceLabel: "合成输入",
        contentRevision: 1,
        requirementSetRevision: 1,
        sourceProvided: false,
      },
      evidenceRevisionId: randomUUID(),
      mode: "template",
      status: "completed",
      revision: 2,
      completedAt: "2026-08-16T00:00:00.000Z",
      deletedAt: null,
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    } satisfies ResumeReviewRun;
    const fallback = {
      ...v1,
      schemaVersion: "resume-review-run-v2",
      mode: "controlled_ai",
      generationProvenanceVersion: "resume-review-generation-v1",
      templateVersion: "resume-review-template-v2",
      privacyConsentAt: "2026-08-16T00:00:00.000Z",
      providerAdapter: null,
      model: null,
      promptVersion: "resume-review-prompt-v1",
      outputSchemaVersion: "resume-review-output-v1",
      safetyPolicyVersion: "confirmed-evidence-and-fixed-requirements-v1",
      parametersVersion: "temperature-zero-v1",
      usedTemplateFallback: true,
      fallbackReasonCode: "AI_DISABLED",
      failureCode: null,
    } satisfies ResumeReviewRun;

    expect(resumeReviewGenerationLabel(v1)).toContain("生成来源未记录");
    expect(resumeReviewGenerationLabel(fallback)).toBe(
      "受控 AI 未启用，已改用确定性模板",
    );
  });

  it("shows only persisted v2 requirement citations", () => {
    const requirementId = "requirement-1";
    const v1 = suggestion({ id: randomUUID(), targetId: randomUUID() });
    const v2 = {
      ...v1,
      schemaVersion: "resume-review-suggestion-v2",
      requirementIds: [requirementId],
    } satisfies ResumeReviewSuggestion;

    expect(resumeReviewRequirementIds(v1)).toEqual([]);
    expect(resumeReviewRequirementIds(v2)).toEqual([requirementId]);
  });
});
