import { z } from "zod";

import {
  ActivityStateSchema,
  ImportModeSchema,
  IngestionStateSchema,
  JobDisplayStatusSchema,
  JobFamilySchema,
  PolicyStatusSchema,
  ProvenanceLevelSchema,
  PublicationStateSchema,
  SourceTypeSchema,
} from "./enums.js";
import { fieldValueSchema } from "./field-value.js";

const IdentifierSchema = z.string().trim().min(1);
const TimestampSchema = z.string().datetime({ offset: true });
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const HttpsUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    },
    {
      message: "Only HTTPS URLs are allowed",
    },
  );

export const InternalPreviewMetadataSchema = z.object({
  mode: z.literal("internal_preview"),
  policyStatus: PolicyStatusSchema,
  ingestionState: IngestionStateSchema,
  reviewReasons: z.array(z.string().trim().min(1)).min(1),
  sourceJobId: IdentifierSchema,
  revisionId: IdentifierSchema,
  importMode: ImportModeSchema,
});
export type InternalPreviewMetadata = z.infer<typeof InternalPreviewMetadataSchema>;

export const JobSourceSummarySchema = z.object({
  sourceId: IdentifierSchema,
  type: SourceTypeSchema,
  provenanceLevel: ProvenanceLevelSchema,
  displayName: z.string().trim().min(1),
  domain: z.string().trim().min(1),
  lastVerifiedAt: TimestampSchema,
});
export type JobSourceSummary = z.infer<typeof JobSourceSummarySchema>;

export const JobSourceDetailSchema = JobSourceSummarySchema.extend({
  originalUrl: HttpsUrlSchema,
});
export type JobSourceDetail = z.infer<typeof JobSourceDetailSchema>;

export const JobSummarySchema = z.object({
  id: IdentifierSchema,
  publishedJobVersionId: IdentifierSchema.nullable(),
  companyName: z.string().trim().min(1),
  title: z.string().trim().min(1),
  jobFamily: fieldValueSchema(JobFamilySchema),
  locations: fieldValueSchema(z.array(z.string().trim().min(1)).min(1)),
  weeklyAttendanceDays: fieldValueSchema(z.number().int().min(1).max(7)),
  durationMonths: fieldValueSchema(z.number().int().positive()),
  source: JobSourceSummarySchema,
  publicationState: PublicationStateSchema,
  activityState: ActivityStateSchema,
  displayStatus: JobDisplayStatusSchema,
  internalPreview: InternalPreviewMetadataSchema.optional(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

export const JobDetailSchema = JobSummarySchema.omit({ source: true }).extend({
  source: JobSourceDetailSchema,
  department: fieldValueSchema(z.string().trim().min(1)),
  jobCode: fieldValueSchema(z.string().trim().min(1)),
  recruitmentType: fieldValueSchema(z.string().trim().min(1)),
  employmentType: fieldValueSchema(z.string().trim().min(1)),
  recruitmentBatch: fieldValueSchema(z.string().trim().min(1)),
  earliestStartDate: fieldValueSchema(DateSchema),
  graduationYears: fieldValueSchema(z.array(z.number().int().min(1900).max(2200)).min(1)),
  postedAt: fieldValueSchema(TimestampSchema),
  deadlineAt: fieldValueSchema(TimestampSchema),
  responsibilitiesText: fieldValueSchema(z.string().trim().min(1)),
  requirementsText: fieldValueSchema(z.string().trim().min(1)),
  officialLink: HttpsUrlSchema.nullable(),
});
export type JobDetail = z.infer<typeof JobDetailSchema>;

export const JobListResponseSchema = z.object({
  items: z.array(JobSummarySchema),
  nextCursor: z.string().min(1).nullable(),
});
export type JobListResponse = z.infer<typeof JobListResponseSchema>;
