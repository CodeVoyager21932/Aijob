import { z } from "zod";

import {
  HttpsUrlSchema,
  RevisionSchema,
  Sha256Schema,
  TimestampSchema,
  UuidSchema,
} from "./common.js";
import {
  CaseOutcomeSchema,
  CaseStageSchema,
  InterviewModeSchema,
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
const ReasonCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Z0-9_]+$/);
const RequirementIdSchema = z.string().trim().min(1).max(200);
const EvidenceIdSchema = z.string().trim().min(1).max(200);
const CaseEventSchemaVersionSchema = z.literal("case-event-v1");

export const JobContextKindSchema = z.enum(["public", "private"]);
export type JobContextKind = z.infer<typeof JobContextKindSchema>;

export const PublicJobReferenceSchema = z
  .object({
    kind: z.literal("public"),
    publishedJobId: UuidSchema,
    publishedJobVersionId: UuidSchema,
    requirementSetId: UuidSchema,
    officialUrl: HttpsUrlSchema,
  })
  .strict();
export type PublicJobReference = z.infer<typeof PublicJobReferenceSchema>;

export const PrivateJobSnapshotSchema = z
  .object({
    kind: z.literal("private"),
    snapshotId: UuidSchema,
    ownerId: UuidSchema,
    title: z.string().trim().min(1).max(240),
    companyName: z.string().trim().min(1).max(240).nullable(),
    sourceLabel: z.string().trim().min(1).max(120),
    officialUrl: HttpsUrlSchema.optional(),
    contentRevision: RevisionSchema,
    requirementSetRevision: RevisionSchema,
    sourceProvided: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.officialUrl !== undefined && !value.sourceProvided) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceProvided"],
        message: "A private snapshot with an official URL must mark its source as provided",
      });
    }
  });
export type PrivateJobSnapshot = z.infer<typeof PrivateJobSnapshotSchema>;

export const JobContextSchema = z.union([PublicJobReferenceSchema, PrivateJobSnapshotSchema]);
export type JobContext = z.infer<typeof JobContextSchema>;

export const PublicRequirementContextSchema = z
  .object({
    kind: z.literal("public"),
    requirementSetId: UuidSchema,
  })
  .strict();
export type PublicRequirementContext = z.infer<typeof PublicRequirementContextSchema>;

export const PrivateRequirementContextSchema = z
  .object({
    kind: z.literal("private"),
    requirementSetRevision: RevisionSchema,
  })
  .strict();
export type PrivateRequirementContext = z.infer<typeof PrivateRequirementContextSchema>;

export const RequirementContextSchema = z.discriminatedUnion("kind", [
  PublicRequirementContextSchema,
  PrivateRequirementContextSchema,
]);
export type RequirementContext = z.infer<typeof RequirementContextSchema>;

function requireResolvedOutcome(
  value: {
    stage: z.infer<typeof CaseStageSchema>;
    outcome: z.infer<typeof CaseOutcomeSchema> | null;
  },
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

const ApplicationCaseWithJobContextFieldsSchema = z.object({
  id: UuidSchema,
  ownerId: UuidSchema,
  ownerEpoch: z.number().int().positive(),
  jobContext: JobContextSchema,
  stage: CaseStageSchema,
  outcome: CaseOutcomeSchema.nullable(),
  revision: RevisionSchema,
  endedAt: TimestampSchema.nullable(),
  deletedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const ApplicationCaseWithJobContextSchema =
  ApplicationCaseWithJobContextFieldsSchema.strict().superRefine((value, context) => {
    requireResolvedOutcome(value, context);
    if ((value.stage === "resolved") !== (value.endedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endedAt"],
        message: "endedAt must be present exactly when the case is resolved",
      });
    }
    if (value.jobContext.kind === "private" && value.jobContext.ownerId !== value.ownerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["jobContext", "ownerId"],
        message: "Private job snapshots must belong to the case owner",
      });
    }
  });
export type ApplicationCaseWithJobContext = z.infer<typeof ApplicationCaseWithJobContextSchema>;

const CreatePublicApplicationCaseContextSchema = z
  .object({
    kind: z.literal("public"),
    publishedJobId: UuidSchema,
    publishedJobVersionId: UuidSchema,
  })
  .strict();

const CreatePrivateApplicationCaseContextSchema = z
  .object({
    kind: z.literal("private"),
    snapshotId: UuidSchema,
    contentRevision: RevisionSchema,
  })
  .strict();

export const CreateApplicationCaseJobContextSchema = z.discriminatedUnion("kind", [
  CreatePublicApplicationCaseContextSchema,
  CreatePrivateApplicationCaseContextSchema,
]);
export type CreateApplicationCaseJobContext = z.infer<typeof CreateApplicationCaseJobContextSchema>;

export const CreateApplicationCaseWithJobContextRequestSchema = z
  .object({
    jobContext: CreateApplicationCaseJobContextSchema,
  })
  .strict();
export type CreateApplicationCaseWithJobContextRequest = z.infer<
  typeof CreateApplicationCaseWithJobContextRequestSchema
>;

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

export const ListApplicationCasesResponseSchema = z
  .object({
    items: z.array(ApplicationCaseWithJobContextSchema),
    nextCursor: z.string().trim().min(1).nullable(),
  })
  .strict();
export type ListApplicationCasesResponse = z.infer<typeof ListApplicationCasesResponseSchema>;

export const CreateApplicationCaseResponseSchema = z
  .object({
    applicationCase: ApplicationCaseWithJobContextSchema,
    created: z.boolean(),
  })
  .strict();
export type CreateApplicationCaseResponse = z.infer<typeof CreateApplicationCaseResponseSchema>;

const CaseCreatedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    initialStage: CaseStageSchema,
    jobContextKind: JobContextKindSchema,
    jobContextRevision: RevisionSchema,
  })
  .strict();

const StageTransitionedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    fromStage: CaseStageSchema,
    toStage: CaseStageSchema,
    outcome: CaseOutcomeSchema.nullable(),
    reasonCode: ReasonCodeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    requireResolvedOutcome({ stage: value.toStage, outcome: value.outcome }, context);
    if (value.fromStage === value.toStage) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toStage"],
        message: "A stage transition must change the stage",
      });
    }
  });

const OutcomeCorrectedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    fromOutcome: CaseOutcomeSchema,
    toOutcome: CaseOutcomeSchema,
    reasonCode: ReasonCodeSchema,
  })
  .strict()
  .refine((value) => value.fromOutcome !== value.toOutcome, {
    path: ["toOutcome"],
    message: "An outcome correction must change the outcome",
  });

const JobVersionUpgradedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    fromPublishedJobVersionId: UuidSchema,
    toPublishedJobVersionId: UuidSchema,
    fromRequirementSetId: UuidSchema,
    toRequirementSetId: UuidSchema,
    reasonCode: ReasonCodeSchema.nullable(),
  })
  .strict()
  .refine((value) => value.fromPublishedJobVersionId !== value.toPublishedJobVersionId, {
    path: ["toPublishedJobVersionId"],
    message: "A job version upgrade must change the pinned version",
  });

const PublicRequirementStateChangedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    requirementSetId: UuidSchema,
    requirementId: RequirementIdSchema,
    fromState: RequirementEvidenceStateSchema.nullable(),
    toState: RequirementEvidenceStateSchema,
    reasonCode: ReasonCodeSchema.nullable(),
  })
  .strict()
  .refine((value) => value.fromState === null || value.fromState !== value.toState, {
    path: ["toState"],
    message: "A requirement state event must change the state",
  });

const PrivateRequirementStateChangedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    requirementContextKind: z.literal("private"),
    requirementSetRevision: RevisionSchema,
    requirementId: RequirementIdSchema,
    fromState: RequirementEvidenceStateSchema.nullable(),
    toState: RequirementEvidenceStateSchema,
    reasonCode: ReasonCodeSchema.nullable(),
  })
  .strict()
  .refine((value) => value.fromState === null || value.fromState !== value.toState, {
    path: ["toState"],
    message: "A requirement state event must change the state",
  });

const RequirementStateChangedEventDataSchema = z.union([
  PublicRequirementStateChangedEventDataSchema,
  PrivateRequirementStateChangedEventDataSchema,
]);

const PublicRequirementEvidenceChangedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    requirementSetId: UuidSchema,
    requirementId: RequirementIdSchema,
    evidenceRevisionId: UuidSchema,
    evidenceIds: z
      .array(EvidenceIdSchema)
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "evidenceIds must be unique",
      }),
    action: z.enum(["linked", "removed"]),
  })
  .strict();

const PrivateRequirementEvidenceChangedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    requirementContextKind: z.literal("private"),
    requirementSetRevision: RevisionSchema,
    requirementId: RequirementIdSchema,
    evidenceRevisionId: UuidSchema,
    evidenceIds: z
      .array(EvidenceIdSchema)
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "evidenceIds must be unique",
      }),
    action: z.enum(["linked", "removed"]),
  })
  .strict();

const RequirementEvidenceChangedEventDataSchema = z.union([
  PublicRequirementEvidenceChangedEventDataSchema,
  PrivateRequirementEvidenceChangedEventDataSchema,
]);

const QuestionAddedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    questionId: UuidSchema,
    requirementId: RequirementIdSchema.nullable(),
  })
  .strict();

const QuestionUpdatedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    questionId: UuidSchema,
    fromStatus: CaseQuestionStatusSchema,
    toStatus: CaseQuestionStatusSchema,
  })
  .strict()
  .refine((value) => value.fromStatus !== value.toStatus, {
    path: ["toStatus"],
    message: "A question update must change the status",
  });

const OfficialLinkOpenedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    jobContextKind: JobContextKindSchema,
    officialUrlHash: Sha256Schema,
  })
  .strict();

const ManualApplicationRecordedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    fromStage: CaseStageSchema,
    toStage: z.literal("applied"),
    reasonCode: ReasonCodeSchema.nullable(),
  })
  .strict()
  .refine((value) => value.fromStage !== "applied", {
    path: ["fromStage"],
    message: "Manual application recording must newly enter the applied stage",
  });

const ResumeDocumentDerivedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    documentId: UuidSchema,
    contentRevisionId: UuidSchema,
  })
  .strict();

const InterviewStartedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    interviewSessionId: UuidSchema,
    mode: InterviewModeSchema,
  })
  .strict();

const DebriefConfirmedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    debriefId: UuidSchema,
    evidenceRevisionId: UuidSchema.nullable(),
  })
  .strict();

export const CaseEventDataSchema = z.union([
  CaseCreatedEventDataSchema,
  StageTransitionedEventDataSchema,
  OutcomeCorrectedEventDataSchema,
  JobVersionUpgradedEventDataSchema,
  RequirementStateChangedEventDataSchema,
  RequirementEvidenceChangedEventDataSchema,
  QuestionAddedEventDataSchema,
  QuestionUpdatedEventDataSchema,
  OfficialLinkOpenedEventDataSchema,
  ManualApplicationRecordedEventDataSchema,
  ResumeDocumentDerivedEventDataSchema,
  InterviewStartedEventDataSchema,
  DebriefConfirmedEventDataSchema,
]);
export type CaseEventData = z.infer<typeof CaseEventDataSchema>;

const ApplicationCaseEventFieldsSchema = z.object({
  id: UuidSchema,
  caseId: UuidSchema,
  sequence: RevisionSchema,
  actorType: CaseEventActorTypeSchema,
  createdAt: TimestampSchema,
});

export const ApplicationCaseEventSchema = z.discriminatedUnion("eventType", [
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("case_created"),
    eventData: CaseCreatedEventDataSchema,
  }).strict(),
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("stage_transitioned"),
    eventData: StageTransitionedEventDataSchema,
  }).strict(),
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("outcome_corrected"),
    eventData: OutcomeCorrectedEventDataSchema,
  }).strict(),
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("job_version_upgraded"),
    eventData: JobVersionUpgradedEventDataSchema,
  }).strict(),
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("requirement_state_changed"),
    eventData: RequirementStateChangedEventDataSchema,
  }).strict(),
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("requirement_evidence_changed"),
    eventData: RequirementEvidenceChangedEventDataSchema,
  }).strict(),
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("question_added"),
    eventData: QuestionAddedEventDataSchema,
  }).strict(),
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("question_updated"),
    eventData: QuestionUpdatedEventDataSchema,
  }).strict(),
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("official_link_opened"),
    eventData: OfficialLinkOpenedEventDataSchema,
  }).strict(),
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("manual_application_recorded"),
    eventData: ManualApplicationRecordedEventDataSchema,
  }).strict(),
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("resume_document_derived"),
    eventData: ResumeDocumentDerivedEventDataSchema,
  }).strict(),
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("interview_started"),
    eventData: InterviewStartedEventDataSchema,
  }).strict(),
  ApplicationCaseEventFieldsSchema.extend({
    eventType: z.literal("debrief_confirmed"),
    eventData: DebriefConfirmedEventDataSchema,
  }).strict(),
]);
export type ApplicationCaseEvent = z.infer<typeof ApplicationCaseEventSchema>;

export const LegacyApplicationCaseEventSchema = ApplicationCaseEventFieldsSchema.extend({
  eventType: CaseEventTypeSchema,
  eventData: z.record(z.string(), z.unknown()),
  legacyReadOnly: z.literal(true),
}).strict();
export type LegacyApplicationCaseEvent = z.infer<typeof LegacyApplicationCaseEventSchema>;

export const ApplicationCaseEventReadModelSchema = z.union([
  ApplicationCaseEventSchema,
  LegacyApplicationCaseEventSchema,
]);
export type ApplicationCaseEventReadModel = z.infer<typeof ApplicationCaseEventReadModelSchema>;

export const CaseRequirementStateSchema = z
  .object({
    id: UuidSchema,
    caseId: UuidSchema,
    requirementContext: RequirementContextSchema,
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
export type PutCaseRequirementStateRequest = z.infer<typeof PutCaseRequirementStateRequestSchema>;

export const CaseRequirementEvidenceLinkSchema = z
  .object({
    id: UuidSchema,
    caseId: UuidSchema,
    requirementStateId: UuidSchema,
    requirementContext: RequirementContextSchema,
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
    requirementStateId: UuidSchema.nullable(),
    requirementContext: RequirementContextSchema.nullable(),
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
    const hasRequirement = value.requirementId !== null;
    if (
      (value.requirementStateId !== null) !== hasRequirement ||
      (value.requirementContext !== null) !== hasRequirement
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requirementId"],
        message: "Requirement state, context and ID must be present together",
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
