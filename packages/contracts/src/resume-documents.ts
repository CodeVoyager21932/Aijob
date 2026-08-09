import { z } from "zod";
import { JobContextSchema } from "./application-cases.js";
import {
  JsonRecordSchema,
  RevisionSchema,
  Sha256Schema,
  TimestampSchema,
  UuidSchema,
} from "./common.js";
import { ResumeSuggestionDecisionSchema } from "./enums.js";

export const ResumeDocumentKindSchema = z.enum(["base", "case_derived"]);
export type ResumeDocumentKind = z.infer<typeof ResumeDocumentKindSchema>;

export const ResumeTemplateKeySchema = z.enum(["cn_classic_single_column", "cn_compact_technical"]);
export type ResumeTemplateKey = z.infer<typeof ResumeTemplateKeySchema>;

export const ResumeLayoutFontSizeTokenSchema = z.enum(["compact", "standard", "large"]);
export type ResumeLayoutFontSizeToken = z.infer<typeof ResumeLayoutFontSizeTokenSchema>;

export const ResumeLayoutSpacingTokenSchema = z.enum(["tight", "standard", "relaxed"]);
export type ResumeLayoutSpacingToken = z.infer<typeof ResumeLayoutSpacingTokenSchema>;

export const ResumeLayoutColorTokenSchema = z.enum(["black", "charcoal", "navy"]);
export type ResumeLayoutColorToken = z.infer<typeof ResumeLayoutColorTokenSchema>;

export const ResumeLayoutPageBreakPolicySchema = z.enum([
  "automatic",
  "keep_sections",
  "compact_to_fit",
]);
export type ResumeLayoutPageBreakPolicy = z.infer<typeof ResumeLayoutPageBreakPolicySchema>;

export const ResumeLayoutSettingsSchema = z
  .object({
    schemaVersion: z.literal("resume-layout-settings-v1"),
    fontSizeToken: ResumeLayoutFontSizeTokenSchema,
    lineSpacingToken: ResumeLayoutSpacingTokenSchema,
    sectionSpacingToken: ResumeLayoutSpacingTokenSchema,
    colorToken: ResumeLayoutColorTokenSchema,
    pageBreakPolicy: ResumeLayoutPageBreakPolicySchema,
  })
  .strict();
export type ResumeLayoutSettings = z.infer<typeof ResumeLayoutSettingsSchema>;

const OrderedIdSchema = z.object({
  id: UuidSchema,
  ordinal: z.number().int().nonnegative(),
});

function requireUniqueOrdering<T extends { id: string; ordinal: number }>(
  values: T[],
  context: z.RefinementCtx,
  path: (string | number)[],
): void {
  const ids = new Set<string>();
  const ordinals = new Set<number>();
  values.forEach((value, index) => {
    if (ids.has(value.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, "id"],
        message: "IDs must be unique",
      });
    }
    if (ordinals.has(value.ordinal)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, "ordinal"],
        message: "ordinals must be unique",
      });
    }
    ids.add(value.id);
    ordinals.add(value.ordinal);
  });
}

export const ResumeDocumentV2BlockSchema = OrderedIdSchema.extend({
  text: z.string().trim().min(1).max(10_000),
  suggestionDecision: ResumeSuggestionDecisionSchema.default("pending"),
}).strict();
export type ResumeDocumentV2Block = z.infer<typeof ResumeDocumentV2BlockSchema>;

export const ResumeDocumentV2SectionSchema = OrderedIdSchema.extend({
  title: z.string().trim().min(1).max(100),
  blocks: z.array(ResumeDocumentV2BlockSchema).min(1).max(500),
})
  .strict()
  .superRefine((section, context) => {
    requireUniqueOrdering(section.blocks, context, ["blocks"]);
  });
export type ResumeDocumentV2Section = z.infer<typeof ResumeDocumentV2SectionSchema>;

export const ResumeDocumentV2ContentSchema = z
  .object({
    sections: z.array(ResumeDocumentV2SectionSchema).min(1).max(100),
  })
  .strict()
  .superRefine((content, context) => {
    requireUniqueOrdering(content.sections, context, ["sections"]);
    const allIds = new Set(content.sections.map((section) => section.id));
    content.sections.forEach((section, sectionIndex) => {
      section.blocks.forEach((block, blockIndex) => {
        if (allIds.has(block.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sections", sectionIndex, "blocks", blockIndex, "id"],
            message: "Section and block IDs must be unique across the document",
          });
        }
        allIds.add(block.id);
      });
    });
  });
export type ResumeDocumentV2Content = z.infer<typeof ResumeDocumentV2ContentSchema>;

const EvidenceIdSchema = z.string().trim().min(1).max(200);

export const ResumeSemanticBlockSchema = OrderedIdSchema.extend({
  text: z.string().trim().min(1).max(10_000),
  evidenceIds: z
    .array(EvidenceIdSchema)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "evidenceIds must be unique",
    }),
}).strict();
export type ResumeSemanticBlock = z.infer<typeof ResumeSemanticBlockSchema>;

export const ResumeSemanticSectionSchema = OrderedIdSchema.extend({
  title: z.string().trim().min(1).max(100),
  blocks: z.array(ResumeSemanticBlockSchema).min(1).max(500),
})
  .strict()
  .superRefine((section, context) => {
    requireUniqueOrdering(section.blocks, context, ["blocks"]);
  });
export type ResumeSemanticSection = z.infer<typeof ResumeSemanticSectionSchema>;

export const ResumeSemanticContentSchema = z
  .object({
    schemaVersion: z.literal("resume-content-v1"),
    sections: z.array(ResumeSemanticSectionSchema).min(1).max(100),
  })
  .strict()
  .superRefine((content, context) => {
    requireUniqueOrdering(content.sections, context, ["sections"]);
    const allIds = new Set(content.sections.map((section) => section.id));
    content.sections.forEach((section, sectionIndex) => {
      section.blocks.forEach((block, blockIndex) => {
        if (allIds.has(block.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sections", sectionIndex, "blocks", blockIndex, "id"],
            message: "Section and block IDs must be unique across the document",
          });
        }
        allIds.add(block.id);
      });
    });
  });
export type ResumeSemanticContent = z.infer<typeof ResumeSemanticContentSchema>;

const BaseDocumentReferenceSchema = z.object({
  kind: z.literal("base"),
  caseId: z.null(),
  detachedFromCaseId: z.null(),
  jobContext: z.null(),
  baseDocumentId: z.null(),
  baseDocumentRevisionId: z.null(),
  evidenceRevisionId: z.null(),
});

const DerivedDocumentReferenceSchema = z.object({
  kind: z.literal("case_derived"),
  caseId: UuidSchema.nullable(),
  detachedFromCaseId: UuidSchema.nullable(),
  jobContext: JobContextSchema,
  baseDocumentId: UuidSchema,
  baseDocumentRevisionId: UuidSchema,
  evidenceRevisionId: UuidSchema,
});

const ResumeDocumentFieldsSchema = z.object({
  id: UuidSchema,
  ownerId: UuidSchema,
  ownerEpoch: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  revision: RevisionSchema,
  currentContentRevisionId: UuidSchema.nullable(),
  currentLayoutRevisionId: UuidSchema.nullable(),
  expiresAt: TimestampSchema.nullable(),
  deletedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const ResumeDocumentSchema = z
  .discriminatedUnion("kind", [
    ResumeDocumentFieldsSchema.merge(BaseDocumentReferenceSchema).strict(),
    ResumeDocumentFieldsSchema.merge(DerivedDocumentReferenceSchema).strict(),
  ])
  .superRefine((value, context) => {
    if (value.kind === "base") return;
    if ((value.caseId === null) === (value.detachedFromCaseId === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["detachedFromCaseId"],
        message: "A derived resume must reference either an active or detached case",
      });
    }
    if (value.jobContext.kind === "private" && value.jobContext.ownerId !== value.ownerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["jobContext", "ownerId"],
        message: "Private job snapshots must belong to the resume owner",
      });
    }
  });
export type ResumeDocument = z.infer<typeof ResumeDocumentSchema>;

export const ResumeDocumentContentRevisionSchema = z
  .object({
    schemaVersion: z.literal("resume-document-v2"),
    id: UuidSchema,
    documentId: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: z.number().int().positive(),
    documentRevision: RevisionSchema,
    baseDocumentRevisionId: UuidSchema.nullable(),
    contentHash: Sha256Schema,
    confirmedAt: TimestampSchema,
    createdAt: TimestampSchema,
    content: ResumeDocumentV2ContentSchema,
  })
  .strict();
export type ResumeDocumentContentRevision = z.infer<typeof ResumeDocumentContentRevisionSchema>;

export const ResumeDocumentLayoutRevisionSchema = z
  .object({
    schemaVersion: z.literal("resume-layout-v1"),
    id: UuidSchema,
    documentId: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: z.number().int().positive(),
    layoutRevision: RevisionSchema,
    baseLayoutRevision: RevisionSchema.nullable(),
    templateKey: ResumeTemplateKeySchema,
    sectionOrder: z
      .array(UuidSchema)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "sectionOrder must be unique",
      }),
    settings: JsonRecordSchema,
    contentHash: Sha256Schema,
    createdAt: TimestampSchema,
  })
  .strict();
export type ResumeDocumentLayoutRevision = z.infer<typeof ResumeDocumentLayoutRevisionSchema>;

export const ResumeSemanticContentRevisionSchema = z
  .object({
    schemaVersion: z.literal("resume-content-revision-v1"),
    id: UuidSchema,
    documentId: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: z.number().int().positive(),
    documentRevision: RevisionSchema,
    baseDocumentRevisionId: UuidSchema.nullable(),
    contentHash: Sha256Schema,
    confirmedAt: TimestampSchema,
    createdAt: TimestampSchema,
    content: ResumeSemanticContentSchema,
  })
  .strict();
export type ResumeSemanticContentRevision = z.infer<typeof ResumeSemanticContentRevisionSchema>;

export const ResumeDocumentLayoutRevisionV2Schema = z
  .object({
    schemaVersion: z.literal("resume-layout-v2"),
    id: UuidSchema,
    documentId: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: z.number().int().positive(),
    layoutRevision: RevisionSchema,
    baseLayoutRevision: RevisionSchema.nullable(),
    templateKey: ResumeTemplateKeySchema,
    sectionOrder: z
      .array(UuidSchema)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "sectionOrder must be unique",
      }),
    settings: ResumeLayoutSettingsSchema,
    contentHash: Sha256Schema,
    createdAt: TimestampSchema,
  })
  .strict();
export type ResumeDocumentLayoutRevisionV2 = z.infer<typeof ResumeDocumentLayoutRevisionV2Schema>;

export const PutResumeDocumentLayoutRevisionV2RequestSchema = z
  .object({
    expectedRevision: RevisionSchema,
    templateKey: ResumeTemplateKeySchema,
    sectionOrder: z
      .array(UuidSchema)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "sectionOrder must be unique",
      }),
    settings: ResumeLayoutSettingsSchema,
  })
  .strict();
export type PutResumeDocumentLayoutRevisionV2Request = z.infer<
  typeof PutResumeDocumentLayoutRevisionV2RequestSchema
>;

export const ResumeReviewRunModeSchema = z.enum(["template", "controlled_ai"]);
export type ResumeReviewRunMode = z.infer<typeof ResumeReviewRunModeSchema>;

export const ResumeReviewRunStatusSchema = z.enum([
  "pending",
  "completed",
  "failed",
  "superseded",
  "deleted",
]);
export type ResumeReviewRunStatus = z.infer<typeof ResumeReviewRunStatusSchema>;

export const ResumeReviewRunSchema = z
  .object({
    schemaVersion: z.literal("resume-review-run-v1"),
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: z.number().int().positive(),
    caseId: UuidSchema.nullable(),
    detachedFromCaseId: UuidSchema.nullable(),
    documentId: UuidSchema,
    contentRevisionId: UuidSchema,
    jobContext: JobContextSchema,
    evidenceRevisionId: UuidSchema,
    mode: ResumeReviewRunModeSchema,
    status: ResumeReviewRunStatusSchema,
    revision: RevisionSchema,
    completedAt: TimestampSchema.nullable(),
    deletedAt: TimestampSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.caseId === null) === (value.detachedFromCaseId === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["detachedFromCaseId"],
        message: "A review run must reference either an active or detached case",
      });
    }
    if (value.jobContext.kind === "private" && value.jobContext.ownerId !== value.ownerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["jobContext", "ownerId"],
        message: "Private job snapshots must belong to the review owner",
      });
    }
    const requiresCompletedAt = value.status === "completed" || value.status === "superseded";
    const forbidsCompletedAt = value.status === "pending" || value.status === "failed";
    if (
      (requiresCompletedAt && value.completedAt === null) ||
      (forbidsCompletedAt && value.completedAt !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "completedAt must follow the review lifecycle",
      });
    }
    if ((value.status === "deleted") !== (value.deletedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deletedAt"],
        message: "deletedAt must be present exactly when the review is deleted",
      });
    }
  });
export type ResumeReviewRun = z.infer<typeof ResumeReviewRunSchema>;

export const ResumeReviewFindingCategorySchema = z.enum([
  "content_relevance",
  "evidence_support",
  "expression_clarity",
  "structure_order",
  "ats_readability",
]);
export type ResumeReviewFindingCategory = z.infer<typeof ResumeReviewFindingCategorySchema>;

export const ResumeReviewFindingSeveritySchema = z.enum(["info", "warning", "critical"]);
export type ResumeReviewFindingSeverity = z.infer<typeof ResumeReviewFindingSeveritySchema>;

const ResumeReviewReasonCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Z0-9_]+$/);

export const ResumeReviewFindingSchema = z
  .object({
    schemaVersion: z.literal("resume-review-finding-v1"),
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: z.number().int().positive(),
    reviewRunId: UuidSchema,
    category: ResumeReviewFindingCategorySchema,
    severity: ResumeReviewFindingSeveritySchema,
    sourceBlockId: UuidSchema,
    evidenceIds: z
      .array(EvidenceIdSchema)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "evidenceIds must be unique",
      }),
    reasonCode: ResumeReviewReasonCodeSchema,
    createdAt: TimestampSchema,
  })
  .strict();
export type ResumeReviewFinding = z.infer<typeof ResumeReviewFindingSchema>;

export const ResumeReviewChangeTypeSchema = z.enum([
  "rewrite_block",
  "remove_block",
  "split_block",
  "merge_blocks",
  "reorder_section",
  "add_confirmed_evidence",
]);
export type ResumeReviewChangeType = z.infer<typeof ResumeReviewChangeTypeSchema>;

export const ResumeReviewTargetTypeSchema = z.enum(["block", "section"]);
export type ResumeReviewTargetType = z.infer<typeof ResumeReviewTargetTypeSchema>;

export const ResumeReviewSuggestionSchema = z
  .object({
    schemaVersion: z.literal("resume-review-suggestion-v1"),
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: z.number().int().positive(),
    reviewRunId: UuidSchema,
    findingId: UuidSchema,
    targetType: ResumeReviewTargetTypeSchema,
    targetIds: z.array(UuidSchema).min(1).max(500),
    changeType: ResumeReviewChangeTypeSchema,
    suggestedText: z.string().trim().min(1).max(10_000).nullable(),
    evidenceIds: z
      .array(EvidenceIdSchema)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "evidenceIds must be unique",
      }),
    decision: ResumeSuggestionDecisionSchema,
    revision: RevisionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const uniqueTargetIds = new Set(value.targetIds);
    if (uniqueTargetIds.size !== value.targetIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetIds"],
        message: "targetIds must be unique",
      });
    }

    const isLayoutChange = value.changeType === "reorder_section";
    if ((value.targetType === "section") !== isLayoutChange) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetType"],
        message: "Only section reordering may target sections",
      });
    }

    if (value.changeType === "merge_blocks" && value.targetIds.length < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetIds"],
        message: "Merging blocks requires at least two target IDs",
      });
    }
    if (isLayoutChange && value.targetIds.length < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetIds"],
        message: "Reordering sections requires at least two target IDs",
      });
    }
    if (value.changeType !== "merge_blocks" && !isLayoutChange && value.targetIds.length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetIds"],
        message: "This change type requires exactly one target ID",
      });
    }

    const removesText = value.changeType === "remove_block" || isLayoutChange;
    if (removesText !== (value.suggestedText === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["suggestedText"],
        message: "Only removal and layout suggestions may omit suggested text",
      });
    }

    if (!removesText && value.evidenceIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceIds"],
        message: "Text suggestions must cite confirmed evidence",
      });
    }
  });
export type ResumeReviewSuggestion = z.infer<typeof ResumeReviewSuggestionSchema>;

export const ResumeReviewFinalDecisionSchema = z.enum(["accepted", "edited", "rejected"]);
export type ResumeReviewFinalDecision = z.infer<typeof ResumeReviewFinalDecisionSchema>;

export const ResumeReviewDecisionSchema = z
  .object({
    schemaVersion: z.literal("resume-review-decision-v1"),
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: z.number().int().positive(),
    reviewRunId: UuidSchema,
    suggestionId: UuidSchema,
    basedOnSuggestionRevision: RevisionSchema,
    idempotencyKeyHash: Sha256Schema,
    decision: ResumeReviewFinalDecisionSchema,
    editedText: z.string().trim().min(1).max(10_000).nullable(),
    resultContentRevisionId: UuidSchema.nullable(),
    reasonCode: ResumeReviewReasonCodeSchema.nullable(),
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "accepted") {
      if (
        value.editedText !== null ||
        value.resultContentRevisionId === null ||
        value.reasonCode !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["resultContentRevisionId"],
          message: "Accepted suggestions require only a result revision",
        });
      }
      return;
    }
    if (value.decision === "edited") {
      if (
        value.editedText === null ||
        value.resultContentRevisionId === null ||
        value.reasonCode !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["editedText"],
          message: "Edited suggestions require only edited text and a result revision",
        });
      }
      return;
    }
    if (
      value.editedText !== null ||
      value.resultContentRevisionId !== null ||
      value.reasonCode === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCode"],
        message: "Rejected suggestions require only a reason code",
      });
    }
  });
export type ResumeReviewDecision = z.infer<typeof ResumeReviewDecisionSchema>;

const ResumeReviewDecisionRequestFieldsSchema = z.object({
  expectedRevision: RevisionSchema,
  idempotencyKey: UuidSchema,
});

export const DecideResumeReviewSuggestionRequestSchema = z.discriminatedUnion("decision", [
  ResumeReviewDecisionRequestFieldsSchema.extend({
    decision: z.literal("accepted"),
  }).strict(),
  ResumeReviewDecisionRequestFieldsSchema.extend({
    decision: z.literal("edited"),
    editedText: z.string().trim().min(1).max(10_000),
    evidenceIds: z
      .array(EvidenceIdSchema)
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "evidenceIds must be unique",
      }),
  }).strict(),
  ResumeReviewDecisionRequestFieldsSchema.extend({
    decision: z.literal("rejected"),
    reasonCode: ResumeReviewReasonCodeSchema,
  }).strict(),
]);
export type DecideResumeReviewSuggestionRequest = z.infer<
  typeof DecideResumeReviewSuggestionRequestSchema
>;

export const LegacyResumeDocumentVirtualSchema = z
  .object({
    schemaVersion: z.literal("resume-document-v1"),
    id: UuidSchema,
    ownerId: UuidSchema,
    ownerEpoch: z.number().int().positive(),
    revision: RevisionSchema,
    sections: z.array(z.unknown()).max(100),
    readOnly: z.literal(true),
  })
  .strict();
export type LegacyResumeDocumentVirtual = z.infer<typeof LegacyResumeDocumentVirtualSchema>;

export const ResumeDocumentReadModelSchema = z.discriminatedUnion("schemaVersion", [
  LegacyResumeDocumentVirtualSchema,
  ResumeDocumentContentRevisionSchema,
  ResumeSemanticContentRevisionSchema,
]);
export type ResumeDocumentReadModel = z.infer<typeof ResumeDocumentReadModelSchema>;

const BaseDocumentCreateRequestSchema = z
  .object({
    kind: z.literal("base"),
    title: z.string().trim().min(1).max(200),
  })
  .strict();

const DerivedDocumentCreateRequestSchema = z
  .object({
    kind: z.literal("case_derived"),
    caseId: UuidSchema,
    baseDocumentRevisionId: UuidSchema,
    expectedCaseRevision: RevisionSchema,
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export const CreateResumeDocumentRequestSchema = z.discriminatedUnion("kind", [
  BaseDocumentCreateRequestSchema,
  DerivedDocumentCreateRequestSchema,
]);
export type CreateResumeDocumentRequest = z.infer<typeof CreateResumeDocumentRequestSchema>;

const FirstResumeDocumentEditRequestSchema = z
  .object({
    expectedRevision: z.literal(0),
    legacySourceRevisionId: UuidSchema,
    content: ResumeSemanticContentSchema,
  })
  .strict();

const ExistingResumeDocumentEditRequestSchema = z
  .object({
    expectedRevision: RevisionSchema,
    baseDocumentRevisionId: UuidSchema,
    content: ResumeSemanticContentSchema,
  })
  .strict();

export const PutResumeDocumentContentRevisionRequestSchema = z.union([
  FirstResumeDocumentEditRequestSchema,
  ExistingResumeDocumentEditRequestSchema,
]);
export type PutResumeDocumentContentRevisionRequest = z.infer<
  typeof PutResumeDocumentContentRevisionRequestSchema
>;

export const PutResumeDocumentLayoutRevisionRequestSchema =
  PutResumeDocumentLayoutRevisionV2RequestSchema;
export type PutResumeDocumentLayoutRevisionRequest = z.infer<
  typeof PutResumeDocumentLayoutRevisionRequestSchema
>;

export const ResumeDocumentIdSchema = z
  .object({
    documentId: UuidSchema,
  })
  .strict();
export type ResumeDocumentId = z.infer<typeof ResumeDocumentIdSchema>;

export const LegacyResumeDocumentSourceIdSchema = z
  .object({
    legacySourceRevisionId: UuidSchema,
  })
  .strict();
export type LegacyResumeDocumentSourceId = z.infer<typeof LegacyResumeDocumentSourceIdSchema>;

export const ResumeDocumentLegacySourceSchema = z
  .object({
    legacySourceRevisionId: UuidSchema,
    legacySchemaVersion: z.literal("resume-document-v1"),
    legacyRevision: RevisionSchema,
  })
  .strict();
export type ResumeDocumentLegacySource = z.infer<typeof ResumeDocumentLegacySourceSchema>;

export const LegacyResumeDocumentSourceSummarySchema = ResumeDocumentLegacySourceSchema.extend({
  ownerId: UuidSchema,
  ownerEpoch: z.number().int().positive(),
  confirmedAt: TimestampSchema,
  readOnly: z.literal(true),
}).strict();
export type LegacyResumeDocumentSourceSummary = z.infer<
  typeof LegacyResumeDocumentSourceSummarySchema
>;

export const LegacyResumeContentConversionSchema = z
  .object({
    schemaVersion: z.literal("resume-legacy-content-conversion-v1"),
    legacySource: LegacyResumeDocumentSourceSummarySchema,
    content: ResumeSemanticContentSchema,
  })
  .strict();
export type LegacyResumeContentConversion = z.infer<typeof LegacyResumeContentConversionSchema>;

export const ResumeDocumentRevisionPageQuerySchema = z
  .object({
    beforeRevision: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ResumeDocumentRevisionPageQuery = z.infer<typeof ResumeDocumentRevisionPageQuerySchema>;

export const ResumeDocumentContentRevisionReadModelSchema = z.union([
  ResumeDocumentContentRevisionSchema,
  ResumeSemanticContentRevisionSchema,
]);
export type ResumeDocumentContentRevisionReadModel = z.infer<
  typeof ResumeDocumentContentRevisionReadModelSchema
>;

export const ListResumeDocumentContentRevisionsResponseSchema = z
  .object({
    documentRevision: RevisionSchema,
    currentContentRevisionId: UuidSchema.nullable(),
    current: ResumeDocumentContentRevisionReadModelSchema.nullable(),
    items: z.array(ResumeDocumentContentRevisionReadModelSchema).max(100),
    nextBeforeRevision: RevisionSchema.nullable(),
  })
  .strict();
export type ListResumeDocumentContentRevisionsResponse = z.infer<
  typeof ListResumeDocumentContentRevisionsResponseSchema
>;

export const PutResumeDocumentContentRevisionResponseSchema = z
  .object({
    contentRevision: ResumeSemanticContentRevisionSchema,
    documentRevision: RevisionSchema,
    created: z.boolean(),
  })
  .strict();
export type PutResumeDocumentContentRevisionResponse = z.infer<
  typeof PutResumeDocumentContentRevisionResponseSchema
>;

export const ResumeDocumentLayoutRevisionReadModelSchema = z.union([
  ResumeDocumentLayoutRevisionSchema,
  ResumeDocumentLayoutRevisionV2Schema,
]);
export type ResumeDocumentLayoutRevisionReadModel = z.infer<
  typeof ResumeDocumentLayoutRevisionReadModelSchema
>;

export const ListResumeDocumentLayoutRevisionsResponseSchema = z
  .object({
    documentRevision: RevisionSchema,
    currentLayoutRevisionId: UuidSchema.nullable(),
    current: ResumeDocumentLayoutRevisionReadModelSchema.nullable(),
    items: z.array(ResumeDocumentLayoutRevisionReadModelSchema).max(100),
    nextBeforeRevision: RevisionSchema.nullable(),
  })
  .strict();
export type ListResumeDocumentLayoutRevisionsResponse = z.infer<
  typeof ListResumeDocumentLayoutRevisionsResponseSchema
>;

export const PutResumeDocumentLayoutRevisionResponseSchema = z
  .object({
    layoutRevision: ResumeDocumentLayoutRevisionV2Schema,
    documentRevision: RevisionSchema,
    created: z.boolean(),
  })
  .strict();
export type PutResumeDocumentLayoutRevisionResponse = z.infer<
  typeof PutResumeDocumentLayoutRevisionResponseSchema
>;

export const ResumeDocumentCursorSchema = z
  .object({
    updatedAt: TimestampSchema,
    id: UuidSchema,
  })
  .strict();
export type ResumeDocumentCursor = z.infer<typeof ResumeDocumentCursorSchema>;

export const ListResumeDocumentsQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(1_024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    kind: ResumeDocumentKindSchema.optional(),
    caseId: UuidSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "base" && value.caseId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caseId"],
        message: "Base resume queries cannot be scoped to an application case",
      });
    }
  });
export type ListResumeDocumentsQuery = z.infer<typeof ListResumeDocumentsQuerySchema>;

export const ListResumeDocumentsResponseSchema = z
  .object({
    items: z.array(ResumeDocumentSchema),
    nextCursor: z.string().trim().min(1).nullable(),
    legacySource: LegacyResumeDocumentSourceSummarySchema.nullable(),
  })
  .strict();
export type ListResumeDocumentsResponse = z.infer<typeof ListResumeDocumentsResponseSchema>;

export const CreateResumeDocumentResponseSchema = z
  .object({
    resumeDocument: ResumeDocumentSchema,
    created: z.boolean(),
  })
  .strict();
export type CreateResumeDocumentResponse = z.infer<typeof CreateResumeDocumentResponseSchema>;

export const ResumeDocumentContentSchema = ResumeSemanticContentSchema;
export type ResumeDocumentContent = ResumeSemanticContent;

export const ResumeDocumentV2Schema = ResumeDocumentSchema;
export const ResumeDocumentV2ContentRevisionSchema = ResumeSemanticContentRevisionSchema;
export const ResumeDocumentV2LayoutRevisionSchema = ResumeDocumentLayoutRevisionV2Schema;
export const CreateResumeDocumentContentRevisionRequestSchema =
  PutResumeDocumentContentRevisionRequestSchema;
export type ResumeDocumentV2ContentRevision = ResumeSemanticContentRevision;
export type ResumeDocumentV2LayoutRevision = ResumeDocumentLayoutRevisionV2;
