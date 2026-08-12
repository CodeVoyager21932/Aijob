import { randomInt, randomUUID } from "node:crypto";
import {
  type CompleteEmailVerificationRequest,
  type CreateEmailVerificationChallengeRequest,
  type EmailVerificationChallenge,
  EmailVerificationChallengeSchema,
  type SessionStatus,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { canonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import type { EmailVerificationDelivery } from "./email-delivery.js";
import {
  emailLookupHash,
  encryptEmail,
  identityRequestHash,
  maskEmail,
  secureHexEqual,
  verificationCodeHash,
} from "./email-crypto.js";
import {
  assertActiveOwnerEpoch,
  issueOwnerSession,
  type OwnerContext,
  projectSessionStatus,
} from "./session-repository.js";

export const EMAIL_CHALLENGE_TTL_MS = 10 * 60 * 1_000;
export const EMAIL_CHALLENGE_RETRY_MS = 60 * 1_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const NEW_ACCOUNT_OWNER_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

interface EmailVerificationServiceOptions {
  db: Kysely<Database>;
  identityMasterKey: string;
  invitedEmailHashes: readonly string[];
  delivery: EmailVerificationDelivery;
  fixedVerificationCode?: string;
  now?: () => Date;
}

interface ActiveEmailIdentity {
  emailIdentityId: string;
  accountId: string;
  ownerId: string;
  ownerEpoch: number;
}

function sixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function challengeProjection(input: {
  id: string;
  purpose: string;
  status: string;
  expiresAt: Date | string;
  retryAfterAt: Date | string;
  attemptCount: number;
  maxAttempts: number;
  email: string;
}): EmailVerificationChallenge {
  return EmailVerificationChallengeSchema.parse({
    id: input.id,
    purpose: input.purpose,
    status: input.status,
    maskedEmail: maskEmail(input.email),
    expiresAt: new Date(input.expiresAt).toISOString(),
    retryAfterAt: new Date(input.retryAfterAt).toISOString(),
    remainingAttempts: Math.max(0, input.maxAttempts - input.attemptCount),
  });
}

async function activeEmailIdentity(
  db: Kysely<Database> | Transaction<Database>,
  lookupHash: string,
): Promise<ActiveEmailIdentity | null> {
  const row = await db
    .selectFrom("identity.email_identities as email")
    .innerJoin("identity.accounts as account", "account.id", "email.account_id")
    .innerJoin("identity.owners as owner", "owner.id", "account.owner_id")
    .select([
      "email.id as email_identity_id",
      "account.id as account_id",
      "owner.id as owner_id",
      "owner.epoch as owner_epoch",
    ])
    .where("email.email_lookup_hash", "=", lookupHash)
    .where("email.status", "=", "active")
    .where("account.status", "=", "active")
    .where("owner.status", "=", "active")
    .where("owner.retention_mode", "=", "account_managed")
    .executeTakeFirst();
  return row
    ? {
        emailIdentityId: row.email_identity_id,
        accountId: row.account_id,
        ownerId: row.owner_id,
        ownerEpoch: Number(row.owner_epoch),
      }
    : null;
}

function challengeScope(
  request: CreateEmailVerificationChallengeRequest,
  context: OwnerContext | null,
  lookupHash: string,
): string {
  return request.purpose === "claim_owner"
    ? `owner:${context?.ownerId ?? "missing"}:${request.expectedOwnerEpoch}`
    : `email:${lookupHash}`;
}

function unsupportedChangeEmail(): never {
  throw new ServiceError(
    409,
    "EMAIL_CHANGE_NOT_AVAILABLE",
    "当前离线候选只开放邮箱认领与登录；更换邮箱尚未进入本切片。",
  );
}

export class EmailVerificationService {
  constructor(private readonly options: EmailVerificationServiceOptions) {}

  async createChallenge(input: {
    request: CreateEmailVerificationChallengeRequest;
    context: OwnerContext | null;
    idempotencyKey: string;
  }): Promise<EmailVerificationChallenge> {
    if (input.request.purpose === "change_email") unsupportedChangeEmail();
    if (input.request.purpose === "claim_owner") {
      if (!input.context) {
        throw new ServiceError(401, "SESSION_REQUIRED", "认领当前数据前需要有效会话。");
      }
      if (input.context.ownerEpoch !== input.request.expectedOwnerEpoch) {
        throw new ServiceError(409, "OWNER_REVISION_CONFLICT", "当前数据版本已经变化，请刷新后重试。");
      }
      await assertActiveOwnerEpoch(
        this.options.db,
        input.context.ownerId,
        input.context.ownerEpoch,
        this.options.now?.() ?? new Date(),
      );
      const account = await this.options.db
        .selectFrom("identity.accounts")
        .select("id")
        .where("owner_id", "=", input.context.ownerId)
        .where("status", "=", "active")
        .executeTakeFirst();
      if (account) {
        throw new ServiceError(409, "OWNER_ALREADY_CLAIMED", "当前职业数据已经绑定邮箱账号。");
      }
    }

    const now = this.options.now?.() ?? new Date();
    const lookupHash = emailLookupHash(input.request.email, this.options.identityMasterKey);
    const scope = challengeScope(input.request, input.context, lookupHash);
    const idempotencyKeyHash = identityRequestHash(
      `${input.request.purpose}:${scope}:${input.idempotencyKey}`,
      this.options.identityMasterKey,
    );
    const requestHash = identityRequestHash(
      canonicalJson({ ...input.request, email: lookupHash, scope }),
      this.options.identityMasterKey,
    );
    const verificationCode = this.options.fixedVerificationCode ?? sixDigitCode();
    if (!/^\d{6}$/.test(verificationCode)) throw new Error("FIXTURE_VERIFICATION_CODE_INVALID");
    const challengeId = randomUUID();
    const expiresAt = new Date(now.getTime() + EMAIL_CHALLENGE_TTL_MS);
    const retryAfterAt = new Date(now.getTime() + EMAIL_CHALLENGE_RETRY_MS);

    const result = await this.options.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`identity:${input.request.purpose}:${scope}:${input.idempotencyKey}`}, 0))`.execute(
        transaction,
      );
      const existing = await transaction
        .selectFrom("identity.email_verification_challenges")
        .selectAll()
        .where("purpose", "=", input.request.purpose)
        .where("idempotency_key_hash", "=", idempotencyKeyHash)
        .executeTakeFirst();
      if (existing) {
        if (!secureHexEqual(existing.request_hash, requestHash)) {
          throw new ServiceError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "同一个请求编号不能用于不同的邮箱验证请求。",
          );
        }
        return {
          challenge: challengeProjection({
            id: existing.id,
            purpose: existing.purpose,
            status: existing.status,
            expiresAt: existing.expires_at,
            retryAfterAt: existing.retry_after_at,
            attemptCount: existing.attempt_count,
            maxAttempts: existing.max_attempts,
            email: input.request.email,
          }),
          deliver: false,
          challengeId: existing.id,
        };
      }

      let throttledQuery = transaction
        .selectFrom("identity.email_verification_challenges")
        .selectAll()
        .where("purpose", "=", input.request.purpose)
        .where("email_lookup_hash", "=", lookupHash)
        .where("status", "=", "pending");
      if (input.request.purpose === "claim_owner") {
        throttledQuery = throttledQuery
          .where("owner_id", "=", input.context?.ownerId ?? "")
          .where("owner_epoch", "=", input.request.expectedOwnerEpoch);
      }
      const throttled = await throttledQuery
        .orderBy("created_at", "desc")
        .executeTakeFirst();
      if (throttled && new Date(throttled.retry_after_at).getTime() > now.getTime()) {
        return {
          challenge: challengeProjection({
            id: throttled.id,
            purpose: throttled.purpose,
            status: throttled.status,
            expiresAt: throttled.expires_at,
            retryAfterAt: throttled.retry_after_at,
            attemptCount: throttled.attempt_count,
            maxAttempts: throttled.max_attempts,
            email: input.request.email,
          }),
          deliver: false,
          challengeId: throttled.id,
        };
      }

      let expireQuery = transaction
        .updateTable("identity.email_verification_challenges")
        .set({ status: "expired", updated_at: now })
        .where("purpose", "=", input.request.purpose)
        .where("email_lookup_hash", "=", lookupHash)
        .where("status", "=", "pending");
      if (input.request.purpose === "claim_owner") {
        expireQuery = expireQuery
          .where("owner_id", "=", input.context?.ownerId ?? "")
          .where("owner_epoch", "=", input.request.expectedOwnerEpoch);
      }
      await expireQuery.execute();

      const identity = await activeEmailIdentity(transaction, lookupHash);
      const invited = this.options.invitedEmailHashes.some((value) =>
        secureHexEqual(value, lookupHash),
      );
      const shouldDeliver =
        input.request.purpose === "claim_owner" || identity !== null || invited;
      const inserted = await transaction
        .insertInto("identity.email_verification_challenges")
        .values({
          id: challengeId,
          purpose: input.request.purpose,
          status: "pending",
          owner_id: input.request.purpose === "claim_owner" ? input.context?.ownerId ?? null : null,
          owner_epoch:
            input.request.purpose === "claim_owner" ? input.request.expectedOwnerEpoch : null,
          account_id: null,
          email_lookup_hash: lookupHash,
          verification_token_hash: verificationCodeHash({
            challengeId,
            verificationCode,
            identityMasterKey: this.options.identityMasterKey,
          }),
          attempt_count: 0,
          max_attempts: DEFAULT_MAX_ATTEMPTS,
          expires_at: expiresAt,
          retry_after_at: retryAfterAt,
          consumed_at: null,
          locked_at: null,
          idempotency_key_hash: idempotencyKeyHash,
          request_hash: requestHash,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return {
        challenge: challengeProjection({
          id: inserted.id,
          purpose: inserted.purpose,
          status: inserted.status,
          expiresAt: inserted.expires_at,
          retryAfterAt: inserted.retry_after_at,
          attemptCount: inserted.attempt_count,
          maxAttempts: inserted.max_attempts,
          email: input.request.email,
        }),
        deliver: shouldDeliver,
        challengeId,
      };
    });

    if (result.deliver) {
      await this.options.delivery.deliver({
        challengeId: result.challengeId,
        purpose: input.request.purpose,
        email: input.request.email,
        verificationCode,
        expiresAt,
      });
    }
    return result.challenge;
  }

  async completeChallenge(input: {
    request: CompleteEmailVerificationRequest;
    context: OwnerContext | null;
  }): Promise<{ session: SessionStatus; credentials: Awaited<ReturnType<typeof issueOwnerSession>> }> {
    if (input.request.purpose === "change_email") unsupportedChangeEmail();
    const now = this.options.now?.() ?? new Date();
    const lookupHash = emailLookupHash(input.request.email, this.options.identityMasterKey);

    const result = await this.options.db.transaction().execute(async (transaction) => {
      const challenge = await transaction
        .selectFrom("identity.email_verification_challenges")
        .selectAll()
        .where("id", "=", input.request.challengeId)
        .forUpdate()
        .executeTakeFirst();
      if (!challenge || challenge.purpose !== input.request.purpose) {
        return {
          error: new ServiceError(404, "EMAIL_CHALLENGE_NOT_FOUND", "验证请求不存在或已不可用。"),
        } as const;
      }
      if (challenge.status !== "pending") {
        return {
          error: new ServiceError(410, "EMAIL_CHALLENGE_UNAVAILABLE", "验证码已经使用、锁定或过期。"),
        } as const;
      }
      if (new Date(challenge.expires_at).getTime() <= now.getTime()) {
        await transaction
          .updateTable("identity.email_verification_challenges")
          .set({ status: "expired", updated_at: now })
          .where("id", "=", challenge.id)
          .execute();
        return {
          error: new ServiceError(410, "EMAIL_CHALLENGE_EXPIRED", "验证码已过期，请重新获取。"),
        } as const;
      }

      await sql`select pg_advisory_xact_lock(hashtextextended(${`identity-complete:${lookupHash}`}, 0))`.execute(
        transaction,
      );

      const contextMatches =
        input.request.purpose !== "claim_owner" ||
        (input.context !== null &&
          challenge.owner_id === input.context.ownerId &&
          Number(challenge.owner_epoch) === input.request.expectedOwnerEpoch &&
          input.context.ownerEpoch === input.request.expectedOwnerEpoch);
      const requestMatches = secureHexEqual(challenge.email_lookup_hash, lookupHash);
      const tokenMatches = secureHexEqual(
        challenge.verification_token_hash,
        verificationCodeHash({
          challengeId: challenge.id,
          verificationCode: input.request.verificationCode,
          identityMasterKey: this.options.identityMasterKey,
        }),
      );
      const existingIdentity = await activeEmailIdentity(transaction, lookupHash);
      const invited = this.options.invitedEmailHashes.some((value) =>
        secureHexEqual(value, lookupHash),
      );
      const eligible =
        input.request.purpose === "claim_owner"
          ? contextMatches && existingIdentity === null
          : existingIdentity !== null || invited;

      if (!contextMatches || !requestMatches || !tokenMatches || !eligible) {
        const nextAttempts = Math.min(challenge.max_attempts, challenge.attempt_count + 1);
        const locked = nextAttempts >= challenge.max_attempts;
        await transaction
          .updateTable("identity.email_verification_challenges")
          .set({
            attempt_count: nextAttempts,
            status: locked ? "locked" : "pending",
            locked_at: locked ? now : null,
            updated_at: now,
          })
          .where("id", "=", challenge.id)
          .execute();
        return {
          error: new ServiceError(
            locked ? 410 : 403,
            locked ? "EMAIL_CHALLENGE_LOCKED" : "EMAIL_VERIFICATION_REJECTED",
            locked ? "错误次数已达到上限，请重新获取验证码。" : "验证码未通过校验。",
          ),
        } as const;
      }

      let ownerId: string;
      let ownerEpoch: number;
      if (input.request.purpose === "claim_owner") {
        if (!input.context) throw new Error("CLAIM_OWNER_CONTEXT_MISSING");
        await assertActiveOwnerEpoch(
          transaction,
          input.context.ownerId,
          input.context.ownerEpoch,
          now,
        );
        ownerId = input.context.ownerId;
        ownerEpoch = input.context.ownerEpoch;
        const accountId = randomUUID();
        await transaction
          .insertInto("identity.accounts")
          .values({ id: accountId, owner_id: ownerId, status: "active", deleted_at: null })
          .execute();
        await transaction
          .updateTable("identity.owners")
          .set({ retention_mode: "account_managed", retention_expires_at: null })
          .where("id", "=", ownerId)
          .where("epoch", "=", ownerEpoch)
          .execute();
        await this.insertEmailIdentity(transaction, {
          accountId,
          lookupHash,
          email: input.request.email,
          now,
        });
      } else if (existingIdentity) {
        ownerId = existingIdentity.ownerId;
        ownerEpoch = existingIdentity.ownerEpoch;
      } else {
        ownerId = randomUUID();
        ownerEpoch = 1;
        const accountId = randomUUID();
        await transaction
          .insertInto("identity.owners")
          .values({
            id: ownerId,
            status: "active",
            epoch: ownerEpoch,
            retention_mode: "anonymous_ttl",
            retention_expires_at: new Date(now.getTime() + NEW_ACCOUNT_OWNER_TTL_MS),
            last_seen_at: now,
            deleted_at: null,
          })
          .execute();
        await transaction
          .insertInto("identity.accounts")
          .values({ id: accountId, owner_id: ownerId, status: "active", deleted_at: null })
          .execute();
        await transaction
          .updateTable("identity.owners")
          .set({ retention_mode: "account_managed", retention_expires_at: null })
          .where("id", "=", ownerId)
          .execute();
        await this.insertEmailIdentity(transaction, {
          accountId,
          lookupHash,
          email: input.request.email,
          now,
        });
      }

      await transaction
        .updateTable("identity.email_verification_challenges")
        .set({ status: "consumed", consumed_at: now, updated_at: now })
        .where("id", "=", challenge.id)
        .execute();
      const credentials = await issueOwnerSession({
        db: transaction,
        ownerId,
        ownerEpoch,
        now,
        revokeExisting: true,
      });
      return { credentials } as const;
    });

    if ("error" in result) throw result.error;
    return {
      credentials: result.credentials,
      session: await projectSessionStatus({
        db: this.options.db,
        context: result.credentials.context,
      }),
    };
  }

  private async insertEmailIdentity(
    transaction: Transaction<Database>,
    input: { accountId: string; lookupHash: string; email: string; now: Date },
  ): Promise<void> {
    const encrypted = encryptEmail(input.email, this.options.identityMasterKey);
    await transaction
      .insertInto("identity.email_identities")
      .values({
        id: randomUUID(),
        account_id: input.accountId,
        status: "active",
        email_lookup_hash: input.lookupHash,
        email_ciphertext: encrypted.ciphertext,
        email_nonce: encrypted.nonce,
        email_auth_tag: encrypted.authenticationTag,
        encryption_key_version: encrypted.keyVersion,
        verified_at: input.now,
        revoked_at: null,
        created_at: input.now,
        updated_at: input.now,
      })
      .execute();
  }
}
