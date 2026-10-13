import { z } from "zod";
import {
  ResumeLayoutSettingsSchema,
  ResumeSemanticContentSchema,
  ResumeTemplateKeySchema,
} from "./resume-documents.js";
import { ResumeStudioContentSchema, ResumeStudioLayoutSchema } from "./resume-studio.js";

const SubmittedMaterialBaseSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  caseRevision: z.number().int().positive(),
  documentId: z.string().uuid(),
  contentRevisionId: z.string().uuid(),
  layoutRevisionId: z.string().uuid(),
  title: z.string(),
  submittedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  submittedFile: z.object({artifactId:z.string().uuid(),format:z.enum(["pdf","docx"]),fileName:z.string(),sha256:z.string()}).optional(),
});
export const NativeSubmittedContentSchema = z
  .object({
    schemaVersion: z.literal("aijob-native-resume-v1"),
    coreVersion: z.string(),
    data: z.record(z.unknown()),
    sourceBindings: z.array(z.object({originalId:z.string().min(1).max(300),blockId:z.string().min(1).max(300),sectionId:z.string().min(1).max(300),itemId:z.string().min(1).max(300).optional(),field:z.string().min(1).max(100)}).strict()).max(100000).optional(),
  })
  .strict();
export const NativeSubmittedLayoutSchema = z
  .object({
    schemaVersion: z.literal("aijob-native-layout-v1"),
    coreVersion: z.string(),
    metadata: z.record(z.unknown()),
    presentation: z.object({ id: z.string(), version: z.number().int().positive() }).optional(),
  })
  .strict();
export const SubmittedMaterialSchema = z.union([
  SubmittedMaterialBaseSchema.extend({
    editorCore: z.literal("native-v1"),
    content: NativeSubmittedContentSchema,
    layout: NativeSubmittedLayoutSchema,
  }),
  SubmittedMaterialBaseSchema.extend({
    editorCore: z.literal("legacy").default("legacy"),
    content: ResumeSemanticContentSchema,
    layout: z.object({
      templateKey: ResumeTemplateKeySchema,
      sectionOrder: z.array(z.string().uuid()),
      settings: ResumeLayoutSettingsSchema,
      studio: z
        .object({
          content: ResumeStudioContentSchema,
          layout: ResumeStudioLayoutSchema,
          resources: z
            .object({
              photoDataUrl: z
                .string()
                .max(7200000)
                .regex(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/)
                .optional(),
            })
            .optional(),
        })
        .optional(),
    }),
  }),
]);
export type SubmittedMaterial = z.infer<typeof SubmittedMaterialSchema>;
export const SubmittedMaterialListSchema = z.object({ items: z.array(SubmittedMaterialSchema) });
export const MaterialSnippetFieldsSchema = z.object({
  kind: z.enum(["introduction", "project_long", "project_short", "email", "other"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  sourceDocumentId: z.string().uuid().nullable().default(null),
  sourceContentRevisionId: z.string().uuid().nullable().default(null),
  sourceBlockIds: z.array(z.string().min(1).max(500)).max(100).default([]),
  sourceExperienceIds: z.array(z.string().uuid()).max(30).optional(),
});
export const MaterialSnippetSchema = MaterialSnippetFieldsSchema.extend({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const MaterialSnippetListSchema = z.object({
  items: z.array(MaterialSnippetSchema),
  nextOffset: z.number().int().nonnegative().nullable().default(null),
});
export const CreateMaterialSnippetRequestSchema = MaterialSnippetFieldsSchema.strict();
export const UpdateMaterialSnippetRequestSchema = MaterialSnippetFieldsSchema.extend({
  expectedRevision: z.number().int().positive(),
}).strict();
export type MaterialSnippet = z.infer<typeof MaterialSnippetSchema>;
export type CreateMaterialSnippetRequest = z.infer<typeof CreateMaterialSnippetRequestSchema>;
