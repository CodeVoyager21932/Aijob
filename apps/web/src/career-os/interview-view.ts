import type { InterviewSession, InterviewSessionDetail, InterviewTurn } from "@aijob/contracts";

export const interviewStatusLabels: Record<InterviewSession["status"], string> = {
  queued: "准备中",
  active: "进行中",
  completed: "已完成",
  failed: "未完成",
  deleted: "已删除",
};

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
