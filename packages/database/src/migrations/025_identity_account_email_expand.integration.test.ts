import { randomUUID } from "node:crypto";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../index.js";
import { migrateToForTesting } from "../migrate.js";
import { identityAccountEmailExpandMigration } from "./025_identity_account_email_expand.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("migration 025 identity account and email expand", () => {
  const ids = {
    legacyOwner: randomUUID(),
    accountOwner: randomUUID(),
    expiredOwner: randomUUID(),
    account: randomUUID(),
    emailIdentity: randomUUID(),
    challenge: randomUUID(),
    deletionOwner: randomUUID(),
    deletionAccount: randomUUID(),
  };
  const emptyDatabaseName = `aijob_test_phase2a_identity_empty_${randomUUID().replaceAll("-", "")}`;
  const upgradeDatabaseName = `aijob_test_phase2a_identity_upgrade_${randomUUID().replaceAll("-", "")}`;
  let adminDb: Kysely<Database>;
  let emptyDb: Kysely<Database>;
  let db: Kysely<Database>;

  beforeAll(async () => {
    const adminUrl = new URL(databaseUrl as string);
    adminDb = createDatabase(adminUrl.toString());
    await sql.raw(`CREATE DATABASE "${emptyDatabaseName}"`).execute(adminDb);
    await sql.raw(`CREATE DATABASE "${upgradeDatabaseName}"`).execute(adminDb);

    const emptyUrl = new URL(adminUrl);
    emptyUrl.pathname = `/${emptyDatabaseName}`;
    emptyDb = createDatabase(emptyUrl.toString());
    await migrateToForTesting(emptyDb, "025_identity_account_email_expand");

    const upgradeUrl = new URL(adminUrl);
    upgradeUrl.pathname = `/${upgradeDatabaseName}`;
    db = createDatabase(upgradeUrl.toString());
    await migrateToForTesting(db, "024_resume_document_v2_expand");

    await db
      .insertInto("identity.owners")
      .values([
        {
          id: ids.legacyOwner,
          status: "active",
          epoch: 1,
          retention_expires_at: new Date("2026-09-05T00:00:00.000Z"),
          last_seen_at: new Date("2026-08-06T00:00:00.000Z"),
          deleted_at: null,
        },
        {
          id: ids.accountOwner,
          status: "active",
          epoch: 1,
          retention_expires_at: new Date("2026-09-05T00:00:00.000Z"),
          last_seen_at: new Date("2026-08-06T00:00:00.000Z"),
          deleted_at: null,
        },
        {
          id: ids.expiredOwner,
          status: "active",
          epoch: 1,
          retention_expires_at: new Date("2026-08-05T00:00:00.000Z"),
          last_seen_at: new Date("2026-08-05T00:00:00.000Z"),
          deleted_at: null,
        },
      ])
      .execute();

    await migrateToForTesting(db, "025_identity_account_email_expand");
    await db.transaction().execute(async (transaction) => {
      await sql`
        INSERT INTO identity.accounts (id, owner_id)
        VALUES (${ids.account}, ${ids.accountOwner})
      `.execute(transaction);
      await sql`
        UPDATE identity.owners
        SET retention_mode = 'account_managed', retention_expires_at = NULL
        WHERE id = ${ids.accountOwner}
      `.execute(transaction);
    });
    await sql`
      INSERT INTO identity.email_identities (
        id,
        account_id,
        email_lookup_hash,
        email_ciphertext,
        email_nonce,
        email_auth_tag,
        encryption_key_version,
        verified_at
      ) VALUES (
        ${ids.emailIdentity},
        ${ids.account},
        ${"a".repeat(64)},
        decode('01', 'hex'),
        decode(repeat('02', 12), 'hex'),
        decode(repeat('03', 16), 'hex'),
        'identity-test-v1',
        now()
      )
    `.execute(db);
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    if (emptyDb) await emptyDb.destroy();
    if (adminDb) {
      await sql
        .raw(`DROP DATABASE IF EXISTS "${upgradeDatabaseName}" WITH (FORCE)`)
        .execute(adminDb);
      await sql
        .raw(`DROP DATABASE IF EXISTS "${emptyDatabaseName}" WITH (FORCE)`)
        .execute(adminDb);
      await adminDb.destroy();
    }
  }, 120_000);

  it("migrates empty and populated 024 databases through 025", async () => {
    const [emptyMigration, upgradeMigration] = await Promise.all([
      sql<{ name: string }>`
        SELECT name FROM kysely_migration ORDER BY timestamp DESC LIMIT 1
      `.execute(emptyDb),
      sql<{ name: string }>`
      SELECT name FROM kysely_migration ORDER BY timestamp DESC LIMIT 1
    `.execute(db),
    ]);
    expect(emptyMigration.rows[0]?.name).toBe("025_identity_account_email_expand");
    expect(upgradeMigration.rows[0]?.name).toBe("025_identity_account_email_expand");

    const owner = await sql<{ mode: string; expiresAt: Date | null }>`
      SELECT retention_mode AS mode, retention_expires_at AS "expiresAt"
      FROM identity.owners
      WHERE id = ${ids.legacyOwner}
    `.execute(db);
    expect(owner.rows[0]?.mode).toBe("anonymous_ttl");
    expect(owner.rows[0]?.expiresAt).not.toBeNull();
  });

  it("requires an active account before removing the owner retention deadline", async () => {
    const accountOwner = await sql<{ mode: string; expiresAt: Date | null }>`
      SELECT retention_mode AS mode, retention_expires_at AS "expiresAt"
      FROM identity.owners
      WHERE id = ${ids.accountOwner}
    `.execute(db);
    expect(accountOwner.rows[0]).toEqual({ mode: "account_managed", expiresAt: null });

    await expect(
      sql`
        UPDATE identity.owners
        SET retention_mode = 'account_managed', retention_expires_at = NULL
        WHERE id = ${ids.expiredOwner}
      `.execute(db),
    ).rejects.toThrow(/ACCOUNT_MANAGED_OWNER_REQUIRES_ACTIVE_ACCOUNT/);

    const activeOwners = await sql<{ id: string }>`
      SELECT id
      FROM identity.owners
      WHERE status = 'active'
        AND (
          retention_mode = 'account_managed'
          OR retention_expires_at > '2026-08-06T00:00:00.000Z'::timestamptz
        )
      ORDER BY id
    `.execute(db);
    expect(activeOwners.rows.map(({ id }) => id).sort()).toEqual(
      [ids.legacyOwner, ids.accountOwner].sort(),
    );

    await expect(
      db.deleteFrom("identity.accounts").where("id", "=", ids.account).execute(),
    ).rejects.toThrow(/ACTIVE_OWNER_ACCOUNT_CANNOT_BE_DELETED/);
    await expect(
      db
        .updateTable("identity.accounts")
        .set({ status: "deletion_pending", updated_at: new Date() })
        .where("id", "=", ids.account)
        .execute(),
    ).rejects.toThrow(/ACTIVE_OWNER_REQUIRES_ACTIVE_ACCOUNT/);
    await expect(
      db
        .updateTable("identity.owners")
        .set({
          retention_mode: "anonymous_ttl",
          retention_expires_at: new Date("2026-09-05T00:00:00.000Z"),
        })
        .where("id", "=", ids.accountOwner)
        .execute(),
    ).rejects.toThrow(/ACTIVE_ACCOUNT_REQUIRES_ACCOUNT_MANAGED_OWNER/);
  });

  it("stores only encrypted email material and enforces one active identity", async () => {
    const columns = await sql<{ columnName: string }>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'identity' AND table_name = 'email_identities'
    `.execute(db);
    expect(columns.rows.map(({ columnName }) => columnName)).not.toContain("email");
    expect(columns.rows.map(({ columnName }) => columnName)).not.toContain("normalized_email");

    await expect(
      sql`
        INSERT INTO identity.email_identities (
          account_id,
          email_lookup_hash,
          email_ciphertext,
          email_nonce,
          email_auth_tag,
          encryption_key_version,
          verified_at
        ) VALUES (
          ${ids.account},
          ${"b".repeat(64)},
          decode('04', 'hex'),
          decode(repeat('05', 12), 'hex'),
          decode(repeat('06', 16), 'hex'),
          'identity-test-v1',
          now()
        )
      `.execute(db),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      sql`
        UPDATE identity.email_identities
        SET email_lookup_hash = ${"c".repeat(64)}
        WHERE id = ${ids.emailIdentity}
      `.execute(db),
    ).rejects.toThrow(/IMMUTABLE_EMAIL_IDENTITY_MATERIAL/);
  });

  it("binds claim challenges to the current owner epoch and rejects mixed contexts", async () => {
    await sql`
      INSERT INTO identity.email_verification_challenges (
        id,
        purpose,
        owner_id,
        owner_epoch,
        email_lookup_hash,
        verification_token_hash,
        expires_at,
        retry_after_at,
        idempotency_key_hash,
        request_hash
      ) VALUES (
        ${ids.challenge},
        'claim_owner',
        ${ids.legacyOwner},
        1,
        ${"d".repeat(64)},
        ${"e".repeat(64)},
        now() + interval '10 minutes',
        now() + interval '1 minute',
        ${"f".repeat(64)},
        ${"0".repeat(64)}
      )
    `.execute(db);

    await expect(
      sql`
        INSERT INTO identity.email_verification_challenges (
          purpose,
          owner_id,
          owner_epoch,
          account_id,
          email_lookup_hash,
          verification_token_hash,
          expires_at,
          retry_after_at,
          idempotency_key_hash,
          request_hash
        ) VALUES (
          'claim_owner',
          ${ids.legacyOwner},
          1,
          ${ids.account},
          ${"1".repeat(64)},
          ${"2".repeat(64)},
          now() + interval '10 minutes',
          now(),
          ${"3".repeat(64)},
          ${"4".repeat(64)}
        )
      `.execute(db),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      sql`
        UPDATE identity.email_verification_challenges
        SET status = 'locked', attempt_count = 1, locked_at = now(), updated_at = now()
        WHERE id = ${ids.challenge}
      `.execute(db),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("keeps identity material inaccessible to collector and match workers", async () => {
    for (const role of ["aijob_collector_worker", "aijob_match_worker"]) {
      await expect(
        db.transaction().execute(async (transaction) => {
          await sql.raw(`SET LOCAL ROLE ${role}`).execute(transaction);
          await sql`SELECT id FROM identity.email_identities LIMIT 1`.execute(transaction);
        }),
      ).rejects.toMatchObject({ code: "42501" });
    }

    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_web_api`.execute(transaction);
        await sql`SELECT id FROM identity.email_identities LIMIT 1`.execute(transaction);
      }),
    ).resolves.toBeUndefined();

    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_web_api`.execute(transaction);
        await sql`
          UPDATE identity.email_verification_challenges
          SET verification_token_hash = ${"9".repeat(64)}
          WHERE id = ${ids.challenge}
        `.execute(transaction);
      }),
    ).rejects.toMatchObject({ code: "42501" });

    await db
      .insertInto("identity.owners")
      .values({
        id: ids.deletionOwner,
        status: "deletion_pending",
        epoch: 2,
        retention_expires_at: new Date("2026-09-05T00:00:00.000Z"),
        last_seen_at: new Date("2026-08-06T00:00:00.000Z"),
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("identity.accounts")
      .values({ id: ids.deletionAccount, owner_id: ids.deletionOwner, deleted_at: null })
      .execute();
    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_match_worker`.execute(transaction);
        await sql`
          SELECT identity.purge_account_identity_for_owner(
            ${ids.deletionOwner}::uuid,
            1::bigint
          )
        `.execute(transaction);
      }),
    ).resolves.toBeUndefined();
    expect(
      await db
        .selectFrom("identity.accounts")
        .select("id")
        .where("id", "=", ids.deletionAccount)
        .executeTakeFirst(),
    ).toBeUndefined();
  });

  it("keeps 025 forward-only rollback non-destructive", async () => {
    await identityAccountEmailExpandMigration.down?.(db);
    const account = await db
      .selectFrom("identity.accounts")
      .select(["id", "owner_id"])
      .where("id", "=", ids.account)
      .executeTakeFirstOrThrow();
    expect(account).toEqual({ id: ids.account, owner_id: ids.accountOwner });
  });
});
