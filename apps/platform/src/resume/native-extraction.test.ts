import { describe, expect, it } from "vitest";
import { createAtsResumeDocx } from "./export-docx.js";
import { extractNativeResumeBlocks, nativeDocxBlocks } from "./native-extraction.js";

describe("native structure extraction", () => {
  it("keeps table cells, paragraphs, nested lists and labeled links without duplicating bullets", () => {
    const result = nativeDocxBlocks({
      schemaVersion: "native-docx-extraction-v1",
      html: '<h2>教育经历</h2><table><tr><td><p>示例大学</p></td><td><p>2023–2027</p></td></tr></table><ul><li>完成研究<ul><li>独立设计实验</li></ul></li></ul><p><a href="https://example.com/paper">论文</a></p>',
      warnings: [],
    });
    expect(result.blocks.map((value) => value.text)).toEqual([
      "教育经历",
      "示例大学",
      "2023–2027",
      "完成研究",
      "独立设计实验",
      "论文",
      "论文: https://example.com/paper",
    ]);
    expect(result.blocks[2]?.source).toEqual({
      kind: "docx",
      path: "table:0/row:0/cell:1/paragraph:0",
    });
  });
  it("extracts an actual DOCX through the isolated child and keeps section boundaries", async () => {
    const buffer = await createAtsResumeDocx({
      title: "中文导入夹具",
      sections: [
        { id: "education", heading: "教育经历", paragraphs: ["示例大学 本科 2023.09–2027.06"] },
        { id: "projects", heading: "项目经历", paragraphs: ["完成 18 次用户访谈，保留需求记录。"] },
      ],
    });
    const result = await extractNativeResumeBlocks({ kind: "docx", buffer });
    expect(result.blocks.some((value) => value.text === "教育经历")).toBe(true);
    expect(result.blocks.some((value) => value.text.includes("18 次用户访谈"))).toBe(true);
    expect(new Set(result.blocks.map((value) => value.id)).size).toBe(result.blocks.length);
  }, 20000);
});
