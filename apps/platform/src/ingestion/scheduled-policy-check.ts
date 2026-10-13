import type { SourceConfig } from "../sources/source-config.js";
import { sha256 } from "../lib/canonical-json.js";
import { decideAccessPolicyRecheck } from "./access-policy-recheck.js";
import { fetchRobotsTxt } from "./robots-fetch.js";
import { NetworkPolicyError } from "./safe-http.js";

export async function checkScheduledAccess(input: {
  config: SourceConfig;
  beforeRequest?: (() => Promise<void> | void) | undefined;
  fetchRobots?: typeof fetchRobotsTxt;
}): Promise<{
  crawlDelaySeconds: number | undefined;
  evidence: Array<{
    host: string;
    status: string;
    reason: string | null;
    bodySha256: string | null;
  }>;
}> {
  const recordedEvidence = input.config.policy.accessPolicyEvidence;
  if (!recordedEvidence)
    throw new NetworkPolicyError(
      "ACCESS_POLICY_EVIDENCE_MISSING",
      "Run source access assessment before enabling scheduled refresh",
    );
  const evidence = [];
  let crawlDelaySeconds: number | undefined;
  for (const host of [
    ...new Set(input.config.policy.fetchTargets.map((target) => target.host)),
  ].sort()) {
    const record = await (input.fetchRobots ?? fetchRobotsTxt)({
      host,
      ...(input.beforeRequest ? { beforeRequest: input.beforeRequest } : {}),
    });
    const bodySha256 = record.outcome.status === "fetched" ? sha256(record.outcome.body) : null;
    const action = decideAccessPolicyRecheck({
      recordedEvidence,
      robots: record.outcome,
      fetchTargets: input.config.policy.fetchTargets.filter((target) => target.host === host),
      robotsBodySha256: bodySha256,
    });
    if (action.action === "retry")
      throw new NetworkPolicyError(
        record.errorCode ?? "ROBOTS_TEMPORARY_FAILURE",
        `Temporary robots failure on ${host}`,
      );
    if (action.action === "pause")
      throw new NetworkPolicyError(action.code, `${host}: ${action.detail}`);
    if (action.crawlDelaySeconds !== undefined)
      crawlDelaySeconds = Math.max(crawlDelaySeconds ?? 0, action.crawlDelaySeconds);
    evidence.push({
      host,
      status: record.outcome.status,
      reason: record.outcome.status === "unavailable" ? record.outcome.reason : null,
      bodySha256,
    });
  }
  return { crawlDelaySeconds, evidence };
}
