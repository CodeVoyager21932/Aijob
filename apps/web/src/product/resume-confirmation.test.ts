import { describe, expect, it } from "vitest";
import { buildConfirmedEvidence, profileConfirmationError } from "./resume-confirmation";

describe("resume profile confirmation", () => {
  it("allows a user with no confirmed evidence to continue conservatively", () => {
    expect(buildConfirmedEvidence([], new Set(), "analysis-1")).toEqual([]);
    expect(profileConfirmationError({ resultAvailable: true, privacyConfirmed: true })).toBeNull();
  });

  it("still requires the user to review the de-identified text", () => {
    expect(profileConfirmationError({ resultAvailable: true, privacyConfirmed: false })).toBe(
      "请确认去标识化内容后再保存。",
    );
  });
});
