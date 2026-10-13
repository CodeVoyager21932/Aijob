/** Synthetic Chinese fixtures only. Never persisted as a user's resume or experience. */
import { blankResumeEntry, blankResumeStudioContent, ResumeStudioContentSchema, resumeRichText, type ResumeSectionKind, type ResumeStudioContent, type ResumeStudioEntry } from './resume-studio.js';
import { RESUME_MODULE_NAMES } from './resume-modules.js';
/** Gallery fixture: one student, one internship, one project. Stress samples below
 * deliberately remain long and must never replace this default browsing example. */
export function resumeGallerySample(): ResumeStudioContent {
  let serial = 1;
  const id = () => `10000000-0000-4000-8000-${String(serial++).padStart(12, '0')}`;
  const content = blankResumeStudioContent();
  content.basics = { name: '林知夏', headline: '产品实习生', phone: '13800000000', email: 'lin.zhixia@example.com', city: '上海', links: [] };
  const add = (kind: ResumeSectionKind, entry: Partial<ResumeStudioEntry>) => content.sections.push({
    id: id(), kind, title: RESUME_MODULE_NAMES[kind], hidden: false, pageBreakBefore: false,
    column: ['skills', 'awards'].includes(kind) ? 'aside' : 'main', entries: [{ ...blankResumeEntry(id()), ...entry }],
  });
  add('education', { organization: '海川大学（示例）', degree: '本科', major: '信息管理与信息系统', startDate: '2023.09', endDate: '2027.06', body: resumeRichText('相关课程：统计学、数据库、用户研究与交互设计。') });
  add('internship', { organization: '知行科技（示例）', role: '产品实习生', startDate: '2026.06', endDate: '2026.08', body: resumeRichText('整理用户访谈，按任务归纳使用问题，形成调研记录。\n完成需求文档与原型，跟进评审意见和修改结果。') });
  add('project', { title: '校园学习空间调研', role: '调研与原型设计', startDate: '2025.10', endDate: '2025.12', body: resumeRichText('访谈同学，整理预约和找座位过程中反复出现的问题。\n制作预约提示原型，根据走查反馈调整信息顺序。') });
  add('skills', { title: 'SQL · Excel · Figma', body: resumeRichText('用于课程数据整理、分组汇总与交互原型制作。\n英语 CET-6，能够阅读专业文档。') });
  add('awards', { title: '课程创新项目优秀展示', endDate: '2025.12' });
  return ResumeStudioContentSchema.parse(content);
}
export function chineseResumeSample(size: 'short' | 'medium' | 'long'): ResumeStudioContent {
  let serial = 10;
  const id = () => `00000000-0000-4000-8000-${String(serial++).padStart(12, '0')}`;
  const content = blankResumeStudioContent();
  content.basics = { name: '林知夏', headline: size === 'long' ? '计算机科学 · 科研与算法方向' : '产品与用户研究 · 实习求职', phone: '13800000000', email: 'lin.zhixia@example.com', city: '上海', links: [{ label: '项目作品集', url: 'https://example.com/portfolio' }] };
  const add = (kind: ResumeSectionKind, entries: Partial<ResumeStudioEntry>[]) => content.sections.push({ id: id(), kind, title: RESUME_MODULE_NAMES[kind], hidden: false, pageBreakBefore: false, column: ['skills', 'languages', 'certificates', 'awards'].includes(kind) ? 'aside' : 'main', entries: entries.map((entry) => ({ ...blankResumeEntry(id()), ...entry })) });
  add('summary', [{ body: resumeRichText('关注真实使用场景中的问题，愿意从访谈、资料整理与原型验证开始，把发现的线索变成可以讨论和改进的方案。') }]);
  add('education', [{ organization: '海川大学（示例）', degree: '本科', major: '信息管理与信息系统', startDate: '2023.09', endDate: '2027.06', details: { gpa: '3.7 / 4.0', courses: '用户研究、数据库原理、统计学、交互设计' }, body: resumeRichText('在课程项目中完成访谈方案、数据整理与可用性观察记录。') }]);
  if (size !== 'short') {
    content.sections.find((s) => s.kind === 'education')!.entries.unshift({ ...blankResumeEntry(id()), organization: '海川大学（示例）', degree: '硕士', major: '计算机科学与技术', startDate: '2027.09', endDate: '2030.06', details: { researchFocus: '人机交互与可信机器学习' }, body: resumeRichText('参与跨学科研究讨论，整理方法比较和实验复现记录。') });
    add('internship', [
      { organization: '知行科技（示例）', role: '产品实习生', startDate: '2026.06', endDate: '2026.09', details: { department: '教育产品组' }, body: resumeRichText(`参与学习工具的使用调研，整理 12 份访谈记录，按用户任务归纳问题。
完成需求文档与低保真原型，记录评审意见和每次修改的依据。
配合设计和开发核对边界场景，维护问题清单并跟进验证结果。`) },
      { organization: '青芽公益（示例）', role: '内容与活动实习生', startDate: '2025.11', endDate: '2026.03', body: resumeRichText(`围绕新成员常见问题整理内容选题，编写活动说明与报名指引。
核对发布内容中的时间、链接和场地信息，汇总活动后的反馈。
将重复咨询归纳成常见问题文档，供团队持续更新使用。`) },
      { organization: '星河工作室（示例）', role: '数据整理实习生', startDate: '2025.07', endDate: '2025.09', body: resumeRichText(`使用 SQL 与 Excel 核对运营数据，补充字段释义和处理步骤。
在分析报告中区分样本事实和待验证的解释，记录数据缺失范围。`) },
    ]);
  }
  add('project', [{ title: '校园学习空间体验调研', role: '调研与方案整理', startDate: '2025.10', endDate: '2025.12', details: { background: '课程小组希望了解学生选择学习空间时遇到的问题。', url: 'https://example.com/projects/study-space' }, body: { type: 'doc', content: [{ type: 'bulletList', content: ['设计访谈提纲并完成 8 次同学访谈，保留原话与观察记录。', '按照找座位、预约和现场使用三个阶段归纳问题，区分个别偏好与反复出现的障碍。', '制作预约提示方案，邀请 5 位同学走查；根据反馈修改提示顺序，并记录仍需验证的问题。'].map((text) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) }] } }]);
  if (size !== 'short') content.sections.find((s) => s.kind === 'project')!.entries.push({ ...blankResumeEntry(id()), title: '课程资料检索与阅读辅助工具', role: '原型设计与前端实现', startDate: '2026.01', endDate: '2026.05', body: resumeRichText(`使用 TypeScript 与 React 实现课程资料的分类、检索和标注界面。
为弱网、空结果和键盘操作补充交互状态；用任务走查记录验证修改。
保留信息来源和版本，区分原始引用、个人理解与工具生成的建议。`) });
  add('skills', [{ title: 'SQL · Excel', details: { skillCategory: '数据与整理' }, body: resumeRichText('在课程调查中完成数据清洗、分组汇总及可复现的处理记录。') }, { title: 'Figma · TypeScript', details: { skillCategory: '原型与实现' }, body: resumeRichText('能制作交互原型，并实现常见列表、表单和状态反馈。') }]);
  add('languages', [{ title: '英语', details: { proficiency: 'CET-6 · 560 分' }, body: resumeRichText('能够阅读专业文档并整理中文摘要。') }]);
  add('awards', [{ title: '课程创新项目优秀展示', details: { issuer: '海川大学（示例）' }, endDate: '2025.12', body: resumeRichText('团队共同完成，本人负责调研和原型说明。') }]);
  if (size === 'long') {
    add('research', [{ title: '面向跨领域信息检索的可解释交互方法：从研究假设、实验设计到复现实证的全过程研究', organization: '海川大学人机交互实验室（示例）', role: '研究成员', startDate: '2027.10', endDate: '至今', details: { methods: '文献对比、原型实验与定性编码', results: '完成实验记录和阶段性研究报告，论文处于整理阶段。' }, body: resumeRichText(Array.from({ length: 12 }, (_, i) => `实验记录 ${i + 1}：围绕检索任务中的信息理解问题，核对输入材料、实验步骤与观察结果。区分参与者原话、研究者解释和仍需进一步检验的假设；针对不一致的记录回到原始资料复核。保留研究中未出现预期效果的部分，避免把探索过程写成已经证明的结论。`).join('\n')) }]);
    add('publications', Array.from({ length: 8 }, (_, i) => ({ title: `研究成果 ${i + 1}：面向复杂资料阅读与协作理解的交互设计方法及其应用场景分析 / Human-Centered Information Understanding`, endDate: String(2028 + i % 2), details: { authors: '林知夏，陈明，周雨（示例作者）', venue: '人机交互研究研讨会（合成测试）', publicationStatus: i % 2 ? '研究报告' : '整理中', url: `https://example.com/papers/${i + 1}` }, body: resumeRichText('负责资料整理、部分实验实现与图表检查；作者顺序及成果状态以正式材料为准。本条为模板测试用的合成内容。') })));
    add('certificates', [{ title: '科研数据管理课程结业', details: { issuer: '示例课程平台', proficiency: '完成课程' }, endDate: '2028.06', body: resumeRichText('课程主题包括数据字典、可复现记录与研究资料归档。') }]);
  }
  return ResumeStudioContentSchema.parse(content);
}
