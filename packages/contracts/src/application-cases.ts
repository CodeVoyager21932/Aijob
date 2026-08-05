import { z } from "zod";

import { RevisionSchema, TimestampSchema, UuidSchema } from "./common.js";
import {
  CaseOutcomeSchema,
  CaseStageSchema,
  RequirementEvidenceStateSchema,
} from "./enums.js";

export const CaseEventTypeSchema = z.enum([
  "case_created",
  "stage_transitioned",
  "outcome_corrected",
  "job_version_upgraded",
  "requirement_state_changed",
  "requirement_evidence_changed",
  "question_added",
  "question_updated",
  "official_link_opened",
  "manual_application_recorded",
  "resume_document_derived",
  "interview_started",
  "debrief_confirmed",
]);
export type CaseEventType = z.infer<typeof CaseEventTypeSchema>;

export const CaseEventActorTypeSchema = z.enum(["owner", "system"]);
export type CaseEventActorType = z.infer<typeof CaseEventActorTypeSchema>;

export const CaseQuestionStatusSchema = z.enum(["open", "answered", "dismissed"]);
export type CaseQuestionStatus = z.infer<typeof CaseQuestionStatusSchema>;

const OptionalReasonSchema = z.string().trim().min(1).max(2_000).nullable().optional();
const RequirementIdSchema = z.string().trim().min(1).max(200);
const EvidenceIdSchema = z.string().trim().min(1).max(200);

function requireResolvedOutcome(
  value: { stage: z.infer<typeof CaseStageSchema>; outcome: z.infer<typeof CaseOutcomeSchema> | null },
  context: z.RefinementCtx,
): void {
  if (value.stage === "resolved" && value.outcome === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outcome"],
      message: "Resolved cases require an outcome",
    });
  }
  if (value.stage !== "resolved" && value.outcome !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outcome"],
      message: "Only resolved cases may have an outcome",
    });
  }
}

export const ApplicationCaseSchema = z
  .object({
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: z.number().int().positive(),
    publishedJobId: UuidSchema,
    publishedJobVersionId: UuidSchema,
    requirementSetId: UuidSchema,
    stage: CaseStageSchema,
    outcome: CaseOutcomeSchema.nullable(),
    revision: RevisionSchema,
    expiresAt: TimestampSchema,
    endedAt: TimestampSchema.nullable(),
    deletedAt: TimestampSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    requireResolvedOutcome(value, context);
    if ((value.stage === "resolved") !== (value.endedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endedAt"],
        message: "endedAt must be present exactly when the case is resolved",
      });
    }
  });
export type ApplicationCase = z.infer<typeof ApplicationCaseSchema>;

export const CreateApplicationCaseRequestSchema = z
  .object({
    publishedJobId: UuidSchema,
    publishedJobVersionId: UuidSchema,
  })
  .strict();
export type CreateApplicationCaseRequest = z.infer<typeof CreateApplicationCaseRequestSchema>;

export const TransitionApplicationCaseRequestSchema = z
  .object({
    expectedRevision: RevisionSchema,
    toStage: CaseStageSchema,
    outcome: CaseOutcomeSchema.nullable().optional(),
    reason: OptionalReasonSchema,
  })
  .strict()
  .superRefine((value, context) =>
    requireResolvedOutcome({ stage: value.toStage, outcome: value.outcome ?? null }, context),
  );
export type TransitionApplicationCaseRequest = z.infer<
  typeof TransitionApplicationCaseRequestSchema
>;

export const UpgradeApplicationCaseJobVersionRequestSchema = z
  .object({
    expectedRevision: RevisionSchema,
    targetPublishedJobVersionId: UuidSchema,
  })
  .strict();
export type UpgradeApplicationCaseJobVersionRequest = z.infer<
  typeof UpgradeApplicationCaseJobVersionRequestSchema
>;

export const ApplicationCaseCursorSchema = z
  .object({
    updatedAt: TimestampSchema,
    id: UuidSchema,
  })
  .strict();
export type ApplicationCaseCursor = z.infer<typeof ApplicationCaseCursorSchema>;

export const ListApplicationCasesQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(1_024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    stage: CaseStageSchema.optional(),
  })
  .strict();
export type ListApplicationCasesQuery = z.infer<typeof ListApplicationCasesQuerySchema>;

export const ApplicationCaseEventSchema = z
  .object({
    id: UuidSchema,
    caseId: UuidSchema,
    sequence: RevisionSchema,
    eventType: CaseEventTypeSchema,
    actorType: CaseEventActorTypeSchema,
    eventData: z.record(z.string(), z.unknown()),
    createdAt: TimestampSchema,
  })
  .strict();
export type ApplicationCaseEvent = z.infer<typeof ApplicationCaseEventSchema>;

export const CaseRequirementStateSchema = z
  .object({
    id: UuidSchema,
    caseId: UuidSchema,
    requirementSetId: UuidSchema,
    requirementId: RequirementIdSchema,
    state: RequirementEvidenceStateSchema,
    userNote: z.string().trim().max(2_000).nullable(),
    revision: RevisionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type CaseRequirementState = z.infer<typeof CaseRequirementStateSchema>;

export const PutCaseRequirementStateRequestSchema = z
  .object({
    expectedRevision: RevisionSchema,
    state: RequirementEvidenceStateSchema,
    userNote: z.string().trim().max(2_000).nullable(),
  })
  .strict();
export type PutCaseRequirementStateRequest = z.infer<
  typeof PutCaseRequirementStateRequestSchema
>;

export const CaseRequirementEvidenceLinkSchema = z
  .object({
    id: UuidSchema,
    caseId: UuidSchema,
    requirementSetId: UuidSchema,
    requirementId: RequirementIdSchema,
    evidenceRevisionId: UuidSchema,
    evidenceId: EvidenceIdSchema,
    revision: RevisionSchema,
    linkedAt: TimestampSchema,
    removedAt: TimestampSchema.nullable(),
  })
  .strict();
export type CaseRequirementEvidenceLink = z.infer<typeof CaseRequirementEvidenceLinkSchema>;

export const PutCaseRequirementEvidenceLinksRequestSchema = z
  .object({
    expectedRevision: RevisionSchema,
    evidenceRevisionId: UuidSchema,
    evidenceIds: z
      .array(EvidenceIdSchema)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "evidenceIds must be unique",
      }),
  })
  .strict();
export type PutCaseRequirementEvidenceLinksRequest = z.infer<
  typeof PutCaseRequirementEvidenceLinksRequestSchema
>;

export const CaseQuestionSchema = z
  .object({
    id: UuidSchema,
    caseId: UuidSchema,
    requirementSetId: UuidSchema.nullable(),
    requirementId: RequirementIdSchema.nullable(),
    question: z.string().trim().min(1).max(1_000),
    answer: z.string().trim().min(1).max(3_000).nullable(),
    status: CaseQuestionStatusSchema,
    revision: RevisionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.requirementSetId === null) !== (value.requirementId === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requirementId"],
        message: "requirementSetId and requirementId must be present together",
      });
    }
    if ((value.status === "answered") !== (value.answer !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answer"],
        message: "Only answered questions may contain an answer",
      });
    }
  });
export type CaseQuestion = z.infer<typeof CaseQuestionSchema>;

export const CreateCaseQuestionRequestSchema = z
  .object({
    expectedRevision: RevisionSchema,
    requirementId: RequirementIdSchema.optional(),
    question: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type CreateCaseQuestionRequest = z.infer<typeof CreateCaseQuestionRequestSchema>;

export const UpdateCaseQuestionRequestSchema = z
  .object({
    expectedRevision: RevisionSchema,
    status: CaseQuestionStatusSchema,
    answer: z.string().trim().min(1).max(3_000).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === "answered") !== (value.answer != null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answer"],
        message: "Only answered questions may contain an answer",
      });
    }
  });
export type UpdateCaseQuestionRequest = z.infer<typeof UpdateCaseQuestionRequestSchema>;

export const ApplicationCaseRequirementsSchema = z
  .object({
    caseId: UuidSchema,
    requirementSetId: UuidSchema,
    revision: RevisionSchema,
    states: z.array(CaseRequirementStateSchema),
    evidenceLinks: z.array(CaseRequirementEvidenceLinkSchema),
    questions: z.array(CaseQuestionSchema),
  })
  .strict();
export type ApplicationCaseRequirements = z.infer<typeof ApplicationCaseRequirementsSchema>;
