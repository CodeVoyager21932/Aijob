import { type UserAiSettingsInputSchema, UserAiSettingsResponseSchema } from "@aijob/contracts";
import { z } from "zod";
import { apiRequest, createIdempotencyKey } from "./client";
export const getUserAiSettings = () =>
  apiRequest("/v1/settings/ai", { responseSchema: UserAiSettingsResponseSchema });
export const getUserAiModels = () =>
  apiRequest("/v1/settings/ai/models", {
    responseSchema: z.object({ models: z.array(z.string()), notice: z.string().nullable() }),
  });
export const saveUserAiSettings = (input: z.input<typeof UserAiSettingsInputSchema>) =>
  apiRequest("/v1/settings/ai", {
    method: "PUT",
    body: input,
    idempotencyKey: createIdempotencyKey(),
    responseSchema: UserAiSettingsResponseSchema,
  });
export const testUserAiSettings = (revision: number) =>
  apiRequest("/v1/settings/ai/test", {
    method: "POST",
    body: { revision },
    idempotencyKey: createIdempotencyKey(),
    responseSchema: z.object({ queued: z.boolean() }),
  });
export const deleteUserAiSettings = (revision: number) =>
  apiRequest("/v1/settings/ai", {
    method: "DELETE",
    body: { revision },
    idempotencyKey: createIdempotencyKey(),
    responseSchema: z.object({ deleted: z.boolean() }),
  });
