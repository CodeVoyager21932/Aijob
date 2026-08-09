export type CaseStage = "interested" | "preparing" | "applied" | "interviewing" | "resolved";

export type EvidenceStateValue = "confirmed" | "needs_work" | "unconfirmed";

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

export function getCaseStageLabel(stage: CaseStage): string {
  return caseStages.find((item) => item.value === stage)?.label ?? "未说明";
}

export function isCaseTab(value: string | undefined): value is CaseTab {
  return caseTabs.some((tab) => tab.value === value);
}
