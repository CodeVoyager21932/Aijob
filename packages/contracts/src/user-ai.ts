import { z } from "zod";

export const UserAiSettingsInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    label: z.string().trim().min(1).max(80).default("我的 API"),
    protocol: z.literal("openai-chat-completions").default("openai-chat-completions"),
    baseUrl: z
      .string()
      .trim()
      .url()
      .max(500)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          (!url.port || url.port === "443")
        );
      }, "请填写 HTTPS 接口地址，不要在地址中填写密钥。"),
    model: z.string().trim().min(1).max(180),
    apiKey: z.string().trim().min(1).max(4096).optional(),
    enabled: z.boolean().default(true),
    jsonMode: z.enum(["json_object", "prompt"]).default("json_object"),
    dailyCalls: z.number().int().min(1).max(10000).default(100),
    dailyTokens: z.number().int().min(10000).max(100000000).default(2000000),
    concurrency: z.number().int().min(1).max(4).default(2),
    maxOutputTokens: z.number().int().min(512).max(16000).default(4096),
    requestTimeoutMs: z.number().int().min(5000).max(120000).default(60000),
  })
  .strict();

export const UserAiSettingsSchema = UserAiSettingsInputSchema.omit({
  expectedRevision: true,
  apiKey: true,
}).extend({
  connectionId: z.string().uuid(),
  revision: z.number().int().positive(),
  testStatus: z.enum(["queued", "completed", "failed"]).nullable(),
  testError: z.string().nullable(),
  testedAt: z.string().nullable(),
  keyConfigured: z.boolean(),
  updatedAt: z.string(),
});
export type UserAiSettings = z.infer<typeof UserAiSettingsSchema>;
export const UserAiUsageSchema = z.object({
  calls: z.number(),
  reservedTokens: z.number(),
  completed: z.number(),
  failed: z.number(),
  running: z.number(),
});
export const UserAiSettingsResponseSchema = z.object({
  settings: UserAiSettingsSchema.nullable(),
  usage: UserAiUsageSchema,
});
