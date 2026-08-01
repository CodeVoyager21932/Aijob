import { describe, expect, it } from "vitest";
import {
  calculateTaskFailureTransition,
  directClosureReasonForErrorCode,
  isHardRefreshConflictCode,
  isRetryableProbeErrorCode,
  isSafeSoftRefreshRejectionCode,
  isSourcePolicyStatusAuthorizedForRun,
  scheduledRefreshRejectionCode,
} from "./probe.js";

const backoffPolicy = {
  baseMilliseconds: 500,
  maximumMilliseconds: 5_000,
  jitter: "full" as const,
  respectsRetryAfter: true,
};

describe("probe task failure transitions", () => {
  it("queues a retryable failure until its jittered available_at", () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const transition = calculateTaskFailureTransition({
      attempt: 1,
      maxAttempts: 3,
      errorCodes: ["UPSTREAM_HTTP_429", "UPSTREAM_TIMEOUT"],
      backoffPolicy,
      now,
      random: () => 0.5,
    });

    expect(transition).toEqual({
      status: "queued",
      availableAt: new Date("2026-07-17T00:00:00.250Z"),
      completedAt: null,
    });
  });

  it("moves a permanent error or exhausted retry budget to dead", () => {
    const now = new Date("2026-07-17T00:00:00.000Z");

    expect(
      calculateTaskFailureTransition({
        attempt: 1,
        maxAttempts: 3,
        errorCodes: ["UPSTREAM_SCHEMA_CHANGED"],
        backoffPolicy,
        now,
      }).status,
    ).toBe("dead");
    expect(
      calculateTaskFailureTransition({
        attempt: 3,
        maxAttempts: 3,
        errorCodes: ["UPSTREAM_HTTP_503"],
        backoffPolicy,
        now,
      }),
    ).toEqual({ status: "dead", availableAt: now, completedAt: now });
  });

  it("only classifies temporary network, throttling, and upstream failures as retryable", () => {
    expect(isRetryableProbeErrorCode("ECONNRESET")).toBe(true);
    expect(isRetryableProbeErrorCode("UPSTREAM_HTTP_503")).toBe(true);
    expect(isRetryableProbeErrorCode("UPSTREAM_HTTP_404")).toBe(false);
    expect(isRetryableProbeErrorCode("TARGET_NOT_ALLOWLISTED")).toBe(false);
  });

  it("fails closed for real adapter schema, application-chain, policy, and count conflicts", () => {
    for (const code of [
      "UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED",
      "UNIVERSITY_EMPLOYMENT_COMPANY_MISMATCH",
      "UNIVERSITY_EMPLOYMENT_APPLICATION_METHOD_MISSING",
      "TARGET_NOT_ALLOWLISTED",
      "REDIRECT_NOT_ALLOWED",
      "BEISEN_LIST_COUNT_INCONSISTENT",
      "FANRUAN_LIST_INVALID_JSON",
      "INVALID_MEITUAN_JOB_ID",
      "INVALID_TENCENT_POST_ID",
      "UNEXPECTED_PROBE_ERROR",
      "UNIVERSITY_EMPLOYMENT_APPLICATION_EMAIL_AMBIGUOUS",
      "UPSTREAM_HTTP_403",
    ]) {
      expect(isHardRefreshConflictCode(code), code).toBe(true);
    }
    expect(isHardRefreshConflictCode("UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP")).toBe(false);
    expect(isHardRefreshConflictCode("UPSTREAM_HTTP_429")).toBe(false);
    expect(isHardRefreshConflictCode("ECONNRESET")).toBe(false);
  });

  it("only allows explicit non-internship filters to remain soft", () => {
    for (const code of [
      "BEISEN_NOT_EXPLICIT_INTERNSHIP",
      "FANRUAN_NOT_EXPLICIT_INTERNSHIP",
      "UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP",
      "UNIVERSITY_EMPLOYMENT_NOT_INTERNSHIP_SECTION",
    ]) {
      expect(isSafeSoftRefreshRejectionCode(code), code).toBe(true);
      expect(isHardRefreshConflictCode(code), code).toBe(false);
    }
    expect(isSafeSoftRefreshRejectionCode("UNKNOWN_NOT_EXPLICIT_INTERNSHIP")).toBe(false);
    expect(isHardRefreshConflictCode("UNKNOWN_NOT_EXPLICIT_INTERNSHIP")).toBe(true);
  });

  it("promotes an existing tracked job losing internship semantics to a hard conflict", () => {
    expect(
      scheduledRefreshRejectionCode({
        code: "UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP",
        runMode: "scheduled",
        refreshCoverage: "tracked_records",
        recordAlreadyTracked: true,
      }),
    ).toBe("TRACKED_RECORD_NOT_INTERNSHIP");
    expect(
      scheduledRefreshRejectionCode({
        code: "UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP",
        runMode: "scheduled",
        refreshCoverage: "tracked_records",
        recordAlreadyTracked: false,
      }),
    ).toBe("UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP");
    expect(isHardRefreshConflictCode("TRACKED_RECORD_NOT_INTERNSHIP")).toBe(true);
  });

  it("lets local scheduled refreshes serve pending and approved policies without widening probes", () => {
    expect(isSourcePolicyStatusAuthorizedForRun("pending_review", "scheduled")).toBe(true);
    expect(isSourcePolicyStatusAuthorizedForRun("approved", "scheduled")).toBe(true);
    expect(isSourcePolicyStatusAuthorizedForRun("approved", "probe")).toBe(false);
    expect(isSourcePolicyStatusAuthorizedForRun("paused", "scheduled")).toBe(false);
  });

  it("maps only explicit not-found responses to direct activity closure", () => {
    expect(directClosureReasonForErrorCode("UPSTREAM_HTTP_404")).toBe("http_404");
    expect(directClosureReasonForErrorCode("UPSTREAM_HTTP_410")).toBe("http_410");
    expect(directClosureReasonForErrorCode("UPSTREAM_HTTP_403")).toBeUndefined();
  });
});
