import { describe, expect, it } from "vitest";
import {
  caseStageTransitions,
  getCaseTransitionTargets,
  isCaseTransitionSelectionValid,
} from "./workspace-model";

describe("Career OS Case transition model", () => {
  it("mirrors the Platform stage graph without allowing drag-style arbitrary moves", () => {
    expect(caseStageTransitions).toEqual({
      interested: ["preparing", "resolved"],
      preparing: ["interested", "applied", "resolved"],
      applied: ["interviewing", "resolved"],
      interviewing: ["applied", "resolved"],
      resolved: [],
    });
  });

  it("requires an outcome when resolving and permits only a changed outcome after resolution", () => {
    expect(
      isCaseTransitionSelectionValid({
        currentStage: "preparing",
        currentOutcome: null,
        toStage: "resolved",
        outcome: "",
      }),
    ).toBe(false);
    expect(
      isCaseTransitionSelectionValid({
        currentStage: "preparing",
        currentOutcome: null,
        toStage: "resolved",
        outcome: "withdrawn",
      }),
    ).toBe(true);
    expect(getCaseTransitionTargets("resolved")).toEqual(["resolved"]);
    expect(
      isCaseTransitionSelectionValid({
        currentStage: "resolved",
        currentOutcome: "rejected",
        toStage: "resolved",
        outcome: "rejected",
      }),
    ).toBe(false);
    expect(
      isCaseTransitionSelectionValid({
        currentStage: "resolved",
        currentOutcome: "rejected",
        toStage: "resolved",
        outcome: "offer",
      }),
    ).toBe(true);
  });

  it("rejects a target that is no longer legal after a revision refresh", () => {
    expect(
      isCaseTransitionSelectionValid({
        currentStage: "applied",
        currentOutcome: null,
        toStage: "preparing",
        outcome: "",
      }),
    ).toBe(false);
  });
});
