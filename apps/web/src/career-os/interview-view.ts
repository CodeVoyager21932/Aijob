import type {
  InterviewFeedbackCategory,
  InterviewFeedbackSeverity,
  InterviewSession,
  InterviewSessionDetail,
  InterviewTurn,
} from "@aijob/contracts";

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
