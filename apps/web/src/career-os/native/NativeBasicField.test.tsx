import { applyNativeTemplate, createNativeResumeDocument } from "@aijob/resume-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  NativeBasicField,
  updateNativeBasicField,
  validNativeFieldBreak,
} from "./NativeBasicField";
import { NativeContentEditor } from "./NativeContentEditor";

describe("local basic-field layout", () => {
  it("invalidates a manual break when source text changes without losing font, position or the other field", () => {
    const document = createNativeResumeDocument();
    document.data.basics.headline = "小学教育 · 教研与阅读活动助理";
    document.fieldLayout = {
      headline: { fontSize: 11.5, lineMode: "manual", breakAfter: 7, position: "main" },
      email: { fontSize: 10, lineMode: "single", position: "auto" },
    };
    const email = structuredClone(document.fieldLayout.email);
    updateNativeBasicField(document, "headline", "语文教学与阅读活动助理");
    expect(document.data.basics.headline).toBe("语文教学与阅读活动助理");
    expect(document.fieldLayout.headline).toEqual({
      fontSize: 11.5,
      lineMode: "auto",
      position: "main",
    });
    expect(document.fieldLayout.email).toEqual(email);
  });

  it("uses original UTF-16 cursor positions and rejects a split inside an emoji or combining character", () => {
    expect(validNativeFieldBreak("教研与阅读活动助理", 3)).toBe(true);
    expect(validNativeFieldBreak("a👩‍🏫b", 2)).toBe(false);
    expect(validNativeFieldBreak("a👩‍🏫b", 6)).toBe(true);
    expect(validNativeFieldBreak("ae\u0301b", 2)).toBe(false);
    expect(validNativeFieldBreak("abc", 0)).toBe(false);
    expect(validNativeFieldBreak("abc", 3)).toBe(false);
    expect(validNativeFieldBreak("abc", null)).toBe(false);
    expect(validNativeFieldBreak("  abc", 1)).toBe(false);
    expect(validNativeFieldBreak("abc  ", 4)).toBe(false);
  });

  it("preserves a chosen single-line policy when the source field is edited", () => {
    const document = createNativeResumeDocument();
    document.data.basics.email = "first@example.com";
    document.fieldLayout = {
      email: { fontSize: 10.5, lineMode: "single", position: "main" },
    };
    updateNativeBasicField(document, "email", "next@example.com");
    expect(document.data.basics.email).toBe("next@example.com");
    expect(document.fieldLayout.email).toEqual({
      fontSize: 10.5,
      lineMode: "single",
      position: "main",
    });
  });

  it("presents a saved override with an explicit field scope and source text unchanged", () => {
    const document = createNativeResumeDocument();
    document.data.basics.headline = "小学教育 · 教研与阅读活动助理";
    document.fieldLayout = {
      headline: { fontSize: 11.5, lineMode: "manual", breakAfter: 7, position: "main" },
    };
    const before = structuredClone(document);
    const html = renderToStaticMarkup(
      <NativeBasicField
        document={document}
        field="headline"
        label="求职方向"
        edit={() => {}}
        active
        open={() => {}}
      />,
    );
    expect(html).toContain("作用范围：整个求职方向字段");
    expect(html).toContain('value="11.5"');
    expect(html).toContain('value="main" selected=""');
    expect(html).toContain('value="小学教育 · 教研与阅读活动助理"');
    expect(html).toContain("恢复该字段默认");
    expect(html).toContain('aria-label="求职方向指定换行效果"');
    expect(document).toEqual(before);
  });

  it("exposes the two local-format entry points only for C", () => {
    const document = createNativeResumeDocument();
    const original = renderToStaticMarkup(
      <NativeContentEditor document={document} edit={() => {}} />,
    );
    const sidebar = applyNativeTemplate(document, "studio-sidebar-cn");
    const html = renderToStaticMarkup(<NativeContentEditor document={sidebar} edit={() => {}} />);
    expect(original).not.toContain("调整邮箱排版");
    expect(html).toContain("调整邮箱排版");
    expect(html).toContain("调整求职方向排版");
  });
});
