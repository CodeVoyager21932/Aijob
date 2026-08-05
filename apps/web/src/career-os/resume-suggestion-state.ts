import type { CareerResumeBlock } from "./case-workspace-domain";

export type ResumeSuggestionDecision = "pending" | "accepted" | "edited" | "rejected";

export interface ResumeSuggestionSession {
  decision: ResumeSuggestionDecision;
  draftText: string;
  appliedText?: string;
}

export type ResumeSuggestionAction =
  | { type: "update_draft"; value: string }
  | { type: "accept"; suggestedText: string }
  | { type: "accept_edit" }
  | { type: "reject" }
  | { type: "undo"; suggestedText: string };

export function createResumeSuggestionSession(suggestedText: string): ResumeSuggestionSession {
  return {
    decision: "pending",
    draftText: suggestedText,
  };
}

export function reduceResumeSuggestion(
  state: ResumeSuggestionSession,
  action: ResumeSuggestionAction,
): ResumeSuggestionSession {
  switch (action.type) {
    case "update_draft":
      return { ...state, draftText: action.value };
    case "accept":
      return {
        decision: "accepted",
        draftText: action.suggestedText,
        appliedText: action.suggestedText,
      };
    case "accept_edit": {
      const appliedText = state.draftText.trim();
      return appliedText ? { ...state, decision: "edited", appliedText } : state;
    }
    case "reject":
      return { decision: "rejected", draftText: state.draftText };
    case "undo":
      return createResumeSuggestionSession(action.suggestedText);
  }
}

export function getResumeBlockBullets(
  block: CareerResumeBlock,
  session: ResumeSuggestionSession | undefined,
): string[] {
  if (session?.appliedText && (session.decision === "accepted" || session.decision === "edited")) {
    return [session.appliedText];
  }
  return block.bullets;
}
