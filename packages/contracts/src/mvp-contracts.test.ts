import { describe, expect, it } from "vitest";

import {
  CompanyScaleSchema,
  CreateResumeTailoringRequestSchema,
  JobDetailSchema,
  MatchRunResultSchema,
  normalizeCityPreferences,
  ProfileDeletionSchema,
  ResumeAnalysisSubmissionSchema,
  ResumeTailoringRunSchema,
  ResumeTailoringSegmentSchema,
} from "./index.js";

const unknown = { state: "unknown" as const, reason: "source_not_stated" as const };

describe("local complete MVP contracts", () => {
  it("keeps deletion status wire output free of receipt-only owner fields", () => {
    expect(
      ProfileDeletionSchema.parse({
        id: "deletion-1",
        ownerId: "must-not-leak",
        requestedOwnerEpoch: 1,
        status: "queued",
        failureCode: null,
        requestedAt: "2026-07-29T00:00:00.000Z",
        completedAt: null,
        updatedAt: "2026-07-29T00:00:00.000Z",
      }),
    ).toEqual({
      id: "deletion-1",
      status: "queued",
      failureCode: null,
      requestedAt: "2026-07-29T00:00:00.000Z",
      completedAt: null,
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
  });

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

  it("requires company scale evidence to be complete or entirely absent", () => {
    expect(
      CompanyScaleSchema.safeParse({
        band: "unknown",
        evidenceUrl: "https://example.com/about",
        evidenceText: null,
        lastVerifiedAt: null,
      }).success,
    ).toBe(false);
    expect(
      CompanyScaleSchema.safeParse({
        band: "medium",
        evidenceUrl: "https://example.com/about",
        evidenceText: "公司官方页面披露员工规模为 500 人。",
        lastVerifiedAt: null,
      }).success,
    ).toBe(false);
    expect(
      CompanyScaleSchema.safeParse({
        band: "unknown",
        evidenceUrl: null,
        evidenceText: null,
        lastVerifiedAt: null,
      }).success,
    ).toBe(true);
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

  it.each(["都可以", "不限", "无所谓", "不限城市"])(
    "normalizes the unlimited-city alias %s to no city preference",
    (alias) => {
      expect(normalizeCityPreferences([alias])).toEqual({
        cities: [],
        mixedUnlimitedValue: false,
      });
    },
  );

  it("flags unlimited-city aliases mixed with concrete cities", () => {
    expect(normalizeCityPreferences(["不限", "上海"])).toEqual({
      cities: [],
      mixedUnlimitedValue: true,
    });
  });

  it("keeps eligibility, evidence and preference as separate axes", () => {
    const result = MatchRunResultSchema.parse({
      eligibility: { status: "needs_information", reasons: [] },
      evidence: { status: "not_in_resume", reasons: [] },
      preference: { status: "fits", reasons: [] },
      basisState: "partial",
      coverage: {
        eligibility: { required: 1, evaluated: 0, met: 0, conflicts: 0, unknown: 1 },
        evidence: { applicable: 1, supported: 0, partial: 0, missing: 1, unknown: 0 },
        preference: { configured: 1, compared: 1, conflicts: 0, unknown: 0 },
      },
      gaps: [
        {
          axis: "eligibility",
          type: "missing_job_value",
          requirementId: "requirement-1",
          explanation: "岗位未说明该项资格条件",
        },
      ],
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

  it("does not expose backend AI provider configuration in the user contract", () => {
    const result = ResumeTailoringRunSchema.parse({
      id: "tailoring-1",
      ownerId: "owner-1",
      status: "succeeded",
      resumeAnalysisId: "resume-1",
      publishedJobVersionId: "job-version-1",
      requirementSetId: "requirement-set-1",
      evidenceRevisionId: "evidence-1",
      providerAdapter: "internal-provider",
      model: "internal-model",
      promptVersion: "internal-prompt",
      schemaVersion: "internal-schema",
      templateVersion: "internal-template",
      usedTemplateFallback: false,
      segments: [],
      failureCode: null,
      createdAt: "2026-07-19T00:00:00.000Z",
      completedAt: "2026-07-19T00:00:01.000Z",
    });

    expect(result).not.toHaveProperty("providerAdapter");
    expect(result).not.toHaveProperty("model");
    expect(result).not.toHaveProperty("promptVersion");
  });
});
