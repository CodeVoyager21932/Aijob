import type {
  CaseMatchCatalogState,
  CaseMatchMissingInput,
  CaseMatchStaleReason,
  MatchRunResult,
} from "@aijob/contracts";

export type CaseMatchAxisTone = "positive" | "warning" | "danger" | "muted";

export interface CaseMatchAxisView {
  key: "eligibility" | "evidence" | "preference";
  label: string;
  value: string;
  tone: CaseMatchAxisTone;
  explanations: string[];
}

const eligibilityLabels = {
  no_explicit_conflict: "未发现明确冲突",
  explicit_conflict: "存在明确冲突",
  needs_information: "需要补充信息",
} as const;

const evidenceLabels = {
  explicit_evidence: "已有明确证据",
  partial_evidence: "部分证据待补充",
  not_in_resume: "当前简历尚未体现",
  insufficient_information: "证据信息不足",
} as const;

const preferenceLabels = {
  fits: "符合已确认偏好",
  does_not_fit: "与已确认偏好冲突",
  not_set: "偏好尚未设置",
} as const;

function axisTone(status: string): CaseMatchAxisTone {
  if (status === "no_explicit_conflict" || status === "explicit_evidence" || status === "fits") {
    return "positive";
  }
  if (status === "explicit_conflict" || status === "not_in_resume" || status === "does_not_fit") {
    return "danger";
  }
  if (status === "needs_information" || status === "partial_evidence") return "warning";
  return "muted";
}

export function toCaseMatchAxes(result: MatchRunResult): CaseMatchAxisView[] {
  return [
    {
      key: "eligibility",
      label: "资格条件",
      value: eligibilityLabels[result.eligibility.status],
      tone: axisTone(result.eligibility.status),
      explanations: result.eligibility.reasons.map(({ explanation }) => explanation),
    },
    {
      key: "evidence",
      label: "经历证据",
      value: evidenceLabels[result.evidence.status],
      tone: axisTone(result.evidence.status),
      explanations: result.evidence.reasons.map(({ explanation }) => explanation),
    },
    {
      key: "preference",
      label: "个人偏好",
      value: preferenceLabels[result.preference.status],
      tone: axisTone(result.preference.status),
      explanations: result.preference.reasons.map(({ explanation }) => explanation),
    },
  ];
}

export const caseMatchMissingInputLabels = {
  facts: "求职事实",
  preferences: "岗位偏好",
  evidence: "经历证据",
} as const satisfies Record<CaseMatchMissingInput, string>;

export const caseMatchStaleReasonLabels = {
  case_job_version: "Case 已固定到其他岗位版本",
  profile_facts: "求职事实已有新修订",
  preferences: "岗位偏好已有新修订",
  evidence: "经历证据已有新修订",
} as const satisfies Record<CaseMatchStaleReason, string>;

export const caseMatchCatalogLabels = {
  current: "目录版本一致",
  stale: "目录已有新版本",
  closed: "目录显示岗位已关闭",
  unavailable: "目录状态暂不可用",
} as const satisfies Record<CaseMatchCatalogState, string>;

export function shortVersionId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}
