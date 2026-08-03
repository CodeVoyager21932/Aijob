import { describe, expect, it } from "vitest";
import { buildManualBrowserImportIdempotencyKey } from "./manual-browser-import.js";

describe("manual browser import idempotency", () => {
  const baseline = {
    sourceId: "00000000-0000-4000-8000-000000000001",
    policyVersion: 1,
    adapterVersion: "1",
    normalizerVersion: "1",
    pipelineVersion: "1",
    snapshotHash: "a".repeat(64),
  };

  it("reuses the exact processing contract", () => {
    expect(buildManualBrowserImportIdempotencyKey(baseline)).toBe(
      buildManualBrowserImportIdempotencyKey({ ...baseline }),
    );
  });

  it("allows a snapshot to be replayed after normalizer or pipeline upgrades", () => {
    const key = buildManualBrowserImportIdempotencyKey(baseline);
    expect(
      buildManualBrowserImportIdempotencyKey({ ...baseline, normalizerVersion: "2" }),
    ).not.toBe(key);
    expect(
      buildManualBrowserImportIdempotencyKey({ ...baseline, pipelineVersion: "2" }),
    ).not.toBe(key);
  });
});
