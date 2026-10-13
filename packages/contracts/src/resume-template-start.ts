/** Empty editing structure and non-persistent writing guidance, never example facts. */
import { RESUME_TEMPLATE_BY_ID } from "./resume-templates.js";
import { RESUME_MODULE_NAMES, resumeEntryHasContent } from "./resume-modules.js";
import {
  blankResumeEntry,
  blankResumeStudioContent,
  type ResumeStudioContent,
  type ResumeSectionKind,
} from "./resume-studio.js";

export const RESUME_WRITING_HINTS: Record<ResumeSectionKind, string> = {
  education: "填写学校、专业和时间；课程或成绩只保留与申请有关的部分。",
  internship: "从你承担的工作写起，用 2–3 个要点说明行动、产物或结果。",
  project: "课程、个人作品和团队项目都可以。写清问题、你的行动，以及完成的产物。",
  research: "交代课题、方法与本人贡献；阶段性发现也可以写，不必等到发表。",
  publications: "填写题名、作者顺序、发表或进行中的状态及链接。",
  activity: "写清活动目标、你的分工，以及具体完成了什么。",
  skills: "列出确实使用过的工具或方法，用一句话说明使用场景。",
  languages: "填写语言及实际水平；考试成绩按需补充。",
  certificates: "填写证书名称和获得时间，选择与申请有关的证书。",
  awards: "填写奖项、授予单位和时间；团队奖项可以注明本人分工。",
  summary: "用 2–3 句话说明求职方向、相关经历和特点，避免堆砌形容词。",
  custom: "填写这个模块要展示的内容；标题和条目可以自由调整。",
};
export function resumeTemplateStarterKinds(templateId: string): ResumeSectionKind[] {
  const group = RESUME_TEMPLATE_BY_ID.get(templateId)?.group;
  if (group === "research") return ["education", "research", "publications", "skills"];
  if (group === "project" || templateId === "jp_designer")
    return ["education", "project", "internship", "skills"];
  return ["education", "internship", "project", "skills"];
}
export function resumeHasWrittenEntries(content: ResumeStudioContent) {
  return content.sections.some((s) => s.entries.some(resumeEntryHasContent));
}
/** The same candidate arrangement is used by the gallery and the apply action.
 * Explicit changes after applying a template stay on the saved content. */
export function resumeContentForTemplate(content: ResumeStudioContent, templateId: string): ResumeStudioContent {
  const two = RESUME_TEMPLATE_BY_ID.get(templateId)?.columns !== 'single';
  const side: string[] = ['certificates', 'awards', 'languages'];
  if (['rx_azurill','rx_ditgar','bre_cool'].includes(templateId)) side.push('skills');
  if (['bre_cool','bre_creative'].includes(templateId)) side.push('summary');
  return {...content,sections:content.sections.map(section=>({...section,column:two&&side.includes(section.kind)?'aside':'main'}))};
}
export function resumeTemplateStarter(templateId: string, id: () => string): ResumeStudioContent {
  const content = blankResumeStudioContent();
  content.sections = resumeTemplateStarterKinds(templateId).map((kind) => ({
    id: id(),
    kind,
    title: RESUME_MODULE_NAMES[kind],
    hidden: false,
    pageBreakBefore: false,
    column: kind === "skills" ? "aside" : "main",
    entries: [blankResumeEntry(id())],
  }));
  return content;
}
/** Supply missing empty modules only while the body is unwritten. Existing ids,
 * hidden flags, custom titles and order survive; no example prose is saved. */
export function prepareEmptyResumeForTemplate(
  content: ResumeStudioContent,
  templateId: string,
  id: () => string,
) {
  if (resumeHasWrittenEntries(content)) return content;
  const existing = new Set(content.sections.map((s) => s.kind));
  const starter = resumeTemplateStarter(templateId, id);
  return {
    ...content,
    sections: [...content.sections, ...starter.sections.filter((s) => !existing.has(s.kind))],
  };
}
