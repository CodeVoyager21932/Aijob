import {
  MaterialSnippetSchema,
  MaterialSnippetListSchema,
  SubmittedMaterialListSchema,
  type CreateMaterialSnippetRequest,
} from "@aijob/contracts";
import { apiRequest } from "./client";
export const materialKeys = {
  snippets: ["career-os", "material-snippets"] as const,
  submissions: (caseId: string) => ["career-os", "submitted-materials", caseId] as const,
};
export function listMaterialSnippets(offset = 0, signal?: AbortSignal) {
  return apiRequest(`/v1/material-snippets?offset=${offset}&limit=50`, {
    signal,
    responseSchema: MaterialSnippetListSchema,
  });
}
export function createMaterialSnippet(request: CreateMaterialSnippetRequest, key: string) {
  return apiRequest("/v1/material-snippets", {
    method: "POST",
    body: request,
    idempotencyKey: key,
    responseSchema: MaterialSnippetSchema,
  });
}
export function updateMaterialSnippet(
  id: string,
  request: CreateMaterialSnippetRequest & { expectedRevision: number },
  key: string,
) {
  return apiRequest(`/v1/material-snippets/${id}`, {
    method: "PUT",
    body: request,
    idempotencyKey: key,
    responseSchema: MaterialSnippetSchema,
  });
}
export function deleteMaterialSnippet(id: string, revision: number, key: string) {
  return apiRequest(`/v1/material-snippets/${id}`, {
    method: "DELETE",
    body: { expectedRevision: revision },
    idempotencyKey: key,
  });
}
export function listSubmittedMaterials(caseId: string, signal?: AbortSignal) {
  return apiRequest(`/v1/application-cases/${caseId}/submitted-materials`, {
    signal,
    responseSchema: SubmittedMaterialListSchema,
  });
}
export function deleteSubmittedMaterial(caseId: string, id: string, key: string) {
  return apiRequest(`/v1/application-cases/${caseId}/submitted-materials/${id}`, {
    method: "DELETE",
    idempotencyKey: key,
  });
}
