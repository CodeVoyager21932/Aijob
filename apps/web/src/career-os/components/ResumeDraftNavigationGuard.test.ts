import { describe, expect, it } from "vitest";
import { shouldGuardResumeNavigation } from "./ResumeDraftNavigationGuard";

describe("Resume Studio draft navigation guard", () => {
  const current = "http://127.0.0.1:5173/applications/case-1/resume?studio=document&block=b1";

  it("allows block, requirement and pane deep-links inside the same document route", () => {
    expect(
      shouldGuardResumeNavigation(
        "/applications/case-1/resume?studio=review&requirement=r1",
        current,
      ),
    ).toBe(false);
  });

  it("guards an in-app route change but leaves external navigation to beforeunload", () => {
    expect(shouldGuardResumeNavigation("/applications/case-1/requirements", current)).toBe(true);
    expect(shouldGuardResumeNavigation("https://careers.example.test/job/1", current)).toBe(false);
  });
});
