import { describe, expect, it } from "vitest";
import { shouldEnableLocalSurfaces } from "./environment";

describe("local-only web surfaces", () => {
  it.each([
    { input: { isDev: true, mode: "development" }, expected: true },
    { input: { isDev: true, mode: "production" }, expected: true },
    { input: { isDev: false, mode: "test" }, expected: true },
    { input: { isDev: false, mode: "alpha" }, expected: false },
    { input: { isDev: false, mode: "production" }, expected: false },
  ])("returns $expected for $input", ({ input, expected }) => {
    expect(shouldEnableLocalSurfaces(input)).toBe(expected);
  });

  it("does not enable local surfaces from an arbitrary mode name", () => {
    expect(shouldEnableLocalSurfaces({ isDev: false, mode: "local" })).toBe(false);
  });
});
