import { expect, it } from "vitest";
import { insertRunBreak, tailBreakOffset } from "./studio-text-balance.js";

it("moves a complete phrase to a short Chinese final line without editing the sentence", () => {
  const source = "完成实验记录与分析，整理数据并参与中文研究汇报。";
  const offset = tailBreakOffset(source, ["完成实验记录与分析，整理数据并参与中文研究", "汇报。"]);
  expect(offset).toBeDefined();
  expect(source.slice(offset)).toBe("中文研究汇报。");
});

it("respects intentional hard breaks and independent short fields", () => {
  expect(tailBreakOffset("完成材料整理。\n上海", ["完成材料整理。", "上海"])).toBeUndefined();
  expect(tailBreakOffset("上海", ["上海"])).toBeUndefined();
});

it("does not use whitespace-stripped offsets for mixed text and links", () => {
  const runs = [
    { content: "使用 Excel 与 ", style: { fontWeight: 700 } },
    {
      content: "中文研究材料完成汇报。",
      href: "https://example.com/work",
      style: { color: "blue" },
    },
  ];
  const source = runs.map((run) => run.content).join("");
  const offset = tailBreakOffset(source, ["使用 Excel 与 中文研究材料完成", "汇报。"]);
  expect(offset).toBeDefined();
  const balanced = insertRunBreak(runs, offset as number);
  expect(
    balanced
      .map((run) => run.content)
      .join("")
      .replace("\n", ""),
  ).toBe(source);
  expect(balanced[1]?.href).toBe(runs[1]?.href);
  expect(balanced[0]?.style).toEqual(runs[0]?.style);
  expect(balanced[1]?.style).toEqual(runs[1]?.style);
  expect(runs.some((run) => run.content.includes("\n"))).toBe(false);
});

it("leaves unmatched text and unbreakable URLs to the existing layout", () => {
  expect(tailBreakOffset("different source", ["unrelated", "尾。"])).toBeUndefined();
  const source = "https://example.com/abcdefghijklmnopqrstuvwxyz";
  expect(tailBreakOffset(source, [source.slice(0, -2), source.slice(-2)])).toBeUndefined();
});
