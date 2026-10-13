import { type DiscoverySettingsInput, DiscoverySettingsResponseSchema } from "@aijob/contracts";
import { z } from "zod";
import { apiRequest, createIdempotencyKey } from "./client";
export const getDiscoverySettings = () =>
  apiRequest("/v1/settings/discovery", { responseSchema: DiscoverySettingsResponseSchema });
export const putDiscoverySettings = (body: DiscoverySettingsInput) =>
  apiRequest("/v1/settings/discovery", {
    method: "PUT",
    body,
    responseSchema: DiscoverySettingsResponseSchema,
  });
export const checkDiscoverySettings = (revision: number) =>
  apiRequest("/v1/settings/discovery/test", {
    method: "POST",
    body: { revision },
    idempotencyKey: createIdempotencyKey(),
    responseSchema: z.object({ queued: z.boolean() }),
  });
export const removeDiscoverySettings = (revision: number) =>
  apiRequest("/v1/settings/discovery", {
    method: "DELETE",
    body: { revision },
    responseSchema: z.object({ deleted: z.boolean() }),
  });
