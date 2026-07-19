import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import Fastify from "fastify";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  installAnonymousIdentity,
  requireOwnerContext,
  SESSION_COOKIE_NAME,
} from "./fastify.js";

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
});
