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

/** Original fictional student example. Never persisted or merged into a personal resume. */
export function campusGallerySample() {
  const document = createNativeResumeDocument();
  const { data } = document;
  Object.assign(data.basics, {
    name: "林知夏",
    headline: "市场营销 · 品牌与用户运营方向",
    email: "zhixia.lin@example.com",
    phone: "138 0000 0000",
    location: "上海",
  });
  data.summary.title = "个人简介";
  data.summary.content =
    "<p>市场营销专业在校生，关注品牌内容与用户沟通。通过实习、课程调研和校园活动积累内容策划、数据整理及跨团队协作经验，希望在实践中持续理解用户需求。</p>";
  data.sections.education.items = [
    {
      ...newNativeItem("education", "campus-education"),
      school: "海川大学（示例）",
      degree: "本科",
      area: "市场营销",
      period: "2023.09 - 2027.06",
      grade: "3.7 / 4.0",
      location: "上海",
      description: "<p>主修消费者行为学、市场调研、品牌管理与统计学；获校级学业奖学金。</p>",
    },
  ];
  data.sections.experience.title = "实习经历";
  data.sections.experience.items = [
    {
      ...newNativeItem("experience", "campus-internship"),
      company: "青禾生活品牌工作室（示例）",
      position: "内容运营实习生",
      period: "2026.06 - 2026.09",
      location: "上海",
      description:
        "<ul><li>围绕新品与用户常见问题整理选题，参与完成 12 篇图文内容，维护素材及发布排期。</li><li>每周汇总阅读、收藏与留言，分类记录用户反馈，为下一轮内容讨论提供依据。</li><li>协助执行线下体验活动，跟进报名、现场物料与回访问卷，整理活动复盘记录。</li></ul>",
    },
  ];
  data.sections.projects.items = [
    {
      ...newNativeItem("projects", "campus-project"),
      name: "校园轻食消费调研",
      role: "课程项目负责人",
      unit: "五人课程小组",
      period: "2025.10 - 2025.12",
      description:
        "<ul><li>围绕购买场景、价格和口味设计问卷，回收 126 份有效答卷，并完成 8 次同学访谈。</li><li>使用 Excel 交叉整理不同年级的选择差异，形成用户需求摘要与图表。</li><li>组织组内分工和进度讨论，完成调研报告及汇报，将结论转化为门店活动建议。</li></ul>",
    },
  ];
  data.sections.volunteer.title = "校园与组织经历";
  data.sections.volunteer.items = [
    {
      ...newNativeItem("volunteer", "campus-organization"),
      organization: "校青年志愿者协会 · 宣传组",
      period: "2024.09 - 2025.06",
      location: "上海",
      description:
        "<ul><li>参与迎新与社区阅读活动的宣传，协调摄影、文案和海报交付，维护统一资料目录。</li><li>为新成员整理活动通知模板和现场检查表，协助完成两次志愿者培训。</li></ul>",
    },
  ];
  data.sections.skills.title = "技能与证书";
  data.sections.skills.items = [
    {
      ...newNativeItem("skills", "campus-skill-office"),
      name: "办公与分析",
      proficiency: "Excel 数据整理、透视表与常用图表；PowerPoint 报告排版",
    },
    {
      ...newNativeItem("skills", "campus-skill-content"),
      name: "内容与协作",
      proficiency: "图文选题与文案整理、Canva 基础排版、访谈纪要与活动复盘",
    },
    {
      ...newNativeItem("skills", "campus-skill-language"),
      name: "语言与证书",
      proficiency: "大学英语六级；普通话二级甲等",
    },
  ];
  data.metadata.layout.pages = [
    {
      fullWidth: true,
      main: ["summary", "education", "experience", "projects", "volunteer", "skills"],
      sidebar: [],
    },
  ];
  return document;
}

/** A fuller fictional specimen shared by the five structurally distinct Chinese layouts. */
export function batchGallerySample() {
  const document = campusGallerySample();
  document.data.sections.experience.items.push({
    ...newNativeItem("experience", "batch-community-intern"),
    company: "澄川文化生活馆（示例）",
    position: "活动与社群助理",
    period: "2025.07 - 2025.09",
    location: "上海",
    description:
      "<ul><li>参与周末阅读会与新客体验活动，整理报名信息、准备活动物料并核对现场分工，协助完成从报名到回访的执行流程。</li><li>维护社群问题清单和活动日历，将重复咨询整理为回复指引；根据参与者反馈调整通知时间与信息顺序。</li><li>汇总活动报名、到场及回访问卷，按周制作复盘简报，记录执行问题、责任分工和下一次活动的改进事项。</li></ul>",
  });
  return document;
}
