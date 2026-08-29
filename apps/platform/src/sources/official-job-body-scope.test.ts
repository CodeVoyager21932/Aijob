import { describe, expect, it } from "vitest";
import { scopeOfficialDutyText } from "./official-job-body-scope.js";

/** 汇测（北森租户）真实岗位「实习-CEO助理(J14675)」的职责字段结构。 */
const huiceRealDutyField = [
  "【公司简介】",
  "1、 业务定位：专注ToB业务，以云计算SaaS模式，提供电商ERP、WMS等一体化智能零售解决方案。",
  "2、规模占优：成立于2011年，现有员工约3000人，累计覆盖超 70 万家电商企业。",
  "3、雄厚资金：累计融资超 4.52 亿美元，D 轮融资 3.12 亿美元。",
  "【职位亮点】",
  "1、超多机会：具有广阔发展空间，每年2次晋升机会。",
  "2、大平台稳：现金流充足，每月 10 号准时发薪，薪资从不迟到。",
  "",
  "【工作职责】",
  "1、协助创始人/CEO开展日常工作事务处理，参与各类经营会议；",
  "2、作为战略管培生项目重要培养成员，接受业务、产品、运营等职轮岗安排；",
  "3、完成CEO临时交办的其他工作任务。",
].join("\n");

describe("official job duty scope (ADR-0033 D1)", () => {
  it("drops company blurb and perks marketing that the employer put in the duty field", () => {
    const scoped = scopeOfficialDutyText(huiceRealDutyField);

    expect(scoped).not.toContain("公司简介");
    expect(scoped).not.toContain("融资");
    expect(scoped).not.toContain("职位亮点");
    expect(scoped).not.toContain("准时发薪");
    expect(scoped).toContain("协助创始人/CEO开展日常工作事务处理");
    expect(scoped).toContain("完成CEO临时交办的其他工作任务");
    expect(scoped.length).toBeLessThan(huiceRealDutyField.length);
  });

  it("stops at a following non-duty heading", () => {
    const scoped = scopeOfficialDutyText(
      ["【工作职责】", "1、负责数据看板搭建。", "【任职要求】", "1、本科及以上。"].join("\n"),
    );

    expect(scoped).toBe("1、负责数据看板搭建。");
  });

  it("accepts the common heading spellings", () => {
    for (const heading of [
      "【岗位职责】",
      "岗位职责：",
      "工作内容:",
      "一、主要工作内容",
      "（一）职位职责",
      "实习职责",
    ]) {
      expect(scopeOfficialDutyText(`${heading}\n负责需求分析。`), heading).toBe("负责需求分析。");
    }
  });

  it("returns the original text unchanged when no duty heading is present", () => {
    // 无法确定哪些行是职责，就不删——不猜测。
    const plain = "1、负责需求分析；\n2、输出竞品报告。";
    expect(scopeOfficialDutyText(plain)).toBe(plain);
  });

  it("never invents or rewrites content", () => {
    const scoped = scopeOfficialDutyText(huiceRealDutyField);
    for (const line of scoped.split("\n")) {
      expect(huiceRealDutyField).toContain(line);
    }
  });

  it("keeps the original text when the duty heading has no content under it", () => {
    const headingOnly = "【公司简介】\n我们是一家公司。\n【工作职责】";
    expect(scopeOfficialDutyText(headingOnly)).toBe(headingOnly);
  });

  it("handles empty and whitespace-only input without throwing", () => {
    expect(scopeOfficialDutyText("")).toBe("");
    expect(scopeOfficialDutyText("   \n  ")).toBe("");
  });
});
