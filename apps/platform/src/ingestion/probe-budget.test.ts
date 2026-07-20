import { describe, expect, it } from "vitest";
import type { SourceConfig } from "../sources/source-config.js";
import { claimProbeRequest } from "./probe.js";

function sourceConfig(): SourceConfig {
  return {
    localProbe: {
      requestBudget: {
        maxItems: 5,
        maxPages: 2,
        maxRequests: 3,
        minimumIntervalMs: 1_000,
      },
    },
  } as SourceConfig;
}

describe("probe request budget", () => {
  it("rejects a page before issuing a request beyond maxPages", () => {
    const usage = { requests: 0, pages: 0 };
    claimProbeRequest(sourceConfig(), usage, "page");
    claimProbeRequest(sourceConfig(), usage, "page");
    expect(() => claimProbeRequest(sourceConfig(), usage, "page")).toThrow(
      "PROBE_PAGE_BUDGET_EXCEEDED",
    );
    expect(usage).toEqual({ requests: 2, pages: 2 });
  });

  it("rejects any request before issuing one beyond maxRequests", () => {
    const usage = { requests: 0, pages: 0 };
    claimProbeRequest(sourceConfig(), usage, "page");
    claimProbeRequest(sourceConfig(), usage, "detail");
    claimProbeRequest(sourceConfig(), usage, "detail");
    expect(() => claimProbeRequest(sourceConfig(), usage, "detail")).toThrow(
      "PROBE_REQUEST_BUDGET_EXCEEDED",
    );
    expect(usage).toEqual({ requests: 3, pages: 1 });
  });
});
