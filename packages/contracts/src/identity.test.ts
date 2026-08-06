import { describe, expect, it } from "vitest";

import {
  AccountSchema,
  CareerOwnerSchema,
  CompleteEmailVerificationRequestSchema,
  CreateEmailVerificationChallengeRequestSchema,
  EmailIdentitySchema,
  EmailVerificationChallengeSchema,
  NormalizedEmailSchema,
} from "./identity.js";

const timestamp = "2026-08-06T00:00:00.000Z";

describe("long-lived identity forward contracts", () => {
  it("keeps anonymous TTL owners distinct from account-managed owners", () => {
    expect(
      CareerOwnerSchema.safeParse({
        id: "owner-anonymous",
        status: "active",
        epoch: 1,
        retentionMode: "anonymous_ttl",
        retentionExpiresAt: timestamp,
        accountId: null,
        createdAt: timestamp,
        lastSeenAt: timestamp,
        deletedAt: null,
      }).success,
    ).toBe(true);
    expect(
      CareerOwnerSchema.safeParse({
        id: "owner-account",
        status: "active",
        epoch: 1,
        retentionMode: "account_managed",
        retentionExpiresAt: null,
        accountId: "account-1",
        createdAt: timestamp,
        lastSeenAt: timestamp,
        deletedAt: null,
      }).success,
    ).toBe(true);
    expect(
      CareerOwnerSchema.safeParse({
        id: "owner-invalid",
        status: "active",
        epoch: 1,
        retentionMode: "account_managed",
        retentionExpiresAt: timestamp,
        accountId: "account-1",
        createdAt: timestamp,
        lastSeenAt: timestamp,
        deletedAt: null,
      }).success,
    ).toBe(false);
  });

  it("normalizes email input without exposing it in challenge output", () => {
    expect(NormalizedEmailSchema.parse("  Coco@Example.COM ")).toBe("coco@example.com");
    expect(
      EmailVerificationChallengeSchema.safeParse({
        id: "challenge-1",
        purpose: "claim_owner",
        status: "pending",
        maskedEmail: "c***@example.com",
        expiresAt: timestamp,
        retryAfterAt: timestamp,
        remainingAttempts: 5,
        email: "must-not-leak@example.com",
        tokenHash: "a".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("requires the current owner epoch before claiming anonymous data", () => {
    expect(
      CreateEmailVerificationChallengeRequestSchema.safeParse({
        purpose: "claim_owner",
        email: "coco@example.com",
        expectedOwnerEpoch: 1,
      }).success,
    ).toBe(true);
    expect(
      CreateEmailVerificationChallengeRequestSchema.safeParse({
        purpose: "claim_owner",
        email: "coco@example.com",
      }).success,
    ).toBe(false);
    expect(
      CreateEmailVerificationChallengeRequestSchema.safeParse({
        purpose: "sign_in",
        email: "coco@example.com",
        ownerId: "client-must-not-choose-owner",
      }).success,
    ).toBe(false);
  });

  it("accepts only six-digit verification codes and purpose-specific revisions", () => {
    expect(
      CompleteEmailVerificationRequestSchema.safeParse({
        purpose: "claim_owner",
        challengeId: "challenge-1",
        verificationCode: "123456",
        expectedOwnerEpoch: 1,
      }).success,
    ).toBe(true);
    expect(
      CompleteEmailVerificationRequestSchema.safeParse({
        purpose: "claim_owner",
        challengeId: "challenge-1",
        verificationCode: "12345a",
        expectedOwnerEpoch: 1,
      }).success,
    ).toBe(false);
    expect(
      CompleteEmailVerificationRequestSchema.safeParse({
        purpose: "change_email",
        challengeId: "challenge-1",
        verificationCode: "123456",
        expectedOwnerEpoch: 1,
      }).success,
    ).toBe(false);
  });

  it("keeps account and email identity responses free of stored credential material", () => {
    expect(
      AccountSchema.safeParse({
        id: "account-1",
        ownerId: "owner-1",
        status: "active",
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        emailLookupHash: "a".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      EmailIdentitySchema.safeParse({
        id: "email-1",
        accountId: "account-1",
        status: "active",
        maskedEmail: "c***@example.com",
        verifiedAt: timestamp,
        revokedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        encryptedEmail: "must-not-leak",
      }).success,
    ).toBe(false);
  });
});
