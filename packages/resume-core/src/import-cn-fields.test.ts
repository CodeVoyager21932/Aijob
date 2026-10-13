import { describe, expect, it } from "vitest";
import { educationHeader, experienceHeader, projectMetadata } from "./import-cn-fields.js";

describe("explicit Chinese header metadata", () => {
  it("extracts explicit labels without turning narrative mentions into qualifications", () => {
    const education = {
      school: "示例大学",
      degree: "",
      area: "",
      grade: "",
      period: "",
      location: "",
    };
    expect(educationHeader("成绩：GPA 3.66/4，主修统计学与计算机基础。", education)).toBe(
      "主修统计学与计算机基础。",
    );
    expect(education.grade).toBe("GPA 3.66/4");
    const experience = { company: "示例企业", position: "", period: "", location: "" };
    expect(experienceHeader("职位：产品实习生", experience)).toBe("");
    expect(experience.position).toBe("产品实习生");
    const project = { role: "", unit: "", method: "" };
    expect(projectMetadata("角色：项目负责人，负责整理问卷。", project)).toBe("负责整理问卷。");
    expect(project.role).toBe("项目负责人");
    expect(projectMetadata("与项目负责人沟通，未负责开发。", project)).toBe(
      "与项目负责人沟通，未负责开发。",
    );
  });
  it("does not swallow an organization into a position when PDF spacing collapses", () => {
    const item = { company: "", position: "", period: "", location: "" };
    expect(experienceHeader("远山科技有限公司 产品实习生", item, true)).toBe("");
    expect(item.company).toBe("远山科技有限公司");
    expect(item.position).toBe("产品实习生");
  });
  it("separates degree, major, grade and dates while retaining unmatched text", () => {
    const item = { school: "示例大学", degree: "", area: "", grade: "", period: "", location: "" };
    const rest = educationHeader(
      "本科 · 信息管理 · GPA3.66 · 2023.09–2027.06 · 教育校区上海",
      item,
    );
    expect(item).toMatchObject({
      degree: "本科",
      area: "信息管理",
      grade: "GPA3.66",
      period: "2023.09–2027.06",
    });
    expect(rest).toContain("教育校区上海");
    expect(rest).not.toContain("2023.09");
    expect(educationHeader("校区：教育校区上海 • 2023.09–2027.06", item)).toBe("");
    expect(item.location).toBe("教育校区上海");
    expect(educationHeader("主修统计学、数据库与用户研究方法。", item)).toBe(
      "主修统计学、数据库与用户研究方法。",
    );
  });
  it("keeps company, position, city and period out of accomplishment paragraphs", () => {
    const item = { company: "", position: "", period: "", location: "" };
    expect(experienceHeader("产品实习生 (上海)  示例科技  2026.03–2026.06", item, true)).toBe("");
    expect(item).toEqual({
      company: "示例科技",
      position: "产品实习生",
      period: "2026.03–2026.06",
      location: "上海",
    });
    expect(experienceHeader("参与 2 轮测试，形成报告。", item)).toBe("参与 2 轮测试，形成报告。");
  });
});
