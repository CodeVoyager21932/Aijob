import { z } from 'zod';
import { RESUME_TEMPLATES } from './resume-templates.js';
export const ResumeTemplatePreferenceSchema = z.object({ templateId: z.string(), favorite: z.boolean(), revision: z.number().int().nonnegative(), lastUsedAt: z.string().nullable() });
export const ResumeTemplatePreferencesSchema = z.object({ items: z.array(ResumeTemplatePreferenceSchema) });
export const SetTemplatePreferenceSchema = z.object({ templateId: z.string().refine((id) => RESUME_TEMPLATES.some((t) => t.id === id), '模板不存在'), favorite: z.boolean(), expectedRevision: z.number().int().nonnegative() }).strict();
export const ResumePhotoSchema = z.object({ id: z.string().uuid(), mediaType: z.enum(['image/jpeg', 'image/png']), width: z.number(), height: z.number(), byteSize: z.number() });
