import { describe, expect, it } from "vitest";
import { CareerDataScopeResponseSchema } from "./career-data-scope.js";

const timestamp = "2026-08-12T00:00:00.000Z";

function zeroCounts() {
  return {
    currentFacts: 0,
    currentPreferences: 0,
    currentEvidence: 0,
    profileFactRevisions: 0,
    preferenceRevisions: 0,
    evidenceRevisions: 0,
    resumeDocumentRevisions: 0,
    resumeAnalysisMetadata: 0,
    resumeAnalysisContentPendingDeletion: 0,
    applicationCases: 0,
    privateJobSnapshots: 0,
    resumeDocuments: 0,
    detachedResumeDocuments: 0,
    resumeReviewRuns: 0,
    interviewSessions: 0,
    detachedInterviewSessions: 0,
    debriefs: 0,
    detachedDebriefs: 0,
    knowledgeClips: 0,
    legacyJobDecisions: 0,
    legacyMatchRuns: 0,
    legacyRecommendationRuns: 0,
    legacyInsightRuns: 0,
    legacyTailoringRuns: 0,
    legacyExports: 0,
    deletionAudits: 0,
  };
}

describe("career data scope contract", () => {
  it("keeps the owner lifecycle and detached assets explicit", () => {
    const parsed = CareerDataScopeResponseSchema.parse({
      owner: {
        id: "owner-local",
        status: "active",
        epoch: 1,
        retentionMode: "anonymous_ttl",
        retentionExpiresAt: "2026-09-11T00:00:00.000Z",
        accountId: null,
        createdAt: timestamp,
        lastSeenAt: timestamp,
        deletedAt: null,
      },
      sessionExpiresAt: "2026-09-11T00:00:00.000Z",
      counts: { ...zeroCounts(), interviewSessions: 1, detachedInterviewSessions: 1 },
      detachedAssets: [
        {
          kind: "interview_session",
          id: "11111111-1111-4111-8111-111111111111",
          revision: 2,
          title: "产品实习生",
          companyName: "示例企业",
          status: "completed",
          createdAt: timestamp,
        },
      ],
      detachedAssetsTruncated: false,
    });

    expect(parsed.counts.detachedInterviewSessions).toBe(1);
    expect(parsed.detachedAssets[0]?.kind).toBe("interview_session");
  });

  it("rejects hidden credential material and negative counts", () => {
    expect(
      CareerDataScopeResponseSchema.safeParse({
        owner: {
          id: "owner-local",
          status: "active",
          epoch: 1,
          retentionMode: "anonymous_ttl",
          retentionExpiresAt: "2026-09-11T00:00:00.000Z",
          accountId: null,
          createdAt: timestamp,
          lastSeenAt: timestamp,
          deletedAt: null,
          sessionToken: "must-not-leak",
        },
        sessionExpiresAt: timestamp,
        counts: { ...zeroCounts(), applicationCases: -1 },
        detachedAssets: [],
        detachedAssetsTruncated: false,
      }).success,
    ).toBe(false);
  });
});
