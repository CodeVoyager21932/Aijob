import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import Fastify from "fastify";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
  });

  afterAll(async () => {
    if (ownerIds.length > 0) {
      await db.deleteFrom("identity.owner_sessions").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owners").where("id", "in", ownerIds).execute();
    }
    await db.destroy();
  });

  it("bootstraps a localhost owner, stores only hashes and enforces Origin plus CSRF", async () => {
    const app = Fastify({ logger: false });
    installAnonymousIdentity(app, {
      db,
      appEnv: "test",
      host: "127.0.0.1",
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
    } finally {
      await app.close();
    }
  });

  it("creates an Alpha session only from an accepted origin with a hashed invite code", async () => {
    const inviteCode = "alpha-private-invite-2026-08-03";
    const acceptedOrigin = "https://alpha.aijob.example";
    const app = Fastify({ logger: false });
    installAnonymousIdentity(app, {
      db,
      appEnv: "alpha",
      host: "0.0.0.0",
      acceptedOrigins: [acceptedOrigin],
      alphaInviteCodeHashes: [hashOpaqueToken(inviteCode)],
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
        url: "/v1/session",
        payload: { inviteCode },
      });
      expect(missingOrigin.statusCode).toBe(403);
      expect(missingOrigin.json()).toMatchObject({ code: "ORIGIN_REJECTED" });

      const wrongOrigin = await app.inject({
        method: "POST",
        url: "/v1/session",
        headers: { origin: "https://attacker.example" },
        payload: { inviteCode },
      });
      expect(wrongOrigin.statusCode).toBe(403);
      expect(wrongOrigin.json()).toMatchObject({ code: "ORIGIN_REJECTED" });

      const wrongInvite = await app.inject({
        method: "POST",
        url: "/v1/session",
        headers: { origin: acceptedOrigin },
        payload: { inviteCode: "wrong-private-invite-2026-08-03" },
      });
      expect(wrongInvite.statusCode).toBe(403);
      expect(wrongInvite.json()).toMatchObject({ code: "ALPHA_INVITE_REJECTED" });

      const accepted = await app.inject({
        method: "POST",
        url: "/v1/session",
        headers: { origin: acceptedOrigin },
        payload: { inviteCode },
      });
      expect(accepted.statusCode).toBe(201);
      expect(accepted.json()).toMatchObject({
        authenticated: true,
        owner: { retentionMode: "anonymous_ttl", accountId: null },
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

      const stored = await db
        .selectFrom("identity.owner_sessions")
        .select(["owner_id", "token_hash", "csrf_token_hash"])
        .where("token_hash", "=", hashOpaqueToken(sessionToken as string))
        .executeTakeFirstOrThrow();
      ownerIds.push(stored.owner_id);
      expect(accepted.headers[OWNER_CONTEXT_HEADER_NAME]).toBe(`${stored.owner_id}:1`);
      expect(stored.token_hash).toBe(hashOpaqueToken(sessionToken as string));
      expect(stored.csrf_token_hash).toBe(hashOpaqueToken(csrfToken as string));
      expect(JSON.stringify(stored)).not.toContain(inviteCode);

      const cookie = `${SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`;
      const authenticated = await app.inject({
        method: "GET",
        url: "/v1/session",
        headers: { cookie },
      });
      expect(authenticated.json()).toMatchObject({
        authenticated: true,
        owner: { id: stored.owner_id, retentionMode: "anonymous_ttl" },
        session: { ownerEpoch: 1 },
      });
      expect(authenticated.headers[OWNER_CONTEXT_HEADER_NAME]).toBe(`${stored.owner_id}:1`);

      const repeatedSessionEntry = await app.inject({
        method: "POST",
        url: "/v1/session",
        headers: { origin: acceptedOrigin, cookie },
        payload: { inviteCode: "not-rechecked-for-an-active-session" },
      });
      expect(repeatedSessionEntry.statusCode).toBe(200);
      expect(repeatedSessionEntry.json()).toMatchObject({
        authenticated: true,
        owner: { id: stored.owner_id, retentionMode: "anonymous_ttl" },
        session: authenticated.json().session,
      });

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
    } finally {
      await app.close();
    }
  });
});
