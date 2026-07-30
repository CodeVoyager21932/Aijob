import { z } from "zod";
import { IdentifierSchema, Sha256Schema, TimestampSchema } from "./common.js";
import { CompanyScaleBandSchema, JobFamilySchema } from "./enums.js";
import { RequirementKindSchema, RequirementNecessitySchema } from "./matching.js";

export const JobInsightScopeSchema = z.object({
  jobFamily: JobFamilySchema,
  cities: z.array(z.string().trim().min(1)).max(20).default([]),
  companyScaleBands: z.array(CompanyScaleBandSchema).max(4).default([]),
});
export type JobInsightScope = z.infer<typeof JobInsightScopeSchema>;

export const CreateJobInsightRunRequestSchema = z.object({
  scope: JobInsightScopeSchema,
  evidenceRevisionId: IdentifierSchema.nullable().optional(),
});
export type CreateJobInsightRunRequest = z.infer<typeof CreateJobInsightRunRequestSchema>;

export const JobInsightExampleSchema = z.object({
  jobId: IdentifierSchema,
  jobTitle: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  sourceText: z.string().trim().min(1),
});
export type JobInsightExample = z.infer<typeof JobInsightExampleSchema>;

export const JobInsightPersonalStatusSchema = z.enum([
  "confirmed_evidence",
  "not_in_resume",
  "needs_confirmation",
]);
export type JobInsightPersonalStatus = z.infer<typeof JobInsightPersonalStatusSchema>;

export const JobInsightRequirementSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  kind: RequirementKindSchema,
  primaryNecessity: RequirementNecessitySchema,
  jobCount: z.number().int().positive(),
  companyCount: z.number().int().positive(),
  necessityCounts: z.object({
    required: z.number().int().nonnegative(),
    preferred: z.number().int().nonnegative(),
    optional: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  examples: z.array(JobInsightExampleSchema).max(3),
  personalStatus: JobInsightPersonalStatusSchema.nullable(),
  evidenceIds: z.array(IdentifierSchema),
  sourceBlockIds: z.array(IdentifierSchema),
});
export type JobInsightRequirement = z.infer<typeof JobInsightRequirementSchema>;

export const JobInsightResultSchema = z.object({
  algorithmVersion: z.literal("job-market-insight-v1"),
  dataSufficient: z.boolean(),
  insufficiencyReasons: z.array(
    z.enum(["too_few_jobs", "too_few_companies", "low_requirement_coverage"]),
  ),
  sample: z.object({
    jobCount: z.number().int().nonnegative(),
    companyCount: z.number().int().nonnegative(),
    knownScaleCompanyCount: z.number().int().nonnegative(),
    structuredRequirementJobCount: z.number().int().nonnegative(),
    requirementCoverage: z.number().min(0).max(1),
    lastVerifiedAt: TimestampSchema.nullable(),
  }),
  commonHardRequirements: z.array(JobInsightRequirementSchema),
  frequentCapabilities: z.array(JobInsightRequirementSchema),
  preferredRequirements: z.array(JobInsightRequirementSchema),
});
export type JobInsightResult = z.infer<typeof JobInsightResultSchema>;

export const JobInsightRunSchema = z.object({
  id: IdentifierSchema,
  ownerId: IdentifierSchema,
  ownerEpoch: z.number().int().positive(),
  scope: JobInsightScopeSchema,
  evidenceRevisionId: IdentifierSchema.nullable(),
  candidateJobVersionIds: z.array(IdentifierSchema),
  candidateRequirementSetIds: z.array(IdentifierSchema),
  candidateSourceVerifications: z.array(
    z.object({
      jobVersionId: IdentifierSchema,
      sourceId: IdentifierSchema,
      lastVerifiedAt: TimestampSchema,
    }),
  ),
  dataVersionHash: Sha256Schema,
  algorithmVersion: z.literal("job-market-insight-v1"),
  result: JobInsightResultSchema,
  createdAt: TimestampSchema,
  completedAt: TimestampSchema,
});
export type JobInsightRun = z.infer<typeof JobInsightRunSchema>;
