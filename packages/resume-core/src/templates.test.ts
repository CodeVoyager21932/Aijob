import { describe, expect, it } from "vitest";
import {
  applyNativeTemplate,
  createNativeResumeDocument,
  joinNativeResumeDocument,
  nativeTemplateCatalog,
  newNativeItem,
  parseNativeResumeDocument,
  splitNativeResumeDocument,
} from "./index.js";

describe("native Chinese template identity and content", () => {
  for (const template of nativeTemplateCatalog)
    it(`${template.id} keeps facts and round trips through split revisions`, () => {
      const original = createNativeResumeDocument();
      original.data.basics.name = "林同学";
      const item = newNativeItem("projects", "stable-project");
      item.name = "完整项目";
      item.description = "<p>18 次访谈与 2 轮测试</p>";
      item.hidden = true;
      original.data.sections.projects.items.push(item);
      const before = structuredClone(original);
      const applied = applyNativeTemplate(original, template.id);
      expect(original).toEqual(before);
      expect(splitNativeResumeDocument(applied).content).toEqual(
        splitNativeResumeDocument(original).content,
      );
      const split = splitNativeResumeDocument(applied);
      expect(joinNativeResumeDocument(split.content, split.layout)).toEqual(applied);
      expect(parseNativeResumeDocument(applied).presentation?.id).toBe(template.id);
    });
  it("clears prior style overrides and logical page breaks without dropping custom modules", () => {
    const original = createNativeResumeDocument();
    original.data.metadata.stylesheet = {
      mode: "semantic",
      source: { languageVersion: 1, text: "" },
    };
    original.data.metadata.layout.pages.push({ fullWidth: true, main: ["my-custom"], sidebar: [] });
    original.data.sections.education.startOnNewPage=true;
    original.data.sections.education.keepTogether=true;
    const applied = applyNativeTemplate(original, "gengar-cn");
    expect(applied.data.metadata.stylesheet).toBeUndefined();
    expect(applied.data.metadata.layout.pages).toHaveLength(1);
    expect(applied.data.metadata.layout.pages[0]?.main).toContain("my-custom");
    expect(applied.data.sections.education.startOnNewPage).toBe(false);
    expect(applied.data.sections.education.keepTogether).toBe(false);
  });
  it("rejects a mismatched template identity rather than silently falling back", () => {
    const applied = applyNativeTemplate(createNativeResumeDocument(), "lapis-cn");
    applied.data.metadata.template = "gengar";
    expect(() => parseNativeResumeDocument(applied)).toThrow("NATIVE_TEMPLATE_BASE_MISMATCH");
  });
});
