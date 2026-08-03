import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../index.js";
import { migrateToLatest } from "../migrate.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("match worker owner-deletion privileges", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");
  const ownerId = randomUUID();
  const sessionId = randomUUID();

  beforeAll(async () => {
    await migrateToLatest(db);
    await db
      .insertInto("identity.owners")
      .values({
        id: ownerId,
        status: "deletion_pending",
        epoch: 2,
        retention_expires_at: new Date(Date.now() + 60_000),
        last_seen_at: new Date(),
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("identity.owner_sessions")
      .values({
        id: sessionId,
        owner_id: ownerId,
        owner_epoch: 1,
        token_hash: createHash("sha256").update(`token:${sessionId}`).digest("hex"),
        csrf_token_hash: createHash("sha256").update(`csrf:${sessionId}`).digest("hex"),
        expires_at: new Date(Date.now() + 60_000),
        revoked_at: new Date(),
        last_seen_at: new Date(),
      })
      .execute();
  });

  afterAll(async () => {
    await db.deleteFrom("identity.owner_sessions").where("owner_id", "=", ownerId).execute();
    await db.deleteFrom("identity.owners").where("id", "=", ownerId).execute();
    await db.destroy();
  });

  it("allows only the identity mutations required by owner deletion", async () => {
    const now = new Date();
    await db.transaction().execute(async (transaction) => {
      await sql`SET LOCAL ROLE aijob_match_worker`.execute(transaction);
      const owner = await transaction
        .selectFrom("identity.owners")
        .select(["status", "epoch"])
        .where("id", "=", ownerId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      expect(owner).toMatchObject({ status: "deletion_pending", epoch: "2" });

      await transaction
        .updateTable("identity.owners")
        .set({
          status: "deleted",
          deleted_at: now,
          retention_expires_at: now,
          last_seen_at: now,
        })
        .where("id", "=", ownerId)
        .executeTakeFirstOrThrow();
      await transaction
        .deleteFrom("identity.owner_sessions")
        .where("owner_id", "=", ownerId)
        .execute();
    });

    const owner = await db
      .selectFrom("identity.owners")
      .select(["status", "deleted_at"])
      .where("id", "=", ownerId)
      .executeTakeFirstOrThrow();
    expect(owner.status).toBe("deleted");
    expect(owner.deleted_at).not.toBeNull();
    await expect(
      db
        .selectFrom("identity.owner_sessions")
        .select("id")
        .where("id", "=", sessionId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
  });

  it("does not expose session secrets or allow owner epoch changes", async () => {
    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_match_worker`.execute(transaction);
        await transaction
          .selectFrom("identity.owner_sessions")
          .select("token_hash")
          .where("owner_id", "=", ownerId)
          .execute();
      }),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_match_worker`.execute(transaction);
        await transaction
          .updateTable("identity.owners")
          .set({ epoch: 3 })
          .where("id", "=", ownerId)
          .execute();
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
