import { describe, expect, it } from "vitest";
import { importNativeChineseBlocks, nativeTextBlocks } from "./index.js";

describe("Chinese research and credential metadata", () => {
  it("keeps authorship, venue and publication status in their own fields", () => {
    const input = nativeTextBlocks(
      "林知夏\n论文与成果\n论文题目：人机协同任务研究\n作者：林知夏、王同学\n本人署名顺序：第二作者\n期刊：示例学报\n发表状态：已录用\n发表时间：2026.08\n尚未正式刊出，未填写影响因子。",
    );
    const result = importNativeChineseBlocks(input, "papers");
    expect(result.document.data.sections.publications.items).toHaveLength(1);
    expect(result.document.data.sections.publications.items[0]).toMatchObject({
      title: "人机协同任务研究",
      authors: "林知夏、王同学",
      authorPosition: "第二作者",
      publisher: "示例学报",
      status: "已录用",
      date: "2026.08",
    });
    expect(result.document.data.sections.publications.items[0]?.description).toContain(
      "未填写影响因子",
    );
    expect(new Set(result.mappings.map((item) => item.blockId)).size).toBe(input.length);
  });
  it("separates consecutive dated certificates without inventing issuers", () => {
    const result = importNativeChineseBlocks(
      nativeTextBlocks(
        "林知夏\n资格证书\n大学英语六级 2025.06\n计算机二级 2024.09\n颁发机构：示例考试中心",
      ),
      "certs",
    );
    expect(result.document.data.sections.certifications.items).toHaveLength(2);
    expect(result.document.data.sections.certifications.items[0]).toMatchObject({
      title: "大学英语六级",
      date: "2025.06",
      issuer: "",
    });
    expect(result.document.data.sections.certifications.items[1]).toMatchObject({
      title: "计算机二级",
      date: "2024.09",
      issuer: "示例考试中心",
    });
  });
  it("keeps an actual exam score without interpreting it as a proficiency rating", () => {
    const result = importNativeChineseBlocks(
      nativeTextBlocks(
        "林知夏\n语言能力\n英语 CET-6 520 分\n日语 JLPT N2\n使用说明：能够阅读实验文献，未承担口译。",
      ),
      "languages",
    );
    expect(result.document.data.sections.languages.items).toHaveLength(2);
    expect(result.document.data.sections.languages.items[0]).toMatchObject({
      language: "英语",
      fluency: "CET-6 520 分",
      level: 0,
    });
    expect(result.document.data.sections.languages.items[1]?.description).toContain("未承担口译");
  });
});
