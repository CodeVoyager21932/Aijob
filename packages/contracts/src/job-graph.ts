import { z } from "zod";
import { JobFamilySchema } from "./enums.js";
import { RequirementNecessitySchema } from "./matching.js";

export const JobGraphScopeSchema = z.object({
  jobFamily: z.union([JobFamilySchema, z.literal("unclassified")]).optional(),
  subrole: z.string().trim().min(1).max(100).optional(),
  cities: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  recruitmentTypes: z
    .array(z.enum(["internship", "campus", "new_grad", "management_trainee", "unknown"]))
    .max(5)
    .default([]),
  educationLevels: z
    .array(z.enum(["大专", "本科", "硕士", "博士", "unknown"]))
    .max(5)
    .default([]),
  batch: z.string().trim().min(1).max(100).optional(),
});
export type JobGraphScope = z.infer<typeof JobGraphScopeSchema>;
export const JobSemanticAtomSchema = z.object({
  key: z.string().min(1).max(250),
  label: z.string().min(1).max(250),
  kind: z.enum(["tool", "task", "deliverable", "education", "school", "qualification"]),
  necessity: RequirementNecessitySchema,
  negated: z.boolean(),
  condition: z.string().nullable(),
  sourceText: z.string().min(1),
  section: z.enum(["requirements", "responsibilities"]),
  sourceSpan: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }),
});
export type JobSemanticAtom = z.infer<typeof JobSemanticAtomSchema>;
export const JobGraphExampleSchema = z.object({
  jobId: z.string().uuid(),
  jobVersionId: z.string().uuid(),
  companyName: z.string(),
  title: z.string(),
  atom: JobSemanticAtomSchema,
  context: z.enum(["public", "private"]).default("public"),
  caseId: z.string().uuid().optional(),
});
export const JobGraphItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: JobSemanticAtomSchema.shape.kind,
  jobCount: z.number().int().nonnegative(),
  companyCount: z.number().int().nonnegative(),
  mentionRate: z.number().min(0).max(1),
  companyCoverage: z.number().min(0).max(1),
  requiredJobCount: z.number().int().nonnegative(),
  preferredJobCount: z.number().int().nonnegative(),
  unknownJobCount: z.number().int().nonnegative(),
  negatedJobCount: z.number().int().nonnegative(),
  conditionalJobCount: z.number().int().nonnegative(),
  examples: z.array(JobGraphExampleSchema).max(3),
});
export const JobGraphResultSchema = z.object({
  dataset: z.enum(["public", "private"]).default("public"),
  schemaVersion: z.literal("job-graph-v1"),
  scope: JobGraphScopeSchema,
  generation: z.string(),
  generatedAt: z.string().datetime(),
  sample: z.object({
    jobCount: z.number().int().nonnegative(),
    companyCount: z.number().int().nonnegative(),
    parsedJobCount: z.number().int().nonnegative(),
    parseCoverage: z.number().min(0).max(1),
    firstVerifiedAt: z.string().datetime().nullable(),
    lastVerifiedAt: z.string().datetime().nullable(),
  }),
  items: z.array(JobGraphItemSchema),
});
export type JobGraphResult = z.infer<typeof JobGraphResultSchema>;
export const PersonalGraphComparisonRequestSchema = z.object({
  scope: JobGraphScopeSchema,
  dataset: z.enum(["public", "private"]).default("public"),
  key: z.string().min(1).max(250),
});
export const PersonalGraphComparisonSchema = z.object({
  key: z.string(),
  evidenceRevisionId: z.string().uuid().nullable(),
  mode: z.literal("rules-reference"),
  candidates: z
    .array(
      z.object({
        evidenceId: z.string().nullable().default(null),
        experienceId: z.string().uuid().nullable().default(null),
        experienceRevision: z.number().int().positive().nullable().default(null),
        title: z.string().optional(),
        statement: z.string(),
        section: z.string(),
        reason: z.string(),
      }),
    )
    .max(10),
});
export const JobGraphEvidencePageSchema = z.object({
  items: z.array(JobGraphExampleSchema),
  nextOffset: z.number().int().nonnegative().nullable(),
  total: z.number().int().nonnegative(),
});
