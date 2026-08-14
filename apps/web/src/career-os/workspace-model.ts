export type CaseStage = "interested" | "preparing" | "applied" | "interviewing" | "resolved";

export type EvidenceStateValue = "confirmed" | "needs_work" | "unconfirmed";

export const caseStages = [
  { value: "interested", label: "感兴趣" },
  { value: "preparing", label: "准备投递" },
  { value: "applied", label: "已投递" },
  { value: "interviewing", label: "面试中" },
  { value: "resolved", label: "结果" },
] as const satisfies ReadonlyArray<{ value: CaseStage; label: string }>;

export const caseStageTransitions: Readonly<Record<CaseStage, readonly CaseStage[]>> = {
  interested: ["preparing", "resolved"],
  preparing: ["interested", "applied", "resolved"],
  applied: ["interviewing", "resolved"],
  interviewing: ["applied", "resolved"],
  resolved: [],
};

export const caseOutcomes = [
  { value: "offer", label: "获得 Offer" },
  { value: "rejected", label: "未通过" },
  { value: "withdrawn", label: "主动撤回" },
  { value: "expired", label: "岗位失效" },
  { value: "unknown", label: "结果未说明" },
] as const;

export type CaseOutcome = (typeof caseOutcomes)[number]["value"];

export function getCaseOutcomeLabel(outcome: CaseOutcome): string {
  return caseOutcomes.find((item) => item.value === outcome)?.label ?? "结果未说明";
}

export function getCaseTransitionTargets(stage: CaseStage): readonly CaseStage[] {
  return stage === "resolved" ? ["resolved"] : caseStageTransitions[stage];
}

export function isCaseTransitionSelectionValid(input: {
  currentStage: CaseStage;
  currentOutcome: CaseOutcome | null;
  toStage: CaseStage | "";
  outcome: CaseOutcome | "";
}): boolean {
  if (!input.toStage || !getCaseTransitionTargets(input.currentStage).includes(input.toStage)) {
    return false;
  }
  if (input.toStage !== "resolved") return input.outcome === "";
  if (!input.outcome) return false;
  return input.currentStage !== "resolved" || input.outcome !== input.currentOutcome;
}

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
