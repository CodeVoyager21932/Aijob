import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

export const resumeDocumentV2ExpandMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE profile.resume_document_revisions
        ADD COLUMN document_id uuid,
        ADD COLUMN document_revision integer,
        ADD COLUMN base_document_revision_id uuid;

      ALTER TABLE profile.resume_document_revisions
        DROP CONSTRAINT resume_document_revisions_schema_version;

      CREATE TABLE profile.resume_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        kind text NOT NULL CHECK (kind IN ('base', 'case_derived')),
        title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
        case_id uuid,
        published_job_id uuid,
        published_job_version_id uuid,
        requirement_set_id uuid,
        base_document_id uuid,
        base_document_revision_id uuid,
        evidence_revision_id uuid,
        current_content_revision_id uuid,
        current_layout_revision_id uuid,
        revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
        creation_idempotency_key text NOT NULL CHECK (
          char_length(btrim(creation_idempotency_key)) BETWEEN 1 AND 200
        ),
        creation_request_hash text NOT NULL CHECK (creation_request_hash ~ '^[a-f0-9]{64}$'),
        expires_at timestamptz NOT NULL,
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT resume_documents_owner_id_unique UNIQUE (owner_id, id),
        CONSTRAINT resume_documents_owner_idempotency_unique
          UNIQUE (owner_id, creation_idempotency_key),
        CONSTRAINT resume_documents_reference_pair CHECK (
          (
            kind = 'base'
            AND num_nulls(
              case_id,
              published_job_id,
              published_job_version_id,
              requirement_set_id,
              base_document_id,
              base_document_revision_id,
              evidence_revision_id
            ) = 7
          )
          OR
          (
            kind = 'case_derived'
            AND num_nulls(
              case_id,
              published_job_id,
              published_job_version_id,
              requirement_set_id,
              base_document_id,
              base_document_revision_id,
              evidence_revision_id
            ) = 0
          )
        ),
        CONSTRAINT resume_documents_expiry_after_creation CHECK (expires_at > created_at),
        CONSTRAINT resume_documents_retention_limit CHECK (
          expires_at <= created_at + interval '30 days'
        ),
        CONSTRAINT resume_documents_delete_after_creation CHECK (
          deleted_at IS NULL OR deleted_at >= created_at
        ),
        CONSTRAINT resume_documents_update_after_creation CHECK (updated_at >= created_at)
      );

      CREATE UNIQUE INDEX resume_documents_one_active_case_derived_idx
        ON profile.resume_documents(owner_id, case_id)
        WHERE kind = 'case_derived' AND deleted_at IS NULL;
      CREATE INDEX resume_documents_owner_updated_idx
        ON profile.resume_documents(owner_id, updated_at DESC, id DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX resume_documents_expiry_idx
        ON profile.resume_documents(expires_at, id)
        WHERE deleted_at IS NULL;
      CREATE INDEX resume_documents_case_idx
        ON profile.resume_documents(owner_id, case_id)
        WHERE case_id IS NOT NULL;
      CREATE INDEX resume_documents_job_version_idx
        ON profile.resume_documents(published_job_id, published_job_version_id)
        WHERE published_job_id IS NOT NULL;
      CREATE INDEX resume_documents_requirement_set_idx
        ON profile.resume_documents(published_job_version_id, requirement_set_id)
        WHERE requirement_set_id IS NOT NULL;
      CREATE INDEX resume_documents_base_reference_idx
        ON profile.resume_documents(owner_id, base_document_id, base_document_revision_id)
        WHERE base_document_revision_id IS NOT NULL;
      CREATE INDEX resume_documents_base_revision_idx
        ON profile.resume_documents(owner_id, base_document_revision_id)
        WHERE base_document_revision_id IS NOT NULL;
      CREATE INDEX resume_documents_evidence_revision_idx
        ON profile.resume_documents(owner_id, evidence_revision_id)
        WHERE evidence_revision_id IS NOT NULL;
      CREATE INDEX resume_documents_current_content_idx
        ON profile.resume_documents(owner_id, id, current_content_revision_id)
        WHERE current_content_revision_id IS NOT NULL;
      CREATE INDEX resume_documents_current_layout_idx
        ON profile.resume_documents(owner_id, id, current_layout_revision_id)
        WHERE current_layout_revision_id IS NOT NULL;

      CREATE TABLE profile.resume_layout_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        document_id uuid NOT NULL,
        layout_revision integer NOT NULL CHECK (layout_revision > 0),
        base_layout_revision integer,
        schema_version text NOT NULL DEFAULT 'resume-layout-v1'
          CHECK (schema_version = 'resume-layout-v1'),
        template_key text NOT NULL CHECK (
          template_key IN ('cn_classic_single_column', 'cn_compact_technical')
        ),
        section_order jsonb NOT NULL CHECK (jsonb_typeof(section_order) = 'array'),
        settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
        content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT resume_layout_revisions_owner_id_unique UNIQUE (owner_id, id),
        CONSTRAINT resume_layout_revisions_owner_document_id_unique
          UNIQUE (owner_id, document_id, id),
        CONSTRAINT resume_layout_revisions_document_revision_unique
          UNIQUE (owner_id, document_id, layout_revision),
        CONSTRAINT resume_layout_revisions_base_revision_consistent CHECK (
          (layout_revision = 1 AND base_layout_revision IS NULL)
          OR (
            layout_revision > 1
            AND base_layout_revision IS NOT NULL
            AND base_layout_revision < layout_revision
          )
        ),
        CONSTRAINT resume_layout_revisions_base_revision_fk
          FOREIGN KEY (owner_id, document_id, base_layout_revision)
          REFERENCES profile.resume_layout_revisions(owner_id, document_id, layout_revision),
        CONSTRAINT resume_layout_revisions_owner_document_fk
          FOREIGN KEY (owner_id, document_id)
          REFERENCES profile.resume_documents(owner_id, id)
          ON DELETE CASCADE
      );

      CREATE INDEX resume_layout_revisions_owner_document_idx
        ON profile.resume_layout_revisions(owner_id, document_id, layout_revision DESC);
      CREATE INDEX resume_layout_revisions_base_revision_idx
        ON profile.resume_layout_revisions(owner_id, document_id, base_layout_revision)
        WHERE base_layout_revision IS NOT NULL;

      ALTER TABLE profile.resume_document_revisions
        ADD CONSTRAINT resume_document_revisions_schema_version
          CHECK (
            (
              schema_version = 'resume-document-v1'
              AND document_id IS NULL
              AND document_revision IS NULL
              AND base_document_revision_id IS NULL
            )
            OR
            (
              schema_version = 'resume-document-v2'
              AND document_id IS NOT NULL
              AND document_revision IS NOT NULL
              AND document_revision > 0
            )
          ),
        ADD CONSTRAINT resume_document_revisions_document_id_unique
          UNIQUE (owner_id, document_id, id),
        ADD CONSTRAINT resume_document_revisions_document_revision_unique
          UNIQUE (owner_id, document_id, document_revision),
        ADD CONSTRAINT resume_document_revisions_document_fk
          FOREIGN KEY (owner_id, document_id)
          REFERENCES profile.resume_documents(owner_id, id)
          ON DELETE CASCADE,
        ADD CONSTRAINT resume_document_revisions_base_document_fk
          FOREIGN KEY (owner_id, document_id, base_document_revision_id)
          REFERENCES profile.resume_document_revisions(owner_id, document_id, id),
        ADD CONSTRAINT resume_document_revisions_base_revision_consistent
          CHECK (
            (
              schema_version = 'resume-document-v1'
              AND base_document_revision_id IS NULL
            )
            OR
            (
              schema_version = 'resume-document-v2'
              AND (
                (document_revision = 1 AND base_document_revision_id IS NULL)
                OR (document_revision > 1 AND base_document_revision_id IS NOT NULL)
              )
            )
          );

      CREATE INDEX resume_document_revisions_base_document_idx
        ON profile.resume_document_revisions(owner_id, document_id, base_document_revision_id)
        WHERE base_document_revision_id IS NOT NULL;

      ALTER TABLE profile.resume_documents
        ADD CONSTRAINT resume_documents_case_fk
          FOREIGN KEY (owner_id, case_id)
          REFERENCES application.application_cases(owner_id, id),
        ADD CONSTRAINT resume_documents_job_version_fk
          FOREIGN KEY (published_job_id, published_job_version_id)
          REFERENCES catalog.published_job_versions(published_job_id, id),
        ADD CONSTRAINT resume_documents_requirement_set_fk
          FOREIGN KEY (published_job_version_id, requirement_set_id)
          REFERENCES catalog.job_requirement_sets(published_job_version_id, id),
        ADD CONSTRAINT resume_documents_base_revision_fk
          FOREIGN KEY (owner_id, base_document_id, base_document_revision_id)
          REFERENCES profile.resume_document_revisions(owner_id, document_id, id),
        ADD CONSTRAINT resume_documents_evidence_revision_fk
          FOREIGN KEY (owner_id, evidence_revision_id)
          REFERENCES profile.resume_evidence_revisions(owner_id, id),
        ADD CONSTRAINT resume_documents_current_content_fk
          FOREIGN KEY (owner_id, id, current_content_revision_id)
          REFERENCES profile.resume_document_revisions(owner_id, document_id, id),
        ADD CONSTRAINT resume_documents_current_layout_fk
          FOREIGN KEY (owner_id, id, current_layout_revision_id)
          REFERENCES profile.resume_layout_revisions(owner_id, document_id, id);

      ALTER TABLE profile.resume_documents
        ADD CONSTRAINT resume_documents_derived_case_job_consistency
          CHECK (
            kind = 'base'
            OR (
              kind = 'case_derived'
              AND case_id IS NOT NULL
              AND published_job_id IS NOT NULL
              AND published_job_version_id IS NOT NULL
              AND requirement_set_id IS NOT NULL
              AND base_document_id IS NOT NULL
              AND base_document_revision_id IS NOT NULL
              AND evidence_revision_id IS NOT NULL
            )
          );

      CREATE FUNCTION profile.validate_resume_document_references()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        base_kind text;
        case_job_id uuid;
        case_job_version_id uuid;
        case_requirement_set_id uuid;
      BEGIN
        IF TG_OP = 'UPDATE' AND (
          OLD.kind IS DISTINCT FROM NEW.kind
          OR OLD.case_id IS DISTINCT FROM NEW.case_id
          OR OLD.published_job_id IS DISTINCT FROM NEW.published_job_id
          OR OLD.published_job_version_id IS DISTINCT FROM NEW.published_job_version_id
          OR OLD.requirement_set_id IS DISTINCT FROM NEW.requirement_set_id
          OR OLD.base_document_id IS DISTINCT FROM NEW.base_document_id
          OR OLD.base_document_revision_id IS DISTINCT FROM NEW.base_document_revision_id
          OR OLD.evidence_revision_id IS DISTINCT FROM NEW.evidence_revision_id
        ) THEN
          RAISE EXCEPTION 'IMMUTABLE_RESUME_DOCUMENT_REFERENCES';
        END IF;

        IF NEW.kind = 'case_derived' THEN
          SELECT kind INTO base_kind
          FROM profile.resume_documents
          WHERE owner_id = NEW.owner_id AND id = NEW.base_document_id;
          IF base_kind IS DISTINCT FROM 'base' THEN
            RAISE EXCEPTION 'RESUME_BASE_DOCUMENT_REQUIRED';
          END IF;

          SELECT published_job_id, published_job_version_id, requirement_set_id
          INTO case_job_id, case_job_version_id, case_requirement_set_id
          FROM application.application_cases
          WHERE owner_id = NEW.owner_id AND id = NEW.case_id AND deleted_at IS NULL;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'RESUME_CASE_NOT_FOUND';
          END IF;
          IF NEW.published_job_id IS DISTINCT FROM case_job_id
            OR NEW.published_job_version_id IS DISTINCT FROM case_job_version_id
            OR NEW.requirement_set_id IS DISTINCT FROM case_requirement_set_id THEN
            RAISE EXCEPTION 'RESUME_CASE_REFERENCE_MISMATCH';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER resume_documents_reference_guard
        BEFORE INSERT OR UPDATE ON profile.resume_documents
        FOR EACH ROW EXECUTE FUNCTION profile.validate_resume_document_references();

      CREATE TRIGGER resume_layout_revisions_no_update
        BEFORE UPDATE ON profile.resume_layout_revisions
        FOR EACH ROW EXECUTE FUNCTION profile.prevent_revision_update();

      REVOKE ALL ON TABLE profile.resume_documents, profile.resume_layout_revisions
        FROM PUBLIC, aijob_collector_worker;
      REVOKE ALL ON SCHEMA profile FROM aijob_collector_worker;

      GRANT SELECT, INSERT, UPDATE, DELETE
        ON TABLE profile.resume_documents
        TO aijob_web_api;
      GRANT SELECT, INSERT
        ON TABLE profile.resume_document_revisions, profile.resume_layout_revisions
        TO aijob_web_api;

      GRANT SELECT, DELETE
        ON TABLE profile.resume_documents,
          profile.resume_document_revisions,
          profile.resume_layout_revisions
        TO aijob_match_worker;

      GRANT ALL PRIVILEGES
        ON TABLE profile.resume_documents,
          profile.resume_document_revisions,
          profile.resume_layout_revisions
        TO aijob_ops_cli, aijob_migrator;
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Forward-only expand migration: never destroy immutable personal history.
  },
};
