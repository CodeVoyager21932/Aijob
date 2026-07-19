import type { MatchRunResult } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { compareRecommendations, recommendationReasonCodes } from "./ranking.js";

function result(
  eligibility: MatchRunResult["eligibility"]["status"],
  preference: MatchRunResult["preference"]["status"],
  evidence: MatchRunResult["evidence"]["status"],
): MatchRunResult {
  return {
    eligibility: { status: eligibility, reasons: [] },
    preference: { status: preference, reasons: [] },
    evidence: { status: evidence, reasons: [] },
    unknownRequirementIds: [],
  };
}

describe("deterministic recommendation ranking", () => {
  it("prioritizes eligibility before preference and evidence", () => {
    const safe = {
      publishedJobVersionId: "job-safe",
      result: result("no_explicit_conflict", "does_not_fit", "not_in_resume"),
      lastVerifiedAt: new Date("2026-07-01T00:00:00Z"),
    };
    const conflict = {
      publishedJobVersionId: "job-conflict",
      result: result("explicit_conflict", "fits", "explicit_evidence"),
      lastVerifiedAt: new Date("2026-07-18T00:00:00Z"),
    };

    expect(
      [conflict, safe].sort(compareRecommendations).map((item) => item.publishedJobVersionId),
    ).toEqual(["job-safe", "job-conflict"]);
  });

  it("uses freshness and stable id only after the three axes", () => {
    const sameResult = result("no_explicit_conflict", "fits", "explicit_evidence");
    const items = [
      {
        publishedJobVersionId: "b",
        result: sameResult,
        lastVerifiedAt: new Date("2026-07-17T00:00:00Z"),
      },
      {
        publishedJobVersionId: "a",
        result: sameResult,
        lastVerifiedAt: new Date("2026-07-18T00:00:00Z"),
      },
    ];

    expect(items.sort(compareRecommendations).map((item) => item.publishedJobVersionId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("returns reason codes rather than a user-facing percentage", () => {
    expect(
      recommendationReasonCodes(result("no_explicit_conflict", "fits", "partial_evidence")),
    ).toEqual(["NO_EXPLICIT_ELIGIBILITY_CONFLICT", "PARTIAL_RESUME_EVIDENCE", "PREFERENCES_FIT"]);
  });
});
