import { z } from "zod";
import { OpportunitySubscriptionSchema } from "./opportunities.js";
import { JobGraphScopeSchema } from "./job-graph.js";
import { JobSearchQuerySchema } from "./jobs.js";

export const PlannerKindSchema = z.enum([
  "preparation",
  "exam",
  "interview",
  "deadline",
  "follow_up",
]);
export const PlannerStatusSchema = z.enum(["todo", "doing", "done"]);
export const PlannerSourceSchema = z
  .object({
    jobId: z.string().uuid(),
    jobVersionId: z.string().uuid(),
    key: z.string().min(1).max(250),
    extractionVersion: z.literal('role-semantics-v2').optional(),
    sourceText: z.string().min(1).max(12000),
    section: z.enum(["requirements", "responsibilities"]),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict();
const PlannerFields = {
  kind: PlannerKindSchema,
  title: z.string().trim().min(1).max(200),
  note: z.string().max(12000).default(""),
  status: PlannerStatusSchema.default("todo"),
  caseId: z.string().uuid().nullable().default(null),
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
  timezone: z
    .string()
    .max(80)
    .default("Asia/Shanghai")
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("zh-CN", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "无效的时区"),
  artifact: z.string().max(20000).default(""),
  evidenceRevisionId: z.string().uuid().nullable().default(null),
  evidenceIds: z.array(z.string().min(1).max(200)).max(50).default([]),
  sourceExperienceIds: z.array(z.string().uuid()).max(50).default([]),
  source: PlannerSourceSchema.nullable().default(null),
};
export const CreatePlannerItemRequestSchema = z.object(PlannerFields).strict();
export const UpdatePlannerItemRequestSchema = z
  .object({ ...PlannerFields, expectedRevision: z.number().int().positive() })
  .strict();
export const PlannerItemSchema = z.object({
  ...PlannerFields,
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export const PlannerListSchema = z.object({
  items: z.array(PlannerItemSchema),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export const PlannerListQuerySchema = z.object({
  caseId: z.string().uuid().optional(),
  kind: PlannerKindSchema.optional(),
  status: z.union([PlannerStatusSchema, z.literal("open"), z.literal("all")]).default("open"),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const DeletePlannerItemRequestSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export type PlannerItem = z.infer<typeof PlannerItemSchema>;
export type CreatePlannerItemRequest = z.infer<typeof CreatePlannerItemRequestSchema>;
export type UpdatePlannerItemRequest = z.infer<typeof UpdatePlannerItemRequestSchema>;
export type PlannerListQuery = z.infer<typeof PlannerListQuerySchema>;
export const SaveSearchRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    catalogQuery: JobSearchQuerySchema.omit({ jobIds: true, cursor: true, limit: true }).optional(),
    scope: JobGraphScopeSchema,
    dataset: z.enum(["public", "private"]).default("public"),
    subscription: OpportunitySubscriptionSchema.optional(),
  })
  .strict();
export const SavedSearchSchema = SaveSearchRequestSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  revision: z.number().int().positive().default(1),
  subscription: OpportunitySubscriptionSchema.default({}),
});
export const SavedSearchListSchema = z.object({ items: z.array(SavedSearchSchema) });
