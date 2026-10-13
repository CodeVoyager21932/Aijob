/** Source-specific document contracts. Metrics are points / millimetres, never UI pixels.
 * Source snapshots and adaptation notes: docs/evidence/resume-studio-quality-2026-09-10.
 */
import type { ResumeStudioLayout } from './resume-studio.js';

export const STUDIO_V3_VERSION = '2026-09-10.1';
export const STUDIO_V3_FONT_SET = 'cjk-2026-09-10.1';
export type ResumeTemplateProfile = {
  id: string;
  name: string;
  group: 'formal' | 'modern' | 'project' | 'columns' | 'research' | 'creative';
  upstream: string;
  sourceKey: string;
  header: 'center' | 'left' | 'sidebar' | 'split' | 'band' | 'classic-group' | 'adaptive-photo' | 'photo-left' | 'stacked-center' | 'split-band' | 'contact-labels' | 'offset-band' | 'main-title' | 'intro-band' | 'cool-band' | 'oblique';
  section: 'rule' | 'partial-line' | 'plain' | 'overline' | 'center-rule' | 'square-rule' | 'rail' | 'boxed' | 'numbered' | 'ribbon' | 'triangle' | 'geometric';
  entry: 'right' | 'date-location' | 'stack' | 'role-inline' | 'date-gutter' | 'inline-three' | 'dual-meta' | 'education-grid' | 'timeline' | 'role-stack';
  columns: 'single' | 'left' | 'right';
  featuredSummary: boolean;
  defaults: Omit<ResumeStudioLayout, 'templateKey'>;
};

// Only source-inspected adapters belong here. New adapters are added with their own
// regional structure and measured defaults, never a colour-only copy of another ID.
const ANCHOR_PROFILES: ResumeTemplateProfile[] = [
  {
    id: 'lapis_cn', name: 'LapisCV · 中文单栏', group: 'formal', upstream: 'lapiscv', sourceKey: 'classic',
    header: 'center', section: 'rule', entry: 'right', columns: 'single', featuredSummary: false,
    defaults: {
      fontFamily: 'sans', fontSize: 10, lineHeight: 1.8, sectionGap: 7, entryGap: 4, paragraphGap: 0,
      margin: 15, columns: 'auto', accent: 'navy', colorHex: '#4870ac', keepEntriesTogether: true,
      photoVisible: true, autoColumns: true, columnRatio: .31,
      typography: { namePt: 16, headingPt: 12, entryPt: 10.5, contactPt: 9.5, datePt: 10, headingFamily: 'sans' },
      regions: { marginYmm: 13, gapMm: 6, sidebarPaddingMm: 0 },
    },
  },
  {
    id: 'rx_gengar', name: 'Gengar · 侧栏与摘要', group: 'creative', upstream: 'reactive', sourceKey: 'gengar',
    header: 'sidebar', section: 'rule', entry: 'right', columns: 'left', featuredSummary: true,
    defaults: {
      fontFamily: 'sans', fontSize: 10, lineHeight: 1.5, sectionGap: 12, entryGap: 8, paragraphGap: 3,
      margin: 10, columns: 'auto', accent: 'navy', colorHex: '#285575', keepEntriesTogether: true,
      photoVisible: true, autoColumns: true, columnRatio: .32,
      typography: { namePt: 21, headingPt: 12.6, entryPt: 10, contactPt: 9, datePt: 9, headingFamily: 'sans' },
      regions: { marginYmm: 10, gapMm: 7, sidebarPaddingMm: 5 },
    },
  },
  {
    id: 'rendercv_classic', name: 'RenderCV · 学术经典', group: 'research', upstream: 'rendercv', sourceKey: 'classic',
    header: 'center', section: 'partial-line', entry: 'date-location', columns: 'single', featuredSummary: false,
    defaults: {
      fontFamily: 'sans', fontSize: 10, lineHeight: 1.6, sectionGap: 10, entryGap: 8, paragraphGap: 3,
      margin: 16, columns: 'auto', accent: 'navy', colorHex: '#004f90', keepEntriesTogether: true,
      photoVisible: true, autoColumns: true, columnRatio: .31,
      typography: { namePt: 30, headingPt: 14, entryPt: 10, contactPt: 10, datePt: 10, headingFamily: 'sans' },
      regions: { marginYmm: 14, gapMm: 6, sidebarPaddingMm: 0 },
    },
  },
];
/** Each metric set is an adapter choice from the pinned source, not a universal
 * theme. Shared defaults only express the unchanged storage contract. */
function profile(input: Omit<ResumeTemplateProfile, 'defaults' | 'featuredSummary'> & {
  metrics: [number, number, number, number, number, number, number];
  roles: [number, number, number, number, number]; color: string;
  font?: 'sans' | 'serif';
  sidebarPad?: number;
}): ResumeTemplateProfile {
  const {metrics:m,roles:r,color,font='sans',sidebarPad=0,...identity}=input;
  return {...identity,featuredSummary:false,defaults:{
    fontFamily:font,fontSize:m[0],lineHeight:m[1],sectionGap:m[2],entryGap:m[3],paragraphGap:m[4],margin:m[5],
    columns:'auto',accent:'ink',colorHex:color,keepEntriesTogether:true,photoVisible:true,autoColumns:true,columnRatio:.31,
    typography:{namePt:r[0],headingPt:r[1],entryPt:r[2],contactPt:r[3],datePt:r[4],headingFamily:font},
    regions:{marginYmm:m[6],gapMm:6,sidebarPaddingMm:sidebarPad},
  }};
}
const SOURCE_INSPECTED_BATCH_10: ResumeTemplateProfile[] = [
  profile({id:'jp_classic',name:'Classic · 居中经典',group:'formal',upstream:'jobpilot',sourceKey:'classic',header:'classic-group',section:'rule',entry:'role-inline',columns:'single',metrics:[10.5,1.5,15,9,3,15,15],roles:[18,10.5,10.5,9,9],color:'#27272a'}),
  profile({id:'jp_ats',name:'ATS · 清晰正文',group:'formal',upstream:'jobpilot',sourceKey:'ats',header:'adaptive-photo',section:'rule',entry:'role-inline',columns:'single',metrics:[10.5,1.5,12,9,2,15,15],roles:[18,12,10.5,9,10],color:'#111111'}),
  profile({id:'jp_swiss',name:'Swiss · 日期网格',group:'project',upstream:'jobpilot',sourceKey:'swiss',header:'classic-group',section:'square-rule',entry:'date-gutter',columns:'single',metrics:[10.5,1.5,15,10,2,15,15],roles:[22.5,10,10.5,9,9],color:'#dc2626'}),
  profile({id:'rx_onyx',name:'Onyx · 左对齐素雅',group:'formal',upstream:'reactive',sourceKey:'onyx',header:'photo-left',section:'plain',entry:'right',columns:'single',metrics:[10,1.5,12,8,3,14,14],roles:[19.5,13,10,9,9],color:'#272b30'}),
  profile({id:'rx_scizor',name:'Scizor · 顶线与分区',group:'formal',upstream:'reactive',sourceKey:'scizor',header:'left',section:'overline',entry:'right',columns:'single',metrics:[10,1.5,12,8,3,14,14],roles:[24,11.7,10,9,9],color:'#344956'}),
  profile({id:'rx_meowth',name:'Meowth · 三列条目',group:'modern',upstream:'reactive',sourceKey:'meowth',header:'left',section:'rule',entry:'inline-three',columns:'single',metrics:[10,1.5,12,8,3,14,14],roles:[19.5,13,10,9,9],color:'#8a453c'}),
  profile({id:'rx_kakuna',name:'Kakuna · 居中层级',group:'modern',upstream:'reactive',sourceKey:'kakuna',header:'stacked-center',section:'center-rule',entry:'right',columns:'single',metrics:[10,1.5,12,8,3,14,14],roles:[19.5,13,10,9,9],color:'#373b43'}),
];
const SOURCE_INSPECTED_BATCH_20: ResumeTemplateProfile[] = [
  profile({id:'magic_cn_formal_photo',name:'中文正装照 · 双侧信息',group:'formal',upstream:'magic',sourceKey:'cn-formal-photo',header:'center',section:'rule',entry:'dual-meta',columns:'single',metrics:[10,1.45,9,6,2,12,12],roles:[16.5,11.25,10,9.75,9.75],color:'#1d4ed8'}),
  profile({id:'magic_clean_minimal',name:'Clean Minimal · 模块网格',group:'modern',upstream:'magic',sourceKey:'clean-minimal',header:'center',section:'rule',entry:'date-location',columns:'single',metrics:[10.5,1.5,14,9,3,12,12],roles:[12,12,10.5,9,9],color:'#111111'}),
  profile({id:'magic_executive_band',name:'Executive · 职业时间轴',group:'modern',upstream:'magic',sourceKey:'executive-band',header:'band',section:'rule',entry:'timeline',columns:'single',metrics:[10.5,1.55,13,9,3,12,12],roles:[12,12.75,10.5,9,9],color:'#1e40af'}),
  profile({id:'magic_compact_cn_photo',name:'中文紧凑 · 三列对齐',group:'project',upstream:'magic',sourceKey:'compact-cn-photo',header:'center',section:'rule',entry:'education-grid',columns:'single',metrics:[10,1.35,6,4,1,12,10],roles:[22,10.5,10,10,9],color:'#111111'}),
  profile({id:'magic_product_ops_focus',name:'产品运营 · 贡献优先',group:'project',upstream:'magic',sourceKey:'product-ops-focus',header:'contact-labels',section:'rule',entry:'dual-meta',columns:'single',metrics:[10.5,1.6,10,7,2,12,12],roles:[18,12,10.5,9,9],color:'#0f766e'}),
  profile({id:'jp_euro',name:'Euro · 分区标题栏',group:'formal',upstream:'jobpilot',sourceKey:'euro',header:'contact-labels',section:'rail',entry:'role-inline',columns:'single',metrics:[10.5,1.5,12,8,2,14,14],roles:[22.5,10,10.5,9,9],color:'#1e40af'}),
  profile({id:'jp_engineer',name:'Engineer · 技术页眉',group:'project',upstream:'jobpilot',sourceKey:'engineer',header:'split-band',section:'partial-line',entry:'role-inline',columns:'single',metrics:[10.5,1.5,12,9,2,14,12],roles:[18,10.5,10.5,9,9],color:'#0284c7'}),
  profile({id:'jp_modern_minimal',name:'Modern Minimal · 时间轴与项目卡',group:'modern',upstream:'jobpilot',sourceKey:'modern-minimal',header:'left',section:'overline',entry:'date-gutter',columns:'single',metrics:[10.5,1.5,12,9,2,14,12],roles:[22.5,10.5,10.5,9,9],color:'#2563eb'}),
  profile({id:'rx_lapras',name:'Lapras · 线框章节',group:'modern',upstream:'reactive',sourceKey:'lapras',header:'photo-left',section:'boxed',entry:'right',columns:'single',metrics:[10,1.5,15,7,2,14,14],roles:[19.5,13,10,9,9],color:'#446773'}),
  profile({id:'rx_bronzor',name:'Bronzor · 横线与标题侧栏',group:'columns',upstream:'reactive',sourceKey:'bronzor',header:'stacked-center',section:'rail',entry:'right',columns:'single',metrics:[10,1.5,10,7,2,14,14],roles:[19.5,10,10,9,9],color:'#6b5748'}),
];
const SOURCE_INSPECTED_BATCH_30: ResumeTemplateProfile[] = [
  profile({id:'jp_academic',name:'Academic · 衬线学术',group:'research',upstream:'jobpilot',sourceKey:'academic',header:'adaptive-photo',section:'rule',entry:'role-stack',columns:'single',metrics:[10.5,1.5,10,7,2,14,14],roles:[18,10,10.5,9,9],color:'#27272a',font:'serif'}),
  profile({id:'jp_scientist',name:'Scientist · 编号研究',group:'research',upstream:'jobpilot',sourceKey:'scientist',header:'stacked-center',section:'numbered',entry:'role-inline',columns:'single',metrics:[10.5,1.5,12,8,2,14,14],roles:[18,10.5,10.5,9,9],color:'#0891b2',font:'serif'}),
  profile({id:'jp_modern',name:'Modern · 渐变页眉',group:'creative',upstream:'jobpilot',sourceKey:'modern',header:'photo-left',section:'partial-line',entry:'role-stack',columns:'single',metrics:[10.5,1.5,12,8,2,14,12],roles:[22.5,10.5,10.5,9,9],color:'#ba2543'}),
  profile({id:'jp_berlin',name:'Berlin · 几何构成',group:'creative',upstream:'jobpilot',sourceKey:'berlin',header:'photo-left',section:'geometric',entry:'role-stack',columns:'single',metrics:[10.5,1.5,12,8,2,14,12],roles:[22.5,10.5,10.5,9,9],color:'#2563eb'}),
  profile({id:'jp_designer',name:'Designer · 杂志与内容卡',group:'creative',upstream:'jobpilot',sourceKey:'designer',header:'left',section:'plain',entry:'role-stack',columns:'single',metrics:[10.5,1.5,12,8,2,14,12],roles:[27,10,10.5,9,9],color:'#ba3a44'}),
  profile({id:'jp_blocks',name:'Blocks · 信息块',group:'creative',upstream:'jobpilot',sourceKey:'blocks',header:'classic-group',section:'triangle',entry:'role-stack',columns:'single',metrics:[10.5,1.5,12,8,2,14,12],roles:[18,10.5,10.5,9,9],color:'#2383e2'}),
  profile({id:'jp_ribbon',name:'Ribbon · 缎带章节',group:'creative',upstream:'jobpilot',sourceKey:'ribbon',header:'photo-left',section:'ribbon',entry:'role-inline',columns:'single',metrics:[10.5,1.5,12,8,2,14,12],roles:[18,10,10.5,9,9],color:'#b91c1c'}),
  profile({id:'rx_azurill',name:'Azurill · 双栏时间线',group:'columns',upstream:'reactive',sourceKey:'azurill',header:'stacked-center',section:'plain',entry:'timeline',columns:'left',metrics:[10,1.5,12,8,2,12,12],roles:[19.5,12,10,9,9],color:'#5b6787'}),
  profile({id:'rx_ditto',name:'Ditto · 横带错位照片',group:'columns',upstream:'reactive',sourceKey:'ditto',header:'offset-band',section:'plain',entry:'right',columns:'left',metrics:[10,1.5,12,8,2,12,12],roles:[19.5,12,10,9,9],color:'#526456'}),
  profile({id:'rx_glalie',name:'Glalie · 侧栏联系框',group:'columns',upstream:'reactive',sourceKey:'glalie',header:'sidebar',section:'rule',entry:'right',columns:'left',metrics:[10,1.5,12,8,2,10,12],roles:[19.5,12,10,9,9],color:'#536c78',sidebarPad:3}),
];
const SOURCE_INSPECTED_BATCH_40: ResumeTemplateProfile[] = [
  profile({id:'rx_chikorita',name:'Chikorita · 右侧彩栏',group:'columns',upstream:'reactive',sourceKey:'chikorita',header:'main-title',section:'rule',entry:'right',columns:'right',metrics:[10,1.5,12,8,2,12,12],roles:[19.5,12,10,9,9],color:'#396353',sidebarPad:3}),
  profile({id:'rx_rhyhorn',name:'Rhyhorn · 联系信息横排',group:'research',upstream:'reactive',sourceKey:'rhyhorn',header:'left',section:'rule',entry:'right',columns:'single',metrics:[10,1.5,12,8,2,14,14],roles:[19.5,12,10,9,9],color:'#465773'}),
  {...profile({id:'rx_ditgar',name:'Ditgar · 侧栏与边线条目',group:'columns',upstream:'reactive',sourceKey:'ditgar',header:'sidebar',section:'plain',entry:'right',columns:'left',metrics:[10,1.5,12,8,2,10,10],roles:[21,12,10,9,9],color:'#6c4768',sidebarPad:4}),featuredSummary:true},
  profile({id:'rx_leafish',name:'Leafish · 摘要与联系横带',group:'modern',upstream:'reactive',sourceKey:'leafish',header:'intro-band',section:'rule',entry:'right',columns:'right',metrics:[10,1.5,12,8,2,12,12],roles:[19.5,12,10,9,9],color:'#507264',sidebarPad:2}),
  profile({id:'rx_pikachu',name:'Pikachu · 主栏身份卡',group:'columns',upstream:'reactive',sourceKey:'pikachu',header:'main-title',section:'rule',entry:'right',columns:'left',metrics:[10,1.5,12,8,2,12,12],roles:[22,12,10,9,9],color:'#725644',sidebarPad:1}),
  profile({id:'billryan_cn',name:'中文专业 · 衬线长文',group:'formal',upstream:'billryan',sourceKey:'resume',header:'center',section:'rule',entry:'right',columns:'single',metrics:[11,1.35,10,7,2,20.3,14],roles:[24.8,14.4,12,11,11],color:'#111111',font:'serif'}),
  profile({id:'rendercv_engineering',name:'Engineering Resumes · 工程专业',group:'project',upstream:'rendercv',sourceKey:'engineeringresumes',header:'center',section:'rule',entry:'role-inline',columns:'single',metrics:[10,1.5,14,10,2,18,14],roles:[25,12,10,10,10],color:'#111111',font:'serif'}),
  profile({id:'bre_cool',name:'Cool · 双色身份横带',group:'creative',upstream:'best-resume-ever',sourceKey:'cool',header:'cool-band',section:'plain',entry:'role-stack',columns:'left',metrics:[10,1.5,12,8,2,10,10],roles:[24,12,10,9,9],color:'#26886a',sidebarPad:3}),
  profile({id:'bre_creative',name:'Creative · 紫色履历栏',group:'creative',upstream:'best-resume-ever',sourceKey:'creative',header:'sidebar',section:'plain',entry:'role-stack',columns:'left',metrics:[10,1.5,12,8,2,10,12],roles:[22,12,10,9,9],color:'#851dcc',sidebarPad:3}),
  profile({id:'bre_oblique',name:'Oblique · 斜切页眉',group:'creative',upstream:'best-resume-ever',sourceKey:'oblique',header:'oblique',section:'plain',entry:'role-stack',columns:'single',metrics:[10,1.5,12,8,2,20,14],roles:[28,14,10,9,9],color:'#006064'}),
];
export const RESUME_TEMPLATE_PROFILES: readonly ResumeTemplateProfile[] = [
  ...ANCHOR_PROFILES,...SOURCE_INSPECTED_BATCH_10,...SOURCE_INSPECTED_BATCH_20,...SOURCE_INSPECTED_BATCH_30,...SOURCE_INSPECTED_BATCH_40,
];
export const RESUME_PROFILE_BY_ID = new Map(RESUME_TEMPLATE_PROFILES.map(profile => [profile.id, profile]));
