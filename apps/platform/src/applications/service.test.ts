import type { CaseStage } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { canTransitionApplicationCaseStage } from "./service.js";

const stages = ["interested", "preparing", "applied", "interviewing", "resolved"] as const;

const allowed = new Set([
  "interested:preparing",
  "interested:resolved",
  "preparing:interested",
  "preparing:applied",
  "preparing:resolved",
  "applied:interviewing",
  "applied:resolved",
  "interviewing:applied",
  "interviewing:resolved",
]);

describe("ApplicationCase stage machine", () => {
  it("keeps every allowed and rejected edge explicit", () => {
    for (const from of stages) {
      for (const to of stages) {
        expect(canTransitionApplicationCaseStage(from, to), `${from} -> ${to}`).toBe(
          allowed.has(`${from}:${to}`),
        );
      }
    }
  });

  it("keeps resolved terminal", () => {
    for (const to of stages) {
      expect(canTransitionApplicationCaseStage("resolved", to as CaseStage)).toBe(false);
    }
  });
});
