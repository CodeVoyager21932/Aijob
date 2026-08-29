import type { AccessPolicyEvidence } from "../sources/source-config.js";
import { evaluateRobotsForSource, type RobotsFetchOutcome, type RobotsTargetCheck } from "./robots-policy.js";

/**
 * ADR-0033 附随义务第五条：`robots.txt` 与服务条款会变。每次调度刷新须复核，
 * 判定转为禁止时**自动暂停**该来源，不得静默继续抓取。
 *
 * 本模块只做判定，不发起网络请求也不写数据库——调用方负责取回 robots 与落库暂停。
 */

export type AccessPolicyRecheckAction =
  | { action: "continue"; robotsChanged: boolean; crawlDelaySeconds: number | undefined }
  | { action: "pause"; code: AccessPolicyPauseCode; detail: string };

export type AccessPolicyPauseCode =
  | "ACCESS_POLICY_EVIDENCE_MISSING"
  | "ROBOTS_UNAVAILABLE_ON_RECHECK"
  | "ROBOTS_NOW_DISALLOWS_TARGET"
  | "TERMS_PROHIBIT_AGGREGATION";

export interface AccessPolicyRecheckInput {
  /** 来源配置中留存的上一次访问政策证据。 */
  recordedEvidence: AccessPolicyEvidence | null;
  /** 本次复核取回的 robots 结果。 */
  robots: RobotsFetchOutcome;
  /** 该来源全部已登记 fetch target。 */
  fetchTargets: readonly RobotsTargetCheck[];
  /** robots 正文的 sha256，用于检测变化；取不到时为 null。 */
  robotsBodySha256: string | null;
}

/**
 * 判定本次刷新是否可以继续。任一禁止条件命中即要求暂停。
 */
export function decideAccessPolicyRecheck(
  input: AccessPolicyRecheckInput,
): AccessPolicyRecheckAction {
  // 没有留存证据说明该来源从未通过访问政策评估，不能靠刷新绕过。
  if (input.recordedEvidence === null) {
    return {
      action: "pause",
      code: "ACCESS_POLICY_EVIDENCE_MISSING",
      detail: "source has no recorded access policy evidence; run the assessment first",
    };
  }

  // 条款结论以留存证据为准；一旦记为禁止聚合，刷新必须停。
  if (input.recordedEvidence.termsOfService.prohibitsAggregation) {
    return {
      action: "pause",
      code: "TERMS_PROHIBIT_AGGREGATION",
      detail: "recorded terms of service prohibit aggregation",
    };
  }

  const verdict = evaluateRobotsForSource(input.robots, input.fetchTargets);
  if (!verdict.allowed) {
    if (verdict.code === "ROBOTS_UNAVAILABLE") {
      return {
        action: "pause",
        code: "ROBOTS_UNAVAILABLE_ON_RECHECK",
        detail: "robots.txt could not be retrieved on recheck; failing closed",
      };
    }
    return {
      action: "pause",
      code: "ROBOTS_NOW_DISALLOWS_TARGET",
      detail:
        verdict.blockedPathPrefix === null
          ? "robots.txt now disallows the registered access scope"
          : `robots.txt now disallows ${verdict.blockedPathPrefix}`,
    };
  }

  const recorded = input.recordedEvidence.robots;
  const robotsChanged =
    recorded.status !== "fetched" ||
    input.robotsBodySha256 === null ||
    recorded.bodySha256 !== input.robotsBodySha256;

  return {
    action: "continue",
    robotsChanged,
    crawlDelaySeconds: verdict.crawlDelaySeconds,
  };
}
