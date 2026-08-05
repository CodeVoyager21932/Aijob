import { describe, expect, it } from "vitest";
import {
  shouldEnableCareerOsV2,
  shouldEnableInternalSurfaces,
  shouldEnableProductSurfaces,
  shouldRequireAlphaAccess,
} from "./environment";

describe("local-only web surfaces", () => {
  it.each([
    { input: { isDev: true, mode: "development" }, expected: true },
    { input: { isDev: true, mode: "production" }, expected: true },
    { input: { isDev: false, mode: "test" }, expected: true },
    { input: { isDev: false, mode: "alpha" }, expected: false },
    { input: { isDev: false, mode: "production" }, expected: false },
  ])("returns $expected for $input", ({ input, expected }) => {
    expect(shouldEnableInternalSurfaces(input)).toBe(expected);
  });

  it("does not enable local surfaces from an arbitrary mode name", () => {
    expect(shouldEnableInternalSurfaces({ isDev: false, mode: "local" })).toBe(false);
  });

  it.each([
    { input: { isDev: true, mode: "development" }, product: true, invite: false },
    { input: { isDev: false, mode: "test" }, product: true, invite: false },
    { input: { isDev: false, mode: "alpha" }, product: true, invite: true },
    { input: { isDev: false, mode: "production" }, product: false, invite: false },
  ])("separates product access from internal surfaces for $input", ({ input, product, invite }) => {
    expect(shouldEnableProductSurfaces(input)).toBe(product);
    expect(shouldRequireAlphaAccess(input)).toBe(invite);
  });

  it.each([
    { flag: "1", expected: true },
    { flag: "true", expected: true },
    { flag: " TRUE ", expected: true },
    { flag: "on", expected: true },
    { flag: "0", expected: false },
    { flag: "false", expected: false },
    { flag: "career-os", expected: false },
    { flag: undefined, expected: false },
  ])("enables Career OS only for an explicit flag value: $flag", ({ flag, expected }) => {
    expect(shouldEnableCareerOsV2({ flag })).toBe(expected);
  });
});
