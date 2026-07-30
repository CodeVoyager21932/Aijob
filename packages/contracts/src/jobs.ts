import { z } from "zod";
import { DateSchema, HttpsUrlSchema, IdentifierSchema, TimestampSchema } from "./common.js";
import {
  ActivityStateSchema,
  CompanyScaleBandSchema,
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

const OptionalTextFieldSchema = fieldValueSchema(z.string().trim().min(1));
const OptionalStringListFieldSchema = fieldValueSchema(z.array(z.string().trim().min(1)).min(1));

export const SalaryPeriodSchema = z.enum(["hour", "day", "week", "month", "year", "other"]);
export type SalaryPeriod = z.infer<typeof SalaryPeriodSchema>;

export const SalarySchema = z.object({
  minimum: z.number().nonnegative().nullable(),
  maximum: z.number().nonnegative().nullable(),
  currency: z.string().trim().min(1),
  period: SalaryPeriodSchema,
  rawText: z.string().trim().min(1),
});
export type Salary = z.infer<typeof SalarySchema>;

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

export const CompanyScaleSchema = z
  .object({
    band: CompanyScaleBandSchema,
    evidenceUrl: HttpsUrlSchema.nullable(),
    evidenceText: z.string().trim().min(1).max(2_000).nullable(),
    lastVerifiedAt: TimestampSchema.nullable(),
  })
  .superRefine((value, context) => {
    const evidenceValues = [value.evidenceUrl, value.evidenceText, value.lastVerifiedAt];
    const hasAnyEvidence = evidenceValues.some((item) => item !== null);
    const hasCompleteEvidence = evidenceValues.every((item) => item !== null);
    if (value.band === "unknown" && hasAnyEvidence) {
      context.addIssue({ code: "custom", message: "unknown scale cannot carry evidence" });
    }
    if (value.band !== "unknown" && !hasCompleteEvidence) {
      context.addIssue({ code: "custom", message: "known scale requires official evidence" });
    }
  });
export type CompanyScale = z.infer<typeof CompanyScaleSchema>;

export const ApplicationMethodSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("official_url"),
    url: HttpsUrlSchema,
  }),
  z.object({
    type: z.literal("company_email"),
    email: z.string().trim().email().max(320),
    sourceText: z.string().trim().min(1).max(1_000),
  }),
]);
export type ApplicationMethod = z.infer<typeof ApplicationMethodSchema>;

export const JobSummarySchema = z.object({
  id: IdentifierSchema,
  publishedJobVersionId: IdentifierSchema.nullable(),
  activeRequirementSetId: IdentifierSchema.nullable().optional(),
  companyName: z.string().trim().min(1),
  companyScale: CompanyScaleSchema.optional(),
  title: z.string().trim().min(1),
  jobFamily: fieldValueSchema(JobFamilySchema),
  locations: fieldValueSchema(z.array(z.string().trim().min(1)).min(1)),
  weeklyAttendanceDays: fieldValueSchema(z.number().int().min(1).max(7)),
  durationMonths: fieldValueSchema(z.number().int().positive()),
  studentStatus: fieldValueSchema(z.boolean()).optional(),
  recruitmentBatch: OptionalTextFieldSchema.optional(),
  graduationYears: fieldValueSchema(
    z.array(z.number().int().min(1900).max(2200)).min(1),
  ).optional(),
  educationLevels: OptionalStringListFieldSchema.optional(),
  majors: OptionalStringListFieldSchema.optional(),
  workMode: OptionalTextFieldSchema.optional(),
  salary: fieldValueSchema(SalarySchema).optional(),
  postedAt: fieldValueSchema(TimestampSchema).optional(),
  deadlineAt: fieldValueSchema(TimestampSchema).optional(),
  source: JobSourceSummarySchema,
  publicationState: PublicationStateSchema,
  activityState: ActivityStateSchema,
  displayStatus: JobDisplayStatusSchema,
  internalPreview: InternalPreviewMetadataSchema.optional(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

export const JobDetailSchema = JobSummarySchema.omit({ source: true }).extend({
  source: JobSourceDetailSchema,
  department: OptionalTextFieldSchema,
  jobCode: OptionalTextFieldSchema,
  recruitmentType: OptionalTextFieldSchema,
  employmentType: OptionalTextFieldSchema,
  recruitmentBatch: OptionalTextFieldSchema,
  earliestStartDate: fieldValueSchema(DateSchema),
  graduationYears: fieldValueSchema(z.array(z.number().int().min(1900).max(2200)).min(1)),
  educationLevels: OptionalStringListFieldSchema.optional(),
  majors: OptionalStringListFieldSchema.optional(),
  languages: OptionalStringListFieldSchema.optional(),
  salary: fieldValueSchema(SalarySchema).optional(),
  workMode: OptionalTextFieldSchema.optional(),
  postedAt: fieldValueSchema(TimestampSchema),
  deadlineAt: fieldValueSchema(TimestampSchema),
  responsibilitiesText: fieldValueSchema(z.string().trim().min(1)),
  requirementsText: fieldValueSchema(z.string().trim().min(1)),
  officialLink: HttpsUrlSchema.nullable(),
  applicationMethods: z.array(ApplicationMethodSchema).max(5).optional(),
});
export type JobDetail = z.infer<typeof JobDetailSchema>;

export const JobListResponseSchema = z.object({
  items: z.array(JobSummarySchema),
  nextCursor: z.string().min(1).nullable(),
});
export type JobListResponse = z.infer<typeof JobListResponseSchema>;

export const JobSearchQuerySchema = z.object({
  keyword: z.string().trim().max(200).optional(),
  companies: z.array(z.string().trim().min(1)).max(50).optional(),
  cities: z.array(z.string().trim().min(1)).max(50).optional(),
  jobFamilies: z.array(JobFamilySchema).max(20).optional(),
  recruitmentBatches: z.array(z.string().trim().min(1)).max(20).optional(),
  availableWeeklyAttendanceDays: z.number().int().min(1).max(7).optional(),
  availableDurationMonths: z.number().int().min(1).max(36).optional(),
  latestStartDate: DateSchema.optional(),
  graduationYears: z.array(z.number().int().min(1900).max(2200)).max(20).optional(),
  educationLevels: z.array(z.string().trim().min(1)).max(20).optional(),
  majors: z.array(z.string().trim().min(1)).max(50).optional(),
  minimumSalary: z.number().nonnegative().optional(),
  salaryPeriods: z.array(SalaryPeriodSchema).max(6).optional(),
  workModes: z.array(z.string().trim().min(1)).max(10).optional(),
  sources: z.array(z.string().trim().min(1)).max(50).optional(),
  sourceTypes: z.array(SourceTypeSchema).max(10).optional(),
  freshness: z.enum(["fresh", "due", "stale", "unknown"]).optional(),
  includeUnknownHardConditions: z.boolean().default(true),
  cursor: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type JobSearchQuery = z.infer<typeof JobSearchQuerySchema>;

export const JobFacetValueSchema = z.object({
  value: z.string().trim().min(1),
  count: z.number().int().nonnegative(),
});
export type JobFacetValue = z.infer<typeof JobFacetValueSchema>;

export const JobFacetSchema = z.object({
  key: z.string().trim().min(1),
  knownCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
  values: z.array(JobFacetValueSchema),
});
export type JobFacet = z.infer<typeof JobFacetSchema>;

export const JobSearchItemSchema = JobSummarySchema.extend({
  conditionState: z.enum(["explicit_match", "information_unknown"]),
});
export type JobSearchItem = z.infer<typeof JobSearchItemSchema>;

// ADR-0021：单家配额压缩后的公开缺口分母（仅在本机 local_mvp 存在被压缩供给时返回）。
export const CompanyQuotaGapSchema = z.object({
  companyName: z.string().min(1),
  scaleBand: z.string().min(1),
  quota: z.number().int().positive(),
  supply: z.number().int().nonnegative(),
  selected: z.number().int().nonnegative(),
});
export type CompanyQuotaGap = z.infer<typeof CompanyQuotaGapSchema>;

export const JobSearchResponseSchema = z.object({
  items: z.array(JobSearchItemSchema),
  nextCursor: z.string().min(1).nullable(),
  facets: z.array(JobFacetSchema),
  totalKnown: z.number().int().nonnegative(),
  totalUnknown: z.number().int().nonnegative(),
  companyQuotaGaps: z.array(CompanyQuotaGapSchema).optional(),
});
export type JobSearchResponse = z.infer<typeof JobSearchResponseSchema>;
