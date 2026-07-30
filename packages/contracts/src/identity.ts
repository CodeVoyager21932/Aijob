import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.js";
import { OwnerStatusSchema } from "./enums.js";

export const OwnerSchema = z.object({
  id: IdentifierSchema,
  status: OwnerStatusSchema,
  epoch: z.number().int().positive(),
  retentionExpiresAt: TimestampSchema,
  createdAt: TimestampSchema,
  lastSeenAt: TimestampSchema,
  deletedAt: TimestampSchema.nullable(),
});
export type Owner = z.infer<typeof OwnerSchema>;

export const AnonymousSessionSchema = z.object({
  id: IdentifierSchema,
  ownerId: IdentifierSchema,
  ownerEpoch: z.number().int().positive(),
  expiresAt: TimestampSchema,
  createdAt: TimestampSchema,
});
export type AnonymousSession = z.infer<typeof AnonymousSessionSchema>;

export const SessionBootstrapResponseSchema = z.object({
  owner: OwnerSchema,
  session: AnonymousSessionSchema,
});
export type SessionBootstrapResponse = z.infer<typeof SessionBootstrapResponseSchema>;
