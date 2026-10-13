import { describe, expect, it } from "vitest";
import { createNativeResumeDocument, parseNativeResumeDocument } from "./index.js";

describe("native document writes", () => {
  it("round trips a blank document without making up facts", () => {
    const draft = createNativeResumeDocument();
    expect(parseNativeResumeDocument(draft)).toEqual(draft);
  });
  it("retains an unfinished education entry with a description but no school", () => {
    const draft = createNativeResumeDocument();
    draft.data.sections.education.items.push({
      id: "education-1",
      hidden: false,
      school: "",
      degree: "本科",
      area: "自动化",
      grade: "",
      location: "",
      period: "2023.09–2027.06",
      website: { url: "", label: "", inlineLink: false },
      description: "<p>课程项目：完成控制系统实验。</p>",
    });
    expect(parseNativeResumeDocument(draft)).toEqual(draft);
  });
  it("rejects wrong field types instead of converting them to defaults", () => {
    const draft = createNativeResumeDocument();
    const invalid = structuredClone(draft) as unknown as {
      data: { metadata: { page: { gapX: unknown } } };
    };
    invalid.data.metadata.page.gapX = "bad";
    expect(() => parseNativeResumeDocument(invalid)).toThrow();
  });
  it("rejects unmodelled nested fields rather than silently removing them", () => {
    const draft = createNativeResumeDocument();
    Object.assign(draft.data.basics, { accidentalLostField: "保留我的输入" });
    expect(() => parseNativeResumeDocument(draft)).toThrow(
      "NATIVE_RESUME_WRITE_WOULD_CHANGE_CONTENT",
    );
  });
  it("does not share mutable default state between resumes", () => {
    const first = createNativeResumeDocument();
    first.data.basics.name = "甲";
    expect(createNativeResumeDocument().data.basics.name).toBe("");
  });
});
