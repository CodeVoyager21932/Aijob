import { describe, expect, it } from "vitest";
import { decideAccessPolicyRecheck } from "./access-policy-recheck.js";
import { evaluateRobotsForSource } from "./robots-policy.js";
import { robotsUnavailableReason } from "./robots-fetch.js";
import type { AccessPolicyEvidence } from "../sources/source-config.js";
const evidence: AccessPolicyEvidence = {
  robots: {
    status: "fetched",
    bodySha256: "a".repeat(64),
    allowsAllFetchTargets: true,
    crawlDelaySeconds: null,
  },
  termsOfService: {
    documentUrl: null,
    excerpt: "夹具：核验无禁止聚合条款",
    prohibitsAggregation: false,
  },
  verifiedAt: "2026-09-06",
  evidenceRef: "fixture",
};
const targets = [{ pathPrefix: "/jobs", method: "GET" as const }];
describe("ADR-0037 robots state distinctions", () => {
  it.each([
    ["404", "not_found", "continue"],
    ["410", "not_found", "continue"],
    ["401", "access_denied", "pause"],
    ["403", "access_denied", "pause"],
    ["429", "rate_limited", "retry"],
    ["503", "server_error", "retry"],
  ])("handles HTTP %s as %s and %s", (status, reason, action) => {
    const classified = robotsUnavailableReason(`UPSTREAM_HTTP_${status}`);
    expect(classified).toBe(reason);
    expect(
      decideAccessPolicyRecheck({
        recordedEvidence: evidence,
        robots: { status: "unavailable", reason: classified },
        fetchTargets: targets,
        robotsBodySha256: null,
      }).action,
    ).toBe(action);
  });
  it("never treats missing robots as source authorization or an empty target list as access scope", () => {
    expect(
      decideAccessPolicyRecheck({
        recordedEvidence: null,
        robots: { status: "unavailable", reason: "not_found" },
        fetchTargets: targets,
        robotsBodySha256: null,
      }).action,
    ).toBe("pause");
    expect(
      evaluateRobotsForSource({ status: "unavailable", reason: "not_found" }, []).allowed,
    ).toBe(false);
  });
});
