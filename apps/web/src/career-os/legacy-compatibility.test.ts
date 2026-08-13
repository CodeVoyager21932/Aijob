import { describe, expect, it } from "vitest";
import { legacySurfaceMode, resumeCompletionPath } from "./legacy-compatibility";

describe("Career OS legacy compatibility policy", () => {
  it("keeps every legacy surface unchanged while the V2 flag is off", () => {
    expect(legacySurfaceMode(false, "job_detail_actions")).toBe("legacy");
    expect(legacySurfaceMode(false, "recommendations")).toBe("legacy");
    expect(legacySurfaceMode(false, "insights")).toBe("legacy");
    expect(legacySurfaceMode(false, "resume_tailoring")).toBe("legacy");
    expect(legacySurfaceMode(false, "data_control")).toBe("legacy");
  });

  it("gives every duplicate V2 surface one explicit non-writing disposition", () => {
    expect(legacySurfaceMode(true, "job_detail_actions")).toBe("case_only");
    expect(legacySurfaceMode(true, "recommendations")).toBe("redirect");
    expect(legacySurfaceMode(true, "insights")).toBe("redirect");
    expect(legacySurfaceMode(true, "resume_tailoring")).toBe("read_only");
    expect(legacySurfaceMode(true, "data_control")).toBe("redirect");
  });

  it("returns confirmed resume data to the V2 asset view without changing legacy exits", () => {
    expect(resumeCompletionPath(true, "saved")).toBe("/resumes");
    expect(resumeCompletionPath(true, "confirmed")).toBe("/resumes?source=confirmed");
    expect(resumeCompletionPath(false, "saved")).toBe("/recommendations?start=1");
    expect(resumeCompletionPath(false, "confirmed")).toBe("/recommendations?start=1");
  });
});
