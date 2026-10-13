import {
  ExperienceRecordSchema,
  ResumeOriginalSchema,
  type ResumeSectionKind,
  ResumeStudioContentSchema,
  ResumeStudioDraftSchema,
  type ResumeStudioEntry,
  ResumeStudioLayoutSchema,
  ResumeTemplatePreferencesSchema,
  ResumePhotoSchema,
  type SaveResumeStudioDraft,
  ResumeExportArtifactSchema,
  ResumeExportArtifactsSchema,
  type CreateResumeExport,
} from "@aijob/contracts";
import { z } from "zod";
import { apiDownload, apiRequest, createIdempotencyKey } from "./client";
export const getTemplatePreferences = () => apiRequest('/v1/resume-template-preferences', { responseSchema: ResumeTemplatePreferencesSchema });
export const setTemplateFavorite = (templateId: string, favorite: boolean, expectedRevision: number, key = createIdempotencyKey()) => apiRequest('/v1/resume-template-preferences', { method: 'PUT', body: { templateId, favorite, expectedRevision }, idempotencyKey: key, responseSchema: ResumeTemplatePreferencesSchema });
export const uploadPhoto = (file: File, key = createIdempotencyKey()) => { const body = new FormData(); body.append('file', file); return apiRequest('/v1/resume-photos', { method: 'POST', body, idempotencyKey: key, responseSchema: ResumePhotoSchema }); };
export const deletePhoto = (id: string) => apiRequest(`/v1/resume-photos/${id}`, { method: 'DELETE', idempotencyKey: createIdempotencyKey() });
export const createResumeExport = (id:string,body:CreateResumeExport,key=createIdempotencyKey())=>apiRequest(`/v1/resume-documents/${id}/exports`,{method:'POST',body,idempotencyKey:key,responseSchema:ResumeExportArtifactSchema});
export const getResumeExport = (id:string)=>apiRequest(`/v1/resume-exports/${id}/status`,{responseSchema:ResumeExportArtifactSchema});
export const listResumeExports = (id:string)=>apiRequest(`/v1/resume-documents/${id}/exports`,{responseSchema:ResumeExportArtifactsSchema});
export const deleteResumeExport = (id:string)=>apiRequest(`/v1/resume-exports/${id}`,{method:'DELETE',idempotencyKey:createIdempotencyKey()});
export async function readyResumeExport(id:string,body:CreateResumeExport,key=createIdempotencyKey()) {
  let artifact=await createResumeExport(id,body,key);
  const deadline=Date.now()+120000;
  while(artifact.state==='generating' && Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,900));artifact=await getResumeExport(artifact.id);
  }
  if(artifact.state!=='ready')throw new Error(artifact.state==='generating'?'这份文件仍在生成，可稍后到版本与导出记录查看。':'文件生成未成功，当前稿件仍然保留。请重新下载。');
  return artifact;
}
export async function photoDataUrl(id: string) { const { blob } = await apiDownload(`/v1/resume-photos/${id}`); return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); }); }

const historySchema = z.object({
  items: z.array(
    z.object({
      contentRevisionId: z.string().uuid(),
      layoutRevisionId: z.string().uuid(),
      version: z.number(),
      createdAt: z.string(),
      content: ResumeStudioContentSchema,
      layout: ResumeStudioLayoutSchema,
    }),
  ),
});
export type StudioHistory = z.infer<typeof historySchema>["items"];
export function getStudio(id: string, signal?: AbortSignal) {
  return apiRequest(`/v1/resume-documents/${id}/studio`, {
    responseSchema: ResumeStudioDraftSchema,
    ...(signal ? { signal } : {}),
  });
}
export function createStudio(
  input: { title: string; copyFromDocumentId?: string; experienceIds?: string[] },
  key = createIdempotencyKey(),
) {
  return apiRequest("/v1/resume-documents/studio", {
    method: "POST",
    body: input,
    idempotencyKey: key,
    responseSchema: ResumeStudioDraftSchema,
  });
}
export function saveStudio(id: string, body: SaveResumeStudioDraft, key: string) {
  return apiRequest(`/v1/resume-documents/${id}/studio`, {
    method: "PUT",
    body,
    idempotencyKey: key,
    responseSchema: ResumeStudioDraftSchema,
  });
}
export function checkpointStudio(id: string, expectedRevision: number) {
  return apiRequest(`/v1/resume-documents/${id}/checkpoint`, {
    method: "POST",
    body: { expectedRevision },
    idempotencyKey: createIdempotencyKey(),
    responseSchema: z.object({
      contentRevisionId: z.string().uuid(),
      layoutRevisionId: z.string().uuid(),
    }),
  });
}
export function getStudioHistory(id: string) {
  return apiRequest(`/v1/resume-documents/${id}/studio-history`, { responseSchema: historySchema });
}
export function importStudio(
  body: FormData | { text: string; title: string },
  key = createIdempotencyKey(),
) {
  return apiRequest("/v1/resume-documents/import", {
    method: "POST",
    body,
    idempotencyKey: key,
    responseSchema: z.object({
      draft: ResumeStudioDraftSchema,
      originals: z.array(ResumeOriginalSchema),
    }),
  });
}
export function studioOriginals(id: string) {
  return apiRequest(`/v1/resume-documents/${id}/originals`, {
    responseSchema: z.object({ items: z.array(ResumeOriginalSchema) }),
  });
}
export function deleteStudioOriginal(id: string) {
  return apiRequest(`/v1/resume-originals/${id}`, {
    method: "DELETE",
    idempotencyKey: createIdempotencyKey(),
  });
}
export function getExperiences() {
  return apiRequest("/v1/experiences", {
    responseSchema: z.object({ items: z.array(ExperienceRecordSchema) }),
  });
}
export function createExperience(kind: ResumeSectionKind, entry: ResumeStudioEntry) {
  return apiRequest("/v1/experiences", {
    method: "POST",
    body: { kind, entry },
    idempotencyKey: createIdempotencyKey(),
    responseSchema: ExperienceRecordSchema,
  });
}
export function putExperience(id: string, expectedRevision: number, entry: ResumeStudioEntry) {
  return apiRequest(`/v1/experiences/${id}`, {
    method: "PUT",
    body: { expectedRevision, entry },
    idempotencyKey: createIdempotencyKey(),
    responseSchema: ExperienceRecordSchema,
  });
}
export function deleteExperience(id: string) {
  return apiRequest(`/v1/experiences/${id}`, {
    method: "DELETE",
    idempotencyKey: createIdempotencyKey(),
  });
}
export async function downloadStudioFile(path: string, fallback: string) {
  const file = await apiDownload(path);
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.fileName ?? fallback;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function applyParsedOriginal(
  id: string,
  expectedRevision: number,
  idempotencyKey = createIdempotencyKey(),
) {
  return apiRequest(`/v1/resume-originals/${id}/use-parsed`, {
    method: "POST",
    body: { expectedRevision },
    idempotencyKey,
    responseSchema: ResumeStudioDraftSchema,
  });
}
export function recoverLegacyResume(id: string, key: string) {
  return apiRequest(`/v1/resume-documents/import-legacy/${id}`, {
    method: "POST",
    idempotencyKey: key,
    responseSchema: ResumeStudioDraftSchema,
  });
}
