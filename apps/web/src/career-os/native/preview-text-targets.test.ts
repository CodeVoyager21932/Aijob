import { describe, expect, it } from "vitest";
import {
  type NativeTextTarget,
  nativeTextAtPoint,
  nativeTextSelectionFromRects,
  nativeTextTargets,
} from "./preview-text-targets";

const target: NativeTextTarget = {
  kind: "text",
  id: "entry:1:body",
  targetId: "entry:1:body",
  text: "用户调研与用户访谈，完成报告",
  label: "项目正文",
  defaultFontSize: 10,
  page: 1,
  x: 30,
  y: 100,
  width: 300,
  height: 32,
  lineBoxes: [
    { x: 30, y: 100, width: 80, height: 12, start: 0, end: 5 },
    { x: 30, y: 120, width: 200, height: 12, start: 5, end: 14 },
  ],
};

describe("measured PDF text selection", () => {
  it("targets actual lines rather than blank gaps within the block bounds", () => {
    expect(nativeTextAtPoint([target], 40, 106)?.targetId).toBe(target.targetId);
    expect(nativeTextAtPoint([target], 200, 106)).toBeUndefined();
    expect(nativeTextTargets([target, { id: "old-entry", page: 1, x: 4, y: 5 }])).toEqual([target]);
  });

  it("uses original offsets for repeated words when their measured lines disambiguate them", () => {
    expect(
      nativeTextSelectionFromRects([target], "用户", [{ x: 30, y: 120, width: 24, height: 12 }])
        ?.range,
    ).toEqual({ start: 5, end: 7 });
    const noLines = { ...target, lineBoxes: undefined } as unknown as NativeTextTarget;
    expect(
      nativeTextSelectionFromRects([noLines], "用户", [{ x: 30, y: 120, width: 24, height: 12 }]),
    ).toBeUndefined();
  });

  it("matches PDF whitespace without inserting or removing source characters", () => {
    expect(
      nativeTextSelectionFromRects([target], "用户 调研与\n用户访谈", [
        { x: 30, y: 100, width: 70, height: 12 },
        { x: 30, y: 120, width: 70, height: 12 },
      ])?.range,
    ).toEqual({ start: 0, end: 9 });
  });

  it("rejects cross-block selections and unmatched or ambiguous text", () => {
    const other = {
      ...target,
      id: "entry:2:body",
      targetId: "entry:2:body",
      text: "第二段",
      y: 160,
      height: 12,
      lineBoxes: [{ x: 30, y: 160, width: 80, height: 12, start: 0, end: 3 }],
    };
    expect(
      nativeTextSelectionFromRects([target, other], "报告第二段", [
        { x: 30, y: 120, width: 100, height: 12 },
        { x: 30, y: 160, width: 80, height: 12 },
      ]),
    ).toBeUndefined();
    expect(
      nativeTextSelectionFromRects([target], "不存在", [{ x: 30, y: 100, width: 30, height: 12 }]),
    ).toBeUndefined();
    expect(
      nativeTextSelectionFromRects([target, { ...target, id: "ambiguous" }], "用户调研", [
        { x: 30, y: 100, width: 30, height: 12 },
      ]),
    ).toBeUndefined();
  });
});
