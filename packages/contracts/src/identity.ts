import { z } from "zod";
import { IdentifierSchema, RevisionSchema, TimestampSchema } from "./common.js";
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

export const OwnerRetentionModeSchema = z.enum(["anonymous_ttl", "account_managed"]);
export type OwnerRetentionMode = z.infer<typeof OwnerRetentionModeSchema>;

const CareerOwnerBaseSchema = z
  .object({
    id: IdentifierSchema,
    status: OwnerStatusSchema,
    epoch: z.number().int().positive(),
    createdAt: TimestampSchema,
    lastSeenAt: TimestampSchema,
    deletedAt: TimestampSchema.nullable(),
  })
  .strict();

export const CareerOwnerSchema = z.discriminatedUnion("retentionMode", [
  CareerOwnerBaseSchema.extend({
    retentionMode: z.literal("anonymous_ttl"),
    retentionExpiresAt: TimestampSchema,
    accountId: z.null(),
  }).strict(),
  CareerOwnerBaseSchema.extend({
    retentionMode: z.literal("account_managed"),
    retentionExpiresAt: z.null(),
    accountId: IdentifierSchema,
  }).strict(),
]);
export type CareerOwner = z.infer<typeof CareerOwnerSchema>;

export const SessionStatusSchema = z.discriminatedUnion("authenticated", [
  z.object({ authenticated: z.literal(false) }).strict(),
  z
    .object({
      authenticated: z.literal(true),
      owner: CareerOwnerSchema,
      session: z
        .object({
          id: IdentifierSchema,
          ownerEpoch: z.number().int().positive(),
          expiresAt: TimestampSchema,
        })
        .strict(),
    })
    .strict(),
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const AccountStatusSchema = z.enum(["active", "deletion_pending", "deleted"]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const AccountSchema = z
  .object({
    id: IdentifierSchema,
    ownerId: IdentifierSchema,
    status: AccountStatusSchema,
    revision: RevisionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    deletedAt: TimestampSchema.nullable(),
  })
  .strict();
export type Account = z.infer<typeof AccountSchema>;

export const EmailIdentityStatusSchema = z.enum(["active", "revoked"]);
export type EmailIdentityStatus = z.infer<typeof EmailIdentityStatusSchema>;

export const EmailIdentitySchema = z
  .object({
    id: IdentifierSchema,
    accountId: IdentifierSchema,
    status: EmailIdentityStatusSchema,
    maskedEmail: z.string().trim().min(3).max(254),
    verifiedAt: TimestampSchema,
    revokedAt: TimestampSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type EmailIdentity = z.infer<typeof EmailIdentitySchema>;

export const NormalizedEmailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export type NormalizedEmail = z.infer<typeof NormalizedEmailSchema>;

export const EmailVerificationPurposeSchema = z.enum(["claim_owner", "sign_in", "change_email"]);
export type EmailVerificationPurpose = z.infer<typeof EmailVerificationPurposeSchema>;

export const EmailVerificationChallengeStatusSchema = z.enum([
  "pending",
  "consumed",
  "expired",
  "locked",
]);
export type EmailVerificationChallengeStatus = z.infer<
  typeof EmailVerificationChallengeStatusSchema
>;

export const CreateEmailVerificationChallengeRequestSchema = z.discriminatedUnion("purpose", [
  z
    .object({
      purpose: z.literal("claim_owner"),
      email: NormalizedEmailSchema,
      expectedOwnerEpoch: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      purpose: z.literal("sign_in"),
      email: NormalizedEmailSchema,
    })
    .strict(),
  z
    .object({
      purpose: z.literal("change_email"),
      email: NormalizedEmailSchema,
      expectedAccountRevision: RevisionSchema,
    })
    .strict(),
]);
export type CreateEmailVerificationChallengeRequest = z.infer<
  typeof CreateEmailVerificationChallengeRequestSchema
>;

export const EmailVerificationChallengeSchema = z
  .object({
    id: IdentifierSchema,
    purpose: EmailVerificationPurposeSchema,
    status: EmailVerificationChallengeStatusSchema,
    maskedEmail: z.string().trim().min(3).max(254),
    expiresAt: TimestampSchema,
    retryAfterAt: TimestampSchema,
    remainingAttempts: z.number().int().min(0).max(10),
  })
  .strict();
export type EmailVerificationChallenge = z.infer<typeof EmailVerificationChallengeSchema>;

const VerificationCodeSchema = z.string().regex(/^\d{6}$/);

export const CompleteEmailVerificationRequestSchema = z.discriminatedUnion("purpose", [
  z
    .object({
      purpose: z.literal("claim_owner"),
      challengeId: IdentifierSchema,
      verificationCode: VerificationCodeSchema,
      expectedOwnerEpoch: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      purpose: z.literal("sign_in"),
      challengeId: IdentifierSchema,
      verificationCode: VerificationCodeSchema,
    })
    .strict(),
  z
    .object({
      purpose: z.literal("change_email"),
      challengeId: IdentifierSchema,
      verificationCode: VerificationCodeSchema,
      expectedAccountRevision: RevisionSchema,
    })
    .strict(),
]);
export type CompleteEmailVerificationRequest = z.infer<
  typeof CompleteEmailVerificationRequestSchema
>;
