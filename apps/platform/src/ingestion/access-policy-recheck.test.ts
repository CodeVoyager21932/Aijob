import { describe, expect, it } from "vitest";
import type { AccessPolicyEvidence } from "../sources/source-config.js";
import { decideAccessPolicyRecheck } from "./access-policy-recheck.js";
import type { RobotsFetchOutcome } from "./robots-policy.js";

const targets = [
  { pathPrefix: "/api/job/list", method: "POST" as const },
  { pathPrefix: "/api/job/detail", method: "POST" as const },
];

const sha = (value: string) => value.padEnd(64, "0").slice(0, 64);
const originalSha = sha("aa");

function evidence(overrides: Partial<AccessPolicyEvidence> = {}): AccessPolicyEvidence {
  return {
    robots: {
      status: "fetched",
      bodySha256: originalSha,
      allowsAllFetchTargets: true,
      crawlDelaySeconds: null,
    },
    termsOfService: {
      documentUrl: "https://example.test/terms",
      excerpt: "本站公开招聘信息可供检索引用。",
      prohibitsAggregation: false,
    },
    verifiedAt: "2026-08-29",
    evidenceRef: "docs/evidence/ingestion/access-policy-fixture.md",
    ...overrides,
  } as AccessPolicyEvidence;
}

const allowing: RobotsFetchOutcome = { status: "fetched", body: "User-agent: *\nDisallow: /admin" };

describe("access policy recheck (ADR-0033 periodic recheck)", () => {
  it("continues when robots still allows every registered target and terms are clean", () => {
    const decision = decideAccessPolicyRecheck({
      recordedEvidence: evidence(),
      robots: allowing,
      fetchTargets: targets,
      robotsBodySha256: originalSha,
    });

    expect(decision.action).toBe("continue");
    if (decision.action !== "continue") throw new Error("UNREACHABLE");
    expect(decision.robotsChanged).toBe(false);
  });

  it("pauses when the source has no recorded access policy evidence", () => {
    const decision = decideAccessPolicyRecheck({
      recordedEvidence: null,
      robots: allowing,
      fetchTargets: targets,
      robotsBodySha256: originalSha,
    });

    expect(decision.action).toBe("pause");
    if (decision.action !== "pause") throw new Error("UNREACHABLE");
    expect(decision.code).toBe("ACCESS_POLICY_EVIDENCE_MISSING");
  });

  it("pauses when robots newly disallows a registered target", () => {
    const decision = decideAccessPolicyRecheck({
      recordedEvidence: evidence(),
      robots: { status: "fetched", body: "User-agent: *\nDisallow: /api/job/detail" },
      fetchTargets: targets,
      robotsBodySha256: sha("bb"),
    });

    expect(decision.action).toBe("pause");
    if (decision.action !== "pause") throw new Error("UNREACHABLE");
    expect(decision.code).toBe("ROBOTS_NOW_DISALLOWS_TARGET");
    expect(decision.detail).toContain("/api/job/detail");
  });

  it("pauses when robots becomes unretrievable on recheck", () => {
    for (const reason of ["not_found", "timeout", "http_error", "network_error"] as const) {
      const decision = decideAccessPolicyRecheck({
        recordedEvidence: evidence(),
        robots: { status: "unavailable", reason },
        fetchTargets: targets,
        robotsBodySha256: null,
      });

      expect(decision.action, reason).toBe("pause");
      if (decision.action !== "pause") throw new Error("UNREACHABLE");
      expect(decision.code).toBe("ROBOTS_UNAVAILABLE_ON_RECHECK");
    }
  });

  it("pauses when the recorded terms prohibit aggregation, even if robots allows", () => {
    const decision = decideAccessPolicyRecheck({
      recordedEvidence: evidence({
        termsOfService: {
          documentUrl: "https://example.test/terms",
          excerpt: "禁止任何第三方抓取、复制或聚合本站招聘信息。",
          prohibitsAggregation: true,
        },
      }),
      robots: allowing,
      fetchTargets: targets,
      robotsBodySha256: originalSha,
    });

    expect(decision.action).toBe("pause");
    if (decision.action !== "pause") throw new Error("UNREACHABLE");
    expect(decision.code).toBe("TERMS_PROHIBIT_AGGREGATION");
  });

  it("flags a changed robots body while still continuing when it remains permissive", () => {
    const decision = decideAccessPolicyRecheck({
      recordedEvidence: evidence(),
      robots: { status: "fetched", body: "User-agent: *\nDisallow: /admin\nCrawl-delay: 4" },
      fetchTargets: targets,
      robotsBodySha256: sha("cc"),
    });

    expect(decision.action).toBe("continue");
    if (decision.action !== "continue") throw new Error("UNREACHABLE");
    expect(decision.robotsChanged).toBe(true);
    expect(decision.crawlDelaySeconds).toBe(4);
  });

});
