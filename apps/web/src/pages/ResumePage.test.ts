import { describe, expect, it } from "vitest";
import { browserPrivacyState, initialResumeFormState, resumeFormReducer } from "./ResumePage";

describe("resume input privacy state", () => {
  it("does not claim that the browser inspected PDF or DOCX contents", () => {
    expect(browserPrivacyState("file", 0)).toBe("file_not_read");
    expect(browserPrivacyState("text", 0)).toBe("no_obvious_pii");
    expect(browserPrivacyState("text", 1)).toBe("pii_found");
  });

  it("invalidates privacy confirmation when the input mode or selected file changes", () => {
    const confirmed = resumeFormReducer(initialResumeFormState, {
      type: "set-privacy",
      checked: true,
    });
    const fileMode = resumeFormReducer(confirmed, { type: "select-mode", mode: "file" });
    expect(fileMode.privacyChecked).toBe(false);

    const reconfirmed = resumeFormReducer(fileMode, { type: "set-privacy", checked: true });
    const nextFile = { name: "resume.pdf", size: 1024 } as File;
    expect(
      resumeFormReducer(reconfirmed, { type: "set-file", file: nextFile }).privacyChecked,
    ).toBe(false);
  });

  it("also invalidates confirmation when pasted text changes", () => {
    const confirmed = resumeFormReducer(initialResumeFormState, {
      type: "set-privacy",
      checked: true,
    });
    expect(
      resumeFormReducer(confirmed, { type: "set-text", text: "updated resume" }).privacyChecked,
    ).toBe(false);
  });
});
