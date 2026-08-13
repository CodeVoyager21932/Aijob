import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreateRecommendationRunFromSearchRequestSchema,
  JobRecommendationRunViewSchema,
} from "./matching.js";

const timestamp = "2026-08-13T00:00:00.000Z";

function runView() {
  const ownerId = randomUUID();
  const publishedJobId = randomUUID();
  const publishedJobVersionId = randomUUID();
  const item = {
    ordinal: 0,
    publishedJobVersionId,
    matchRunId: randomUUID(),
    eligibility: "no_explicit_conflict" as const,
    evidence: "explicit_evidence" as const,
    preference: "fits" as const,
    reasonCodes: ["PREFERENCE_FITS"],
    basisState: "complete" as const,
    coverage: {
      eligibility: { required: 1, evaluated: 1, met: 1, conflicts: 0, unknown: 0 },
      evidence: { applicable: 1, supported: 1, partial: 0, missing: 0, unknown: 0 },
      preference: { configured: 1, compared: 1, conflicts: 0, unknown: 0 },
    },
    gaps: [],
    unknownRequirementIds: [],
    lastVerifiedAt: timestamp,
    catalogState: "current" as const,
  };
  return {
    schemaVersion: "job-recommendation-run-view-v1" as const,
    run: {
      id: randomUUID(),
      ownerId,
      status: "succeeded" as const,
      candidateSetHash: "a".repeat(64),
      strategyVersion: "decision-readiness-v2",
      catalogState: "current" as const,
      items: [item],
      failureCode: null,
      createdAt: timestamp,
      completedAt: timestamp,
    },
    jobs: [
      {
        ordinal: 0,
        publishedJobId,
        publishedJobVersionId,
        display: {
          title: "产品实习生",
          companyName: "示例公司",
          locations: { state: "known" as const, value: ["深圳"], evidenceRefs: ["source#city"] },
          workMode: { state: "unknown" as const, reason: "source_not_stated" as const },
          deadlineAt: { state: "unknown" as const, reason: "source_not_stated" as const },
          sourceName: "示例公司招聘官网",
          lastVerifiedAt: timestamp,
        },
        officialUrl: "https://careers.example.com/jobs/one",
        catalogState: "current" as const,
      },
    ],
  };
}

describe("job recommendation adapter contracts", () => {
  it("accepts only a cursor-free strict catalog scope", () => {
    expect(
      CreateRecommendationRunFromSearchRequestSchema.parse({
        scope: { cities: ["深圳"], jobFamilies: ["product"] },
      }),
    ).toEqual({
      scope: {
        cities: ["深圳"],
        jobFamilies: ["product"],
        includeUnknownHardConditions: true,
      },
    });
    expect(
      CreateRecommendationRunFromSearchRequestSchema.safeParse({ scope: { cursor: "hidden" } })
        .success,
    ).toBe(false);
    expect(
      CreateRecommendationRunFromSearchRequestSchema.safeParse({ scope: { limit: 20 } }).success,
    ).toBe(false);
  });

  it("requires immutable job projections to align with succeeded run items", () => {
    const valid = runView();
    expect(JobRecommendationRunViewSchema.safeParse(valid).success).toBe(true);
    expect(
      JobRecommendationRunViewSchema.safeParse({
        ...valid,
        jobs: [{ ...valid.jobs[0], ordinal: 1 }],
      }).success,
    ).toBe(false);
    expect(
      JobRecommendationRunViewSchema.safeParse({
        ...valid,
        run: { ...valid.run, status: "processing", items: [] },
      }).success,
    ).toBe(false);
  });
});
