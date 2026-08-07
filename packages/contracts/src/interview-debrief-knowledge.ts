import { z } from "zod";

import { JobContextSchema } from "./application-cases.js";
import {
  DateSchema,
  HttpsUrlSchema,
  RevisionSchema,
  Sha256Schema,
  TimestampSchema,
  UuidSchema,
} from "./common.js";
import { InterviewModeSchema } from "./enums.js";

const OwnerEpochSchema = z.number().int().positive();
const BoundedIdentifierSchema = z.string().trim().min(1).max(200);

function uniqueArray<T extends string>(schema: z.ZodType<T>, maximum: number) {
  return z
    .array(schema)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, {
      message: "Values must be unique",
    });
}

function validateCaseAndOwnerContext(
  value: {
    ownerId: string;
    caseId: string | null;
    detachedFromCaseId: string | null;
    jobContext: z.infer<typeof JobContextSchema>;
  },
  context: z.RefinementCtx,
): void {
  if ((value.caseId === null) === (value.detachedFromCaseId === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["detachedFromCaseId"],
      message: "The asset must reference either an active or detached case",
    });
  }
  if (value.jobContext.kind === "private" && value.jobContext.ownerId !== value.ownerId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["jobContext", "ownerId"],
      message: "Private job snapshots must belong to the asset owner",
    });
  }
}

export const InterviewSessionStatusSchema = z.enum([
  "queued",
  "active",
  "completed",
  "failed",
  "deleted",
]);
export type InterviewSessionStatus = z.infer<typeof InterviewSessionStatusSchema>;

export const InterviewSessionSchema = z
  .object({
    schemaVersion: z.literal("interview-session-v1"),
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: OwnerEpochSchema,
    caseId: UuidSchema.nullable(),
    detachedFromCaseId: UuidSchema.nullable(),
    jobContext: JobContextSchema,
    evidenceRevisionId: UuidSchema,
    resumeDocumentId: UuidSchema.nullable(),
    resumeContentRevisionId: UuidSchema.nullable(),
    mode: InterviewModeSchema,
    status: InterviewSessionStatusSchema,
    templateVersion: z.string().trim().min(1).max(100),
    promptVersion: z.string().trim().min(1).max(100).nullable(),
    providerAdapter: z.string().trim().min(1).max(100).nullable(),
    model: z.string().trim().min(1).max(200).nullable(),
    revision: RevisionSchema,
    completedAt: TimestampSchema.nullable(),
    deletedAt: TimestampSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    validateCaseAndOwnerContext(value, context);

    if ((value.resumeDocumentId === null) !== (value.resumeContentRevisionId === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resumeContentRevisionId"],
        message: "Resume document and content revision must be supplied together",
      });
    }

    const providerFields = [value.promptVersion, value.providerAdapter, value.model];
    const providerFieldCount = providerFields.filter((field) => field !== null).length;
    if (
      (value.mode === "template" && providerFieldCount !== 0) ||
      (value.mode === "controlled_ai" && providerFieldCount !== providerFields.length)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerAdapter"],
        message: "Provider metadata must follow the interview mode",
      });
    }

    if (
      (value.status === "completed" && value.completedAt === null) ||
      ((value.status === "queued" || value.status === "active" || value.status === "failed") &&
        value.completedAt !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "completedAt must follow the session lifecycle",
      });
    }
    if ((value.status === "deleted") !== (value.deletedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deletedAt"],
        message: "deletedAt must be present exactly when the session is deleted",
      });
    }
  });
export type InterviewSession = z.infer<typeof InterviewSessionSchema>;

export const InterviewTurnKindSchema = z.enum(["question", "answer", "follow_up"]);
export type InterviewTurnKind = z.infer<typeof InterviewTurnKindSchema>;

export const InterviewTurnSchema = z
  .object({
    schemaVersion: z.literal("interview-turn-v1"),
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: OwnerEpochSchema,
    interviewSessionId: UuidSchema,
    sequence: RevisionSchema,
    kind: InterviewTurnKindSchema,
    content: z.string().trim().min(1).max(20_000),
    requirementIds: uniqueArray(BoundedIdentifierSchema, 500),
    evidenceIds: uniqueArray(BoundedIdentifierSchema, 500),
    createdAt: TimestampSchema,
  })
  .strict();
export type InterviewTurn = z.infer<typeof InterviewTurnSchema>;

export const InterviewFeedbackCategorySchema = z.enum([
  "relevance",
  "structure",
  "evidence",
  "clarity",
]);
export type InterviewFeedbackCategory = z.infer<typeof InterviewFeedbackCategorySchema>;

export const InterviewFeedbackSeveritySchema = z.enum(["info", "warning", "critical"]);
export type InterviewFeedbackSeverity = z.infer<typeof InterviewFeedbackSeveritySchema>;

export const InterviewFeedbackItemSchema = z
  .object({
    id: UuidSchema,
    category: InterviewFeedbackCategorySchema,
    severity: InterviewFeedbackSeveritySchema,
    message: z.string().trim().min(1).max(2_000),
    improvement: z.string().trim().min(1).max(2_000).nullable(),
    turnIds: uniqueArray(UuidSchema, 200),
    requirementIds: uniqueArray(BoundedIdentifierSchema, 500),
    evidenceIds: uniqueArray(BoundedIdentifierSchema, 500),
  })
  .strict();
export type InterviewFeedbackItem = z.infer<typeof InterviewFeedbackItemSchema>;

export const InterviewFeedbackPayloadSchema = z
  .object({
    schemaVersion: z.literal("interview-feedback-v1"),
    summary: z.string().trim().min(1).max(4_000),
    strengths: uniqueArray(z.string().trim().min(1).max(1_000), 20),
    items: z.array(InterviewFeedbackItemSchema).max(100),
    practicePriorities: uniqueArray(z.string().trim().min(1).max(1_000), 20),
  })
  .strict();
export type InterviewFeedbackPayload = z.infer<typeof InterviewFeedbackPayloadSchema>;

export const InterviewFeedbackSchema = z
  .object({
    schemaVersion: z.literal("interview-feedback-record-v1"),
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: OwnerEpochSchema,
    interviewSessionId: UuidSchema,
    revision: RevisionSchema,
    generatorMode: InterviewModeSchema,
    feedback: InterviewFeedbackPayloadSchema,
    createdAt: TimestampSchema,
  })
  .strict();
export type InterviewFeedback = z.infer<typeof InterviewFeedbackSchema>;

export const DebriefExpressionIssueSchema = z
  .object({
    id: UuidSchema,
    description: z.string().trim().min(1).max(2_000),
    turnIds: uniqueArray(UuidSchema, 200),
  })
  .strict();
export type DebriefExpressionIssue = z.infer<typeof DebriefExpressionIssueSchema>;

export const DebriefEvidenceGapSchema = z
  .object({
    id: UuidSchema,
    description: z.string().trim().min(1).max(2_000),
    requirementIds: uniqueArray(BoundedIdentifierSchema, 500),
  })
  .strict();
export type DebriefEvidenceGap = z.infer<typeof DebriefEvidenceGapSchema>;

export const DebriefPracticePlanItemSchema = z
  .object({
    id: UuidSchema,
    action: z.string().trim().min(1).max(2_000),
    targetDate: DateSchema.nullable(),
  })
  .strict();
export type DebriefPracticePlanItem = z.infer<typeof DebriefPracticePlanItemSchema>;

export const DebriefStatusSchema = z.enum(["draft", "confirmed"]);
export type DebriefStatus = z.infer<typeof DebriefStatusSchema>;

export const DebriefSchema = z
  .object({
    schemaVersion: z.literal("debrief-v1"),
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: OwnerEpochSchema,
    caseId: UuidSchema.nullable(),
    detachedFromCaseId: UuidSchema.nullable(),
    jobContext: JobContextSchema,
    interviewSessionId: UuidSchema.nullable(),
    evidenceRevisionId: UuidSchema,
    expressionIssues: z.array(DebriefExpressionIssueSchema).max(100),
    evidenceGaps: z.array(DebriefEvidenceGapSchema).max(100),
    practicePlan: z.array(DebriefPracticePlanItemSchema).max(100),
    status: DebriefStatusSchema,
    revision: RevisionSchema,
    confirmedAt: TimestampSchema.nullable(),
    deletedAt: TimestampSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    validateCaseAndOwnerContext(value, context);
    if ((value.status === "confirmed") !== (value.confirmedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmedAt"],
        message: "confirmedAt must be present exactly when the debrief is confirmed",
      });
    }
  });
export type Debrief = z.infer<typeof DebriefSchema>;

export const DebriefConfirmationSchema = z
  .object({
    schemaVersion: z.literal("debrief-confirmation-v1"),
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: OwnerEpochSchema,
    debriefId: UuidSchema,
    basedOnDebriefRevision: RevisionSchema,
    idempotencyKeyHash: Sha256Schema,
    confirmedAt: TimestampSchema,
  })
  .strict();
export type DebriefConfirmation = z.infer<typeof DebriefConfirmationSchema>;

export const KnowledgeClipSchema = z
  .object({
    schemaVersion: z.literal("knowledge-clip-v1"),
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: OwnerEpochSchema,
    url: HttpsUrlSchema.refine((value) => value.length <= 2_048, {
      message: "Knowledge clip URLs must not exceed 2048 characters",
    }),
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(2_000),
    useCases: uniqueArray(z.string().trim().min(1).max(500), 20),
    userNotes: z.string().trim().min(1).max(5_000).nullable(),
    verifiedAt: TimestampSchema,
    revision: RevisionSchema,
    deletedAt: TimestampSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type KnowledgeClip = z.infer<typeof KnowledgeClipSchema>;

export const KnowledgeClipCaseLinkSchema = z
  .object({
    schemaVersion: z.literal("knowledge-clip-case-link-v1"),
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: OwnerEpochSchema,
    knowledgeClipId: UuidSchema,
    caseId: UuidSchema,
    createdAt: TimestampSchema,
  })
  .strict();
export type KnowledgeClipCaseLink = z.infer<typeof KnowledgeClipCaseLinkSchema>;
