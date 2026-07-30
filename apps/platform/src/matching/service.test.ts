import { describe, expect, it } from "vitest";
import { parseMatchJobFamily, parseStoredMatchRunResult } from "./service.js";

describe("stored match result compatibility", () => {
  it("treats a legacy one-reference conflict as unknown instead of failing a run", () => {
    expect(
      parseMatchJobFamily({
        state: "conflict",
        rawValues: ["operations", "data_ai"],
        evidenceRefs: ["legacy-page"],
      }),
    ).toEqual({ state: "unknown", reason: "parse_failed" });
  });

  it("keeps a legacy v1 result readable without reconstructing missing basis data", () => {
    const result = parseStoredMatchRunResult({
      eligibility: { status: "needs_information", reasons: [] },
      evidence: { status: "insufficient_information", reasons: [] },
      preference: { status: "not_set", reasons: [] },
      unknownRequirementIds: ["legacy-requirement"],
    });

    expect(result).toMatchObject({
      eligibility: { status: "needs_information" },
      basisState: "insufficient",
      gaps: [],
      unknownRequirementIds: ["legacy-requirement"],
    });
    expect(result.coverage).toEqual({
      eligibility: { required: 0, evaluated: 0, met: 0, conflicts: 0, unknown: 0 },
      evidence: { applicable: 0, supported: 0, partial: 0, missing: 0, unknown: 0 },
      preference: { configured: 0, compared: 0, conflicts: 0, unknown: 0 },
    });
  });
});
