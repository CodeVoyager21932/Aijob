import { describe, expect, it } from "vitest";
import {
  dynamicHourlySourceLimit,
  immediateRefreshWindowStart,
  isTransportErrorCode,
  refreshCapacityProfile,
  remainingHourlyCapacity,
} from "./refresh-scheduler.js";

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

  it.each([
    [0, 3],
    [21, 3],
    [22, 3],
    [23, 3],
    [24, 3],
    [25, 4],
    [110, 11],
    [132, 12],
    [500, 12],
  ])("sets %s deterministic sources to a %s-source hourly limit", (sources, expected) => {
    expect(dynamicHourlySourceLimit(sources)).toBe(expected);
  });

  it.each([-1, 1.5, Number.NaN])("rejects an invalid source count %s", (sources) => {
    expect(() => dynamicHourlySourceLimit(sources)).toThrow("SOURCE_REFRESH_COUNT_INVALID");
  });

  it("keeps the legacy limit until every deterministic source targets twelve hours", () => {
    expect(refreshCapacityProfile(["12h", "24h"])).toMatchObject({
      enabledDeterministicSources: 2,
      maximumSourceStartsPerHour: 3,
      mode: "legacy",
    });
    expect(refreshCapacityProfile(Array.from({ length: 110 }, () => "12h"))).toMatchObject({
      enabledDeterministicSources: 110,
      maximumSourceStartsPerHour: 11,
      mode: "rolling_12h",
    });
  });

  it("uses one stable UTC-hour window for repeated immediate refresh requests", () => {
    expect(immediateRefreshWindowStart(new Date("2026-08-03T08:34:56.789Z"))).toEqual(
      new Date("2026-08-03T08:00:00.000Z"),
    );
    expect(immediateRefreshWindowStart(new Date("2026-08-03T08:59:59.999Z"))).toEqual(
      new Date("2026-08-03T08:00:00.000Z"),
    );
  });
});
