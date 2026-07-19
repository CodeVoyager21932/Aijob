import { describe, expect, it } from "vitest";
import { groupMatchReasons, matchRunVersionState } from "./JobDetailPage";

describe("job detail match explanations", () => {
  it("groups repeated generic explanations without losing their count", () => {
    const shared = {
      code: "EVIDENCE_REQUIREMENT_NOT_STRUCTURED",
      evidenceIds: [],
      explanation: "岗位要求尚未拆成可核对的证据项。",
    };

    expect(
      groupMatchReasons([
        { ...shared, requirementIds: ["requirement-one"] },
        { ...shared, requirementIds: ["requirement-two"] },
      ]),
    ).toEqual([
      {
        key: `${shared.code}:${shared.explanation}`,
        explanation: shared.explanation,
        count: 2,
      },
    ]);
  });

  it("only treats a match run for the current immutable job version as displayable", () => {
    expect(matchRunVersionState(undefined, "job-version-current")).toBe("missing");
    expect(matchRunVersionState("job-version-current", "job-version-current")).toBe("current");
    expect(matchRunVersionState("job-version-old", "job-version-current")).toBe("stale");
    expect(matchRunVersionState("job-version-old", null)).toBe("stale");
  });
});
