import { z } from "zod";
import { RevisionSchema, TimestampSchema, UuidSchema } from "./common.js";
import { CareerOwnerSchema } from "./identity.js";

const CountSchema = z.number().int().nonnegative();

export const CareerDataScopeCountsSchema = z
  .object({
    currentFacts: CountSchema,
    currentPreferences: CountSchema,
    currentEvidence: CountSchema,
    profileFactRevisions: CountSchema,
    preferenceRevisions: CountSchema,
    evidenceRevisions: CountSchema,
    resumeDocumentRevisions: CountSchema,
    resumeAnalysisMetadata: CountSchema,
    resumeAnalysisContentPendingDeletion: CountSchema,
    applicationCases: CountSchema,
    privateJobSnapshots: CountSchema,
    resumeDocuments: CountSchema,
    detachedResumeDocuments: CountSchema,
    resumeReviewRuns: CountSchema,
    interviewSessions: CountSchema,
    detachedInterviewSessions: CountSchema,
    debriefs: CountSchema,
    detachedDebriefs: CountSchema,
    knowledgeClips: CountSchema,
    legacyJobDecisions: CountSchema,
    legacyMatchRuns: CountSchema,
    legacyRecommendationRuns: CountSchema,
    legacyInsightRuns: CountSchema,
    legacyTailoringRuns: CountSchema,
    legacyExports: CountSchema,
    deletionAudits: CountSchema,
  })
  .strict();
export type CareerDataScopeCounts = z.infer<typeof CareerDataScopeCountsSchema>;

export const DetachedCareerAssetSchema = z
  .object({
    kind: z.enum(["interview_session", "debrief"]),
    id: UuidSchema,
    revision: RevisionSchema,
    title: z.string().trim().min(1).max(300),
    companyName: z.string().trim().min(1).max(300).nullable(),
    status: z.string().trim().min(1).max(50),
    createdAt: TimestampSchema,
  })
  .strict();
export type DetachedCareerAsset = z.infer<typeof DetachedCareerAssetSchema>;

export const CareerDataScopeResponseSchema = z
  .object({
    owner: CareerOwnerSchema,
    sessionExpiresAt: TimestampSchema,
    counts: CareerDataScopeCountsSchema,
    detachedAssets: z.array(DetachedCareerAssetSchema).max(5_000),
    detachedAssetsTruncated: z.boolean(),
  })
  .strict();
export type CareerDataScopeResponse = z.infer<typeof CareerDataScopeResponseSchema>;
