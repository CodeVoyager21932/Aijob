/** Synthetic Chinese material shared by reproducible output checks; no user data. */
import { createNativeResumeDocument, ensureNativeResearchSection, newNativeItem } from "../../packages/resume-core/dist/index.js";
export function nativeOutputFixture() {
const doc = createNativeResumeDocument();
doc.data.basics.name = "林知夏";
doc.data.basics.email = "lin@example.com";
doc.data.basics.headline = "产品实习生";
doc.data.sections.education.items.push({
  id: "education-1",
  hidden: false,
  school: "示例大学",
  degree: "本科",
  area: "信息管理",
  grade: "GPA3.66",
  location: "教育校区上海",
  period: "2023.09–2027.06",
  website: { url: "", label: "", inlineLink: false },
  description: "<p>主修统计学、数据库与用户研究方法。</p>",
});
doc.data.sections.experience.items.push({
  id: "experience-1",
  hidden: false,
  company: "示例科技",
  position: "产品实习生",
  location: "上海",
  period: "2026.03–2026.06",
  roles: [],
  website: { url: "", label: "", inlineLink: false },
  description:
    "<ul><li>整理 18 次用户访谈，归纳新用户首次使用过程中的问题。</li><li>与设计同学合作完成原型，参与 2 轮可用性测试。</li></ul>",
});
const project = newNativeItem("projects", "project-cn");
project.name = "校园访谈项目";
project.role="访谈与研究整理";
project.unit="校级研究小组";
project.method="半结构化访谈";
project.period = "2026.01–2026.02";
project.description = "<p>完成 12 次访谈，整理研究报告。</p>";
doc.data.sections.projects.items.push(project);
const unfinished = newNativeItem("projects", "unfinished");
unfinished.description="<p>尚未填写标题的真实项目正文。</p>";
doc.data.sections.projects.items.push(unfinished);
const paper = newNativeItem("publications", "paper-cn");
paper.title = "实验方法研究";
paper.authors="林知夏、陈同学";
paper.authorPosition="第二作者";
paper.status="已录用";
paper.publisher = "示例学报";
paper.date = "2026.07";
doc.data.sections.publications.items.push(paper);
const skill = newNativeItem("skills", "skill-cn");
skill.name = "SQL";
skill.proficiency = "完成留存统计";
doc.data.sections.skills.items.push(skill);
const certificate = newNativeItem("certifications", "certificate-cn");
certificate.title = "英语六级";
certificate.issuer = "全国大学英语考试";
certificate.date = "2025.06";
doc.data.sections.certifications.items.push(certificate);
const award = newNativeItem("awards", "award-cn");
award.title = "校级奖学金";
award.awarder = "示例大学";
award.date = "2025.12";
doc.data.sections.awards.items.push(award);
const research=ensureNativeResearchSection(doc.data,"research-section");
const researchItem=newNativeItem("projects","research-item");
researchItem.name="跨学科研究课题";researchItem.unit="自动化实验室";researchItem.role="实验设计";researchItem.method="对照实验";researchItem.description="<p>记录实验过程与结果。</p>";
research.items.push(researchItem);
return doc;
}
