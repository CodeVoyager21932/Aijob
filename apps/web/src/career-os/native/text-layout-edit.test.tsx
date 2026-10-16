import { createNativeResumeDocument, parseNativeResumeDocument } from "@aijob/resume-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NativeBasicField } from "./NativeBasicField";
import { NativeTextBlockControls, NativeTextLayoutPanel } from "./NativeTextLayoutPanel";
import type { NativeTextTarget } from "./preview-text-targets";
import {
  nativeEffectiveTextLayout,
  nativeRangeFontSize,
  patchNativeTextLayout,
  resetNativeTextLayout,
  setNativeTextRangeSize,
} from "./text-layout-edit";

const target: NativeTextTarget = {
  kind: "text",
  id: "entry:fixture:description",
  targetId: "entry:fixture:description",
  text: "负责用户调研并整理结果",
  label: "项目经历正文",
  defaultFontSize: 10,
  page: 1,
  x: 40,
  y: 120,
  width: 400,
  height: 24,
};

describe("local text layout edits", () => {
  it("overlays a new range without changing rich content or unselected ranges, and survives serialization", () => {
    const document = createNativeResumeDocument();
    document.data.summary.content =
      '<p><strong>完整经历</strong>与<a href="https://example.com">链接</a></p>';
    const content = structuredClone(document.data);
    patchNativeTextLayout(document, target, {
      fontSize: 10.5,
      textAlign: "right",
      ranges: [{ start: 0, end: 6, fontSize: 12 }],
    });
    setNativeTextRangeSize(document, target, { start: 2, end: 4 }, 14);
    expect(document.textLayout?.[target.targetId]?.ranges).toEqual([
      { start: 0, end: 2, fontSize: 12 },
      { start: 2, end: 4, fontSize: 14 },
      { start: 4, end: 6, fontSize: 12 },
    ]);
    expect(document.data).toEqual(content);
    expect(parseNativeResumeDocument(JSON.parse(JSON.stringify(document))).textLayout).toEqual(
      document.textLayout,
    );
  });

  it("ignores all stale formatting and creates fresh offsets against the current source", () => {
    const document = createNativeResumeDocument();
    patchNativeTextLayout(document, target, {
      fontSize: 12,
      textAlign: "right",
      ranges: [{ start: 0, end: 2, fontSize: 14 }],
    });
    const changed = { ...target, text: "新增的不同正文" };
    expect(nativeEffectiveTextLayout(document, changed)).toBeUndefined();
    setNativeTextRangeSize(document, changed, { start: 2, end: 4 }, 11);
    expect(document.textLayout?.[target.targetId]).toEqual({
      sourceText: changed.text,
      ranges: [{ start: 2, end: 4, fontSize: 11 }],
    });
  });

  it("does not accept selections inside a grapheme and clears manual offsets when returning to auto", () => {
    const document = createNativeResumeDocument();
    const emoji = { ...target, text: "a👩‍🏫b" };
    setNativeTextRangeSize(document, emoji, { start: 2, end: 4 }, 12);
    expect(document.textLayout).toBeUndefined();
    patchNativeTextLayout(document, target, { lineMode: "manual", breakAfter: 4 });
    patchNativeTextLayout(document, target, { lineMode: "auto" });
    expect(document.textLayout?.[target.targetId]).toEqual({
      sourceText: target.text,
      lineMode: "auto",
    });
  });

  it("reports mixed selection sizes honestly and resets only the selected block", () => {
    const document = createNativeResumeDocument();
    document.fieldLayout = { email: { position: "main", fontSize: 10.5 } };
    patchNativeTextLayout(document, target, {
      fontSize: 11,
      ranges: [{ start: 2, end: 4, fontSize: 14 }],
    });
    patchNativeTextLayout(document, { ...target, targetId: "basics:email" }, { fontSize: 12 });
    const layout = nativeEffectiveTextLayout(document, target);
    expect(nativeRangeFontSize(layout, { start: 2, end: 4 }, 10)).toBe(14);
    expect(nativeRangeFontSize(layout, { start: 1, end: 5 }, 10)).toBeNull();
    expect(nativeRangeFontSize(layout, undefined, 10)).toBe(11);
    resetNativeTextLayout(document, target.targetId);
    expect(document.textLayout?.["basics:email"]?.fontSize).toBe(12);
    expect(document.fieldLayout.email).toEqual({ position: "main", fontSize: 10.5 });
  });
});

describe("local text controls", () => {
  it("disables ineffective alignment on a tight text box while preserving useful position controls", () => {
    const html = renderToStaticMarkup(
      <NativeTextBlockControls
        document={createNativeResumeDocument()}
        target={{ ...target, alignmentAvailable: false }}
        selectedRange={undefined}
        edit={() => {}}
      />,
    );
    expect(html).toContain('<select aria-label="局部对齐方式" disabled=""');
    expect(html).toContain('aria-describedby="native-text-block-alignment-hint"');
    expect(html).toContain("这个文字框紧贴内容，可用缩进调整位置。");
    expect(html).toContain('<input aria-label="增加左侧缩进" type="number"');
    expect(html).not.toContain('<input aria-label="增加左侧缩进" disabled');
    expect(html).toContain('aria-label="段前间距"');
  });
  it("shows read-only original text, selection scope and template defaults without mutating data", () => {
    const document = createNativeResumeDocument();
    const before = structuredClone(document);
    const html = renderToStaticMarkup(
      <NativeTextBlockControls
        document={document}
        target={target}
        selectedRange={{ start: 2, end: 6 }}
        edit={() => {}}
      />,
    );
    expect(html).toContain('readOnly=""');
    expect(html).toContain("仅调整：");
    expect(html).toContain("用户调研");
    expect(html).toContain('value="default" selected=""');
    expect(html).toContain('placeholder="模板默认"');
    expect(html).toContain('aria-label="增大局部字号"');
    expect(document).toEqual(before);
  });

  it("deduplicates the block picker when an overflowing block spans two pages", () => {
    const html = renderToStaticMarkup(
      <NativeTextLayoutPanel
        document={createNativeResumeDocument()}
        targets={[target, { ...target, page: 2, y: 30 }]}
        selection={{ target }}
        edit={() => {}}
        select={() => {}}
        close={() => {}}
      />,
    );
    expect(html.match(/<option value="entry:fixture:description"/g)).toHaveLength(1);
  });

  it("presents stale formatting as unapplied and does not show its former size", () => {
    const document = createNativeResumeDocument();
    document.textLayout = { [target.targetId]: { sourceText: "旧正文", fontSize: 18 } };
    const html = renderToStaticMarkup(
      <NativeTextBlockControls
        document={document}
        target={target}
        selectedRange={undefined}
        edit={() => {}}
      />,
    );
    expect(html).toContain("旧局部格式暂未应用");
    expect(html).toContain('value="10"');
    expect(html).not.toContain('value="18"');
  });

  it("reads unified C font and line settings through the retained basic-field controls", () => {
    const document = createNativeResumeDocument();
    document.data.basics.email = "person@example.com";
    document.fieldLayout = { email: { fontSize: 10, position: "main" } };
    document.textLayout = {
      "basics:email": { sourceText: document.data.basics.email, fontSize: 24, lineMode: "single" },
    };
    const html = renderToStaticMarkup(
      <NativeBasicField
        document={document}
        field="email"
        label="邮箱"
        edit={() => {}}
        active
        open={() => {}}
      />,
    );
    expect(html).toContain('value="24"');
    expect(html).toContain('max="36"');
    expect(html).toContain('value="main" selected=""');
  });
});
