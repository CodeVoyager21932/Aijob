import { describe, expect, it } from "vitest";
import {
  ConfirmResumeProfileRequestSchema,
  ConfirmResumeProfileResponseSchema,
  ResumeAnalysisViewSchema,
} from "./profile.js";

const timestamp = "2026-08-12T00:00:00.000Z";
const blockId = "11111111-1111-4111-8111-111111111111";

describe("atomic resume profile confirmation contract", () => {
  it("requires all three expected revisions in one command", () => {
    const parsed = ConfirmResumeProfileRequestSchema.parse({
      facts: { expectedRevision: 0, facts: [{ key: "current_student", value: true }] },
      preferences: {
        expectedRevision: 0,
        preferences: { cities: [], jobFamilies: ["product"], companyNames: [], workModes: [] },
      },
      evidence: {
        expectedRevision: 0,
        resumeAnalysisId: "analysis-one",
        document: {
          schemaVersion: "resume-document-v1",
          sections: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              ordinal: 0,
              title: "项目经历",
              blocks: [{ id: blockId, ordinal: 0, text: "完成用户研究并推动改版。" }],
            },
          ],
        },
        evidence: [
          {
            id: "evidence-one",
            resumeAnalysisId: "analysis-one",
            sourceBlockId: blockId,
            section: "项目经历",
            evidenceType: "project",
            statement: "完成用户研究并推动改版。",
            skills: ["用户研究"],
            outcomes: [],
            confirmed: true,
          },
        ],
      },
    });
    expect(parsed.preferences.expectedRevision).toBe(0);
    expect(
      ConfirmResumeProfileRequestSchema.safeParse({
        ...parsed,
        preferences: { preferences: parsed.preferences.preferences },
      }).success,
    ).toBe(false);
  });

  it("returns the three committed immutable revisions together", () => {
    const base = {
      id: "revision-one",
      ownerId: "owner-one",
      revision: 1,
      baseRevision: null,
      contentHash: "a".repeat(64),
      confirmedAt: timestamp,
      createdAt: timestamp,
    };
    expect(
      ConfirmResumeProfileResponseSchema.safeParse({
        factsRevision: { ...base, facts: [] },
        preferencesRevision: {
          ...base,
          id: "revision-two",
          preferences: { cities: [], jobFamilies: [], companyNames: [], workModes: [] },
        },
        evidenceRevision: {
          ...base,
          id: "revision-three",
          resumeAnalysisId: null,
          schemaVersion: "resume-evidence-v2",
          documentRevisionId: null,
          evidence: [],
        },
      }).success,
    ).toBe(true);
  });

  it("validates the hydrated resume analysis used by the confirmation route", () => {
    const analysisId = "33333333-3333-4333-8333-333333333333";
    expect(
      ResumeAnalysisViewSchema.safeParse({
        id: analysisId,
        ownerId: "owner-one",
        inputKind: "pasted_text",
        status: "succeeded",
        piiFindings: [],
        requiresPrivacyConfirmation: false,
        purgeAfter: timestamp,
        confirmedAt: null,
        purgedAt: null,
        failureCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        result: {
          version: "resume-analysis-v2",
          redactedText: "项目经历",
          document: {
            schemaVersion: "resume-document-v1",
            sections: [
              {
                id: "44444444-4444-4444-8444-444444444444",
                ordinal: 0,
                title: "项目经历",
                blocks: [{ id: blockId, ordinal: 0, text: "完成用户研究。" }],
              },
            ],
          },
          candidateFacts: [{ key: "current_student", value: true, confirmed: false }],
          candidateEvidence: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              sourceBlockId: blockId,
              section: "项目经历",
              evidenceType: "project",
              statement: "完成用户研究。",
              skills: ["用户研究"],
              outcomes: [],
              confirmed: false,
            },
          ],
        },
      }).success,
    ).toBe(true);
  });
});
