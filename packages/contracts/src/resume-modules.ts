import { RESUME_TEMPLATE_BY_ID, RESUME_TEMPLATE_VERSION, RESUME_RENDERER_VERSION } from './resume-templates.js';
import { ResumeStudioLayoutSchema, resumeRichPlain, type ResumeSectionKind, type ResumeStudioEntry, type ResumeStudioLayout } from './resume-studio.js';
import { RESUME_PROFILE_BY_ID, STUDIO_V3_FONT_SET } from './resume-template-profiles.js';
export const RESUME_MODULE_NAMES: Record<ResumeSectionKind, string> = { education: '教育经历', internship: '实习 / 工作经历', project: '项目经历', research: '科研经历', publications: '论文与成果', activity: '校园与实践', skills: '技能与工具', languages: '语言能力', certificates: '证书', awards: '荣誉奖项', summary: '个人简介', custom: '自定义模块' };
export type ResumeEntryField = { key: keyof Pick<ResumeStudioEntry, 'title' | 'organization' | 'role' | 'location' | 'startDate' | 'endDate' | 'degree' | 'major'> | `details.${keyof NonNullable<ResumeStudioEntry['details']>}`; label: string; optional?: boolean; multiline?: boolean };
const dates: ResumeEntryField[] = [{ key: 'startDate', label: '开始时间' }, { key: 'endDate', label: '结束时间 / 至今' }];
export const RESUME_MODULE_FIELDS: Record<ResumeSectionKind, ResumeEntryField[]> = {
  education: [{ key: 'organization', label: '学校' }, { key: 'degree', label: '学历' }, { key: 'major', label: '专业' }, ...dates, { key: 'details.gpa', label: '成绩 / GPA', optional: true }, { key: 'details.courses', label: '相关课程', optional: true }, { key: 'details.researchFocus', label: '研究方向', optional: true }, { key: 'title', label: '补充标题', optional: true }, { key: 'role', label: '学习形式 / 备注', optional: true }, { key: 'location', label: '地点', optional: true }],
  internship: [{ key: 'organization', label: '企业 / 单位' }, { key: 'role', label: '职位' }, { key: 'details.department', label: '部门', optional: true }, ...dates, { key: 'location', label: '地点', optional: true }, { key: 'title', label: '补充标题', optional: true }, { key: 'details.results', label: '成果补充', optional: true, multiline: true }],
  project: [{ key: 'title', label: '项目名称' }, { key: 'role', label: '我的角色' }, ...dates, { key: 'details.background', label: '项目背景', optional: true, multiline: true }, { key: 'details.results', label: '产物与结果', optional: true, multiline: true }, { key: 'details.url', label: '项目链接', optional: true }],
  activity: [{ key: 'title', label: '活动 / 实践名称' }, { key: 'role', label: '我的角色' }, ...dates, { key: 'details.background', label: '背景', optional: true, multiline: true }, { key: 'details.results', label: '成果', optional: true, multiline: true }],
  research: [{ key: 'title', label: '课题名称' }, { key: 'organization', label: '研究单位' }, { key: 'role', label: '我的角色' }, ...dates, { key: 'details.methods', label: '研究方法', optional: true, multiline: true }, { key: 'details.results', label: '研究结果', optional: true, multiline: true }],
  publications: [{ key: 'title', label: '论文 / 成果标题' }, { key: 'details.authors', label: '作者及本人顺序' }, { key: 'details.venue', label: '刊物 / 会议' }, { key: 'endDate', label: '年份 / 时间' }, { key: 'details.publicationStatus', label: '发表状态' }, { key: 'details.url', label: '论文 / 成果链接' }],
  skills: [{ key: 'details.skillCategory', label: '技能分类' }, { key: 'title', label: '技能 / 工具' }],
  languages: [{ key: 'title', label: '语言' }, { key: 'details.proficiency', label: '水平 / 成绩' }, { key: 'endDate', label: '考试时间', optional: true }],
  certificates: [{ key: 'title', label: '证书名称' }, { key: 'details.issuer', label: '授予机构' }, { key: 'endDate', label: '获得时间' }, { key: 'details.proficiency', label: '等级 / 成绩', optional: true }],
  awards: [{ key: 'title', label: '奖项名称' }, { key: 'details.issuer', label: '授予单位' }, { key: 'endDate', label: '获奖时间' }, { key: 'details.proficiency', label: '级别', optional: true }],
  summary: [], custom: [{ key: 'title', label: '条目标题（可留空）' }, ...dates.map((d) => ({ ...d, optional: true }))],
};
export const RESUME_DETAIL_LABELS: Record<keyof NonNullable<ResumeStudioEntry['details']>, string> = { department: '部门', background: '背景', methods: '方法', results: '成果', gpa: '成绩', courses: '课程', researchFocus: '研究方向', authors: '作者', venue: '刊物 / 会议', publicationStatus: '状态', url: '链接', skillCategory: '类别', proficiency: '水平', issuer: '授予方' };
export function resumeEntryDetails(entry: ResumeStudioEntry) {
  return Object.entries(entry.details ?? {}).filter(([, value]) => value?.trim()).map(([key, value]) => ({ key, label: RESUME_DETAIL_LABELS[key as keyof NonNullable<ResumeStudioEntry['details']>], value: value! }));
}
export function resumeEntryHasContent(entry: ResumeStudioEntry) {
  return [entry.title, entry.organization, entry.role, entry.degree, entry.major, resumeRichPlain(entry.body), ...Object.values(entry.details ?? {})].some((v) => Boolean(v?.trim()));
}
export function resumeTemplateLayout(id: string): ResumeStudioLayout {
  const profile = RESUME_PROFILE_BY_ID.get(id);
  if (profile) return ResumeStudioLayoutSchema.parse({ ...profile.defaults, templateKey: id, templateVersion: RESUME_TEMPLATE_VERSION, rendererVersion: RESUME_RENDERER_VERSION, fontSetVersion: STUDIO_V3_FONT_SET });
  const t = RESUME_TEMPLATE_BY_ID.get(id);
  if (!t) return ResumeStudioLayoutSchema.parse({ templateKey: id });
  // Only defaults for a new application of a template. Saved layouts retain their
  // explicit metrics and the renderer definition/version is unchanged.
  const compact = ['jp_classic', 'jp_designer', 'jp_blocks'].includes(id);
  const insetCards = id === 'jp_designer' || id === 'jp_blocks';
  return ResumeStudioLayoutSchema.parse({ templateKey: id, templateVersion: t.version, rendererVersion: t.rendererVersion, fontFamily: t.font, fontSize: t.group === 'project' ? 10.5 : 11, lineHeight: compact ? 1.32 : t.group === 'research' ? 1.5 : 1.4, sectionGap: insetCards ? 7 : compact ? 9 : t.group === 'project' ? 10 : 12, margin: insetCards ? 13 : compact ? 15 : t.columns === 'single' ? 17 : 14, paragraphGap: compact ? 2 : 3, entryGap: compact ? 6 : 8, columnRatio: 0.31, photoVisible: true, accent: t.group === 'creative' ? 'navy' : 'ink' });
}
