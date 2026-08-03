import { describe, expect, it } from "vitest";
import {
  assertSourceRefreshStaggerHours,
  planStableSourceRefreshOffsets,
  sourceRefreshStaggerOffsetMilliseconds,
} from "./source-refresh-stagger.js";

describe("source refresh schedule staggering", () => {
  it("keeps the default mode immediate", () => {
    expect(sourceRefreshStaggerOffsetMilliseconds("shining3d-internships", 0)).toBe(0);
  });

  it("derives a stable source-key offset inside the selected window", () => {
    const first = sourceRefreshStaggerOffsetMilliseconds("shining3d-internships", 24);
    const repeated = sourceRefreshStaggerOffsetMilliseconds("shining3d-internships", 24);
    const otherSource = sourceRefreshStaggerOffsetMilliseconds("onerobotics-internships", 24);

    expect(repeated).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(24 * 60 * 60 * 1_000);
    expect(otherSource).not.toBe(first);
  });

  it.each([-1, 1.5, 25, Number.NaN])("rejects an invalid %s-hour window", (staggerHours) => {
    expect(() => assertSourceRefreshStaggerHours(staggerHours)).toThrow(
      "SOURCE_REFRESH_STAGGER_HOURS_OUT_OF_RANGE",
    );
  });

  it("stably distributes 110 sources through a rolling twelve-hour window", () => {
    const sourceKeys = Array.from(
      { length: 110 },
      (_, index) => `source-${String(index).padStart(3, "0")}`,
    );
    const planned = planStableSourceRefreshOffsets(sourceKeys, 12);
    const repeated = planStableSourceRefreshOffsets([...sourceKeys].reverse(), 12);
    const bySourceKey = (rows: typeof planned) =>
      [...rows].sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
    const windowMilliseconds = 12 * 60 * 60 * 1_000;
    const hourMilliseconds = 60 * 60 * 1_000;

    expect(bySourceKey(repeated)).toEqual(bySourceKey(planned));
    expect(new Set(planned.map(({ sourceKey }) => sourceKey)).size).toBe(110);
    expect(planned.every(({ offsetMilliseconds }) => offsetMilliseconds >= 0)).toBe(true);
    expect(planned.every(({ offsetMilliseconds }) => offsetMilliseconds < windowMilliseconds)).toBe(
      true,
    );

    for (const start of planned.map(({ offsetMilliseconds }) => offsetMilliseconds)) {
      const startsInRollingHour = planned.filter(({ offsetMilliseconds }) => {
        const distance = (offsetMilliseconds - start + windowMilliseconds) % windowMilliseconds;
        return distance < hourMilliseconds;
      }).length;
      expect(startsInRollingHour).toBeLessThanOrEqual(11);
    }
  });

  it("rejects duplicate source keys before assigning offsets", () => {
    expect(() => planStableSourceRefreshOffsets(["duplicate", "duplicate"], 12)).toThrow(
      "SOURCE_REFRESH_STAGGER_DUPLICATE_SOURCE_KEY",
    );
  });
});
