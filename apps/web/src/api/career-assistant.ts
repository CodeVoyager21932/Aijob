import {
  type AdoptAssistantResultSchema,
  AssistantSessionSchema,
  type CreateAssistantSessionSchema,
  type SubmitAssistantTurnSchema,
} from "@aijob/contracts";
import { z } from "zod";
import { apiRequest, createIdempotencyKey } from "./client";
export function assistantStatus() {
  return apiRequest("/v1/assistant/status", {
    responseSchema: z.object({
      enabled: z.boolean(),
      model: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  });
}
export function createAssistant(
  input: z.input<typeof CreateAssistantSessionSchema>,
  key = createIdempotencyKey(),
) {
  return apiRequest("/v1/assistant/sessions", {
    method: "POST",
    body: input,
    idempotencyKey: key,
    responseSchema: AssistantSessionSchema,
  });
}
export function getAssistant(id: string) {
  return apiRequest(`/v1/assistant/sessions/${id}`, { responseSchema: AssistantSessionSchema });
}
export function listAssistantSessions(caseId?: string) {
  return apiRequest(
    `/v1/assistant/sessions${caseId ? `?caseId=${encodeURIComponent(caseId)}` : ""}`,
    {
      responseSchema: z.object({
        items: z.array(
          z.object({
            id: z.string(),
            task: z.string(),
            title: z.string(),
            status: z.string(),
            updatedAt: z.string(),
          }),
        ),
      }),
    },
  );
}
export function sendAssistant(
  id: string,
  input: z.input<typeof SubmitAssistantTurnSchema>,
  key: string,
) {
  return apiRequest(`/v1/assistant/sessions/${id}/turns`, {
    method: "POST",
    body: input,
    idempotencyKey: key,
    responseSchema: AssistantSessionSchema,
  });
}
export function setAssistantStatus(
  id: string,
  expectedRevision: number,
  status: "active" | "paused" | "completed",
) {
  return apiRequest(`/v1/assistant/sessions/${id}`, {
    method: "PATCH",
    body: { expectedRevision, status },
    idempotencyKey: createIdempotencyKey(),
    responseSchema: AssistantSessionSchema,
  });
}
export function adoptAssistant(
  turnId: string,
  input: z.input<typeof AdoptAssistantResultSchema>,
  key: string,
) {
  return apiRequest(`/v1/assistant/turns/${turnId}/adopt`, {
    method: "POST",
    body: input,
    idempotencyKey: key,
  });
}

export function retryAssistant(turnId: string, expectedRevision: number, key: string) {
  return apiRequest(`/v1/assistant/turns/${turnId}/retry`, {
    method: "POST",
    body: { expectedRevision },
    idempotencyKey: key,
    responseSchema: AssistantSessionSchema,
  });
}
