import { describe, expect, it } from "vitest";
import {
  applyNativeTemplate,
  createNativeResumeDocument,
  isNativeTextBoundary,
  joinNativeResumeDocument,
  parseNativeResumeDocument,
  recommendedNativeTemplateIds,
  setNativeTextRange,
  singlePageLayout,
  splitNativeResumeDocument,
} from "./index.js";

describe("local text presentation", () => {
  it("persists whole-block and selection formats outside facts across six templates", () => {
    const draft = createNativeResumeDocument();
    draft.data.basics.headline = "产品设计与用户研究";
    const content = splitNativeResumeDocument(draft).content;
    draft.textLayout = {
      "basics:headline": {
        sourceText: draft.data.basics.headline,
        fontSize: 12,
        lineMode: "manual",
        breakAfter: 5,
        textAlign: "left",
        inset: 2,
        spaceBefore: 1,
        spaceAfter: 3,
        ranges: [{ start: 5, end: 9, fontSize: 13.5 }],
      },
    };
    for (const id of recommendedNativeTemplateIds) {
      const applied = applyNativeTemplate(draft, id);
      expect(applied.textLayout).toEqual(draft.textLayout);
      const stored = splitNativeResumeDocument(applied);
      expect(stored.content).toEqual(content);
      expect(joinNativeResumeDocument(stored.content, stored.layout)).toEqual(applied);
      for (const level of [0, 1, 2])
        expect(singlePageLayout(applied, level).textLayout).toEqual(draft.textLayout);
    }
  });

  it("keeps old documents and existing C controls intact", () => {
    const old = createNativeResumeDocument();
    old.fieldLayout = { email: { position: "main", fontSize: 10.5 } };
    const stored = splitNativeResumeDocument(old);
    expect(stored.layout).not.toHaveProperty("textLayout");
    expect(joinNativeResumeDocument(stored.content, stored.layout)).toEqual(old);
  });

  it("overrides overlapping selections while retaining both unaffected sides", () => {
    const original = [{ start: 0, end: 12, fontSize: 11 }];
    expect(setNativeTextRange(original, { start: 3, end: 8, fontSize: 14 })).toEqual([
      { start: 0, end: 3, fontSize: 11 },
      { start: 3, end: 8, fontSize: 14 },
      { start: 8, end: 12, fontSize: 11 },
    ]);
    expect(original).toEqual([{ start: 0, end: 12, fontSize: 11 }]);
    expect(setNativeTextRange(original, { start: 12, end: 15, fontSize: 11 })).toEqual([
      { start: 0, end: 15, fontSize: 11 },
    ]);
  });

  it("rejects offsets inside Unicode graphemes", () => {
    const text = "A👩‍💻é中";
    expect(isNativeTextBoundary(text, 1)).toBe(true);
    expect(isNativeTextBoundary(text, 2)).toBe(false);
    expect(isNativeTextBoundary(text, 7)).toBe(false);
    expect(isNativeTextBoundary(text, 8)).toBe(true);
  });

  it.each([
    { sourceText: "完整文字", fontSize: 8 },
    { sourceText: "完整文字", fontSize: 10.2 },
    { sourceText: "完整文字", hidden: true },
    { sourceText: "完整文字", lineMode: "manual", breakAfter: 4 },
    { sourceText: "完整文字", lineMode: "manual" },
    { sourceText: "完整文字", ranges: [{ start: 1, end: 5, fontSize: 11 }] },
    { sourceText: "完整文字", ranges: [{ start: 2, end: 2, fontSize: 11 }] },
    {
      sourceText: "完整文字",
      ranges: [
        { start: 0, end: 3, fontSize: 11 },
        { start: 2, end: 4, fontSize: 12 },
      ],
    },
    { sourceText: "A👩‍💻B", ranges: [{ start: 1, end: 3, fontSize: 11 }] },
  ])("rejects invalid formatting without discarding text: %o", (layout) => {
    expect(() =>
      parseNativeResumeDocument({
        ...createNativeResumeDocument(),
        textLayout: { "basics:headline": layout },
      }),
    ).toThrow();
  });
});
