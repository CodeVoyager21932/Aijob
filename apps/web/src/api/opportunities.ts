import {
  OpportunityDigestListSchema,
  OpportunityDiscoveryStatusSchema,
  SavedSearchSchema,
  type UpdateOpportunitySubscription,
} from "@aijob/contracts";
import { apiRequest, createIdempotencyKey } from "./client";
export const opportunityKeys = {
  digests: ["career-os", "opportunity-digests"] as const,
  status: ["career-os", "discovery-status"] as const,
};
export const getOpportunityDigests = (offset = 0) =>
  apiRequest(`/v1/opportunity-digests?offset=${offset}`, {
    responseSchema: OpportunityDigestListSchema,
  });
export const getDiscoveryStatus = () =>
  apiRequest("/v1/opportunity-discovery/status", {
    responseSchema: OpportunityDiscoveryStatusSchema,
  });
export const updateOpportunitySubscription = (id: string, body: UpdateOpportunitySubscription) =>
  apiRequest(`/v1/saved-searches/${id}`, {
    method: "PATCH",
    body,
    idempotencyKey: createIdempotencyKey(),
    responseSchema: SavedSearchSchema,
  });
export const markOpportunityDigestRead = (id: string) =>
  apiRequest(`/v1/opportunity-digests/${id}`, {
    method: "PATCH",
    body: {},
    idempotencyKey: createIdempotencyKey(),
  });
