import { randomUUID } from "node:crypto";
import type { ApplicationCaseRequirements, JobRequirement } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  requirementGroup,
  requirementNextStep,
  summarizeRequirementProgress,
} from "./requirements-view";

function requirement(
  id: string,
  kind: JobRequirement["kind"],
  operator: JobRequirement["operator"] = "contains",
): JobRequirement {
  return {
    id,
    kind,
    operator,
    expectedValue: null,
    sourceText: `原文 ${id}`,
    evidenceRefs: ["source"],
    necessity: "unknown",
    sourceSpan: null,
  };
}

describe("M1 requirement view", () => {
  it("groups hard, capability and unknown requirements without inference", () => {
    expect(requirementGroup(requirement("city", "city"))).toBe("hard");
    expect(requirementGroup(requirement("skill", "skill"))).toBe("capability");
    expect(requirementGroup(requirement("other", "other"))).toBe("unknown");
    expect(requirementGroup(requirement("unknown", "skill", "unknown"))).toBe("unknown");
  });

  it("derives progress from persisted states and active evidence links", () => {
    const caseId = randomUUID();
    const context = { kind: "private" as const, requirementSetRevision: 1 };
    const data: ApplicationCaseRequirements = {
      caseId,
      requirementContext: context,
      revision: 4,
      requirements: [
        requirement("confirmed", "city"),
        requirement("work", "skill"),
        requirement("unknown", "other"),
      ],
      states: [
        {
          id: randomUUID(),
          caseId,
          requirementContext: context,
          requirementId: "confirmed",
          state: "confirmed",
          userNote: null,
          revision: 2,
          persisted: true,
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:00.000Z",
        },
        {
          id: randomUUID(),
          caseId,
          requirementContext: context,
          requirementId: "work",
          state: "needs_work",
          userNote: null,
          revision: 3,
          persisted: true,
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:00.000Z",
        },
      ],
      evidenceLinks: [],
      questions: [],
    };
    expect(summarizeRequirementProgress(data)).toEqual({
      total: 3,
      confirmed: 1,
      needsWork: 1,
      unconfirmed: 1,
      linkedEvidenceCount: 0,
    });
    expect(requirementNextStep("unconfirmed", 0)).toContain("未知信息");
    expect(requirementNextStep("confirmed", 2)).toContain("2 项证据");
  });
});
