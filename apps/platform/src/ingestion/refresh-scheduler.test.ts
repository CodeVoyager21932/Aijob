import { describe, expect, it } from "vitest";
import { isTransportErrorCode, remainingHourlyCapacity } from "./refresh-scheduler.js";

describe("source refresh scheduler limits", () => {
  it("counts distinct sources toward the hourly maximum", () => {
    expect(remainingHourlyCapacity(["a", "a", "b"])).toBe(1);
    expect(remainingHourlyCapacity(["a", "b", "c"])).toBe(0);
  });

  it("opens the transport category only for transport failures", () => {
    expect(isTransportErrorCode("ECONNRESET")).toBe(true);
    expect(isTransportErrorCode("UPSTREAM_SCHEMA_CHANGED")).toBe(false);
    expect(isTransportErrorCode("UPSTREAM_HTTP_500")).toBe(false);
  });
});
