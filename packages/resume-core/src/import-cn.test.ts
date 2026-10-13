import { describe, expect, it } from "vitest";
import { importNativeChineseBlocks, nativeTextBlocks, parseNativeResumeDocument } from "./index.js";

describe("Chinese native import draft", () => {
  it("recognizes common Chinese section aliases and keeps their entries separate", () => {
    const result = importNativeChineseBlocks(nativeTextBlocks(
      "周乐\n手机：13900139001 邮箱：zhoule@example.com\n教育情况\n西南大学 硕士 新闻学 2023.09—2026.06\n实习经验\n山海文化有限公司 内容运营实习生 2025.03—2025.07\n• 策划三期专题。\n项目成果\n校园读书节 2024.09—2024.12\n• 组织现场活动。\n技能清单\nExcel：整理活动反馈。",
    ), "aliases");
    expect(result.document.data.sections.education.items[0]?.school).toBe("西南大学");
    expect(result.document.data.sections.experience.items[0]?.company).toBe("山海文化有限公司");
    expect(result.document.data.sections.projects.items[0]?.name).toContain("校园读书节");
    expect(result.document.data.sections.skills.items[0]?.name).toBe("Excel");
    expect(result.unclassifiedBlockIds).toHaveLength(0);
  });
  it("keeps an undated 项目成果 subheading with its existing experience", () => {
    for (const title of ["项目成果", "Ÿ 项目成果"]) {
      const result = importNativeChineseBlocks(nativeTextBlocks(
        `工作经历\n示例科技有限公司 2024.03—2024.08\n${title}\n• 交付访谈总结。`,
      ), "outcome-subheading");
      expect(result.document.data.sections.experience.items).toHaveLength(1);
      expect(result.document.data.sections.experience.items[0]?.description).toContain("交付访谈总结");
      expect(result.document.data.sections.projects.items).toHaveLength(0);
    }
  });
  it("recognizes numbered section headings without mistaking a prose mention for a heading", () => {
    const result = importNativeChineseBlocks(nativeTextBlocks(
      "一、教育背景\n示例大学 本科 2022.09—2026.06\n二、项目经历\n访谈项目 2024.09—2024.12\n• 项目成果是访谈报告。",
    ), "numbered");
    expect(result.document.data.sections.education.items).toHaveLength(1);
    expect(result.document.data.sections.projects.items).toHaveLength(1);
    expect(result.document.data.sections.projects.items[0]?.description).toContain("项目成果是访谈报告");
  });
  it("joins a Chinese skill soft-wrap using PDF geometry without inserting punctuation", () => {
    const blocks = nativeTextBlocks(
      "专业技能\nSQL：使用查询完成留存统\n计。\nPython：清理记录",
    ).map((block, index) => ({
      ...block,
      source: {
        kind: "pdf" as const,
        page: 1,
        column: 0,
        x: 50,
        y: 100 + index * 15,
        width: 120,
        height: 10,
        fontSize: 10,
      },
    }));
    const result = importNativeChineseBlocks(blocks, "wrapped-skill");
    expect(result.document.data.sections.skills.items[0]?.proficiency).toBe(
      "使用查询完成留存统计。",
    );
    expect(result.document.data.sections.skills.items).toHaveLength(2);
    const paragraphs = importNativeChineseBlocks(
      nativeTextBlocks("专业技能\nSQL：统计留存。\n参与数据整理"),
      "separate-paragraphs",
    );
    expect(paragraphs.document.data.sections.skills.items[0]?.proficiency).toBe(
      "统计留存。\n参与数据整理",
    );
    expect(paragraphs.reviewReasons).toContain("skill-entry-boundary");
  });
  it("preserves a display name in the contact header without interpreting arbitrary numbered lines as names", () => {
    for (const name of ["coco2026", "林同学12", "A. Chen-2"]) {
      const parsed = importNativeChineseBlocks(
        nativeTextBlocks(`${name}\n邮箱：person@example.com\n教育经历\n示例大学 本科`),
        "alias",
      );
      expect(parsed.document.data.basics.name).toBe(name);
      expect(parsed.parserVersion).toBe("native-cn-v9");
    }
    for (const label of ["2026 校园招聘", "求职简历12", "作品编号123"]) {
      const parsed = importNativeChineseBlocks(
        nativeTextBlocks(`${label}\n项目经历\n校园项目`),
        "not-name",
      );
      expect(parsed.document.data.basics.name).toBe("");
      expect(parsed.unclassifiedBlockIds.length).toBeGreaterThan(0);
    }
  });
  it("allows an explicit second project boundary without changing original source blocks", () => {
    const blocks = nativeTextBlocks(
      "项目经历\n校园研究项目\n完成访谈。\n另一项课堂作业\n整理课程报告。",
    );
    const before = structuredClone(blocks);
    expect(
      importNativeChineseBlocks(blocks, "auto").document.data.sections.projects.items,
    ).toHaveLength(1);
    const boundary = blocks[3];
    if (!boundary) throw new Error("missing fixture boundary");
    const corrected = importNativeChineseBlocks(blocks, "manual", {
      [boundary.id]: { section: "projects", startsEntry: true },
    });
    expect(corrected.document.data.sections.projects.items).toHaveLength(2);
    expect(corrected.document.data.sections.projects.items[1]?.description).toContain("课程报告");
    expect(blocks).toEqual(before);
    expect(new Set(corrected.mappings.map((value) => value.blockId)).size).toBe(blocks.length);
  });
  it("keeps practice detail with its skill while preserving a subsequent named tool", () => {
    const result = importNativeChineseBlocks(
      nativeTextBlocks("专业技能\nSQL：留存查询\n实践成果：校验 24 个查询。\nPython：清理记录"),
      "skills-detail",
    );
    expect(result.document.data.sections.skills.items).toHaveLength(2);
    expect(result.document.data.sections.skills.items[0]?.description).toContain("24 个查询");
    expect(result.document.data.sections.skills.items[1]?.name).toBe("Python");
  });
  it("preserves education, projects and bullets as complete entries rather than separate facts", () => {
    const blocks = nativeTextBlocks(`林知夏
电话：13800000000 邮箱：lin@example.com
教育经历
示例大学 本科 2023.09–2027.06
主修统计学、计算机基础。
项目经历
校园访谈项目 2025.10–2025.12
• 完成 18 次访谈。
• 汇总 6 类问题，形成报告。
专业技能
SQL：统计用户留存`);
    const result = importNativeChineseBlocks(blocks, "fixture");
    expect(result.document.data.basics.email).toBe("lin@example.com");
    expect(result.document.data.sections.education.items[0]?.school).toBe("示例大学");
    expect(result.document.data.sections.projects.items).toHaveLength(1);
    expect(result.document.data.sections.projects.items[0]?.description).toContain("18 次访谈");
    expect(result.document.data.sections.projects.items[0]?.description).toContain("<ul><li>");
    expect(result.document.data.sections.projects.items[0]?.description).not.toContain("•");
    expect(result.document.data.sections.projects.items[0]?.description).toContain("6 类问题");
    expect(result.document.data.sections.skills.items[0]?.proficiency).toBe("统计用户留存");
    expect(new Set(result.mappings.map((value) => value.blockId)).size).toBe(blocks.length);
    expect(parseNativeResumeDocument(result.document)).toEqual(result.document);
  });
  it("joins a date-and-role first header to its following school or company without merging later records", () => {
    const blocks = nativeTextBlocks(`教育经历
2023.09–2027.06  信息管理 (本科)
示例大学
主修统计学。
2027.09–2030.06  管理科学 (硕士)
第二示例大学
研究方向：人机协同。
工作经历
2026.03–2026.06  产品实习生 (上海)
示例科技
• 整理 18 次访谈。
2025.03–2025.06  运营实习生 (杭州)
第二示例公司
• 整理活动记录。`);
    const result = importNativeChineseBlocks(blocks, "date-first");
    expect(result.document.data.sections.education.items).toHaveLength(2);
    expect(result.document.data.sections.education.items[0]).toMatchObject({
      school: "示例大学",
      degree: "本科",
      area: "信息管理",
      period: "2023.09–2027.06",
    });
    expect(result.document.data.sections.education.items[1]).toMatchObject({
      school: "第二示例大学",
      degree: "硕士",
      period: "2027.09–2030.06",
    });
    expect(result.document.data.sections.experience.items).toHaveLength(2);
    expect(result.document.data.sections.experience.items[0]).toMatchObject({
      company: "示例科技",
      position: "产品实习生",
      location: "上海",
    });
    expect(result.document.data.sections.experience.items[1]).toMatchObject({
      company: "第二示例公司",
      position: "运营实习生",
      location: "杭州",
    });
    expect(new Set(result.mappings.map((value) => value.blockId)).size).toBe(blocks.length);
  });
  it("does not call a flattened unrecognized resume successfully structured", () => {
    const blocks = nativeTextBlocks(
      "这是一个没有标题分隔的长段落，教育背景示例大学、项目经历校园活动全部挤在一句话里。",
    );
    const result = importNativeChineseBlocks(blocks, "flat");
    expect(result.quality).toBe("unstructured");
    expect(result.document.data.sections.experience.items).toHaveLength(0);
    expect(result.unclassifiedBlockIds).toEqual([blocks[0]?.id]);
    const section = result.document.data.customSections[0];
    expect(section?.type).toBe("summary");
    if (section?.type === "summary")
      expect(section.items[0]?.content).toContain("教育背景示例大学");
  });
  it("separates noncorporate employers from roles in inline and date-first experience headers", () => {
    const blocks = nativeTextBlocks(`工作经历
江南律师事务所 法务实习生 2025.03—2025.06
• 核对合同条款。
青桥医院 数据分析实习生 2024.07—2024.09
• 清理门诊数据。
2023.08—2023.10 项目助理
北辰基金会
• 整理志愿者记录。`);
    const entries = importNativeChineseBlocks(blocks, "noncorporate").document.data.sections.experience.items;
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ company: "江南律师事务所", position: "法务实习生" });
    expect(entries[0]?.description).toContain("合同条款");
    expect(entries[1]).toMatchObject({ company: "青桥医院", position: "数据分析实习生" });
    expect(entries[1]?.description).toContain("门诊数据");
    expect(entries[2]).toMatchObject({ company: "北辰基金会", position: "项目助理" });
    expect(entries[2]?.description).toContain("志愿者记录");
  });
  it("recognizes role-first experience headers with a city before the employer", () => {
    const blocks = nativeTextBlocks(`工作经历
运营实习生（杭州） 星河科技 2025.05—2025.08
• 编排活动日历。
法务实习生 青木律师事务所 2024.06—2024.09
• 整理诉讼材料。`);
    const entries = importNativeChineseBlocks(blocks, "role-first").document.data.sections.experience.items;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ company: "星河科技", position: "运营实习生", location: "杭州" });
    expect(entries[0]?.description).toContain("活动日历");
    expect(entries[1]).toMatchObject({ company: "青木律师事务所", position: "法务实习生" });
    expect(entries[1]?.description).toContain("诉讼材料");
  });
});
