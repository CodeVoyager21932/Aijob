import { describe, expect, it } from "vitest";
import {
  insertNativeExperience,
  nativeExperienceEntries,
  parseNativeExperience,
} from "./experiences.js";
import { createNativeResumeDocument, newNativeItem } from "./index.js";

describe("complete native experience reuse", () => {
  it("preserves research fields and complete context without sharing mutable state", () => {
    const entry = newNativeItem("projects", "source:research");
    entry.name = "长周期课题";
    entry.role = "实验设计";
    entry.method = "对照实验";
    entry.description = "<p>没有得出显著差异，保留完整实验记录。</p>";
    const source = {
      schemaVersion: "aijob-native-experience-v1",
      type: "projects",
      kind: "research",
      entry,
    };
    const document = createNativeResumeDocument();
    insertNativeExperience(document, source, "target:research");
    const result = nativeExperienceEntries(document);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "research",
      entry: { ...entry, id: "target:research" },
    });
    expect(document.data.customSections[0]?.aijobKind).toBe("research");
    entry.description = "changed original";
    expect(result[0]?.entry.description).toContain("完整实验记录");
  });
  it("rejects incompatible kinds and fields that would otherwise disappear", () => {
    const entry = newNativeItem("projects", "p1");
    const source = {
      schemaVersion: "aijob-native-experience-v1",
      type: "projects",
      kind: "internship",
      entry,
    };
    expect(() => parseNativeExperience(source)).toThrow("NATIVE_EXPERIENCE_KIND_MISMATCH");
    expect(() =>
      parseNativeExperience({
        ...source,
        kind: "project",
        entry: { ...entry, unsupportedFact: "不得丢失" },
      }),
    ).toThrow();
  });
  it("keeps hidden originals in the library but excludes them from submitted interview context", () => {
    const document = createNativeResumeDocument();
    const entry = newNativeItem("projects", "p1");
    entry.description = "<p>只有实际显示的经历可用于投递稿追问。</p>";
    insertNativeExperience(
      document,
      { schemaVersion: "aijob-native-experience-v1", type: "projects", kind: "research", entry },
      "r1",
    );
    expect(nativeExperienceEntries(document, { visibleOnly: true })).toHaveLength(1);
    const section = document.data.customSections[0];
    if (!section) throw new Error("missing fixture section");
    section.hidden = true;
    expect(nativeExperienceEntries(document)).toHaveLength(1);
    expect(nativeExperienceEntries(document, { visibleOnly: true })).toHaveLength(0);
    section.hidden = false;
    for (const page of document.data.metadata.layout.pages) {
      page.main = page.main.filter((id) => id !== section.id);
      page.sidebar = page.sidebar.filter((id) => id !== section.id);
    }
    expect(nativeExperienceEntries(document, { visibleOnly: true })).toHaveLength(0);
  });
});
