import { describe, expect, it } from "vitest";

import {
  CreateResumeTailoringRequestSchema,
  JobDetailSchema,
  MatchRunResultSchema,
  ResumeAnalysisSubmissionSchema,
  ResumeTailoringSegmentSchema,
} from "./index.js";

const unknown = { state: "unknown" as const, reason: "source_not_stated" as const };

describe("local complete MVP contracts", () => {
  it("keeps the existing job detail payload backward compatible", () => {
    const result = JobDetailSchema.safeParse({
      id: "job-1",
      publishedJobVersionId: null,
      companyName: "示例公司",
      title: "产品实习生",
      jobFamily: unknown,
      locations: unknown,
      weeklyAttendanceDays: unknown,
      durationMonths: unknown,
      source: {
        sourceId: "source-1",
        type: "organization_career_site",
        provenanceLevel: "organization_owned",
        displayName: "示例公司招聘",
        domain: "example.com",
        lastVerifiedAt: "2026-07-18T10:00:00+08:00",
        originalUrl: "https://example.com/jobs/1",
      },
      publicationState: "review",
      activityState: "active",
      displayStatus: "pending_review",
      department: unknown,
      jobCode: unknown,
      recruitmentType: unknown,
      employmentType: unknown,
      recruitmentBatch: unknown,
      earliestStartDate: unknown,
      graduationYears: unknown,
      postedAt: unknown,
      deadlineAt: unknown,
      responsibilitiesText: unknown,
      requirementsText: unknown,
      officialLink: "https://example.com/jobs/1",
    });

    expect(result.success).toBe(true);
  });

  it("rejects oversized files and mismatched file media types", () => {
    expect(
      ResumeAnalysisSubmissionSchema.safeParse({
        inputKind: "pdf",
        fileName: "resume.pdf",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteSize: 1024,
        contentSha256: "a".repeat(64),
      }).success,
    ).toBe(false);

    expect(
      ResumeAnalysisSubmissionSchema.safeParse({
        inputKind: "pdf",
        fileName: "resume.pdf",
        mediaType: "application/pdf",
        byteSize: 5 * 1024 * 1024 + 1,
        contentSha256: "a".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("requires explicit privacy consent for an AI tailoring request", () => {
    expect(
      CreateResumeTailoringRequestSchema.safeParse({
        resumeAnalysisId: "resume-1",
        publishedJobVersionId: "job-version-1",
        evidenceRevisionId: "evidence-1",
        privacyConsent: false,
      }).success,
    ).toBe(false);
  });

  it("keeps eligibility, evidence and preference as separate axes", () => {
    const result = MatchRunResultSchema.parse({
      eligibility: { status: "needs_information", reasons: [] },
      evidence: { status: "not_in_resume", reasons: [] },
      preference: { status: "fits", reasons: [] },
      unknownRequirementIds: ["requirement-1"],
    });

    expect(result.eligibility.status).toBe("needs_information");
    expect(result.evidence.status).toBe("not_in_resume");
    expect(result.preference.status).toBe("fits");
  });

  it("requires evidence and requirement references for every suggested segment", () => {
    expect(
      ResumeTailoringSegmentSchema.safeParse({
        id: "segment-1",
        ordinal: 0,
        originalText: "负责活动运营",
        suggestedText: "负责活动运营并复盘关键指标",
        reason: "与岗位的数据复盘要求对应",
        requirementIds: [],
        evidenceIds: [],
        decision: "pending",
        editedText: null,
      }).success,
    ).toBe(false);
  });
});
