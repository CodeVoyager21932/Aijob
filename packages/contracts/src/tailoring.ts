import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.js";
import { AsyncRunStatusSchema, TailoringSegmentDecisionSchema } from "./enums.js";

export const CreateResumeTailoringRequestSchema = z.object({
  resumeAnalysisId: IdentifierSchema,
  publishedJobVersionId: IdentifierSchema,
  evidenceRevisionId: IdentifierSchema,
  privacyConsent: z.literal(true),
});
export type CreateResumeTailoringRequest = z.infer<typeof CreateResumeTailoringRequestSchema>;

export const ResumeTailoringSegmentSchema = z.object({
  id: IdentifierSchema,
  ordinal: z.number().int().nonnegative(),
  originalText: z.string().max(10_000),
  suggestedText: z.string().trim().min(1).max(10_000),
  reason: z.string().trim().min(1).max(2_000),
  requirementIds: z.array(IdentifierSchema).min(1),
  evidenceIds: z.array(IdentifierSchema).min(1),
  decision: TailoringSegmentDecisionSchema,
  editedText: z.string().trim().min(1).max(10_000).nullable(),
});
export type ResumeTailoringSegment = z.infer<typeof ResumeTailoringSegmentSchema>;

export const ResumeTailoringRunSchema = z.object({
  id: IdentifierSchema,
  ownerId: IdentifierSchema,
  status: AsyncRunStatusSchema,
  resumeAnalysisId: IdentifierSchema,
  publishedJobVersionId: IdentifierSchema,
  requirementSetId: IdentifierSchema,
  evidenceRevisionId: IdentifierSchema,
  usedTemplateFallback: z.boolean(),
  segments: z.array(ResumeTailoringSegmentSchema),
  failureCode: z.string().trim().min(1).nullable(),
  createdAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
});
export type ResumeTailoringRun = z.infer<typeof ResumeTailoringRunSchema>;

export const PutTailoringSegmentRequestSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("accepted") }),
  z.object({ decision: z.literal("rejected") }),
  z.object({
    decision: z.literal("edited"),
    editedText: z.string().trim().min(1).max(10_000),
  }),
]);
export type PutTailoringSegmentRequest = z.infer<typeof PutTailoringSegmentRequestSchema>;

export const ResumeExportSchema = z.object({
  id: IdentifierSchema,
  tailoringRunId: IdentifierSchema,
  status: AsyncRunStatusSchema,
  mediaType: z.literal("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  fileName: z.string().trim().min(1).max(255),
  byteSize: z.number().int().positive().nullable(),
  expiresAt: TimestampSchema,
  failureCode: z.string().trim().min(1).nullable(),
  createdAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
});
export type ResumeExport = z.infer<typeof ResumeExportSchema>;
