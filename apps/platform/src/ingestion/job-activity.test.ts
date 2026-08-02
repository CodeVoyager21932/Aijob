import { describe, expect, it } from "vitest";
import { nextAbsenceProjection } from "./job-activity.js";

describe("source job absence projection", () => {
  it("requires two complete absences separated by one refresh interval", () => {
    const first = nextAbsenceProjection({
      current: { state: "active", count: 0, lastAbsentAt: null },
      observedAt: new Date("2026-08-01T00:00:00.000Z"),
      minimumHours: 24,
    });
    expect(first).toEqual({
      state: "uncertain",
      count: 1,
      lastAbsentAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(
      nextAbsenceProjection({
        current: first,
        observedAt: new Date("2026-08-01T23:59:59.000Z"),
        minimumHours: 24,
      }),
    ).toBe(first);

    expect(
      nextAbsenceProjection({
        current: first,
        observedAt: new Date("2026-08-02T00:00:00.000Z"),
        minimumHours: 24,
      }),
    ).toEqual({
      state: "closed",
      count: 2,
      lastAbsentAt: new Date("2026-08-02T00:00:00.000Z"),
    });
  });
});
