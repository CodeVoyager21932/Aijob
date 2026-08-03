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

export const RequirementNecessitySchema = z.enum(["required", "preferred", "optional", "unknown"]);
export type RequirementNecessity = z.infer<typeof RequirementNecessitySchema>;

export const RequirementSourceSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  excerptHash: Sha256Schema,
});
export type RequirementSourceSpan = z.infer<typeof RequirementSourceSpanSchema>;

const JobRequirementInputSchema = z.object({
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
  sourceSpan: RequirementSourceSpanSchema.nullable().optional(),
  necessity: RequirementNecessitySchema.optional(),
  required: z.boolean().optional(),
});

export const JobRequirementSchema = JobRequirementInputSchema.superRefine((value, context) => {
  if (value.necessity === undefined && value.required === undefined) {
    context.addIssue({
      code: "custom",
      message: "requirement necessity is missing",
      path: ["necessity"],
    });
  }
}).transform(({ required, necessity, sourceSpan, ...value }) => ({
  ...value,
  necessity: necessity ?? (required ? "required" : "preferred"),
  sourceSpan: sourceSpan ?? null,
}));
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

export const MatchBasisStateSchema = z.enum(["complete", "partial", "insufficient"]);
export type MatchBasisState = z.infer<typeof MatchBasisStateSchema>;

export const MatchGapSchema = z.object({
  axis: z.enum(["eligibility", "evidence", "preference"]),
  type: z.enum([
    "explicit_conflict",
    "missing_user_fact",
    "missing_job_value",
    "unstructured_job_requirement",
    "missing_resume_evidence",
    "partial_resume_evidence",
    "preference_not_comparable",
  ]),
  requirementId: IdentifierSchema.nullable(),
  explanation: z.string().trim().min(1),
});
export type MatchGap = z.infer<typeof MatchGapSchema>;

export const MatchCoverageSchema = z.object({
  eligibility: z.object({
    required: z.number().int().nonnegative(),
    evaluated: z.number().int().nonnegative(),
    met: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  evidence: z.object({
    applicable: z.number().int().nonnegative(),
    supported: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  preference: z.object({
    configured: z.number().int().nonnegative(),
    compared: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
});
export type MatchCoverage = z.infer<typeof MatchCoverageSchema>;

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
  basisState: MatchBasisStateSchema,
  coverage: MatchCoverageSchema,
  gaps: z.array(MatchGapSchema),
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

export const MAX_RECOMMENDATION_CANDIDATES = 1_100;

export const CreateRecommendationRunRequestSchema = z.object({
  profileFactRevisionId: IdentifierSchema,
  preferenceRevisionId: IdentifierSchema,
  evidenceRevisionId: IdentifierSchema,
  candidateJobVersionIds: z
    .array(IdentifierSchema)
    .min(1)
    .max(MAX_RECOMMENDATION_CANDIDATES),
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
  basisState: MatchBasisStateSchema,
  coverage: MatchCoverageSchema,
  gaps: z.array(MatchGapSchema),
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
