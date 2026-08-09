import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";

import type { Database } from "../types.js";

export const resumeRevisionMutationReceiptsMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE profile.resume_document_revisions
        ADD COLUMN legacy_source_revision_id uuid,
        ADD COLUMN mutation_idempotency_key text,
        ADD COLUMN mutation_request_hash text,
        ADD COLUMN result_document_revision integer,
        ADD CONSTRAINT resume_document_revisions_mutation_receipt_pair CHECK (
          (
            mutation_idempotency_key IS NULL
            AND mutation_request_hash IS NULL
            AND result_document_revision IS NULL
          )
          OR (
            schema_version = 'resume-content-v1'
            AND mutation_idempotency_key IS NOT NULL
            AND mutation_request_hash IS NOT NULL
            AND result_document_revision IS NOT NULL
            AND char_length(btrim(mutation_idempotency_key)) BETWEEN 1 AND 200
            AND mutation_request_hash ~ '^[a-f0-9]{64}$'
            AND result_document_revision > 0
          )
        ),
        ADD CONSTRAINT resume_document_revisions_legacy_source_first_only CHECK (
          legacy_source_revision_id IS NULL
          OR (
            schema_version = 'resume-content-v1'
            AND document_revision = 1
            AND base_document_revision_id IS NULL
          )
        ),
        ADD CONSTRAINT resume_document_revisions_legacy_source_fk
          FOREIGN KEY (owner_id, legacy_source_revision_id)
          REFERENCES profile.resume_document_revisions(owner_id, id);

      CREATE UNIQUE INDEX resume_document_revisions_mutation_key_unique
        ON profile.resume_document_revisions(
          owner_id,
          document_id,
          mutation_idempotency_key
        )
        WHERE mutation_idempotency_key IS NOT NULL;

      CREATE UNIQUE INDEX resume_document_revisions_legacy_source_unique
        ON profile.resume_document_revisions(owner_id, legacy_source_revision_id)
        WHERE legacy_source_revision_id IS NOT NULL;

      CREATE FUNCTION profile.enforce_resume_revision_legacy_source()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.legacy_source_revision_id IS NOT NULL AND NOT EXISTS (
          SELECT 1
          FROM profile.resume_document_revisions AS legacy
          WHERE legacy.owner_id = NEW.owner_id
            AND legacy.owner_epoch = NEW.owner_epoch
            AND legacy.id = NEW.legacy_source_revision_id
            AND legacy.schema_version = 'resume-document-v1'
            AND legacy.document_id IS NULL
        ) THEN
          RAISE EXCEPTION 'INVALID_LEGACY_RESUME_SOURCE';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER resume_document_revisions_legacy_source_guard
        BEFORE INSERT ON profile.resume_document_revisions
        FOR EACH ROW EXECUTE FUNCTION profile.enforce_resume_revision_legacy_source();

      ALTER TABLE profile.resume_layout_revisions
        ADD COLUMN mutation_idempotency_key text,
        ADD COLUMN mutation_request_hash text,
        ADD COLUMN result_document_revision integer,
        ADD CONSTRAINT resume_layout_revisions_mutation_receipt_pair CHECK (
          (
            mutation_idempotency_key IS NULL
            AND mutation_request_hash IS NULL
            AND result_document_revision IS NULL
          )
          OR (
            schema_version = 'resume-layout-v2'
            AND mutation_idempotency_key IS NOT NULL
            AND mutation_request_hash IS NOT NULL
            AND result_document_revision IS NOT NULL
            AND char_length(btrim(mutation_idempotency_key)) BETWEEN 1 AND 200
            AND mutation_request_hash ~ '^[a-f0-9]{64}$'
            AND result_document_revision > 0
          )
        );

      CREATE UNIQUE INDEX resume_layout_revisions_mutation_key_unique
        ON profile.resume_layout_revisions(
          owner_id,
          document_id,
          mutation_idempotency_key
        )
        WHERE mutation_idempotency_key IS NOT NULL;
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Forward-only expand: immutable resume history and idempotency receipts must remain readable.
  },
};
