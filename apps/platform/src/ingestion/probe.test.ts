import { describe, expect, it } from "vitest";
import { calculateTaskFailureTransition, isRetryableProbeErrorCode } from "./probe.js";

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
});
