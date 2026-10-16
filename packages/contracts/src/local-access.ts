import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.js";

// A recovery file is a sign-in credential, never a copy of personal material or API keys.
export const LocalRecoveryFileSchema = z
  .object({
    format: z.literal("aijob-local-recovery"),
    version: z.literal(1),
    workspaceId: IdentifierSchema,
    createdAt: TimestampSchema,
    recoveryKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  })
  .strict();
export type LocalRecoveryFile = z.infer<typeof LocalRecoveryFileSchema>;

export const LocalAccessStatusSchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }).strict(),
  z
    .object({
      enabled: z.literal(true),
      browserRemembered: z.boolean(),
      recoveryCreatedAt: TimestampSchema.nullable(),
    })
    .strict(),
]);
export type LocalAccessStatus = z.infer<typeof LocalAccessStatusSchema>;
