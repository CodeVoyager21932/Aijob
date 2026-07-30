import { z } from "zod";

import {
  DateSchema,
  IdentifierSchema,
  RevisionSchema,
  Sha256Schema,
  TimestampSchema,
  UuidSchema,
} from "./common.js";
import { AsyncRunStatusSchema, JobFamilySchema, ResumeInputKindSchema } from "./enums.js";

const ResumeFileBaseSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
  contentSha256: Sha256Schema,
});

export const ResumeFileMetadataSchema = z.discriminatedUnion("inputKind", [
  ResumeFileBaseSchema.extend({
    inputKind: z.literal("pdf"),
    mediaType: z.literal("application/pdf"),
  }),
  ResumeFileBaseSchema.extend({
    inputKind: z.literal("docx"),
    mediaType: z.literal("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  }),
]);
export type ResumeFileMetadata = z.infer<typeof ResumeFileMetadataSchema>;

export const ResumeTextSubmissionSchema = z.object({
  inputKind: z.literal("pasted_text"),
  text: z.string().trim().min(1).max(200_000),
});
export type ResumeTextSubmission = z.infer<typeof ResumeTextSubmissionSchema>;

export const ResumeAnalysisSubmissionSchema = z.union([
  ResumeFileMetadataSchema,
  ResumeTextSubmissionSchema,
]);
export type ResumeAnalysisSubmission = z.infer<typeof ResumeAnalysisSubmissionSchema>;

export const PiiFindingSchema = z.object({
  kind: z.enum(["phone", "email", "national_id", "address", "other"]),
  count: z.number().int().positive(),
});
export type PiiFinding = z.infer<typeof PiiFindingSchema>;

export const ResumeAnalysisSchema = z.object({
  id: IdentifierSchema,
  ownerId: IdentifierSchema,
  inputKind: ResumeInputKindSchema,
  status: AsyncRunStatusSchema,
  piiFindings: z.array(PiiFindingSchema),
  requiresPrivacyConfirmation: z.boolean(),
  purgeAfter: TimestampSchema,
  confirmedAt: TimestampSchema.nullable(),
  purgedAt: TimestampSchema.nullable(),
  failureCode: z.string().trim().min(1).nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ResumeAnalysis = z.infer<typeof ResumeAnalysisSchema>;

export const ProfileFactSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("current_student"), value: z.boolean() }),
  z.object({
    key: z.literal("graduation_year"),
    value: z.number().int().min(1900).max(2200),
  }),
  z.object({ key: z.literal("current_city"), value: z.string().trim().min(1) }),
  z.object({ key: z.literal("available_from"), value: DateSchema }),
  z.object({
    key: z.literal("weekly_attendance_days"),
    value: z.number().int().min(1).max(7),
  }),
  z.object({ key: z.literal("duration_months"), value: z.number().int().min(1).max(36) }),
  z.object({ key: z.literal("education_level"), value: z.string().trim().min(1) }),
  z.object({
    key: z.literal("majors"),
    value: z.array(z.string().trim().min(1)).min(1).max(20),
  }),
  z.object({
    key: z.literal("languages"),
    value: z.array(z.string().trim().min(1)).min(1).max(20),
  }),
  z.object({
    key: z.literal("skills"),
    value: z.array(z.string().trim().min(1)).min(1).max(100),
  }),
]);
export type ProfileFact = z.infer<typeof ProfileFactSchema>;

export const JobPreferenceSchema = z.object({
  cities: z.array(z.string().trim().min(1)).max(50),
  jobFamilies: z.array(JobFamilySchema).max(20),
  companyNames: z.array(z.string().trim().min(1)).max(50),
  workModes: z.array(z.string().trim().min(1)).max(10),
});
export type JobPreference = z.infer<typeof JobPreferenceSchema>;

const UNLIMITED_CITY_ALIASES = new Set(["都可以", "不限", "无所谓", "不限城市", "任何城市"]);

export function normalizeCityPreferences(values: string[]): {
  cities: string[];
  mixedUnlimitedValue: boolean;
} {
  const normalized = [...new Set(values.map((value) => value.normalize("NFKC").trim()))].filter(
    Boolean,
  );
  const hasUnlimited = normalized.some((value) => UNLIMITED_CITY_ALIASES.has(value));
  const concrete = normalized.filter((value) => !UNLIMITED_CITY_ALIASES.has(value));
  return {
    cities: hasUnlimited ? [] : concrete,
    mixedUnlimitedValue: hasUnlimited && concrete.length > 0,
  };
}

export const ResumeDocumentBlockSchema = z.object({
  id: UuidSchema,
  ordinal: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(10_000),
});
export type ResumeDocumentBlock = z.infer<typeof ResumeDocumentBlockSchema>;

export const ResumeDocumentSectionSchema = z.object({
  id: UuidSchema,
  ordinal: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(100),
  blocks: z.array(ResumeDocumentBlockSchema).min(1).max(500),
});
export type ResumeDocumentSection = z.infer<typeof ResumeDocumentSectionSchema>;

export const ResumeDocumentInputSchema = z.object({
  schemaVersion: z.literal("resume-document-v1"),
  sections: z.array(ResumeDocumentSectionSchema).min(1).max(100),
});
export type ResumeDocumentInput = z.infer<typeof ResumeDocumentInputSchema>;

export const ResumeEvidenceTypeSchema = z.enum([
  "education",
  "internship",
  "project",
  "campus",
  "competition",
  "volunteer",
  "skill",
  "certificate",
  "other",
]);
export type ResumeEvidenceType = z.infer<typeof ResumeEvidenceTypeSchema>;

export const ResumeEvidenceSchema = z.object({
  id: IdentifierSchema,
  resumeAnalysisId: IdentifierSchema.nullable(),
  sourceBlockId: UuidSchema,
  section: z.string().trim().min(1).max(100),
  evidenceType: ResumeEvidenceTypeSchema,
  statement: z.string().trim().min(1).max(2_000),
  skills: z.array(z.string().trim().min(1)).max(50),
  outcomes: z.array(z.string().trim().min(1)).max(20),
  confirmed: z.literal(true),
});
export type ResumeEvidence = z.infer<typeof ResumeEvidenceSchema>;

export const LegacyResumeEvidenceSchema = z.object({
  id: IdentifierSchema,
  resumeAnalysisId: IdentifierSchema.nullable(),
  section: z.string().trim().min(1).max(100),
  originalText: z.string().trim().min(1).max(10_000),
  claim: z.string().trim().min(1).max(2_000),
  skills: z.array(z.string().trim().min(1)).max(50),
  outcomes: z.array(z.string().trim().min(1)).max(20),
  confirmed: z.literal(true),
});
export type LegacyResumeEvidence = z.infer<typeof LegacyResumeEvidenceSchema>;

const RevisionMetadataSchema = z.object({
  id: IdentifierSchema,
  ownerId: IdentifierSchema,
  revision: RevisionSchema,
  baseRevision: RevisionSchema.nullable(),
  contentHash: Sha256Schema,
  confirmedAt: TimestampSchema,
  createdAt: TimestampSchema,
});

export const ProfileFactRevisionSchema = RevisionMetadataSchema.extend({
  facts: z.array(ProfileFactSchema).max(100),
});
export type ProfileFactRevision = z.infer<typeof ProfileFactRevisionSchema>;

export const JobPreferenceRevisionSchema = RevisionMetadataSchema.extend({
  preferences: JobPreferenceSchema,
});
export type JobPreferenceRevision = z.infer<typeof JobPreferenceRevisionSchema>;

export const ResumeEvidenceRevisionSchema = RevisionMetadataSchema.extend({
  resumeAnalysisId: IdentifierSchema.nullable(),
  schemaVersion: z.enum(["resume-evidence-v1", "resume-evidence-v2"]),
  documentRevisionId: IdentifierSchema.nullable(),
  evidence: z.array(z.union([ResumeEvidenceSchema, LegacyResumeEvidenceSchema])).max(500),
});
export type ResumeEvidenceRevision = z.infer<typeof ResumeEvidenceRevisionSchema>;

export const PutProfileFactsRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  facts: z.array(ProfileFactSchema).max(100),
});
export type PutProfileFactsRequest = z.infer<typeof PutProfileFactsRequestSchema>;

export const PutJobPreferencesRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  preferences: JobPreferenceSchema,
});
export type PutJobPreferencesRequest = z.infer<typeof PutJobPreferencesRequestSchema>;

export const PutResumeEvidenceRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  resumeAnalysisId: IdentifierSchema.nullable(),
  document: ResumeDocumentInputSchema.nullable(),
  evidence: z.array(ResumeEvidenceSchema).max(500),
});
export type PutResumeEvidenceRequest = z.infer<typeof PutResumeEvidenceRequestSchema>;

export const PutSavedResumeEvidenceSelectionRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  documentRevisionId: IdentifierSchema,
  sourceBlockIds: z
    .array(UuidSchema)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "sourceBlockIds must be unique",
    }),
});
export type PutSavedResumeEvidenceSelectionRequest = z.infer<
  typeof PutSavedResumeEvidenceSelectionRequestSchema
>;

export const ResumeDocumentRevisionSchema = RevisionMetadataSchema.extend({
  resumeAnalysisId: IdentifierSchema.nullable(),
  schemaVersion: z.literal("resume-document-v1"),
  sections: z.array(ResumeDocumentSectionSchema).min(1).max(100),
});
export type ResumeDocumentRevision = z.infer<typeof ResumeDocumentRevisionSchema>;

export const CurrentResumeDocumentSchema = z.object({
  document: ResumeDocumentRevisionSchema.nullable(),
});
export type CurrentResumeDocument = z.infer<typeof CurrentResumeDocumentSchema>;
