import type {
  Debrief,
  DebriefItemDecisionInput,
  DebriefItemDecisionValue,
  InterviewFeedbackCategory,
  InterviewFeedbackSeverity,
  InterviewSession,
  InterviewSessionDetail,
  InterviewTurn,
} from "@aijob/contracts";

export const debriefItemDecisionLabels: Record<DebriefItemDecisionValue, string> = {
  accepted: "采用",
  edited: "编辑后采用",
  rejected: "拒绝",
  deferred: "稍后处理",
};

export type DebriefActionItem =
  | {
      kind: "expression_issue";
      id: string;
      description: string;
      requirementIds: [];
    }
  | {
      kind: "evidence_gap";
      id: string;
      description: string;
      requirementIds: string[];
    };

export function debriefActionItems(debrief: Debrief): DebriefActionItem[] {
  return [
    ...debrief.expressionIssues.map((item) => ({
      kind: "expression_issue" as const,
      id: item.id,
      description: item.description,
      requirementIds: [] as [],
    })),
    ...debrief.evidenceGaps.map((item) => ({
      kind: "evidence_gap" as const,
      id: item.id,
      description: item.description,
      requirementIds: item.requirementIds,
    })),
  ];
}

export function debriefDecisionKey(item: Pick<DebriefActionItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

export function debriefConfirmationReady(
  debrief: Debrief,
  drafts: Readonly<Record<string, DebriefItemDecisionInput | undefined>>,
): boolean {
  return debriefActionItems(debrief).every((item) => {
    const decision = drafts[debriefDecisionKey(item)];
    if (!decision) return false;
    return decision.decision !== "edited" || Boolean(decision.editedText?.trim());
  });
}

export function debriefBackflowPath(caseId: string, item: DebriefActionItem): string {
  if (item.kind === "expression_issue") {
    return `/applications/${encodeURIComponent(caseId)}/resume`;
  }
  const requirementId = item.requirementIds[0];
  const base = `/applications/${encodeURIComponent(caseId)}/requirements`;
  return requirementId ? `${base}?requirement=${encodeURIComponent(requirementId)}` : base;
}

export const interviewStatusLabels: Record<InterviewSession["status"], string> = {
  queued: "准备中",
  active: "进行中",
  completed: "已完成",
  failed: "未完成",
  deleted: "已删除",
};

export const interviewFeedbackCategoryLabels: Record<InterviewFeedbackCategory, string> = {
  relevance: "回答相关性",
  structure: "表达结构",
  evidence: "证据关联",
  clarity: "信息清晰度",
};

export const interviewFeedbackSeverityLabels: Record<InterviewFeedbackSeverity, string> = {
  info: "提示",
  warning: "建议核对",
  critical: "需要立即核对",
};

export type CaseDebriefSessionState = "empty" | "selected" | "other";

export function caseDebriefSessionState(
  response: { debrief: { interviewSessionId: string | null } | null } | undefined,
  selectedSessionId: string | null,
): CaseDebriefSessionState {
  if (!response?.debrief) return "empty";
  return response.debrief.interviewSessionId === selectedSessionId ? "selected" : "other";
}

export function currentInterviewQuestion(
  detail: InterviewSessionDetail | undefined,
): InterviewTurn | null {
  if (!detail || detail.session.status !== "active") return null;
  const lastTurn = detail.turns.at(-1);
  return lastTurn && lastTurn.kind !== "answer" ? lastTurn : null;
}

export function interviewTurnLabel(kind: InterviewTurn["kind"]): string {
  if (kind === "answer") return "你的回答";
  if (kind === "follow_up") return "追问";
  return "模板问题";
}
