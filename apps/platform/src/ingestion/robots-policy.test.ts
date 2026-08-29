import { describe, expect, it } from "vitest";
import {
  effectiveMinimumIntervalMs,
  evaluateRobotsForSource,
  evaluateRobotsPath,
  parseRobots,
  type RobotsFetchOutcome,
} from "./robots-policy.js";

const fetched = (body: string): RobotsFetchOutcome => ({ status: "fetched", body });

describe("robots fail-closed behaviour (ADR-0033)", () => {
  it("denies when robots.txt cannot be retrieved", () => {
    for (const reason of ["not_found", "timeout", "http_error", "network_error"] as const) {
      const decision = evaluateRobotsPath({ status: "unavailable", reason }, "/jobs");
      expect(decision.allowed, reason).toBe(false);
      if (decision.allowed) throw new Error("UNREACHABLE");
      expect(decision.code).toBe("ROBOTS_UNAVAILABLE");
    }
  });

  it("allows when robots.txt exists but sets no rule for us or for the wildcard agent", () => {
    const decision = evaluateRobotsPath(
      fetched("User-agent: Googlebot\nDisallow: /jobs"),
      "/jobs",
    );
    expect(decision.allowed).toBe(true);
  });

  it("treats an empty Disallow as allowing everything", () => {
    expect(evaluateRobotsPath(fetched("User-agent: *\nDisallow:"), "/jobs").allowed).toBe(true);
  });
});

describe("robots path matching", () => {
  const wildcardBlocksJobs = fetched("User-agent: *\nDisallow: /jobs");

  it("blocks a disallowed prefix and permits unrelated paths", () => {
    expect(evaluateRobotsPath(wildcardBlocksJobs, "/jobs").allowed).toBe(false);
    expect(evaluateRobotsPath(wildcardBlocksJobs, "/jobs/detail/1").allowed).toBe(false);
    expect(evaluateRobotsPath(wildcardBlocksJobs, "/campus").allowed).toBe(true);
  });

  it("lets the longer Allow rule win over a shorter Disallow", () => {
    const body = "User-agent: *\nDisallow: /jobs\nAllow: /jobs/public";
    expect(evaluateRobotsPath(fetched(body), "/jobs/private").allowed).toBe(false);
    expect(evaluateRobotsPath(fetched(body), "/jobs/public/1").allowed).toBe(true);
  });

  it("honours the * wildcard inside a rule", () => {
    const body = "User-agent: *\nDisallow: /*/apply";
    expect(evaluateRobotsPath(fetched(body), "/jobs/apply").allowed).toBe(false);
    expect(evaluateRobotsPath(fetched(body), "/jobs/detail").allowed).toBe(true);
  });

  it("honours the $ end anchor", () => {
    const body = "User-agent: *\nDisallow: /jobs$";
    expect(evaluateRobotsPath(fetched(body), "/jobs").allowed).toBe(false);
    expect(evaluateRobotsPath(fetched(body), "/jobs/detail").allowed).toBe(true);
  });

  it("ignores comments and blank lines", () => {
    const body = "# comment\n\nUser-agent: *   # us\nDisallow: /jobs  # blocked\n";
    expect(evaluateRobotsPath(fetched(body), "/jobs").allowed).toBe(false);
  });
});

describe("robots agent group selection", () => {
  it("prefers a group naming our collector over the wildcard group", () => {
    const body = [
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: AijobLocalProbe",
      "Disallow: /private",
    ].join("\n");

    expect(evaluateRobotsPath(fetched(body), "/jobs").allowed).toBe(true);
    expect(evaluateRobotsPath(fetched(body), "/private").allowed).toBe(false);
  });

  it("shares one rule block across consecutive user-agent lines", () => {
    const body = "User-agent: Googlebot\nUser-agent: *\nDisallow: /jobs";
    const policy = parseRobots(body);
    expect(policy.hasApplicableGroup).toBe(true);
    expect(evaluateRobotsPath(fetched(body), "/jobs").allowed).toBe(false);
  });

  it("takes the strictest crawl delay when several applicable groups declare one", () => {
    const body = [
      "User-agent: *",
      "Crawl-delay: 2",
      "Disallow: /private",
      "",
      "User-agent: *",
      "Crawl-delay: 9",
    ].join("\n");

    const decision = evaluateRobotsPath(fetched(body), "/jobs");
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error("UNREACHABLE");
    expect(decision.crawlDelaySeconds).toBe(9);
  });
});

describe("crawl delay becomes the interval floor", () => {
  it("raises the configured interval when robots asks for more", () => {
    expect(
      effectiveMinimumIntervalMs({ configuredMinimumIntervalMs: 1500, crawlDelaySeconds: 5 }),
    ).toBe(5000);
  });

  it("keeps the stricter configured interval when robots asks for less", () => {
    expect(
      effectiveMinimumIntervalMs({ configuredMinimumIntervalMs: 3000, crawlDelaySeconds: 1 }),
    ).toBe(3000);
  });

  it("leaves the configured interval untouched when robots states no delay", () => {
    expect(
      effectiveMinimumIntervalMs({ configuredMinimumIntervalMs: 2000, crawlDelaySeconds: undefined }),
    ).toBe(2000);
  });
});

describe("per-source robots verdict", () => {
  const targets = [
    { pathPrefix: "/api/job/list", method: "POST" as const },
    { pathPrefix: "/api/job/detail", method: "POST" as const },
  ];

  it("allows a source only when every registered target is permitted", () => {
    const verdict = evaluateRobotsForSource(
      fetched("User-agent: *\nDisallow: /admin"),
      targets,
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.code).toBeNull();
  });

  it("fails the whole source when any single registered target is disallowed", () => {
    const verdict = evaluateRobotsForSource(
      fetched("User-agent: *\nDisallow: /api/job/detail"),
      targets,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe("ROBOTS_DISALLOWED");
    expect(verdict.blockedPathPrefix).toBe("/api/job/detail");
    expect(verdict.matchedRule).toBe("/api/job/detail");
  });

  it("fails the whole source when robots is unavailable", () => {
    const verdict = evaluateRobotsForSource(
      { status: "unavailable", reason: "timeout" },
      targets,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe("ROBOTS_UNAVAILABLE");
  });

  it("refuses a source that declares no registered target", () => {
    const verdict = evaluateRobotsForSource(fetched("User-agent: *\nDisallow:"), []);
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe("ROBOTS_DISALLOWED");
  });

  it("reports the strictest crawl delay across targets", () => {
    const verdict = evaluateRobotsForSource(
      fetched("User-agent: *\nCrawl-delay: 3\nDisallow: /admin"),
      targets,
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.crawlDelaySeconds).toBe(3);
    expect(
      effectiveMinimumIntervalMs({
        configuredMinimumIntervalMs: 1500,
        crawlDelaySeconds: verdict.crawlDelaySeconds,
      }),
    ).toBe(3000);
  });
});
