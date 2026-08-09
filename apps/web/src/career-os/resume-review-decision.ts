import type { DecideResumeReviewSuggestionRequest, ResumeReviewSuggestion } from "@aijob/contracts";

export type ResumeReviewDecisionDraft =
  | { kind: "accepted"; suggestionId: string }
  | { kind: "edited"; suggestionId: string; text: string }
  | { kind: "rejected"; suggestionId: string };

export function buildResumeReviewDecisionRequest(
  suggestion: ResumeReviewSuggestion,
  draft: ResumeReviewDecisionDraft,
  idempotencyKey: string,
): DecideResumeReviewSuggestionRequest {
  if (draft.kind === "edited") {
    return {
      decision: "edited",
      expectedRevision: suggestion.revision,
      idempotencyKey,
      editedText: draft.text.trim(),
      evidenceIds: suggestion.evidenceIds,
    };
  }
  if (draft.kind === "rejected") {
    return {
      decision: "rejected",
      expectedRevision: suggestion.revision,
      idempotencyKey,
      reasonCode: "USER_KEPT_ORIGINAL",
    };
  }
  return {
    decision: "accepted",
    expectedRevision: suggestion.revision,
    idempotencyKey,
  };
}
