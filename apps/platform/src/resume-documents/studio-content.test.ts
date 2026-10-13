import { describe, expect, it } from "vitest";
import { resumeRichPlain } from "@aijob/contracts";
import { importStudioText } from "./studio-content.js";
describe("whole experience import", () => {
  it("keeps each internship's context and bullets in one dated record with contacts in basics", () => {
    const parsed = importStudioText(
      "张同学\n电话：13800138000 | 邮箱：fixture@example.test\n实习经历\n第一家公司 | 产品实习生\n2025.03 — 2025.06\n• 访谈学生并记录需求。\n• 汇总反馈形成报告。\n第二家公司 | 运营实习生 2025.07 — 2025.09\n参与活动，整理内容并复盘。\n第三家公司 | 研究助理\n2025.10 — 至今\n整理文献，尚未负责实验结果。",
    );
    expect(parsed.basics.phone).toBe("13800138000");
    expect(parsed.basics.email).toBe("fixture@example.test");
    expect(parsed.sections).toHaveLength(1);
    const entries = parsed.sections[0]!.entries;
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.title)).toEqual(["第一家公司", "第二家公司", "第三家公司"]);
    expect(entries[0]?.role).toBe("产品实习生");
    expect(resumeRichPlain(entries[0]!.body)).toContain("汇总反馈");
    expect(entries[2]?.endDate).toBe("至今");
    expect(resumeRichPlain(entries[2]!.body)).toContain("尚未负责");
  });
  it("reads two schools and explicit degree fields without merging them", () => {
    const c = importStudioText(
      "教育经历\n示例大学 | 本科 | 信息管理 2021.09 — 2025.06\n课程研究。\n研究大学\n2025.09 — 2028.06\n硕士 · 信息系统\n研究方法课程。",
    );
    expect(c.sections[0]?.entries.map((e) => [e.title, e.degree, e.major])).toEqual([
      ["示例大学", "本科", "信息管理"],
      ["研究大学", "硕士", "信息系统"],
    ]);
  });
  it("keeps uncertain undated narratives intact instead of inventing project boundaries or results", () => {
    const body =
      "起初不知道选什么方向。\n参与课程展示。\n负责在2025.03 — 2025.06收集资料。\n没有统计商业增长。";
    const c = importStudioText(`项目经历\n${body}`);
    expect(c.sections[0]?.entries).toHaveLength(1);
    expect(resumeRichPlain(c.sections[0]!.entries[0]!.body)).toBe(body);
  });
});
