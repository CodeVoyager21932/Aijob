import { z } from "zod";

export const DiscoveryModeSchema = z.enum(["existing_sources", "ai_connection", "tavily"]);
export const SearchAdapterSchema = z.enum([
  "auto",
  "openai-responses",
  "bailian-responses",
  "openrouter",
]);
export const DiscoverySettingsInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    mode: DiscoveryModeSchema,
    adapter: SearchAdapterSchema.default("auto"),
    apiKey: z.string().trim().min(1).max(4096).optional(),
    useLegacyKey: z.boolean().default(false),
  })
  .strict();
export const SearchCapabilitySchema = z.enum([
  "unchecked",
  "queued",
  "ready",
  "unsupported",
  "unrecognized",
  "temporary_failure",
]);
export const DiscoverySettingsResponseSchema = z.object({
  settings: z
    .object({
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      mode: DiscoveryModeSchema,
      adapter: SearchAdapterSchema,
      keyConfigured: z.boolean(),
      capability: SearchCapabilitySchema,
      capabilityCode: z.string().nullable(),
      checkedAt: z.string().nullable(),
      connectionRevision: z.number().int().nullable(),
      connectionId: z.string().uuid().nullable(),
      nextSearchAt: z.string().nullable(),
      lastSearchAt: z.string().nullable(),
      lastSearchStatus: z.string().nullable(),
    })
    .nullable(),
  legacyAvailable: z.boolean(),
  usage: z.object({
    dailyUsed: z.number(),
    monthlyUsed: z.number(),
    dailyLimit: z.literal(20),
    monthlyLimit: z.literal(500),
    toolCalls: z.number().nullable(),
    modelTokens: z.number().nullable(),
  }),
});
export type DiscoverySettingsInput = z.input<typeof DiscoverySettingsInputSchema>;
export type DiscoverySettingsResponse = z.infer<typeof DiscoverySettingsResponseSchema>;
export type SearchAdapter = z.infer<typeof SearchAdapterSchema>;
