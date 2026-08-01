import { describe, expect, it } from "vitest";
import {
  assertSourceRefreshStaggerHours,
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
});
