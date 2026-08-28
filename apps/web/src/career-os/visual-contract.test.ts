import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./career-os.css", import.meta.url), "utf8");

describe("Career OS visual source contract", () => {
  it("does not encode UI text below twelve pixels", () => {
    const undersizedRem = [...css.matchAll(/font-size:\s*(0?\.\d+)rem/g)]
      .map((match) => Number(match[1]))
      .filter((size) => size < 0.75);
    const undersizedPixels = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)]
      .map((match) => Number(match[1]))
      .filter((size) => size < 12);

    expect({ rem: undersizedRem, pixels: undersizedPixels }).toEqual({ rem: [], pixels: [] });
  });

  it("uses standard numeric font weights", () => {
    const nonstandard = [...css.matchAll(/font-weight:\s*(\d+)/g)]
      .map((match) => Number(match[1]))
      .filter((weight) => weight % 100 !== 0);

    expect(nonstandard).toEqual([]);
  });

  it("caps the main workspace headings at the thirty-two-pixel title token", () => {
    for (const selector of [
      ".career-page-heading h1",
      ".career-case-header h1",
      ".career-resume-assets__hero h1",
      ".career-job-workspace__identity h1",
      ".career-legacy-tailoring > .product-hero h1",
    ]) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(css).toMatch(
        new RegExp(`${escaped}\\s*\\{[^}]*font-size:\\s*var\\(--co-title-lg\\)`, "s"),
      );
    }
  });

  it("keeps legacy pages inside the Career OS type scale", () => {
    expect(css).toMatch(
      /\.career-os\s+:where\([^{]*\.button,[^{]*\.full-field,[^{]*\.consent-row,[^{]*\)\s*\{[^}]*font-weight:\s*700/s,
    );
    expect(css).toMatch(
      /\.career-legacy-tailoring \.tailoring-segment > header div > span,[^{]*\.career-legacy-tailoring \.segment-status\s*\{[^}]*font-size:\s*var\(--co-text-xs\)/s,
    );
  });
});
