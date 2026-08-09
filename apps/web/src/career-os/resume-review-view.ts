import type {
  ResumeDocumentContentRevisionReadModel,
  ResumeReviewChangeType,
  ResumeReviewRunStatus,
  ResumeReviewSuggestion,
} from "@aijob/contracts";

const reasonLabels: Readonly<Record<string, string>> = {
  BLOCK_WITHOUT_CONFIRMED_EVIDENCE: "这段内容没有引用当前岗位简历固定的已确认证据。",
  EVIDENCE_BACKED_ATS_REWRITE: "依据已确认证据整理为更便于 HR 与 ATS 阅读的表达。",
  BLOCK_ALREADY_EVIDENCE_ALIGNED: "当前表达已经与已确认证据一致，无需自动改写。",
  USER_KEPT_ORIGINAL: "用户选择保留原文。",
};

const statusLabels: Record<ResumeReviewRunStatus, string> = {
  pending: "正在生成模板建议",
  completed: "审阅已完成",
  failed: "审阅未完成",
  superseded: "已被新审阅替代",
  deleted: "审阅已删除",
};

const changeLabels: Record<ResumeReviewChangeType, string> = {
  rewrite_block: "改写区块",
  remove_block: "删除区块",
  split_block: "拆分区块",
  merge_blocks: "合并区块",
  reorder_section: "调整章节顺序",
  add_confirmed_evidence: "补充已确认证据",
};

export function resumeReviewReasonLabel(reasonCode: string): string {
  return reasonLabels[reasonCode] ?? "系统保留了结构化原因码，可在审阅记录中追溯。";
}

export function resumeReviewStatusLabel(status: ResumeReviewRunStatus): string {
  return statusLabels[status];
}

export function resumeReviewChangeLabel(changeType: ResumeReviewChangeType): string {
  return changeLabels[changeType];
}

export function resumeReviewDecisionLabel(decision: ResumeReviewSuggestion["decision"]): string {
  switch (decision) {
    case "accepted":
      return "已采用";
    case "edited":
      return "已编辑后采用";
    case "rejected":
      return "已保留原文";
    default:
      return "待决定";
  }
}

export function resumeReviewBlockText(
  revision: ResumeDocumentContentRevisionReadModel | null,
  blockId: string,
): string | null {
  if (!revision) return null;
  for (const section of revision.content.sections) {
    const block = section.blocks.find((item) => item.id === blockId);
    if (block) return block.text;
  }
  return null;
}

export function orderResumeReviewSuggestions(
  suggestions: ResumeReviewSuggestion[],
  selectedBlockId: string | null,
): ResumeReviewSuggestion[] {
  return [...suggestions].sort((left, right) => {
    const leftSelected = selectedBlockId ? left.targetIds.includes(selectedBlockId) : false;
    const rightSelected = selectedBlockId ? right.targetIds.includes(selectedBlockId) : false;
    if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
    const leftPending = left.decision === "pending";
    const rightPending = right.decision === "pending";
    if (leftPending !== rightPending) return leftPending ? -1 : 1;
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
  });
}
