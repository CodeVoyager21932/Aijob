import { z } from "zod";

/**
 * 岗位可达性判定 v1（ADR-0032）。
 *
 * 目的：守「普通背景学生投得进」。取代原先的 SME 比例门槛——SME 与「有企业自控官方
 * 招聘页」同时成立的企业本身已非普通 SME，且实测 SME 比例从未接近 50%/40%。
 *
 * 判定只做**显式短语检出**：只读取官方页面原文里已经出现的字符串，绝不推断、不补写。
 * 因此：
 * - 正文没有出现 `985` 等限校词，**不得**推断为「不限校」，只能归入 `unknown`。
 * - 完全没有学历信号时归入 `unknown`，不猜测。
 * - `unknown` 不计入可达配额，也不用于补足门槛（沿用 ADR-0027 对 `unknown` 的既有规则）。
 *
 * 实测依据（A1，n=345 真实岗位正文）：reachable 58.8%、unknown 27.8%、
 * 仅研究生及以上 12.8%、明确限校 0.6%。门槛因此定为可达岗位 ≥50% 可见岗位。
 */
export const JobReachabilityVerdictSchema = z.enum([
  "reachable",
  "not_reachable_school_restricted",
  "not_reachable_postgrad_only",
  "unknown",
]);

export type JobReachabilityVerdict = z.infer<typeof JobReachabilityVerdictSchema>;

/** 明确限定学校层次。命中即判不可达，优先级最高。 */
const SCHOOL_RESTRICTION_PATTERN = /985|211|双一流|重点院校|名校|QS/u;

/** 研究生层次。 */
const POSTGRADUATE_PATTERN = /硕士|研究生|博士/u;

/** 本科层次。 */
const UNDERGRADUATE_PATTERN = /本科|学士/u;

/** 明示不限。视为可达。 */
const NO_LIMIT_PATTERN = /学历不限|不限学历|专业不限|不限专业/u;

/**
 * 大专层次。A1 实测本样本 0 命中，但保留检出：大专可投同样属于可达。
 */
const COLLEGE_PATTERN = /大专|专科/u;

export interface JobReachabilityInput {
  /** 官方页面原文的任职要求。 */
  requirements: string;
  /** 官方页面原文的岗位职责。学历要求有时写在职责段落里，一并检出。 */
  responsibilities?: string;
}

/**
 * 判定单条岗位的可达性。纯函数、确定性、可复现，不依赖时间或外部状态。
 */
export function classifyJobReachability(input: JobReachabilityInput): JobReachabilityVerdict {
  const text = `${input.requirements ?? ""} ${input.responsibilities ?? ""}`;

  if (SCHOOL_RESTRICTION_PATTERN.test(text)) {
    return "not_reachable_school_restricted";
  }

  const undergraduate = UNDERGRADUATE_PATTERN.test(text) || COLLEGE_PATTERN.test(text);
  const postgraduate = POSTGRADUATE_PATTERN.test(text);

  if (postgraduate && !undergraduate) {
    return "not_reachable_postgrad_only";
  }
  if (undergraduate || NO_LIMIT_PATTERN.test(text)) {
    return "reachable";
  }
  return "unknown";
}

/**
 * 是否计入可达配额。只有 `reachable` 计入；`unknown` 明确不计入，避免用未知补足门槛。
 */
export function isReachableVerdict(verdict: JobReachabilityVerdict): boolean {
  return verdict === "reachable";
}

/** ADR-0032 冻结的可达岗位占可见岗位最低比例。 */
export const MINIMUM_REACHABLE_VISIBLE_JOB_RATIO = 0.5;
