import { describe, expect, it } from "vitest";
import { joinNativePeriodContinuations } from "./import-period-continuation.js";
import { importNativeChineseBlocks, type NativeImportBlock } from "./index.js";

function pdf(id: string, text: string, y: number, column = 0): NativeImportBlock {
  return {
    id,
    text,
    kind: "line",
    source: { kind: "pdf", page: 1, column, x: 30, y, width: 260, height: 10, fontSize: 10 },
  };
}
describe("wrapped PDF date ranges", () => {
  it("recovers adjacent wrapped ranges as separate dated entries and retains every source binding", () => {
    const blocks = [
      pdf("h", "项目经历", 100),
      pdf("a", "校园调研 项目负责人（2024.03", 120),
      pdf("b", "- 2024.06）", 133),
      pdf("c", "完成访谈。", 146),
      pdf("d", "第二项目 项目成员（2025.01", 170),
      pdf("e", "- 2025.03）", 183),
      pdf("f", "人工记录尚未上线。", 196),
    ];
    const original = structuredClone(blocks);
    const result = importNativeChineseBlocks(blocks, "fixture");
    expect(result.document.data.sections.projects.items).toHaveLength(2);
    expect(result.document.data.sections.projects.items.map((item) => item.period)).toEqual([
      "2024.03 - 2024.06",
      "2025.01 - 2025.03",
    ]);
    expect(result.document.data.sections.projects.items[1]?.description).toContain("尚未上线");
    expect(result.mappings.find((binding) => binding.blockId === "b")).toMatchObject({
      sectionId: "projects",
      field: "period",
      itemId: "fixture:a",
    });
    expect(new Set(result.mappings.map((binding) => binding.blockId)).size).toBe(blocks.length);
    expect(blocks).toEqual(original);
  });
  it("does not join across columns, distant paragraphs or an explicit user boundary", () => {
    const start = pdf("a", "项目 2024.03", 120);
    expect(
      joinNativePeriodContinuations([start, pdf("b", "- 2024.06", 133, 1)]).blocks,
    ).toHaveLength(2);
    expect(joinNativePeriodContinuations([start, pdf("b", "- 2024.06", 180)]).blocks).toHaveLength(
      2,
    );
    expect(
      joinNativePeriodContinuations([start, pdf("b", "- 2024.06", 133)], new Set(["b"])).blocks,
    ).toHaveLength(2);
    expect(
      joinNativePeriodContinuations([start, pdf("b", "- 2024.06 另一个条目", 133)]).blocks,
    ).toHaveLength(2);
  });
});
