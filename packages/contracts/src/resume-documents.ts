import { z } from "zod";

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

export const ResumeTemplateKeySchema = z.enum([
  "cn_classic_single_column",
  "cn_compact_technical",
]);
export type ResumeTemplateKey = z.infer<typeof ResumeTemplateKeySchema>;

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
      context.addIssue({ code: z.ZodIssueCode.custom, path: [...path, index, "id"], message: "IDs must be unique" });
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
}).strict().superRefine((section, context) => {
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

const BaseDocumentReferenceSchema = z.object({
  kind: z.literal("base"),
  caseId: z.null(),
  publishedJobId: z.null(),
  publishedJobVersionId: z.null(),
  requirementSetId: z.null(),
  baseDocumentRevisionId: z.null(),
  evidenceRevisionId: z.null(),
});

const DerivedDocumentReferenceSchema = z.object({
  kind: z.literal("case_derived"),
  caseId: UuidSchema,
  publishedJobId: UuidSchema,
  publishedJobVersionId: UuidSchema,
  requirementSetId: UuidSchema,
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
  expiresAt: TimestampSchema,
  deletedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const ResumeDocumentSchema = z.discriminatedUnion("kind", [
  ResumeDocumentFieldsSchema.merge(BaseDocumentReferenceSchema).strict(),
  ResumeDocumentFieldsSchema.merge(DerivedDocumentReferenceSchema).strict(),
]);
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
      .refine((ids) => new Set(ids).size === ids.length, { message: "sectionOrder must be unique" }),
    settings: JsonRecordSchema,
    contentHash: Sha256Schema,
    createdAt: TimestampSchema,
  })
  .strict();
export type ResumeDocumentLayoutRevision = z.infer<typeof ResumeDocumentLayoutRevisionSchema>;

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
    content: ResumeDocumentV2ContentSchema,
  })
  .strict();

const ExistingResumeDocumentEditRequestSchema = z
  .object({
    expectedRevision: RevisionSchema,
    baseDocumentRevisionId: UuidSchema,
    content: ResumeDocumentV2ContentSchema,
  })
  .strict();

export const PutResumeDocumentContentRevisionRequestSchema = z.union([
  FirstResumeDocumentEditRequestSchema,
  ExistingResumeDocumentEditRequestSchema,
]);
export type PutResumeDocumentContentRevisionRequest = z.infer<
  typeof PutResumeDocumentContentRevisionRequestSchema
>;

export const PutResumeDocumentLayoutRevisionRequestSchema = z
  .object({
    expectedRevision: RevisionSchema,
    templateKey: ResumeTemplateKeySchema,
    sectionOrder: z
      .array(UuidSchema)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, { message: "sectionOrder must be unique" }),
    settings: JsonRecordSchema,
  })
  .strict();
export type PutResumeDocumentLayoutRevisionRequest = z.infer<
  typeof PutResumeDocumentLayoutRevisionRequestSchema
>;

export const ResumeDocumentIdSchema = z
  .object({
    documentId: UuidSchema,
  })
  .strict();
export type ResumeDocumentId = z.infer<typeof ResumeDocumentIdSchema>;

export const ResumeDocumentLegacySourceSchema = z
  .object({
    legacySourceRevisionId: UuidSchema,
    legacySchemaVersion: z.literal("resume-document-v1"),
    legacyRevision: RevisionSchema,
  })
  .strict();
export type ResumeDocumentLegacySource = z.infer<typeof ResumeDocumentLegacySourceSchema>;

export const ResumeDocumentContentSchema = ResumeDocumentV2ContentSchema;
export type ResumeDocumentContent = ResumeDocumentV2Content;

export const ResumeDocumentV2Schema = ResumeDocumentSchema;
export const ResumeDocumentV2ContentRevisionSchema = ResumeDocumentContentRevisionSchema;
export const ResumeDocumentV2LayoutRevisionSchema = ResumeDocumentLayoutRevisionSchema;
export const CreateResumeDocumentContentRevisionRequestSchema =
  PutResumeDocumentContentRevisionRequestSchema;
export type ResumeDocumentV2ContentRevision = ResumeDocumentContentRevision;
export type ResumeDocumentV2LayoutRevision = ResumeDocumentLayoutRevision;
