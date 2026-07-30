import { describe, expect, it } from "vitest";
import { assertPolicyVersionCanAdvance, policyTargetSetComparable } from "./source-registry.js";

const searchTarget = {
  method: "POST",
  scheme: "https",
  host: "join.qq.com",
  port: 443,
  pathPrefix: "/api/v1/position/searchPosition",
  allowRedirects: false,
  allowedQueryParameters: [],
};

const detailTarget = {
  method: "GET",
  scheme: "https",
  host: "join.qq.com",
  port: 443,
  pathPrefix: "/api/v1/jobDetails/getJobDetailsByPostId",
  allowRedirects: false,
  allowedQueryParameters: ["postId"],
};

describe("source policy target immutability", () => {
  it("treats target ordering as irrelevant", () => {
    expect(policyTargetSetComparable([searchTarget, detailTarget])).toBe(
      policyTargetSetComparable([detailTarget, searchTarget]),
    );
  });

  it("detects target additions, removals and path changes", () => {
    const baseline = policyTargetSetComparable([searchTarget, detailTarget]);

    expect(policyTargetSetComparable([searchTarget])).not.toBe(baseline);
    expect(
      policyTargetSetComparable([
        searchTarget,
        { ...detailTarget, pathPrefix: "/api/v2/jobDetails/getJobDetailsByPostId" },
      ]),
    ).not.toBe(baseline);
  });

  it("detects redirect and query-parameter policy changes", () => {
    const baseline = policyTargetSetComparable([searchTarget, detailTarget]);

    expect(
      policyTargetSetComparable([{ ...searchTarget, allowRedirects: true }, detailTarget]),
    ).not.toBe(baseline);
    expect(
      policyTargetSetComparable([
        searchTarget,
        { ...detailTarget, allowedQueryParameters: ["postId", "debug"] },
      ]),
    ).not.toBe(baseline);
  });
});

describe("current source policy version monotonicity", () => {
  it("allows idempotent registration and a strictly newer version", () => {
    expect(() => assertPolicyVersionCanAdvance(2, 2)).not.toThrow();
    expect(() => assertPolicyVersionCanAdvance(2, 3)).not.toThrow();
  });

  it("rejects rollback with a stable error", () => {
    expect(() => assertPolicyVersionCanAdvance(2, 1)).toThrowError(
      "POLICY_VERSION_ROLLBACK_FORBIDDEN",
    );
  });
});
