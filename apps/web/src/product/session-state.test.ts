import { describe, expect, it } from "vitest";
import { scopedJourneyId } from "./session-state";

describe("scoped journey state", () => {
  it("restores a value only when it belongs to the current parent run", () => {
    expect(scopedJourneyId("tailoring-current", "tailoring-current", "export-current")).toBe(
      "export-current",
    );
    expect(scopedJourneyId("tailoring-current", "tailoring-old", "export-old")).toBeNull();
    expect(scopedJourneyId("tailoring-current", "tailoring-current", null)).toBeNull();
  });
});
