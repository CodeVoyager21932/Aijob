import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import Fastify from "fastify";
import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FixtureEmailVerificationDelivery } from "./email-delivery.js";
import { emailLookupHash } from "./email-crypto.js";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  installAnonymousIdentity,
  OWNER_CONTEXT_HEADER_NAME,
  requireOwnerContext,
  SESSION_COOKIE_NAME,
} from "./fastify.js";
import { hashOpaqueToken } from "./session-repository.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function cookieValue(setCookie: string | string[] | undefined, name: string): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
    if (match?.[1]) return match[1];
  }
  return undefined;
}

describeWithDatabase("anonymous owner Fastify boundary", () => {
  let db: Kysely<Database>;
  const ownerIds: string[] = [];
  const challengeEmailHashes: string[] = [];

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
  });

  afterAll(async () => {
    if (challengeEmailHashes.length > 0) {
      await db
        .deleteFrom("identity.email_verification_challenges")
        .where("email_lookup_hash", "in", challengeEmailHashes)
        .execute();
    }
    if (ownerIds.length > 0) {
      await db
        .deleteFrom("profile.profile_fact_revisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await db
        .updateTable("identity.owners")
        .set({ status: "deletion_pending" })
        .where("id", "in", ownerIds)
        .execute();
      await db.deleteFrom("identity.accounts").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owner_sessions").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owners").where("id", "in", ownerIds).execute();
    }
    await db.destroy();
  });

  it("bootstraps a localhost owner, stores only hashes and enforces Origin plus CSRF", async () => {
    const runId = randomUUID();
    const delivery = new FixtureEmailVerificationDelivery();
    const identityMasterKey = "6b".repeat(32);
    const verificationCode = "135790";
    const app = Fastify({ logger: false });
    installAnonymousIdentity(app, {
      db,
      appEnv: "test",
      host: "127.0.0.1",
      identityMasterKey,
      emailDelivery: delivery,
      fixedVerificationCode: verificationCode,
    });
    app.get("/v1/whoami", async (request) => {
      const owner = requireOwnerContext(request);
      ownerIds.push(owner.ownerId);
      return { ownerId: owner.ownerId };
    });
    app.post("/v1/mutate", async (request) => ({
      ownerId: requireOwnerContext(request).ownerId,
    }));

    try {
      const bootstrap = await app.inject({
        method: "GET",
        url: "/v1/whoami",
        headers: { host: "127.0.0.1:3000" },
      });
      expect(bootstrap.statusCode).toBe(200);
      expect(bootstrap.headers[OWNER_CONTEXT_HEADER_NAME]).toBe(`${bootstrap.json().ownerId}:1`);
      const sessionToken = cookieValue(bootstrap.headers["set-cookie"], SESSION_COOKIE_NAME);
      const csrfToken = cookieValue(bootstrap.headers["set-cookie"], CSRF_COOKIE_NAME);
      expect(sessionToken).toBeTruthy();
      expect(csrfToken).toBeTruthy();

      const stored = await db
        .selectFrom("identity.owner_sessions")
        .select(["token_hash", "csrf_token_hash"])
        .where("owner_id", "=", bootstrap.json().ownerId)
        .executeTakeFirstOrThrow();
      expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(stored.csrf_token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(stored.token_hash).not.toContain(sessionToken as string);
      expect(stored.csrf_token_hash).not.toContain(csrfToken as string);

      const cookie = `${SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`;
      const missingCsrf = await app.inject({
        method: "POST",
        url: "/v1/mutate",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie,
        },
      });
      expect(missingCsrf.statusCode).toBe(403);
      expect(missingCsrf.json()).toMatchObject({ code: "CSRF_REJECTED" });

      const wrongOrigin = await app.inject({
        method: "POST",
        url: "/v1/mutate",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://attacker.example",
          cookie,
          [CSRF_HEADER_NAME]: csrfToken as string,
        },
      });
      expect(wrongOrigin.statusCode).toBe(403);
      expect(wrongOrigin.json()).toMatchObject({ code: "ORIGIN_REJECTED" });

      const accepted = await app.inject({
        method: "POST",
        url: "/v1/mutate",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie,
          [CSRF_HEADER_NAME]: csrfToken as string,
        },
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toEqual(bootstrap.json());

      const factId = randomUUID();
      await db
        .insertInto("profile.profile_fact_revisions")
        .values({
          id: factId,
          owner_id: bootstrap.json().ownerId,
          owner_epoch: 1,
          revision: 1,
          base_revision: null,
          facts: JSON.stringify([{ key: "current_student", value: true }]),
          content_hash: "c".repeat(64),
          confirmed_at: new Date(),
        })
        .execute();

      const claimEmail = `claim.${runId}@example.test`;
      challengeEmailHashes.push(emailLookupHash(claimEmail, identityMasterKey));
      const claimChallenge = await app.inject({
        method: "POST",
        url: "/v1/email-verification-challenges",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie,
          [CSRF_HEADER_NAME]: csrfToken as string,
          "idempotency-key": `claim-local-owner-${runId}`,
        },
        payload: { purpose: "claim_owner", email: claimEmail, expectedOwnerEpoch: 1 },
      });
      expect(claimChallenge.statusCode).toBe(202);
      expect(delivery.deliveries).toHaveLength(1);

      const secondBootstrap = await app.inject({
        method: "GET",
        url: "/v1/whoami",
        headers: { host: "127.0.0.1:3000" },
      });
      const secondSessionToken = cookieValue(
        secondBootstrap.headers["set-cookie"],
        SESSION_COOKIE_NAME,
      );
      const secondCsrfToken = cookieValue(
        secondBootstrap.headers["set-cookie"],
        CSRF_COOKIE_NAME,
      );
      const secondOwnerChallenge = await app.inject({
        method: "POST",
        url: "/v1/email-verification-challenges",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie: `${SESSION_COOKIE_NAME}=${secondSessionToken}; ${CSRF_COOKIE_NAME}=${secondCsrfToken}`,
          [CSRF_HEADER_NAME]: secondCsrfToken as string,
          "idempotency-key": `claim-second-owner-${runId}`,
        },
        payload: { purpose: "claim_owner", email: claimEmail, expectedOwnerEpoch: 1 },
      });
      expect(secondOwnerChallenge.statusCode).toBe(202);
      expect(secondOwnerChallenge.json().id).not.toBe(claimChallenge.json().id);
      expect(delivery.deliveries).toHaveLength(2);

      const claimed = await app.inject({
        method: "POST",
        url: "/v1/email-verification-challenges/complete",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie,
          [CSRF_HEADER_NAME]: csrfToken as string,
        },
        payload: {
          purpose: "claim_owner",
          challengeId: claimChallenge.json().id,
          email: claimEmail,
          verificationCode,
          expectedOwnerEpoch: 1,
        },
      });
      expect(claimed.statusCode, claimed.body).toBe(200);
      expect(claimed.json()).toMatchObject({
        authenticated: true,
        owner: {
          id: bootstrap.json().ownerId,
          retentionMode: "account_managed",
          retentionExpiresAt: null,
        },
      });
      expect(claimed.json().owner.accountId).toBeTruthy();
      expect(
        await db
          .selectFrom("profile.profile_fact_revisions")
          .select(["id", "owner_id"])
          .where("id", "=", factId)
          .executeTakeFirst(),
      ).toEqual({ id: factId, owner_id: bootstrap.json().ownerId });
      expect(
        await db
          .selectFrom("identity.owner_sessions")
          .select("revoked_at")
          .where("token_hash", "=", stored.token_hash)
          .executeTakeFirstOrThrow(),
      ).toMatchObject({ revoked_at: expect.any(Date) });
    } finally {
      await app.close();
    }
  });

  it("creates an account-managed Alpha session from a one-time invited email challenge", async () => {
    const runId = randomUUID();
    const identityMasterKey = "7a".repeat(32);
    const invitedEmail = `coco.alpha.${runId}@example.test`;
    const uninvitedEmail = `not-invited.${runId}@example.test`;
    const verificationCode = "246810";
    const acceptedOrigin = "https://alpha.aijob.example";
    const delivery = new FixtureEmailVerificationDelivery();
    const invitedHash = emailLookupHash(invitedEmail, identityMasterKey);
    const uninvitedHash = emailLookupHash(uninvitedEmail, identityMasterKey);
    challengeEmailHashes.push(invitedHash, uninvitedHash);
    const app = Fastify({ logger: false });
    installAnonymousIdentity(app, {
      db,
      appEnv: "alpha",
      host: "0.0.0.0",
      acceptedOrigins: [acceptedOrigin],
      identityMasterKey,
      invitedEmailHashes: [invitedHash],
      emailDelivery: delivery,
      fixedVerificationCode: verificationCode,
    });
    app.post("/v1/mutate", async (request) => ({
      ownerId: requireOwnerContext(request).ownerId,
    }));
    app.get("/v1/catalog-preview", async () => ({ visible: true }));
    app.get("/v1/profile/deletion", async () => ({ status: "receipt-only" }));

    try {
      const anonymous = await app.inject({ method: "GET", url: "/v1/session" });
      expect(anonymous.statusCode).toBe(200);
      expect(anonymous.json()).toEqual({ authenticated: false });
      expect(anonymous.headers["cache-control"]).toBe("no-store");

      const bypassAttempt = await app.inject({ method: "GET", url: "/v1/catalog-preview" });
      expect(bypassAttempt.statusCode).toBe(401);
      expect(bypassAttempt.json()).toMatchObject({ code: "SESSION_REQUIRED" });

      const deletionReceiptStatus = await app.inject({
        method: "GET",
        url: "/v1/profile/deletion?receipt=opaque",
      });
      expect(deletionReceiptStatus.statusCode).toBe(200);

      const missingOrigin = await app.inject({
        method: "POST",
        url: "/v1/email-verification-challenges",
        headers: { "idempotency-key": "missing-origin" },
        payload: { purpose: "sign_in", email: invitedEmail },
      });
      expect(missingOrigin.statusCode).toBe(403);
      expect(missingOrigin.json()).toMatchObject({ code: "ORIGIN_REJECTED" });

      const wrongOrigin = await app.inject({
        method: "POST",
        url: "/v1/email-verification-challenges",
        headers: { origin: "https://attacker.example", "idempotency-key": "wrong-origin" },
        payload: { purpose: "sign_in", email: invitedEmail },
      });
      expect(wrongOrigin.statusCode).toBe(403);
      expect(wrongOrigin.json()).toMatchObject({ code: "ORIGIN_REJECTED" });

      const uninvited = await app.inject({
        method: "POST",
        url: "/v1/email-verification-challenges",
        headers: { origin: acceptedOrigin, "idempotency-key": `uninvited-email-${runId}` },
        payload: { purpose: "sign_in", email: uninvitedEmail },
      });
      expect(uninvited.statusCode).toBe(202);
      expect(delivery.deliveries).toHaveLength(0);

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const rejected = await app.inject({
          method: "POST",
          url: "/v1/email-verification-challenges/complete",
          headers: { origin: acceptedOrigin },
          payload: {
            purpose: "sign_in",
            challengeId: uninvited.json().id,
            email: uninvitedEmail,
            verificationCode,
          },
        });
        expect(rejected.statusCode).toBe(attempt === 5 ? 410 : 403);
      }
      expect(
        await db
          .selectFrom("identity.email_verification_challenges")
          .select(["attempt_count", "status"])
          .where("id", "=", uninvited.json().id)
          .executeTakeFirstOrThrow(),
      ).toEqual({ attempt_count: 5, status: "locked" });

      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/email-verification-challenges",
        headers: { origin: acceptedOrigin, "idempotency-key": `invited-email-${runId}` },
        payload: { purpose: "sign_in", email: invitedEmail },
      });
      expect(challengeResponse.statusCode).toBe(202);
      expect(challengeResponse.json()).toMatchObject({
        purpose: "sign_in",
        status: "pending",
        maskedEmail: expect.stringMatching(/^c\*+@example\.test$/),
        remainingAttempts: 5,
      });
      expect(JSON.stringify(challengeResponse.json())).not.toContain(invitedEmail);
      expect(JSON.stringify(challengeResponse.json())).not.toContain(verificationCode);
      expect(delivery.deliveries).toHaveLength(1);

      const wrongCode = await app.inject({
        method: "POST",
        url: "/v1/email-verification-challenges/complete",
        headers: { origin: acceptedOrigin },
        payload: {
          purpose: "sign_in",
          challengeId: challengeResponse.json().id,
          email: invitedEmail,
          verificationCode: "000000",
        },
      });
      expect(wrongCode.statusCode).toBe(403);
      expect(wrongCode.json()).toMatchObject({ code: "EMAIL_VERIFICATION_REJECTED" });
      expect(
        await db
          .selectFrom("identity.email_verification_challenges")
          .select(["attempt_count", "status"])
          .where("id", "=", challengeResponse.json().id)
          .executeTakeFirstOrThrow(),
      ).toEqual({ attempt_count: 1, status: "pending" });

      const restartedApp = Fastify({ logger: false });
      installAnonymousIdentity(restartedApp, {
        db,
        appEnv: "alpha",
        host: "0.0.0.0",
        acceptedOrigins: [acceptedOrigin],
        identityMasterKey,
        invitedEmailHashes: [invitedHash],
        emailDelivery: new FixtureEmailVerificationDelivery(),
        fixedVerificationCode: verificationCode,
      });
      const accepted = await restartedApp
        .inject({
          method: "POST",
          url: "/v1/email-verification-challenges/complete",
          headers: { origin: acceptedOrigin },
          payload: {
            purpose: "sign_in",
            challengeId: challengeResponse.json().id,
            email: invitedEmail,
            verificationCode,
          },
        })
        .finally(() => restartedApp.close());
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(accepted.json()).toMatchObject({
        authenticated: true,
        owner: { retentionMode: "account_managed", retentionExpiresAt: null },
        session: { ownerEpoch: 1 },
      });
      expect(JSON.stringify(accepted.json())).not.toContain("csrfTokenHash");
      expect(JSON.stringify(accepted.json())).not.toContain("tokenHash");
      expect(accepted.headers["cache-control"]).toBe("no-store");

      const setCookie = accepted.headers["set-cookie"];
      const sessionToken = cookieValue(setCookie, SESSION_COOKIE_NAME);
      const csrfToken = cookieValue(setCookie, CSRF_COOKIE_NAME);
      expect(sessionToken).toBeTruthy();
      expect(csrfToken).toBeTruthy();
      const cookieHeaders = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
      expect(cookieHeaders.some((header) => /aijob_session=.*HttpOnly/.test(header))).toBe(true);
      expect(cookieHeaders.every((header) => /Secure/.test(header))).toBe(true);
      expect(cookieHeaders.every((header) => /SameSite=Strict/.test(header))).toBe(true);

      const stored = await db
        .selectFrom("identity.owner_sessions")
        .select(["owner_id", "token_hash", "csrf_token_hash"])
        .where("token_hash", "=", hashOpaqueToken(sessionToken as string))
        .executeTakeFirstOrThrow();
      ownerIds.push(stored.owner_id);
      expect(accepted.headers[OWNER_CONTEXT_HEADER_NAME]).toBe(`${stored.owner_id}:1`);
      expect(stored.token_hash).toBe(hashOpaqueToken(sessionToken as string));
      expect(stored.csrf_token_hash).toBe(hashOpaqueToken(csrfToken as string));
      const storedIdentity = await db
        .selectFrom("identity.email_identities")
        .select(["email_lookup_hash", "email_ciphertext", "encryption_key_version"])
        .where("email_lookup_hash", "=", invitedHash)
        .executeTakeFirstOrThrow();
      expect(storedIdentity.email_lookup_hash).toBe(invitedHash);
      expect(Buffer.from(storedIdentity.email_ciphertext).toString("utf8")).not.toContain(
        invitedEmail,
      );
      expect(storedIdentity.encryption_key_version).toBe("identity-email-v1");

      const cookie = `${SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`;
      const authenticated = await app.inject({
        method: "GET",
        url: "/v1/session",
        headers: { cookie },
      });
      expect(authenticated.json()).toMatchObject({
        authenticated: true,
        owner: { id: stored.owner_id, retentionMode: "account_managed" },
        session: { ownerEpoch: 1 },
      });
      expect(authenticated.headers[OWNER_CONTEXT_HEADER_NAME]).toBe(`${stored.owner_id}:1`);

      const replay = await app.inject({
        method: "POST",
        url: "/v1/email-verification-challenges/complete",
        headers: { origin: acceptedOrigin },
        payload: {
          purpose: "sign_in",
          challengeId: challengeResponse.json().id,
          email: invitedEmail,
          verificationCode,
        },
      });
      expect(replay.statusCode).toBe(410);
      expect(replay.json()).toMatchObject({ code: "EMAIL_CHALLENGE_UNAVAILABLE" });

      const catalog = await app.inject({
        method: "GET",
        url: "/v1/catalog-preview",
        headers: { cookie },
      });
      expect(catalog.statusCode).toBe(200);
      expect(catalog.json()).toEqual({ visible: true });

      const mutation = await app.inject({
        method: "POST",
        url: "/v1/mutate",
        headers: {
          origin: acceptedOrigin,
          cookie,
          [CSRF_HEADER_NAME]: csrfToken as string,
        },
      });
      expect(mutation.statusCode).toBe(200);
      expect(mutation.json()).toEqual({ ownerId: stored.owner_id });

      const concurrentChallenge = await app.inject({
        method: "POST",
        url: "/v1/email-verification-challenges",
        headers: { origin: acceptedOrigin, "idempotency-key": "concurrent-relogin" },
        payload: { purpose: "sign_in", email: invitedEmail },
      });
      expect(concurrentChallenge.statusCode).toBe(202);
      const completion = {
        method: "POST" as const,
        url: "/v1/email-verification-challenges/complete",
        headers: { origin: acceptedOrigin },
        payload: {
          purpose: "sign_in",
          challengeId: concurrentChallenge.json().id,
          email: invitedEmail,
          verificationCode,
        },
      };
      const concurrentResults = await Promise.all([app.inject(completion), app.inject(completion)]);
      expect(concurrentResults.map((response) => response.statusCode).sort()).toEqual([200, 410]);
      expect(
        await db
          .selectFrom("identity.email_verification_challenges")
          .select(["status", "consumed_at"])
          .where("id", "=", concurrentChallenge.json().id)
          .executeTakeFirstOrThrow(),
      ).toMatchObject({ status: "consumed", consumed_at: expect.any(Date) });
    } finally {
      await app.close();
    }
  });
});
