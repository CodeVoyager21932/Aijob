import { randomUUID } from "node:crypto";
import type { ResumeReviewSuggestion } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { buildResumeReviewDecisionRequest } from "./resume-review-decision";

function suggestion(): ResumeReviewSuggestion {
  return {
    schemaVersion: "resume-review-suggestion-v1",
    id: randomUUID(),
    ownerId: randomUUID(),
    ownerEpoch: 1,
    reviewRunId: randomUUID(),
    findingId: randomUUID(),
    targetType: "block",
    targetIds: [randomUUID()],
    changeType: "rewrite_block",
    suggestedText: "建议表达",
    evidenceIds: ["confirmed-evidence"],
    decision: "pending",
    revision: 3,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

describe("resume review decision requests", () => {
  it("accepts the immutable suggestion revision without adding fields", () => {
    const item = suggestion();
    const key = randomUUID();
    expect(
      buildResumeReviewDecisionRequest(item, { kind: "accepted", suggestionId: item.id }, key),
    ).toEqual({ decision: "accepted", expectedRevision: 3, idempotencyKey: key });
  });

  it("trims edited text and keeps the suggestion's confirmed evidence IDs", () => {
    const item = suggestion();
    const key = randomUUID();
    expect(
      buildResumeReviewDecisionRequest(
        item,
        { kind: "edited", suggestionId: item.id, text: "  用户核对后的表达  " },
        key,
      ),
    ).toEqual({
      decision: "edited",
      expectedRevision: 3,
      idempotencyKey: key,
      editedText: "用户核对后的表达",
      evidenceIds: ["confirmed-evidence"],
    });
  });

  it("rejects by recording a fixed reason without mutating content", () => {
    const item = suggestion();
    const key = randomUUID();
    expect(
      buildResumeReviewDecisionRequest(item, { kind: "rejected", suggestionId: item.id }, key),
    ).toEqual({
      decision: "rejected",
      expectedRevision: 3,
      idempotencyKey: key,
      reasonCode: "USER_KEPT_ORIGINAL",
    });
  });
});
