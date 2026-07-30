import { describe, expect, it } from "vitest";
import { safeOfficialUrl, safeResearchSearchPath } from "./navigation";
import type { ResearchOfficialTarget } from "./types";

const officialTarget: ResearchOfficialTarget = {
  scheme: "https",
  host: "careers.example",
  port: 443,
  pathPrefix: "/jobs/",
  allowedQueryParameters: ["id"],
};

describe("research detail navigation boundaries", () => {
  it("preserves only the exact same-origin research list and its filters", () => {
    expect(safeResearchSearchPath("/research/jobs?q=运营&city=shenzhen")).toBe(
      "/research/jobs?q=%E8%BF%90%E8%90%A5&city=shenzhen",
    );
  });

  it.each([
    "https://attacker.example/research/jobs",
    "//attacker.example/research/jobs",
    "/research/jobs/fake-detail?returnUrl=/research/jobs",
    "/internal-preview/jobs",
    "not a valid URL %",
  ])("rejects an arbitrary return target: %s", (candidate) => {
    expect(safeResearchSearchPath(candidate)).toBe("/research/jobs");
  });

  it("accepts only an exact HTTPS official target", () => {
    expect(safeOfficialUrl("https://careers.example/jobs/1?id=1", officialTarget)?.hostname).toBe(
      "careers.example",
    );
    expect(safeOfficialUrl("http://careers.example/jobs/1", officialTarget)).toBeNull();
    expect(safeOfficialUrl("https://careers.example/other/1", officialTarget)).toBeNull();
    expect(
      safeOfficialUrl("https://careers.example/jobs-impersonation/1", {
        ...officialTarget,
        pathPrefix: "/jobs",
      }),
    ).toBeNull();
    expect(
      safeOfficialUrl("https://careers.example/jobs/1?token=secret", officialTarget),
    ).toBeNull();
    expect(safeOfficialUrl("https://attacker.example/jobs/1", officialTarget)).toBeNull();
    expect(safeOfficialUrl("javascript:alert(1)", officialTarget)).toBeNull();
    expect(safeOfficialUrl("not a url", officialTarget)).toBeNull();
  });
});
