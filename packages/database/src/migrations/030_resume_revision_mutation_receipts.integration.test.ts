import { randomUUID } from "node:crypto";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../index.js";
import { migrateToForTesting } from "../migrate.js";

const databaseUrl = process.env.AIJob_TEST_DATABASE_URL ?? process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("resume revision mutation receipt migration", () => {
  const ids = {
    owner: randomUUID(),
    legacyRevision: randomUUID(),
    firstDocument: randomUUID(),
    secondDocument: randomUUID(),
    contentRevision: randomUUID(),
    layoutRevision: randomUUID(),
    section: randomUUID(),
    block: randomUUID(),
  };
  const databaseName = `aijob_test_phase2b4b_${randomUUID().replaceAll("-", "")}`;
  let adminDb: Kysely<Database>;
  let db: Kysely<Database>;

  beforeAll(async () => {
    const adminUrl = new URL(databaseUrl as string);
    adminDb = createDatabase(adminUrl.toString());
    await sql.raw(`CREATE DATABASE "${databaseName}"`).execute(adminDb);
    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${databaseName}`;
    db = createDatabase(testUrl.toString());
    await migrateToForTesting(db, "030_resume_revision_mutation_receipts");

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
        sections: JSON.stringify([
          {
            id: ids.section,
            ordinal: 0,
            title: "Synthetic legacy section",
            blocks: [{ id: ids.block, ordinal: 0, text: "Synthetic legacy block" }],
          },
        ]),
        content_hash: "a".repeat(64),
        confirmed_at: now,
      })
      .execute();
    await db
      .insertInto("profile.resume_documents")
      .values(
        [ids.firstDocument, ids.secondDocument].map((documentId, index) => ({
          id: documentId,
          owner_id: ids.owner,
          owner_epoch: 1,
          kind: "base",
          title: `Synthetic base ${index + 1}`,
          case_id: null,
          detached_from_case_id: null,
          job_context_kind: null,
          published_job_id: null,
          published_job_version_id: null,
          requirement_set_id: null,
          private_job_snapshot_id: null,
          job_context_revision: null,
          base_document_id: null,
          base_document_revision_id: null,
          evidence_revision_id: null,
          current_content_revision_id: null,
          current_layout_revision_id: null,
          revision: 1,
          creation_idempotency_key: `receipt-document-${documentId}`,
          creation_request_hash: `${index + 1}`.repeat(64),
          expires_at: null,
          deleted_at: null,
        })),
      )
      .execute();
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    if (adminDb) {
      await sql.raw(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).execute(adminDb);
      await adminDb.destroy();
    }
  }, 120_000);

  it("keeps old rows unchanged and records additive receipt columns", async () => {
    const migration = await sql<{ name: string }>`
      SELECT name FROM kysely_migration ORDER BY timestamp DESC LIMIT 1
    `.execute(db);
    expect(migration.rows[0]?.name).toBe("030_resume_revision_mutation_receipts");

    const legacy = await db
      .selectFrom("profile.resume_document_revisions")
      .select([
        "legacy_source_revision_id",
        "mutation_idempotency_key",
        "mutation_request_hash",
        "result_document_revision",
      ])
      .where("id", "=", ids.legacyRevision)
      .executeTakeFirstOrThrow();
    expect(legacy).toEqual({
      legacy_source_revision_id: null,
      mutation_idempotency_key: null,
      mutation_request_hash: null,
      result_document_revision: null,
    });
  });

  it("persists immutable content/layout outcomes and prevents duplicate legacy truth", async () => {
    const now = new Date();
    const semanticSections = JSON.stringify([
      {
        id: ids.section,
        ordinal: 0,
        title: "Synthetic semantic section",
        blocks: [
          {
            id: ids.block,
            ordinal: 0,
            text: "Synthetic semantic block",
            evidenceIds: [],
          },
        ],
      },
    ]);
    await db
      .insertInto("profile.resume_document_revisions")
      .values({
        id: ids.contentRevision,
        owner_id: ids.owner,
        owner_epoch: 1,
        resume_analysis_id: null,
        revision: 2,
        base_revision: 1,
        schema_version: "resume-content-v1",
        sections: semanticSections,
        content_hash: "b".repeat(64),
        confirmed_at: now,
        document_id: ids.firstDocument,
        document_revision: 1,
        base_document_revision_id: null,
        legacy_source_revision_id: ids.legacyRevision,
        mutation_idempotency_key: "content-request-1",
        mutation_request_hash: "c".repeat(64),
        result_document_revision: 2,
      })
      .execute();
    await db
      .insertInto("profile.resume_layout_revisions")
      .values({
        id: ids.layoutRevision,
        owner_id: ids.owner,
        owner_epoch: 1,
        document_id: ids.firstDocument,
        layout_revision: 1,
        base_layout_revision: null,
        schema_version: "resume-layout-v2",
        template_key: "cn_classic_single_column",
        section_order: JSON.stringify([ids.section]),
        settings: JSON.stringify({
          schemaVersion: "resume-layout-settings-v1",
          fontSizeToken: "standard",
          lineSpacingToken: "standard",
          sectionSpacingToken: "standard",
          colorToken: "charcoal",
          pageBreakPolicy: "keep_sections",
        }),
        content_hash: "d".repeat(64),
        mutation_idempotency_key: "layout-request-1",
        mutation_request_hash: "e".repeat(64),
        result_document_revision: 3,
      })
      .execute();

    await expect(
      db
        .insertInto("profile.resume_document_revisions")
        .values({
          id: randomUUID(),
          owner_id: ids.owner,
          owner_epoch: 1,
          resume_analysis_id: null,
          revision: 3,
          base_revision: 2,
          schema_version: "resume-content-v1",
          sections: semanticSections,
          content_hash: "f".repeat(64),
          confirmed_at: now,
          document_id: ids.secondDocument,
          document_revision: 1,
          base_document_revision_id: null,
          legacy_source_revision_id: ids.legacyRevision,
          mutation_idempotency_key: "content-request-2",
          mutation_request_hash: "1".repeat(64),
          result_document_revision: 2,
        })
        .execute(),
    ).rejects.toThrow("resume_document_revisions_legacy_source_unique");

    await expect(
      db
        .updateTable("profile.resume_document_revisions")
        .set({ mutation_request_hash: "2".repeat(64) })
        .where("id", "=", ids.contentRevision)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_PROFILE_REVISION");
    await expect(
      db
        .updateTable("profile.resume_layout_revisions")
        .set({ mutation_request_hash: "3".repeat(64) })
        .where("id", "=", ids.layoutRevision)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_PROFILE_REVISION");
  });

  it("rejects partial or legacy mutation receipts", async () => {
    const now = new Date();
    await expect(
      db
        .insertInto("profile.resume_layout_revisions")
        .values({
          id: randomUUID(),
          owner_id: ids.owner,
          owner_epoch: 1,
          document_id: ids.secondDocument,
          layout_revision: 1,
          base_layout_revision: null,
          schema_version: "resume-layout-v2",
          template_key: "cn_classic_single_column",
          section_order: JSON.stringify([ids.section]),
          settings: JSON.stringify({
            schemaVersion: "resume-layout-settings-v1",
            fontSizeToken: "standard",
            lineSpacingToken: "standard",
            sectionSpacingToken: "standard",
            colorToken: "charcoal",
            pageBreakPolicy: "keep_sections",
          }),
          content_hash: "4".repeat(64),
          mutation_idempotency_key: "partial-layout-receipt",
          mutation_request_hash: null,
          result_document_revision: null,
        })
        .execute(),
    ).rejects.toThrow("resume_layout_revisions_mutation_receipt_pair");

    await expect(
      db
        .insertInto("profile.resume_document_revisions")
        .values({
          id: randomUUID(),
          owner_id: ids.owner,
          owner_epoch: 1,
          resume_analysis_id: null,
          revision: 3,
          base_revision: 2,
          schema_version: "resume-document-v1",
          sections: JSON.stringify([]),
          content_hash: "5".repeat(64),
          confirmed_at: now,
          mutation_idempotency_key: "legacy-write-receipt",
          mutation_request_hash: "6".repeat(64),
          result_document_revision: 1,
        })
        .execute(),
    ).rejects.toThrow("resume_document_revisions_mutation_receipt_pair");

    await expect(
      db
        .insertInto("profile.resume_document_revisions")
        .values({
          id: randomUUID(),
          owner_id: ids.owner,
          owner_epoch: 1,
          resume_analysis_id: null,
          revision: 3,
          base_revision: null,
          schema_version: "resume-content-v1",
          sections: JSON.stringify([
            {
              id: ids.section,
              ordinal: 0,
              title: "Synthetic semantic section",
              blocks: [
                {
                  id: ids.block,
                  ordinal: 0,
                  text: "Synthetic semantic block",
                  evidenceIds: [],
                },
              ],
            },
          ]),
          content_hash: "7".repeat(64),
          confirmed_at: now,
          document_id: ids.secondDocument,
          document_revision: 1,
          base_document_revision_id: null,
          legacy_source_revision_id: ids.contentRevision,
          mutation_idempotency_key: "invalid-legacy-source",
          mutation_request_hash: "8".repeat(64),
          result_document_revision: 2,
        })
        .execute(),
    ).rejects.toThrow("INVALID_LEGACY_RESUME_SOURCE");
  });
});
