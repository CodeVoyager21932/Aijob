import { z } from "zod";

import { IdentifierSchema, Sha256Schema, TimestampSchema } from "./common.js";
import {
  AsyncRunStatusSchema,
  EligibilityStatusSchema,
  EvidenceMatchStatusSchema,
  PreferenceMatchStatusSchema,
} from "./enums.js";

export const RequirementKindSchema = z.enum([
  "graduation_year",
  "student_status",
  "city",
  "arrival_date",
  "weekly_attendance",
  "duration",
  "education",
  "major",
  "language",
  "skill",
  "experience",
  "other",
]);
export type RequirementKind = z.infer<typeof RequirementKindSchema>;

export const JobRequirementSchema = z.object({
  id: IdentifierSchema,
  kind: RequirementKindSchema,
  operator: z.enum([
    "equals",
    "one_of",
    "at_least",
    "at_most",
    "before_or_on",
    "after_or_on",
    "contains",
    "unknown",
  ]),
  expectedValue: z.unknown(),
  sourceText: z.string().trim().min(1),
  evidenceRefs: z.array(IdentifierSchema).min(1),
  required: z.boolean(),
});
export type JobRequirement = z.infer<typeof JobRequirementSchema>;

export const JobRequirementSetSchema = z.object({
  id: IdentifierSchema,
  publishedJobVersionId: IdentifierSchema,
  schemaVersion: z.string().trim().min(1),
  requirements: z.array(JobRequirementSchema),
  contentHash: Sha256Schema,
  createdAt: TimestampSchema,
});
export type JobRequirementSet = z.infer<typeof JobRequirementSetSchema>;

const MatchAxisReasonSchema = z.object({
  code: z.string().trim().min(1),
  requirementIds: z.array(IdentifierSchema),
  evidenceIds: z.array(IdentifierSchema),
  explanation: z.string().trim().min(1),
});

export const EligibilityResultSchema = z.object({
  status: EligibilityStatusSchema,
  reasons: z.array(MatchAxisReasonSchema),
});
export type EligibilityResult = z.infer<typeof EligibilityResultSchema>;

export const EvidenceMatchResultSchema = z.object({
  status: EvidenceMatchStatusSchema,
  reasons: z.array(MatchAxisReasonSchema),
});
export type EvidenceMatchResult = z.infer<typeof EvidenceMatchResultSchema>;

export const PreferenceMatchResultSchema = z.object({
  status: PreferenceMatchStatusSchema,
  reasons: z.array(MatchAxisReasonSchema),
});
export type PreferenceMatchResult = z.infer<typeof PreferenceMatchResultSchema>;

export const MatchRunResultSchema = z.object({
  eligibility: EligibilityResultSchema,
  evidence: EvidenceMatchResultSchema,
  preference: PreferenceMatchResultSchema,
  unknownRequirementIds: z.array(IdentifierSchema),
});
export type MatchRunResult = z.infer<typeof MatchRunResultSchema>;

export const CreateMatchRunRequestSchema = z.object({
  publishedJobVersionId: IdentifierSchema,
  profileFactRevisionId: IdentifierSchema,
  preferenceRevisionId: IdentifierSchema,
  evidenceRevisionId: IdentifierSchema,
});
export type CreateMatchRunRequest = z.infer<typeof CreateMatchRunRequestSchema>;

export const MatchRunSchema = z.object({
  id: IdentifierSchema,
  ownerId: IdentifierSchema,
  status: AsyncRunStatusSchema,
  publishedJobVersionId: IdentifierSchema,
  requirementSetId: IdentifierSchema,
  profileFactRevisionId: IdentifierSchema,
  preferenceRevisionId: IdentifierSchema,
  evidenceRevisionId: IdentifierSchema,
  ruleVersion: z.string().trim().min(1),
  dictionaryVersion: z.string().trim().min(1),
  templateVersion: z.string().trim().min(1),
  result: MatchRunResultSchema.nullable(),
  failureCode: z.string().trim().min(1).nullable(),
  createdAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
});
export type MatchRun = z.infer<typeof MatchRunSchema>;

export const CreateRecommendationRunRequestSchema = z.object({
  profileFactRevisionId: IdentifierSchema,
  preferenceRevisionId: IdentifierSchema,
  evidenceRevisionId: IdentifierSchema,
  candidateJobVersionIds: z.array(IdentifierSchema).min(1).max(500),
});
export type CreateRecommendationRunRequest = z.infer<typeof CreateRecommendationRunRequestSchema>;

export const RecommendationCatalogStateSchema = z.enum(["current", "stale", "invalid"]);
export type RecommendationCatalogState = z.infer<typeof RecommendationCatalogStateSchema>;

export const RecommendationItemSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  publishedJobVersionId: IdentifierSchema,
  matchRunId: IdentifierSchema,
  eligibility: EligibilityStatusSchema,
  evidence: EvidenceMatchStatusSchema,
  preference: PreferenceMatchStatusSchema,
  reasonCodes: z.array(z.string().trim().min(1)),
  unknownRequirementIds: z.array(IdentifierSchema),
  lastVerifiedAt: TimestampSchema.nullable(),
  catalogState: RecommendationCatalogStateSchema,
});
export type RecommendationItem = z.infer<typeof RecommendationItemSchema>;

export const RecommendationRunSchema = z.object({
  id: IdentifierSchema,
  ownerId: IdentifierSchema,
  status: AsyncRunStatusSchema,
  candidateSetHash: Sha256Schema,
  strategyVersion: z.string().trim().min(1),
  catalogState: RecommendationCatalogStateSchema,
  items: z.array(RecommendationItemSchema),
  failureCode: z.string().trim().min(1).nullable(),
  createdAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
});
export type RecommendationRun = z.infer<typeof RecommendationRunSchema>;
