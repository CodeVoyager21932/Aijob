// Offline Phase 1 prototype fixture. Production Career OS runtime imports workspace-model.ts.
export type CaseStage = "interested" | "preparing" | "applied" | "interviewing" | "resolved";

export type EvidenceStateValue = "confirmed" | "needs_work" | "unconfirmed";

export interface CareerCaseEvidence {
  id: string;
  label: string;
  state: EvidenceStateValue;
}

export interface CareerCase {
  id: string;
  companyName: string;
  roleTitle: string;
  location: string;
  workMode: string;
  deadline: string;
  updatedAt: string;
  stage: CaseStage;
  sourceLabel: string;
  sourceVerifiedAt: string;
  nextTask: string;
  nextTaskDetail: string;
  qualification: string;
  preference: string;
  evidence: CareerCaseEvidence[];
}

export const caseStages = [
  { value: "interested", label: "感兴趣" },
  { value: "preparing", label: "准备投递" },
  { value: "applied", label: "已投递" },
  { value: "interviewing", label: "面试中" },
  { value: "resolved", label: "结果" },
] as const satisfies ReadonlyArray<{ value: CaseStage; label: string }>;

export const caseTabs = [
  { value: "overview", label: "概览" },
  { value: "requirements", label: "JD能力" },
  { value: "resume", label: "定制简历" },
  { value: "application", label: "投递" },
  { value: "interview", label: "面试" },
  { value: "debrief", label: "复盘" },
] as const;

export type CaseTab = (typeof caseTabs)[number]["value"];

export const careerCases: CareerCase[] = [
  {
    id: "case-starbridge-product",
    companyName: "示例·星桥科技",
    roleTitle: "产品策划实习生",
    location: "上海",
    workMode: "线下",
    deadline: "2026-08-18",
    updatedAt: "2026-08-04T08:40:00.000Z",
    stage: "interested",
    sourceLabel: "企业官方 ATS · 静态演示",
    sourceVerifiedAt: "2026-08-04",
    nextTask: "查看岗位原文",
    nextTaskDetail: "先核对到岗时间和岗位职责，再决定是否进入准备阶段。",
    qualification: "需补充信息",
    preference: "符合",
    evidence: [
      { id: "product-analysis", label: "需求分析", state: "confirmed" },
      { id: "user-research", label: "用户研究", state: "needs_work" },
      { id: "weekly-days", label: "每周到岗天数", state: "unconfirmed" },
    ],
  },
  {
    id: "case-greenfield-operations",
    companyName: "示例·青原数字",
    roleTitle: "内容运营实习生",
    location: "杭州",
    workMode: "线下",
    deadline: "2026-08-16",
    updatedAt: "2026-08-04T07:30:00.000Z",
    stage: "preparing",
    sourceLabel: "企业招聘官网 · 静态演示",
    sourceVerifiedAt: "2026-08-03",
    nextTask: "确认两段经历证据",
    nextTaskDetail: "把内容复盘和数据分析分别关联到已确认的经历区块。",
    qualification: "未发现明确冲突",
    preference: "符合",
    evidence: [
      { id: "content-planning", label: "内容策划", state: "confirmed" },
      { id: "data-review", label: "数据复盘", state: "needs_work" },
      { id: "industry-interest", label: "行业偏好", state: "unconfirmed" },
    ],
  },
  {
    id: "case-northstar-data",
    companyName: "示例·北辰数据",
    roleTitle: "数据分析实习生",
    location: "深圳",
    workMode: "混合",
    deadline: "2026-08-20",
    updatedAt: "2026-08-03T12:10:00.000Z",
    stage: "applied",
    sourceLabel: "企业官方 ATS · 静态演示",
    sourceVerifiedAt: "2026-08-03",
    nextTask: "记录筛选进展",
    nextTaskDetail: "打开官方页面不会自动标记已投递；当前状态来自你的手动记录。",
    qualification: "未发现明确冲突",
    preference: "符合",
    evidence: [
      { id: "sql", label: "SQL 分析", state: "confirmed" },
      { id: "visualization", label: "数据可视化", state: "confirmed" },
      { id: "business-context", label: "业务场景", state: "needs_work" },
    ],
  },
  {
    id: "case-farsight-engineering",
    companyName: "示例·远望实验室",
    roleTitle: "前端工程实习生",
    location: "北京",
    workMode: "线下",
    deadline: "2026-08-14",
    updatedAt: "2026-08-03T09:00:00.000Z",
    stage: "interviewing",
    sourceLabel: "企业招聘官网 · 静态演示",
    sourceVerifiedAt: "2026-08-02",
    nextTask: "准备第一轮文字面试",
    nextTaskDetail: "围绕组件设计、协作和性能问题整理三段已确认经历。",
    qualification: "未发现明确冲突",
    preference: "未设置",
    evidence: [
      { id: "react", label: "React 项目", state: "confirmed" },
      { id: "collaboration", label: "跨团队协作", state: "confirmed" },
      { id: "performance", label: "性能优化", state: "needs_work" },
    ],
  },
  {
    id: "case-clearpath-market",
    companyName: "示例·明栈创新",
    roleTitle: "市场研究实习生",
    location: "广州",
    workMode: "线下",
    deadline: "2026-08-12",
    updatedAt: "2026-08-02T10:20:00.000Z",
    stage: "resolved",
    sourceLabel: "企业官方 ATS · 静态演示",
    sourceVerifiedAt: "2026-08-02",
    nextTask: "完成复盘",
    nextTaskDetail: "只记录你确认过的结果、表达问题和下一次练习计划。",
    qualification: "未发现明确冲突",
    preference: "不符合",
    evidence: [
      { id: "desk-research", label: "案头研究", state: "confirmed" },
      { id: "interview-notes", label: "访谈记录", state: "confirmed" },
      { id: "result", label: "流程结果", state: "unconfirmed" },
    ],
  },
  {
    id: "case-spring-ai",
    companyName: "示例·春序智能",
    roleTitle: "算法应用实习生",
    location: "成都",
    workMode: "线下",
    deadline: "2026-08-24",
    updatedAt: "2026-08-01T11:00:00.000Z",
    stage: "preparing",
    sourceLabel: "企业官方 ATS · 静态演示",
    sourceVerifiedAt: "2026-08-01",
    nextTask: "补充项目证据",
    nextTaskDetail: "确认模型评估经历是否能够支持岗位原文中的实验要求。",
    qualification: "需补充信息",
    preference: "符合",
    evidence: [
      { id: "modeling", label: "模型训练", state: "confirmed" },
      { id: "evaluation", label: "模型评估", state: "needs_work" },
      { id: "attendance", label: "到岗周期", state: "unconfirmed" },
    ],
  },
];

const careerCasesById = new Map(careerCases.map((careerCase) => [careerCase.id, careerCase]));

export function getCareerCase(caseId: string | undefined): CareerCase | undefined {
  return caseId ? careerCasesById.get(caseId) : undefined;
}

export function getCaseStageLabel(stage: CaseStage): string {
  return caseStages.find((item) => item.value === stage)?.label ?? "未说明";
}

export function isCaseTab(value: string | undefined): value is CaseTab {
  return caseTabs.some((tab) => tab.value === value);
}
