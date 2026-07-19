import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.js";
import { DeletionStatusSchema, JobDecisionStatusSchema } from "./enums.js";

export const PutJobDecisionRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  status: JobDecisionStatusSchema,
  reason: z.string().trim().max(2_000).nullable(),
});
export type PutJobDecisionRequest = z.infer<typeof PutJobDecisionRequestSchema>;

export const JobDecisionSchema = z.object({
  ownerId: IdentifierSchema,
  publishedJobId: IdentifierSchema,
  status: JobDecisionStatusSchema,
  reason: z.string().trim().max(2_000).nullable(),
  revision: z.number().int().positive(),
  officialLinkOpenedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type JobDecision = z.infer<typeof JobDecisionSchema>;

export const ProfileDeletionSchema = z.object({
  id: IdentifierSchema,
  ownerId: IdentifierSchema,
  requestedOwnerEpoch: z.number().int().positive(),
  status: DeletionStatusSchema,
  failureCode: z.string().trim().min(1).nullable(),
  requestedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
  updatedAt: TimestampSchema,
});
export type ProfileDeletion = z.infer<typeof ProfileDeletionSchema>;
