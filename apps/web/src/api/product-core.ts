import {
  JobGraphResultSchema,
  JobGraphEvidencePageSchema,
  PersonalGraphComparisonSchema,
  PlannerItemSchema,
  PlannerListSchema,
  SavedSearchSchema,
  SavedSearchListSchema,
  type JobGraphScope,
  type CreatePlannerItemRequest,
  type UpdatePlannerItemRequest,
  type PlannerListQuery,
} from "@aijob/contracts";
import { apiRequest, createIdempotencyKey } from "./client";

export const coreKeys = {
  graph: ["career-os", "current-graph"] as const,
  planner: ["career-os", "planner"] as const,
  searches: ["career-os", "saved-searches"] as const,
};
export function compareGraphWithEvidence(
  scope: JobGraphScope,
  key: string,
  dataset: "public" | "private",
) {
  return apiRequest("/v1/job-graph/personal-comparison", {
    method: "POST",
    body: { scope, key, dataset },
    responseSchema: PersonalGraphComparisonSchema,
  });
}
export function getCurrentGraph(
  scope: JobGraphScope,
  signal?: AbortSignal,
  dataset: "public" | "private" = "public",
) {
  return apiRequest(
    `/v1/${dataset === "private" ? "private-job-graph" : "job-graph"}?${new URLSearchParams({ scope: JSON.stringify(scope) })}`,
    { signal, responseSchema: JobGraphResultSchema },
  );
}
export function getGraphEvidence(
  scope: JobGraphScope,
  key: string,
  offset: number,
  signal?: AbortSignal,
  dataset: "public" | "private" = "public",
) {
  return apiRequest(
    `/v1/${dataset === "private" ? "private-job-graph" : "job-graph"}/evidence?${new URLSearchParams({ scope: JSON.stringify(scope), key, offset: String(offset), limit: "20" })}`,
    { signal, responseSchema: JobGraphEvidencePageSchema },
  );
}
export function getPlannerItems(query: Partial<PlannerListQuery> = {}, signal?: AbortSignal) {
  const params = new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  return apiRequest(`/v1/planner-items?${params}`, { signal, responseSchema: PlannerListSchema });
}
export function addPlannerItem(request: CreatePlannerItemRequest, idempotencyKey: string) {
  return apiRequest("/v1/planner-items", {
    method: "POST",
    body: request,
    idempotencyKey,
    responseSchema: PlannerItemSchema,
  });
}
export function putPlannerItem(
  id: string,
  request: UpdatePlannerItemRequest,
  idempotencyKey: string,
) {
  return apiRequest(`/v1/planner-items/${id}`, {
    method: "PUT",
    body: request,
    idempotencyKey,
    responseSchema: PlannerItemSchema,
  });
}
export function removePlannerItem(id: string, expectedRevision: number, idempotencyKey: string) {
  return apiRequest(`/v1/planner-items/${id}`, {
    method: "DELETE",
    body: { expectedRevision },
    idempotencyKey,
  });
}
export function getSavedSearches(signal?: AbortSignal) {
  return apiRequest("/v1/saved-searches", { signal, responseSchema: SavedSearchListSchema });
}
export function persistSearch(
  label: string,
  scope: JobGraphScope,
  idempotencyKey: string,
  dataset: "public" | "private" = "public",
) {
  return apiRequest("/v1/saved-searches", {
    method: "POST",
    body: { label, scope, dataset },
    idempotencyKey,
    responseSchema: SavedSearchSchema,
  });
}
export function removeSavedSearch(id: string) {
  return apiRequest(`/v1/saved-searches/${id}`, {
    method: "DELETE",
    idempotencyKey: createIdempotencyKey(),
  });
}
