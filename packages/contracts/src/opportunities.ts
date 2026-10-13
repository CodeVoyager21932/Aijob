import { z } from "zod";
import { JobSearchQuerySchema } from "./jobs.js";

export const OpportunitySubscriptionSchema = z
  .object({
    discoveryEnabled: z.boolean().default(false),
    digestEnabled: z.boolean().default(false),
    digestTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("09:00"),
    timezone: z.literal("Asia/Shanghai").default("Asia/Shanghai"),
  })
  .strict();
export const UpdateOpportunitySubscriptionSchema = OpportunitySubscriptionSchema.partial().extend({
  expectedRevision: z.number().int().positive(),
  label: z.string().trim().min(1).max(120).optional(),
  catalogQuery: JobSearchQuerySchema.omit({ jobIds: true, cursor: true, limit: true }).optional(),
});
export type OpportunitySubscription = z.infer<typeof OpportunitySubscriptionSchema>;
export type UpdateOpportunitySubscription = z.infer<typeof UpdateOpportunitySubscriptionSchema>;
export const OpportunityDigestItemSchema = z.object({
  jobId: z.string().uuid(),
  versionId: z.string().uuid().nullable(),
  kind: z.enum(["initial", "new", "updated", "closed", "reopened"]),
  title: z.string(),
  companyName: z.string(),
  reason: z.string(),
});
export const OpportunityDigestSchema = z.object({
  id: z.string().uuid(),
  searchId: z.string().uuid(),
  label: z.string(),
  localDate: z.string(),
  initial: z.boolean(),
  partial: z.boolean(),
  statusNote: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
  items: z.array(OpportunityDigestItemSchema),
});
export const OpportunityDigestListSchema = z.object({
  items: z.array(OpportunityDigestSchema),
  nextOffset: z.number().int().nonnegative().nullable().default(null),
});
export const OpportunityDiscoveryStatusSchema = z.object({
  provider: z.enum(["tavily", "ai_connection", "existing_sources"]),
  configured: z.boolean(),
  enabled: z.boolean(),
  dailyUsed: z.number(),
  dailyLimit: z.literal(20),
  monthlyUsed: z.number(),
  monthlyLimit: z.literal(500),
  notice: z.string(),
  capability: z.string().nullable().default(null),
  capabilityCode: z.string().nullable().default(null),
  settingsPath: z.literal("/settings/ai").default("/settings/ai"),
  setupUrl: z.string().url().nullable().default(null),
  sourceRefresh: z
    .object({ enabled: z.boolean(), networkEnabled: z.boolean() })
    .nullable()
    .default(null),
  lastSearchAt: z.string().nullable().default(null),
  nextSearchAt: z.string().nullable().default(null),
  lastSearchStatus: z.string().nullable().default(null),
  lastDigestAt: z.string().nullable().default(null),
  nextDigestAt: z.string().nullable().default(null),
});
