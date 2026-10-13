import { z } from 'zod';

export const CreateResumeExportSchema = z.object({
  format: z.enum(['pdf', 'docx']), contentRevisionId: z.string().uuid(), layoutRevisionId: z.string().uuid(),
}).strict();
export type CreateResumeExport = z.infer<typeof CreateResumeExportSchema>;
export const ResumeExportArtifactSchema = z.object({
  id: z.string().uuid(), documentId: z.string().uuid(), contentRevisionId: z.string().uuid(), layoutRevisionId: z.string().uuid(),
  format: z.enum(['pdf', 'docx']), state: z.enum(['generating','ready','failed','deleted']),
  fileName: z.string(), mediaType: z.string(), pageCount: z.number().int().positive().nullable(),
  byteSize: z.number().int().positive().nullable(), sha256: z.string().nullable(),
  templateId: z.string(), templateVersion: z.string(), rendererVersion: z.string(), fontSetVersion: z.string(),
  createdAt: z.string().datetime(), failureCode: z.string().nullable(),
});
export type ResumeExportArtifact = z.infer<typeof ResumeExportArtifactSchema>;
export const ResumeExportArtifactsSchema = z.object({ items: z.array(ResumeExportArtifactSchema) });
