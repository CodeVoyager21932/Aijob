import { createNativeResumeDocument, newNativeItem } from "@aijob/resume-core";

/** Synthetic gallery content only. Applying a template passes its ID, never this data. */
export function nativeGallerySample() {
  const document = createNativeResumeDocument(),
    data = document.data;
  Object.assign(data.basics, {
    name: "林知夏",
    headline: "产品实习生",
    email: "lin@example.com",
    phone: "13800000000",
    location: "上海",
  });
  data.sections.education.items.push({
    id: "sample-education",
    hidden: false,
    school: "示例大学",
    degree: "本科",
    area: "信息管理",
    period: "2023.09–2027.06",
    grade: "GPA 3.6/4.0",
    location: "上海",
    website: { url: "", label: "", inlineLink: false },
    description: "<p>主修用户研究、统计学与信息系统设计。</p>",
  });
  data.sections.experience.items.push({
    id: "sample-intern",
    hidden: false,
    company: "示例科技团队",
    position: "产品实习生",
    period: "2026.03–2026.06",
    location: "上海",
    website: { url: "", label: "", inlineLink: false },
    roles: [],
    description:
      "<ul><li>整理 18 次用户访谈，归纳使用流程中的主要问题。</li><li>绘制需求流程和交互原型，参与两轮体验走查。</li><li>跟进问题修复，完成可供团队复用的验收记录。</li></ul>",
  });
  const project = newNativeItem("projects", "sample-project");
  Object.assign(project, {
    name: "校园活动报名优化",
    role: "需求整理与原型设计",
    period: "2025.10–2025.12",
    description:
      "<ul><li>梳理报名与通知流程，归纳学生和组织者的使用需求。</li><li>完成表单原型和操作说明，通过同学试用调整字段顺序。</li></ul>",
  });
  data.sections.projects.items.push(project);
  const skill = newNativeItem("skills", "sample-skills");
  Object.assign(skill, { name: "工具与方法", proficiency: "Figma、Excel、访谈记录与需求整理" });
  data.sections.skills.items.push(skill);
  const language = newNativeItem("languages", "sample-language");
  Object.assign(language, { language: "英语", fluency: "CET-6，可阅读专业资料" });
  data.sections.languages.items.push(language);
  return document;
}
