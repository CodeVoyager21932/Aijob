import { randomUUID } from "node:crypto";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../index.js";
import { migrateToForTesting } from "../migrate.js";

const databaseUrl = process.env.AIJob_TEST_DATABASE_URL ?? process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("resume document V2 expand migration", () => {
  const ids = {
    owner: randomUUID(),
    baseDocument: randomUUID(),
    legacyRevision: randomUUID(),
    firstV2Revision: randomUUID(),
    secondV2Revision: randomUUID(),
    layoutRevision: randomUUID(),
  };
  const databaseName = `aijob_test_phase2a2_${randomUUID().replaceAll("-", "")}`;
  let adminDb: Kysely<Database>;
  let db: Kysely<Database>;

  beforeAll(async () => {
    const adminUrl = new URL(databaseUrl as string);
    adminDb = createDatabase(adminUrl.toString());
    await sql.raw(`CREATE DATABASE "${databaseName}"`).execute(adminDb);
    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${databaseName}`;
    db = createDatabase(testUrl.toString());
    await migrateToForTesting(db, "024_resume_document_v2_expand");

    const now = new Date();
    await db
      .insertInto("identity.owners")
      .values({
        id: ids.owner,
        status: "active",
        epoch: 1,
        retention_expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
        last_seen_at: now,
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("profile.resume_document_revisions")
      .values({
        id: ids.legacyRevision,
        owner_id: ids.owner,
        owner_epoch: 1,
        resume_analysis_id: null,
        revision: 1,
        base_revision: null,
        schema_version: "resume-document-v1",
        sections: JSON.stringify([]),
        content_hash: "a".repeat(64),
        confirmed_at: now,
      })
      .execute();
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    if (adminDb) {
      await sql.raw(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).execute(adminDb);
      await adminDb.destroy();
    }
  }, 120_000);

  it("keeps V1 rows unchanged and records the 024 migration", async () => {
    const migration = await sql<{ name: string }>`
      SELECT name FROM kysely_migration ORDER BY timestamp DESC LIMIT 1
    `.execute(db);
    expect(migration.rows[0]?.name).toBe("024_resume_document_v2_expand");

    const legacy = await db
      .selectFrom("profile.resume_document_revisions")
      .select([
        "schema_version",
        "document_id",
        "document_revision",
        "base_document_revision_id",
        "content_hash",
      ])
      .where("id", "=", ids.legacyRevision)
      .executeTakeFirstOrThrow();
    expect(legacy).toEqual({
      schema_version: "resume-document-v1",
      document_id: null,
      document_revision: null,
      base_document_revision_id: null,
      content_hash: "a".repeat(64),
    });
  });

  it("supports a same-document immutable V2 content and layout chain", async () => {
    const now = new Date();
    await db
      .insertInto("profile.resume_documents")
      .values({
        id: ids.baseDocument,
        owner_id: ids.owner,
        owner_epoch: 1,
        kind: "base",
        title: "Phase 2A-2 base resume",
        case_id: null,
        published_job_id: null,
        published_job_version_id: null,
        requirement_set_id: null,
        base_document_id: null,
        base_document_revision_id: null,
        evidence_revision_id: null,
        current_content_revision_id: null,
        current_layout_revision_id: null,
        revision: 1,
        creation_idempotency_key: `base-${ids.baseDocument}`,
        creation_request_hash: "1".repeat(64),
        expires_at: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1_000),
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("profile.resume_document_revisions")
      .values({
        id: ids.firstV2Revision,
        owner_id: ids.owner,
        owner_epoch: 1,
        resume_analysis_id: null,
        revision: 2,
        base_revision: 1,
        schema_version: "resume-document-v2",
        sections: JSON.stringify([{ id: "section-1", blocks: [] }]),
        content_hash: "b".repeat(64),
        confirmed_at: now,
        document_id: ids.baseDocument,
        document_revision: 1,
        base_document_revision_id: null,
      })
      .execute();
    await db
      .updateTable("profile.resume_documents")
      .set({
        current_content_revision_id: ids.firstV2Revision,
        updated_at: new Date(now.getTime() + 1_000),
      })
      .where("id", "=", ids.baseDocument)
      .execute();
    await db
      .insertInto("profile.resume_layout_revisions")
      .values({
        id: ids.layoutRevision,
        owner_id: ids.owner,
        owner_epoch: 1,
        document_id: ids.baseDocument,
        layout_revision: 1,
        base_layout_revision: null,
        template_key: "cn_classic_single_column",
        section_order: JSON.stringify(["section-1"]),
        settings: JSON.stringify({}),
        content_hash: "e".repeat(64),
      })
      .execute();
    await db
      .updateTable("profile.resume_documents")
      .set({
        current_layout_revision_id: ids.layoutRevision,
        updated_at: new Date(now.getTime() + 2_000),
      })
      .where("id", "=", ids.baseDocument)
      .execute();

    await expect(
      db
        .updateTable("profile.resume_document_revisions")
        .set({ content_hash: "c".repeat(64) })
        .where("id", "=", ids.firstV2Revision)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_PROFILE_REVISION");
    await expect(
      db
        .updateTable("profile.resume_layout_revisions")
        .set({ template_key: "cn_compact_technical" })
        .where("id", "=", ids.layoutRevision)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_PROFILE_REVISION");

    await db
      .insertInto("profile.resume_document_revisions")
      .values({
        id: ids.secondV2Revision,
        owner_id: ids.owner,
        owner_epoch: 1,
        resume_analysis_id: null,
        revision: 3,
        base_revision: 2,
        schema_version: "resume-document-v2",
        sections: JSON.stringify([{ id: "section-1", blocks: [{ id: "block-1" }] }]),
        content_hash: "d".repeat(64),
        confirmed_at: now,
        document_id: ids.baseDocument,
        document_revision: 2,
        base_document_revision_id: ids.firstV2Revision,
      })
      .execute();

    const current = await db
      .selectFrom("profile.resume_documents")
      .select(["current_content_revision_id", "current_layout_revision_id"])
      .where("id", "=", ids.baseDocument)
      .executeTakeFirstOrThrow();
    expect(current).toEqual({
      current_content_revision_id: ids.firstV2Revision,
      current_layout_revision_id: ids.layoutRevision,
    });
  });

  it("rejects invalid references, retention and template values", async () => {
    const now = new Date();
    await expect(
      db
        .insertInto("profile.resume_documents")
        .values({
          id: randomUUID(),
          owner_id: ids.owner,
          owner_epoch: 1,
          kind: "base",
          title: "Invalid base",
          case_id: ids.owner,
          published_job_id: null,
          published_job_version_id: null,
          requirement_set_id: null,
          base_document_id: null,
          base_document_revision_id: null,
          evidence_revision_id: null,
          current_content_revision_id: null,
          current_layout_revision_id: null,
          revision: 1,
          creation_idempotency_key: `invalid-${randomUUID()}`,
          creation_request_hash: "2".repeat(64),
          expires_at: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1_000),
          deleted_at: null,
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      db
        .insertInto("profile.resume_layout_revisions")
        .values({
          id: randomUUID(),
          owner_id: ids.owner,
          owner_epoch: 1,
          document_id: ids.baseDocument,
          layout_revision: 9,
          base_layout_revision: 1,
          template_key: "not-a-template",
          section_order: JSON.stringify([]),
          settings: JSON.stringify({}),
          content_hash: "3".repeat(64),
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("exposes the new tables only to the intended runtime roles", async () => {
    const privileges = await sql<{
      webCanRead: boolean;
      matchCanDelete: boolean;
      collectorCanRead: boolean;
    }>`
      SELECT
        has_table_privilege('aijob_web_api', 'profile.resume_documents', 'SELECT') AS "webCanRead",
        has_table_privilege('aijob_match_worker', 'profile.resume_documents', 'DELETE') AS "matchCanDelete",
        has_table_privilege('aijob_collector_worker', 'profile.resume_documents', 'SELECT') AS "collectorCanRead"
    `.execute(db);
    expect(privileges.rows[0]).toEqual({
      webCanRead: true,
      matchCanDelete: true,
      collectorCanRead: false,
    });
  });
});
