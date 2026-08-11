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
  PolicyStatusSchema,
  ProvenanceLevelSchema,
  RequirementEvidenceStateSchema,
} from "./enums.js";
import { fieldValueSchema } from "./field-value.js";
import {
  JobRequirementSchema,
  RequirementKindSchema,
  RequirementNecessitySchema,
} from "./matching.js";

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

const ReasonCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Z0-9_]+$/);
const OptionalReasonSchema = ReasonCodeSchema.nullable().optional();
const RequirementIdSchema = z.string().trim().min(1).max(200);
const EvidenceIdSchema = z.string().trim().min(1).max(200);
const CaseEventSchemaVersionSchema = z.literal("case-event-v1");
const CaseMutationEventSchemaVersionSchema = z.literal("case-event-v2");
const EvidenceIdsSchema = z
  .array(EvidenceIdSchema)
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Evidence IDs must be unique",
  });

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

export const ApplicationCaseCatalogSourceSchema = z
  .object({
    kind: z.literal("catalog"),
    displayName: z.string().trim().min(1).max(240),
    policyStatus: PolicyStatusSchema,
    provenanceLevel: ProvenanceLevelSchema,
    lastVerifiedAt: TimestampSchema,
  })
  .strict();
export type ApplicationCaseCatalogSource = z.infer<typeof ApplicationCaseCatalogSourceSchema>;

export const ApplicationCaseOwnerPrivateSourceSchema = z
  .object({
    kind: z.literal("owner_private"),
    displayName: z.string().trim().min(1).max(120),
    sourceProvided: z.boolean(),
    verified: z.literal(false),
  })
  .strict();
export type ApplicationCaseOwnerPrivateSource = z.infer<
  typeof ApplicationCaseOwnerPrivateSourceSchema
>;

export const ApplicationCaseJobDisplaySchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    companyName: z.string().trim().min(1).max(240).nullable(),
    locations: fieldValueSchema(z.array(z.string().trim().min(1)).min(1)),
    workMode: fieldValueSchema(z.string().trim().min(1)),
    deadlineAt: fieldValueSchema(TimestampSchema),
    source: z.discriminatedUnion("kind", [
      ApplicationCaseCatalogSourceSchema,
      ApplicationCaseOwnerPrivateSourceSchema,
    ]),
  })
  .strict();
export type ApplicationCaseJobDisplay = z.infer<typeof ApplicationCaseJobDisplaySchema>;

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
  jobDisplay: ApplicationCaseJobDisplaySchema,
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

export const PrivateApplicationCaseSourceInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("provided_url"),
      url: HttpsUrlSchema,
    })
    .strict(),
  z.object({ kind: z.literal("referral") }).strict(),
  z.object({ kind: z.literal("unspecified") }).strict(),
]);
export type PrivateApplicationCaseSourceInput = z.infer<
  typeof PrivateApplicationCaseSourceInputSchema
>;

export const PrivateApplicationCaseDuplicateHandlingSchema = z.enum(["reuse", "create_separate"]);
export type PrivateApplicationCaseDuplicateHandling = z.infer<
  typeof PrivateApplicationCaseDuplicateHandlingSchema
>;

const CreatePrivateInputApplicationCaseContextSchema = z
  .object({
    kind: z.literal("private_input"),
    title: z.string().trim().min(1).max(240),
    companyName: z.string().trim().min(1).max(240).nullable(),
    contentText: z.string().trim().min(1).max(200_000),
    source: PrivateApplicationCaseSourceInputSchema,
    duplicateHandling: PrivateApplicationCaseDuplicateHandlingSchema.default("reuse"),
  })
  .strict();

export const CreateApplicationCaseJobContextSchema = z.discriminatedUnion("kind", [
  CreatePublicApplicationCaseContextSchema,
  CreatePrivateApplicationCaseContextSchema,
  CreatePrivateInputApplicationCaseContextSchema,
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

export const RecordManualApplicationRequestSchema = z
  .object({
    expectedRevision: RevisionSchema,
  })
  .strict();
export type RecordManualApplicationRequest = z.infer<typeof RecordManualApplicationRequestSchema>;

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

export const ListApplicationCaseEventsQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(1_024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListApplicationCaseEventsQuery = z.infer<typeof ListApplicationCaseEventsQuerySchema>;

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
  z
    .object({
      schemaVersion: CaseMutationEventSchemaVersionSchema,
      requirementSetId: UuidSchema,
      requirementId: RequirementIdSchema,
      fromState: RequirementEvidenceStateSchema.nullable(),
      toState: RequirementEvidenceStateSchema,
      noteChanged: z.boolean(),
      reasonCode: ReasonCodeSchema.nullable(),
    })
    .strict()
    .refine(
      (value) => value.fromState === null || value.fromState !== value.toState || value.noteChanged,
      {
        path: ["toState"],
        message: "A requirement state event must change the state or note",
      },
    ),
  z
    .object({
      schemaVersion: CaseMutationEventSchemaVersionSchema,
      requirementContextKind: z.literal("private"),
      requirementSetRevision: RevisionSchema,
      requirementId: RequirementIdSchema,
      fromState: RequirementEvidenceStateSchema.nullable(),
      toState: RequirementEvidenceStateSchema,
      noteChanged: z.boolean(),
      reasonCode: ReasonCodeSchema.nullable(),
    })
    .strict()
    .refine(
      (value) => value.fromState === null || value.fromState !== value.toState || value.noteChanged,
      {
        path: ["toState"],
        message: "A requirement state event must change the state or note",
      },
    ),
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
  z
    .object({
      schemaVersion: CaseMutationEventSchemaVersionSchema,
      requirementSetId: UuidSchema,
      requirementId: RequirementIdSchema,
      evidenceRevisionId: UuidSchema,
      linkedEvidenceIds: EvidenceIdsSchema,
      removedEvidenceIds: EvidenceIdsSchema,
    })
    .strict()
    .superRefine((value, context) => {
      if (value.linkedEvidenceIds.length + value.removedEvidenceIds.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["linkedEvidenceIds"],
          message: "An evidence event must link or remove at least one ID",
        });
      }
      const removed = new Set(value.removedEvidenceIds);
      if (value.linkedEvidenceIds.some((id) => removed.has(id))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["removedEvidenceIds"],
          message: "Linked and removed evidence IDs must be disjoint",
        });
      }
    }),
  z
    .object({
      schemaVersion: CaseMutationEventSchemaVersionSchema,
      requirementContextKind: z.literal("private"),
      requirementSetRevision: RevisionSchema,
      requirementId: RequirementIdSchema,
      evidenceRevisionId: UuidSchema,
      linkedEvidenceIds: EvidenceIdsSchema,
      removedEvidenceIds: EvidenceIdsSchema,
    })
    .strict()
    .superRefine((value, context) => {
      if (value.linkedEvidenceIds.length + value.removedEvidenceIds.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["linkedEvidenceIds"],
          message: "An evidence event must link or remove at least one ID",
        });
      }
      const removed = new Set(value.removedEvidenceIds);
      if (value.linkedEvidenceIds.some((id) => removed.has(id))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["removedEvidenceIds"],
          message: "Linked and removed evidence IDs must be disjoint",
        });
      }
    }),
]);

const QuestionAddedEventDataSchema = z
  .object({
    schemaVersion: CaseEventSchemaVersionSchema,
    questionId: UuidSchema,
    requirementId: RequirementIdSchema.nullable(),
  })
  .strict();

const QuestionUpdatedEventDataSchema = z.union([
  z
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
    }),
  z
    .object({
      schemaVersion: CaseMutationEventSchemaVersionSchema,
      questionId: UuidSchema,
      fromStatus: CaseQuestionStatusSchema,
      toStatus: CaseQuestionStatusSchema,
      answerChanged: z.boolean(),
    })
    .strict()
    .refine((value) => value.fromStatus !== value.toStatus || value.answerChanged, {
      path: ["toStatus"],
      message: "A question update must change the status or answer",
    }),
]);

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

export const ApplicationCaseCommandResponseSchema = z
  .object({
    event: ApplicationCaseEventSchema,
  })
  .strict();
export type ApplicationCaseCommandResponse = z.infer<typeof ApplicationCaseCommandResponseSchema>;

export const JobVersionDiffStatusSchema = z.enum([
  "up_to_date",
  "update_available",
  "target_unavailable",
]);
export type JobVersionDiffStatus = z.infer<typeof JobVersionDiffStatusSchema>;

export const JobVersionDiffFieldSchema = z.enum([
  "companyName",
  "title",
  "jobFamily",
  "locations",
  "department",
  "jobCode",
  "recruitmentType",
  "employmentType",
  "recruitmentBatch",
  "weeklyAttendanceDays",
  "durationMonths",
  "earliestStartDate",
  "graduationYears",
  "educationLevels",
  "majors",
  "languages",
  "salary",
  "workMode",
  "postedAt",
  "deadlineAt",
  "responsibilities",
  "requirements",
  "structuredFields",
  "activityState",
  "sourceUrl",
  "applyUrl",
]);
export type JobVersionDiffField = z.infer<typeof JobVersionDiffFieldSchema>;

const JobVersionDiffTextSchema = z.string().max(200_000).nullable();

export const JobVersionFieldChangeSchema = z
  .object({
    field: JobVersionDiffFieldSchema,
    fromValue: JobVersionDiffTextSchema,
    toValue: JobVersionDiffTextSchema,
  })
  .strict();
export type JobVersionFieldChange = z.infer<typeof JobVersionFieldChangeSchema>;

export const JobVersionRequirementSummarySchema = z
  .object({
    id: RequirementIdSchema,
    kind: RequirementKindSchema,
    necessity: RequirementNecessitySchema,
    sourceText: z.string().trim().min(1).max(200_000),
  })
  .strict();
export type JobVersionRequirementSummary = z.infer<typeof JobVersionRequirementSummarySchema>;

export const JobVersionRequirementChangeSchema = z
  .object({
    from: JobVersionRequirementSummarySchema,
    to: JobVersionRequirementSummarySchema,
  })
  .strict();
export type JobVersionRequirementChange = z.infer<typeof JobVersionRequirementChangeSchema>;

export const JobVersionRequirementDiffSchema = z
  .object({
    added: z.array(JobVersionRequirementSummarySchema),
    removed: z.array(JobVersionRequirementSummarySchema),
    changed: z.array(JobVersionRequirementChangeSchema),
  })
  .strict();
export type JobVersionRequirementDiff = z.infer<typeof JobVersionRequirementDiffSchema>;

export const ApplicationCaseJobVersionDiffResponseSchema = z
  .object({
    caseId: UuidSchema,
    publishedJobId: UuidSchema,
    pinnedPublishedJobVersionId: UuidSchema,
    pinnedRequirementSetId: UuidSchema,
    status: JobVersionDiffStatusSchema,
    targetPublishedJobVersionId: UuidSchema.nullable(),
    targetRequirementSetId: UuidSchema.nullable(),
    fieldChanges: z
      .array(JobVersionFieldChangeSchema)
      .refine((changes) => new Set(changes.map(({ field }) => field)).size === changes.length, {
        message: "fieldChanges must contain each field at most once",
      }),
    requirementChanges: JobVersionRequirementDiffSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const hasTarget =
      value.targetPublishedJobVersionId !== null && value.targetRequirementSetId !== null;
    if (hasTarget !== (value.status === "up_to_date" || value.status === "update_available")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetPublishedJobVersionId"],
        message: "Available diff statuses require a complete target version",
      });
    }
    const hasChanges =
      value.fieldChanges.length > 0 ||
      value.requirementChanges.added.length > 0 ||
      value.requirementChanges.removed.length > 0 ||
      value.requirementChanges.changed.length > 0;
    if (value.status !== "update_available" && hasChanges) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fieldChanges"],
        message: "Only available updates may contain changes",
      });
    }
    if (
      value.status === "up_to_date" &&
      value.targetPublishedJobVersionId !== value.pinnedPublishedJobVersionId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetPublishedJobVersionId"],
        message: "An up-to-date target must equal the pinned version",
      });
    }
    if (
      value.status === "update_available" &&
      value.targetPublishedJobVersionId === value.pinnedPublishedJobVersionId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetPublishedJobVersionId"],
        message: "An available update must change the pinned version",
      });
    }
  });
export type ApplicationCaseJobVersionDiffResponse = z.infer<
  typeof ApplicationCaseJobVersionDiffResponseSchema
>;

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

export const ListApplicationCaseEventsResponseSchema = z
  .object({
    items: z.array(ApplicationCaseEventReadModelSchema),
    nextCursor: z.string().trim().min(1).nullable(),
  })
  .strict();
export type ListApplicationCaseEventsResponse = z.infer<
  typeof ListApplicationCaseEventsResponseSchema
>;

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

export const CaseRequirementStateReadModelSchema = z
  .object({
    id: UuidSchema.nullable(),
    caseId: UuidSchema,
    requirementContext: RequirementContextSchema,
    requirementId: RequirementIdSchema,
    state: RequirementEvidenceStateSchema,
    userNote: z.string().trim().max(2_000).nullable(),
    revision: RevisionSchema.nullable(),
    persisted: z.boolean(),
    createdAt: TimestampSchema.nullable(),
    updatedAt: TimestampSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const persistenceFields = [value.id, value.revision, value.createdAt, value.updatedAt];
    if (persistenceFields.some((field) => (field !== null) !== value.persisted)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["persisted"],
        message: "Persisted requirement state metadata must be present together",
      });
    }
  });
export type CaseRequirementStateReadModel = z.infer<typeof CaseRequirementStateReadModelSchema>;

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
    requirementContext: RequirementContextSchema,
    revision: RevisionSchema,
    requirements: z.array(JobRequirementSchema),
    states: z.array(CaseRequirementStateReadModelSchema),
    evidenceLinks: z.array(CaseRequirementEvidenceLinkSchema),
    questions: z.array(CaseQuestionSchema),
  })
  .strict();
export type ApplicationCaseRequirements = z.infer<typeof ApplicationCaseRequirementsSchema>;

export const ApplicationCaseMutationResponseSchema = z
  .object({
    caseRevision: RevisionSchema,
    event: ApplicationCaseEventSchema.nullable(),
  })
  .strict();
export type ApplicationCaseMutationResponse = z.infer<typeof ApplicationCaseMutationResponseSchema>;
