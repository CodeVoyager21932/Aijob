import { describe, expect, it } from "vitest";
import { nativePdfBlocks } from "./import-blocks.js";

const span = (str: string, x: number, y: number, width: number) => ({
  str,
  transform: [10, 0, 0, 10, x, 842 - y - 10],
  width,
  height: 10,
  fontRef: "fixture",
  hasEol: true,
});
function pdf(items: unknown[]) {
  return {
    schemaVersion: "native-pdf-extraction-v1",
    pages: [{ pageNumber: 1, width: 595, height: 842, rotation: 0, items, operators: null }],
    links: [],
  };
}
describe("PDF geometry to Chinese reading blocks", () => {
  it("separates a name and education sidebar when its headings do not align with the main column", () => {
    const result = nativePdfBlocks(
      pdf([
        span("林知夏", 18, 40, 66),
        span("实习与工作经历", 256, 40, 100),
        span("产品实习生", 18, 65, 70),
        span("示例科技", 256, 65, 50),
        span("lin@example.com", 18, 85, 110),
        span("产品实习生", 256, 85, 70),
        span("整理用户访谈。", 256, 108, 160),
        span("教育经历", 18, 145, 60),
        span("项目经历", 256, 145, 60),
        span("示例大学", 18, 167, 80),
        span("校园项目", 256, 178, 90),
        span("本科，信息管理", 18, 188, 150),
        span("完成研究报告。", 256, 208, 180),
      ]),
    );
    expect(result.blocks[0]?.text).toBe("林知夏");
    expect(result.blocks.find((b) => b.text === "教育经历")?.source).toMatchObject({ column: 0 });
    expect(result.blocks.find((b) => b.text === "实习与工作经历")?.source).toMatchObject({
      column: 1,
    });
    expect(result.blocks.some((b) => b.text.includes("林知夏") && b.text.includes("工作"))).toBe(
      false,
    );
  });
  it("reads a contact-only left sidebar before the main educational content", () => {
    const result = nativePdfBlocks(
      pdf([
        span("教育经历", 215, 30, 50),
        span("示例大学", 215, 50, 80),
        span("林知夏", 35, 60, 55),
        span("本科", 215, 60, 30),
        span("产品实习生", 35, 80, 70),
        span("主修统计学。", 215, 80, 100),
        span("lin@example.com", 35, 105, 110),
        span("工作经历", 215, 125, 50),
        span("示例企业", 215, 145, 100),
      ]),
    );
    expect(result.blocks[0]?.text).toBe("林知夏");
    expect(result.blocks.find((b) => b.text === "教育经历")?.source).toMatchObject({ column: 1 });
    expect(result.blocks.some((b) => b.text.includes("林知夏") && b.text.includes("本科"))).toBe(
      false,
    );
  });
  it("keeps a narrow contact sidebar separate from headed experience content", () => {
    const result = nativePdfBlocks(
      pdf([
        span("林知夏", 34, 30, 40),
        span("教育背景", 205, 30, 50),
        span("示例大学", 260, 48, 80),
        span("产品与用户研究方向", 34, 65, 158),
        span("本科，信息管理", 205, 68, 100),
        span("lin@example.com", 34, 90, 140),
        span("工作经历", 205, 120, 50),
        span("示例企业", 260, 138, 80),
        span("整理用户访谈。", 205, 160, 100),
        span("技能", 205, 190, 25),
        span("SQL", 205, 210, 25),
      ]),
    );
    expect(result.blocks[0]?.text).toBe("林知夏");
    expect(result.blocks.find((block) => block.text === "教育背景")?.source).toMatchObject({ column: 1 });
    expect(result.blocks.find((block) => block.text === "示例大学")?.source).toMatchObject({ column: 1 });
    expect(result.blocks.some((block) => block.text.includes("林知夏") && block.text.includes("教育"))).toBe(false);
  });
  it("preserves a centered narrow header above the left education column", () => {
    const result = nativePdfBlocks(
      pdf([
        span("林知夏", 260, 20, 60),
        span("lin@example.com", 220, 40, 120),
        span("教育经历", 35, 80, 55),
        span("实习经历", 215, 80, 55),
        span("示例大学", 35, 100, 100),
        span("示例企业", 215, 100, 200),
        span("课程说明", 35, 120, 100),
        span("工作说明", 215, 120, 200),
      ]),
    );
    expect(result.blocks.slice(0, 2).map((b) => b.text)).toEqual(["林知夏", "lin@example.com"]);
    expect(result.blocks.find((b) => b.text === "示例企业")?.source).toMatchObject({ column: 1 });
  });
  it("separates an index-style section title from an entry on the same baseline", () => {
    const result = nativePdfBlocks(
      pdf([
        span("林知夏", 260, 20, 60),
        span("lin@example.com", 220, 40, 120),
        span("教育经历", 35, 80, 60),
        span("示例大学", 220, 80, 90),
        span("信息管理", 220, 100, 90),
        span("2023.09–2027.06", 440, 100, 110),
        span("工作经历", 35, 140, 60),
        span("示例企业", 220, 140, 90),
      ]),
    );
    expect(result.blocks.slice(0, 4).map((b) => b.text)).toEqual([
      "林知夏",
      "lin@example.com",
      "教育经历",
      "示例大学",
    ]);
    expect(result.blocks.find((b) => b.text.includes("信息管理"))?.text).toContain("2023.09");
  });
  it("keeps a full-width contact header before independently reading two body columns", () => {
    const result = nativePdfBlocks(
      pdf([
        span("电话及邮箱联系方式", 35, 20, 360),
        span("技能", 35, 60, 25),
        span("教育经历", 215, 60, 50),
        span("SQL 查询", 35, 80, 75),
        span("示例大学 本科", 215, 80, 150),
        span("整理记录", 35, 100, 75),
        span("2023.09–2027.06", 215, 100, 100),
        span("项目经历", 215, 140, 50),
        span("校园研究", 215, 160, 100),
      ]),
    );
    expect(result.blocks[0]?.text).toBe("电话及邮箱联系方式");
    expect(result.blocks.filter((b) => b.text.includes("电话"))).toHaveLength(1);
    expect(
      result.blocks.some(
        (b) => b.text === "教育经历" && b.source.kind === "pdf" && b.source.column === 1,
      ),
    ).toBe(true);
    expect(result.blocks.some((b) => b.text.includes("SQL") && b.text.includes("大学"))).toBe(
      false,
    );
  });
  it("reads a sparse sidebar independently without merging equal-height section headings", () => {
    const items = [
      span("技能与工具", 36, 40, 60),
      span("SQL", 36, 60, 25),
      span("查询统计", 36, 80, 40),
      span("资格证书", 36, 120, 50),
      span("英语六级", 36, 140, 50),
      span("教育经历", 215, 40, 50),
      ...Array.from({ length: 30 }, (_, i) => span(`主栏第${i}行`, 215, 60 + i * 18, 180)),
    ];
    const result = nativePdfBlocks(pdf(items));
    expect(result.blocks.some((b) => b.text === "技能与工具")).toBe(true);
    expect(result.blocks.some((b) => b.text === "教育经历")).toBe(true);
    expect(result.blocks.some((b) => b.text.includes("SQL") && b.text.includes("主栏"))).toBe(
      false,
    );
    const headings = result.blocks.filter((b) => b.text.includes("经历"));
    expect(headings[0]?.source).toMatchObject({ column: 1 });
  });
  it("keeps dates attached to their single-column entry rather than treating them as a sidebar", () => {
    const items = [
      span("林知夏", 35, 5, 60),
      span("lin@example.com", 435, 5, 120),
      span("教育经历", 35, 30, 50),
      ...Array.from({ length: 12 }, (_, i) => [
        span(`示例学校${i}`, 35, 50 + i * 30, 100),
        span("2023.09–2027.06", 450, 50 + i * 30, 110),
      ]).flat(),
    ];
    const result = nativePdfBlocks(pdf(items));
    expect(
      result.blocks.filter((b) => b.text.includes("学校")).every((b) => b.text.includes("2023.09")),
    ).toBe(true);
  });
});
