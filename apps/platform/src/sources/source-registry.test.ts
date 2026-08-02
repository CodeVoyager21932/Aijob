import { describe, expect, it } from "vitest";
import {
  assertPolicyVersionCanAdvance,
  policyTargetSetComparable,
  sourceRuntimeRegistrationUpdate,
} from "./source-registry.js";

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

describe("source runtime registration transitions", () => {
  const now = new Date("2026-08-01T06:00:00.000Z");

  it("preserves accumulated runtime fields during idempotent registration", () => {
    expect(
      sourceRuntimeRegistrationUpdate({
        policyVersion: 3,
        policyAdvanced: false,
        scheduleEnabled: true,
        previousCrawlInterval: "24h",
        now,
      }),
    ).toEqual({ policy_version: 3, updated_at: now });
  });

  it("makes newly enabled policies immediately due and clears disabled schedules", () => {
    expect(
      sourceRuntimeRegistrationUpdate({
        policyVersion: 3,
        policyAdvanced: true,
        scheduleEnabled: true,
        previousCrawlInterval: null,
        now,
      }),
    ).toEqual({
      policy_version: 3,
      updated_at: now,
      next_due_at: now,
      freshness_state: "due",
      automation_paused: false,
      automation_pause_reason: null,
      consecutive_failures: 0,
      last_error_code: null,
      manual_snapshot_required: false,
      manual_snapshot_due_at: null,
    });
    expect(
      sourceRuntimeRegistrationUpdate({
        policyVersion: 4,
        policyAdvanced: true,
        scheduleEnabled: false,
        previousCrawlInterval: "24h",
        now,
      }),
    ).toEqual({
      policy_version: 4,
      updated_at: now,
      next_due_at: null,
      manual_snapshot_required: false,
      manual_snapshot_due_at: null,
    });
  });
});
