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
} from "../identity/fastify.js";
import { registerResumeRoutes } from "./routes.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const encryptionKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

function readCookie(setCookie: string | string[] | undefined, name: string): string {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
    if (match?.[1]) return match[1];
  }
  throw new Error(`cookie ${name} missing`);
}

describeWithDatabase("resume analysis HTTP routes", () => {
  let db: Kysely<Database>;
  const ownerIds: string[] = [];

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
  });

  afterAll(async () => {
    if (ownerIds.length > 0) {
      await db.deleteFrom("task_queue.tasks").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("profile.resume_analyses").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owner_sessions").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owners").where("id", "in", ownerIds).execute();
    }
    await db.destroy();
  });

  it("accepts pasted text and a validated multipart PDF under one owner", async () => {
    const app = Fastify({ logger: false });
    installAnonymousIdentity(app, {
      db,
      appEnv: "test",
      host: "127.0.0.1",
    });
    registerResumeRoutes(app, {
      db,
      encryptionKey,
      maxBytes: 5 * 1024 * 1024,
    });
    app.get("/v1/bootstrap", async (request) => {
      const owner = requireOwnerContext(request);
      ownerIds.push(owner.ownerId);
      return { ownerId: owner.ownerId };
    });

    try {
      const bootstrap = await app.inject({
        method: "GET",
        url: "/v1/bootstrap",
        headers: { host: "127.0.0.1:3000" },
      });
      const session = readCookie(bootstrap.headers["set-cookie"], SESSION_COOKIE_NAME);
      const csrf = readCookie(bootstrap.headers["set-cookie"], CSRF_COOKIE_NAME);
      const headers = {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        cookie: `${SESSION_COOKIE_NAME}=${session}; ${CSRF_COOKIE_NAME}=${csrf}`,
        [CSRF_HEADER_NAME]: csrf,
      };

      const pasted = await app.inject({
        method: "POST",
        url: "/v1/resume-analyses",
        headers: {
          ...headers,
          "content-type": "application/json",
          "idempotency-key": "http-pasted-1",
        },
        payload: {
          inputKind: "pasted_text",
          text: "产品实习经历：完成用户研究、需求分析与数据复盘，推动关键流程持续改进。",
        },
      });
      expect(pasted.statusCode).toBe(202);
      expect(pasted.json()).toMatchObject({
        inputKind: "pasted_text",
        status: "queued",
      });

      const boundary = "aijob-test-boundary";
      const pdfPayload = Buffer.from(
        [
          `--${boundary}\r\n`,
          'Content-Disposition: form-data; name="resume"; filename="resume.pdf"\r\n',
          "Content-Type: application/pdf\r\n\r\n",
          "%PDF-1.7\nAijob test resume\n",
          `\r\n--${boundary}--\r\n`,
        ].join(""),
      );
      const uploaded = await app.inject({
        method: "POST",
        url: "/v1/resume-analyses",
        headers: {
          ...headers,
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "idempotency-key": "http-pdf-1",
        },
        payload: pdfPayload,
      });
      expect(uploaded.statusCode).toBe(202);
      expect(uploaded.json()).toMatchObject({ inputKind: "pdf", status: "queued" });

      const fetched = await app.inject({
        method: "GET",
        url: `/v1/resume-analyses/${pasted.json().id}`,
        headers: {
          host: headers.host,
          cookie: headers.cookie,
        },
      });
      expect(fetched.statusCode).toBe(200);
      expect(fetched.json()).toMatchObject({ id: pasted.json().id });
    } finally {
      await app.close();
    }
  });
});
