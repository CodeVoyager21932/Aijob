import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "../types.js";

export async function applyResumeDocumentReviewForwardContract(
  db: Kysely<Database>,
): Promise<void> {
  await sql`
    ALTER TABLE profile.resume_documents
      ADD COLUMN job_context_kind text CHECK (job_context_kind IN ('public', 'private')),
      ADD COLUMN private_job_snapshot_id uuid,
      ADD COLUMN job_context_revision integer CHECK (job_context_revision > 0),
      ADD COLUMN detached_from_case_id uuid;

    UPDATE profile.resume_documents
    SET job_context_kind = 'public', job_context_revision = 1
    WHERE kind = 'case_derived';

    ALTER TABLE profile.resume_documents
      ALTER COLUMN expires_at DROP NOT NULL,
      DROP CONSTRAINT resume_documents_expiry_after_creation,
      DROP CONSTRAINT resume_documents_retention_limit,
      DROP CONSTRAINT resume_documents_reference_pair,
      DROP CONSTRAINT resume_documents_derived_case_job_consistency;

    DROP INDEX profile.resume_documents_expiry_idx;

    ALTER TABLE profile.resume_documents
      ADD CONSTRAINT resume_documents_forward_reference_pair CHECK (
        (
          kind = 'base'
          AND num_nulls(
            case_id,
            published_job_id,
            published_job_version_id,
            requirement_set_id,
            private_job_snapshot_id,
            job_context_kind,
            job_context_revision,
            detached_from_case_id,
            base_document_id,
            base_document_revision_id,
            evidence_revision_id
          ) = 11
        )
        OR
        (
          kind = 'case_derived'
          AND job_context_kind = 'public'
          AND num_nulls(case_id, detached_from_case_id) = 1
          AND published_job_id IS NOT NULL
          AND published_job_version_id IS NOT NULL
          AND requirement_set_id IS NOT NULL
          AND private_job_snapshot_id IS NULL
          AND job_context_revision IS NOT NULL
          AND base_document_id IS NOT NULL
          AND base_document_revision_id IS NOT NULL
          AND evidence_revision_id IS NOT NULL
        )
        OR
        (
          kind = 'case_derived'
          AND job_context_kind = 'private'
          AND num_nulls(case_id, detached_from_case_id) = 1
          AND published_job_id IS NULL
          AND published_job_version_id IS NULL
          AND requirement_set_id IS NULL
          AND private_job_snapshot_id IS NOT NULL
          AND job_context_revision IS NOT NULL
          AND base_document_id IS NOT NULL
          AND base_document_revision_id IS NOT NULL
          AND evidence_revision_id IS NOT NULL
        )
      ),
      ADD CONSTRAINT resume_documents_private_snapshot_revision_fk
        FOREIGN KEY (owner_id, private_job_snapshot_id, job_context_revision)
        REFERENCES application.private_job_snapshot_revisions(
          owner_id,
          snapshot_id,
          content_revision
        );

    CREATE INDEX resume_documents_private_snapshot_idx
      ON profile.resume_documents(owner_id, private_job_snapshot_id, job_context_revision)
      WHERE private_job_snapshot_id IS NOT NULL;
    CREATE INDEX resume_documents_detached_case_idx
      ON profile.resume_documents(owner_id, detached_from_case_id)
      WHERE detached_from_case_id IS NOT NULL;
    CREATE INDEX resume_documents_legacy_expiry_idx
      ON profile.resume_documents(expires_at, id)
      WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

    CREATE OR REPLACE FUNCTION profile.validate_resume_document_references()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      base_kind text;
      case_context_kind text;
      case_job_id uuid;
      case_job_version_id uuid;
      case_requirement_set_id uuid;
      case_private_snapshot_id uuid;
      case_context_revision integer;
    BEGIN
      IF TG_OP = 'UPDATE' AND (
        OLD.kind IS DISTINCT FROM NEW.kind
        OR (
          (
            OLD.case_id IS DISTINCT FROM NEW.case_id
            OR OLD.detached_from_case_id IS DISTINCT FROM NEW.detached_from_case_id
          )
          AND NOT (
            OLD.case_id IS NOT NULL
            AND OLD.detached_from_case_id IS NULL
            AND NEW.case_id IS NULL
            AND NEW.detached_from_case_id = OLD.case_id
          )
        )
        OR OLD.published_job_id IS DISTINCT FROM NEW.published_job_id
        OR OLD.published_job_version_id IS DISTINCT FROM NEW.published_job_version_id
        OR OLD.requirement_set_id IS DISTINCT FROM NEW.requirement_set_id
        OR OLD.private_job_snapshot_id IS DISTINCT FROM NEW.private_job_snapshot_id
        OR OLD.job_context_kind IS DISTINCT FROM NEW.job_context_kind
        OR OLD.job_context_revision IS DISTINCT FROM NEW.job_context_revision
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

        IF NEW.case_id IS NULL THEN
          RETURN NEW;
        END IF;

        SELECT
          job_context_kind,
          published_job_id,
          published_job_version_id,
          requirement_set_id,
          private_job_snapshot_id,
          job_context_revision
        INTO
          case_context_kind,
          case_job_id,
          case_job_version_id,
          case_requirement_set_id,
          case_private_snapshot_id,
          case_context_revision
        FROM application.application_cases
        WHERE owner_id = NEW.owner_id AND id = NEW.case_id AND deleted_at IS NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'RESUME_CASE_NOT_FOUND';
        END IF;

        IF NEW.job_context_kind IS DISTINCT FROM case_context_kind
          OR NEW.job_context_revision IS DISTINCT FROM case_context_revision
          OR NEW.published_job_id IS DISTINCT FROM case_job_id
          OR NEW.published_job_version_id IS DISTINCT FROM case_job_version_id
          OR NEW.requirement_set_id IS DISTINCT FROM case_requirement_set_id
          OR NEW.private_job_snapshot_id IS DISTINCT FROM case_private_snapshot_id THEN
          RAISE EXCEPTION 'RESUME_CASE_REFERENCE_MISMATCH';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE FUNCTION profile.is_unique_string_array(
      payload jsonb,
      maximum_items integer,
      require_uuid boolean
    )
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT CASE
        WHEN jsonb_typeof(payload) <> 'array' THEN false
        WHEN jsonb_array_length(payload) > maximum_items THEN false
        ELSE
          NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(payload) AS entry(value)
            WHERE jsonb_typeof(entry.value) <> 'string'
              OR (
                require_uuid
                AND trim(both '"' from entry.value::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              )
          )
          AND (
            SELECT count(*) = count(DISTINCT entry.value)
            FROM jsonb_array_elements(payload) AS entry(value)
          )
      END
    $$;

    CREATE FUNCTION profile.is_valid_resume_semantic_sections(sections jsonb)
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT
        jsonb_typeof(sections) = 'array'
        AND jsonb_array_length(sections) BETWEEN 1 AND 100
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(sections) AS section(value)
          WHERE NOT application.jsonb_has_exact_keys(
            section.value,
            ARRAY['id', 'ordinal', 'title', 'blocks']
          )
            OR section.value ->> 'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            OR jsonb_typeof(section.value -> 'ordinal') <> 'number'
            OR (section.value ->> 'ordinal') !~ '^[0-9]+$'
            OR jsonb_typeof(section.value -> 'title') <> 'string'
            OR char_length(btrim(section.value ->> 'title')) NOT BETWEEN 1 AND 100
            OR jsonb_typeof(section.value -> 'blocks') <> 'array'
            OR jsonb_array_length(section.value -> 'blocks') NOT BETWEEN 1 AND 500
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(section.value -> 'blocks') AS block(value)
              WHERE NOT application.jsonb_has_exact_keys(
                block.value,
                ARRAY['id', 'ordinal', 'text', 'evidenceIds']
              )
                OR block.value ->> 'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                OR jsonb_typeof(block.value -> 'ordinal') <> 'number'
                OR (block.value ->> 'ordinal') !~ '^[0-9]+$'
                OR jsonb_typeof(block.value -> 'text') <> 'string'
                OR char_length(btrim(block.value ->> 'text')) NOT BETWEEN 1 AND 10000
                OR NOT profile.is_unique_string_array(block.value -> 'evidenceIds', 500, false)
            )
        )
        AND (
          SELECT count(*) = count(DISTINCT section.value ->> 'id')
          FROM jsonb_array_elements(sections) AS section(value)
        )
        AND (
          SELECT count(*) = count(DISTINCT section.value ->> 'ordinal')
          FROM jsonb_array_elements(sections) AS section(value)
        )
        AND (
          SELECT count(*) = count(DISTINCT block.value ->> 'id')
          FROM jsonb_array_elements(sections) AS section(value)
          JOIN LATERAL jsonb_array_elements(section.value -> 'blocks') AS block(value) ON true
        )
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(sections) AS section(value)
          WHERE (
            SELECT count(*) <> count(DISTINCT block.value ->> 'ordinal')
            FROM jsonb_array_elements(section.value -> 'blocks') AS block(value)
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(sections) AS section(value)
          JOIN LATERAL jsonb_array_elements(section.value -> 'blocks') AS block(value) ON true
          WHERE block.value ->> 'id' IN (
            SELECT other_section.value ->> 'id'
            FROM jsonb_array_elements(sections) AS other_section(value)
          )
        )
    $$;

    ALTER TABLE profile.resume_document_revisions
      DROP CONSTRAINT resume_document_revisions_schema_version,
      DROP CONSTRAINT resume_document_revisions_base_revision_consistent;

    ALTER TABLE profile.resume_document_revisions
      ADD CONSTRAINT resume_document_revisions_forward_schema_version CHECK (
        (
          schema_version = 'resume-document-v1'
          AND document_id IS NULL
          AND document_revision IS NULL
          AND base_document_revision_id IS NULL
        )
        OR
        (
          schema_version IN ('resume-document-v2', 'resume-content-v1')
          AND document_id IS NOT NULL
          AND document_revision IS NOT NULL
          AND document_revision > 0
        )
      ),
      ADD CONSTRAINT resume_document_revisions_forward_base_consistent CHECK (
        (
          schema_version = 'resume-document-v1'
          AND base_document_revision_id IS NULL
        )
        OR
        (
          schema_version IN ('resume-document-v2', 'resume-content-v1')
          AND (
            (document_revision = 1 AND base_document_revision_id IS NULL)
            OR (document_revision > 1 AND base_document_revision_id IS NOT NULL)
          )
        )
      ),
      ADD CONSTRAINT resume_document_revisions_semantic_content CHECK (
        schema_version <> 'resume-content-v1'
        OR profile.is_valid_resume_semantic_sections(sections)
      );

    CREATE FUNCTION profile.is_valid_resume_layout_v2(
      checked_section_order jsonb,
      checked_settings jsonb
    )
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT
        jsonb_typeof(checked_section_order) = 'array'
        AND profile.is_unique_string_array(checked_section_order, 100, true)
        AND application.jsonb_has_exact_keys(
          checked_settings,
          ARRAY[
            'schemaVersion',
            'fontSizeToken',
            'lineSpacingToken',
            'sectionSpacingToken',
            'colorToken',
            'pageBreakPolicy'
          ]
        )
        AND checked_settings ->> 'schemaVersion' = 'resume-layout-settings-v1'
        AND checked_settings ->> 'fontSizeToken' IN ('compact', 'standard', 'large')
        AND checked_settings ->> 'lineSpacingToken' IN ('tight', 'standard', 'relaxed')
        AND checked_settings ->> 'sectionSpacingToken' IN ('tight', 'standard', 'relaxed')
        AND checked_settings ->> 'colorToken' IN ('black', 'charcoal', 'navy')
        AND checked_settings ->> 'pageBreakPolicy' IN (
          'automatic',
          'keep_sections',
          'compact_to_fit'
        )
    $$;

    ALTER TABLE profile.resume_layout_revisions
      DROP CONSTRAINT resume_layout_revisions_schema_version_check;
    ALTER TABLE profile.resume_layout_revisions
      ADD CONSTRAINT resume_layout_revisions_forward_schema CHECK (
        schema_version IN ('resume-layout-v1', 'resume-layout-v2')
      ),
      ADD CONSTRAINT resume_layout_revisions_v2_strict CHECK (
        schema_version <> 'resume-layout-v2'
        OR profile.is_valid_resume_layout_v2(section_order, settings)
      );

    CREATE FUNCTION profile.enforce_new_resume_layout_schema()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.schema_version <> 'resume-layout-v2' THEN
        RAISE EXCEPTION 'LEGACY_RESUME_LAYOUT_READ_ONLY';
      END IF;
      IF NOT profile.is_valid_resume_layout_v2(NEW.section_order, NEW.settings) THEN
        RAISE EXCEPTION 'INVALID_RESUME_LAYOUT_SETTINGS';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER resume_layout_revisions_strict_insert
      BEFORE INSERT ON profile.resume_layout_revisions
      FOR EACH ROW EXECUTE FUNCTION profile.enforce_new_resume_layout_schema();

    CREATE TABLE profile.resume_review_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES identity.owners(id),
      owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
      case_id uuid,
      detached_from_case_id uuid,
      document_id uuid NOT NULL,
      content_revision_id uuid NOT NULL,
      job_context_kind text NOT NULL CHECK (job_context_kind IN ('public', 'private')),
      published_job_id uuid,
      published_job_version_id uuid,
      requirement_set_id uuid,
      private_job_snapshot_id uuid,
      job_context_revision integer NOT NULL CHECK (job_context_revision > 0),
      evidence_revision_id uuid NOT NULL,
      mode text NOT NULL CHECK (mode IN ('template', 'controlled_ai')),
      status text NOT NULL CHECK (
        status IN ('pending', 'completed', 'failed', 'superseded', 'deleted')
      ),
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      creation_idempotency_key text NOT NULL CHECK (
        char_length(btrim(creation_idempotency_key)) BETWEEN 1 AND 200
      ),
      creation_request_hash text NOT NULL CHECK (creation_request_hash ~ '^[a-f0-9]{64}$'),
      completed_at timestamptz,
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT resume_review_runs_owner_id_unique UNIQUE (owner_id, id),
      CONSTRAINT resume_review_runs_owner_document_id_unique UNIQUE (owner_id, id, document_id),
      CONSTRAINT resume_review_runs_owner_creation_key_unique
        UNIQUE (owner_id, creation_idempotency_key),
      CONSTRAINT resume_review_runs_case_reference_pair CHECK (
        num_nulls(case_id, detached_from_case_id) = 1
      ),
      CONSTRAINT resume_review_runs_owner_case_fk
        FOREIGN KEY (owner_id, case_id)
        REFERENCES application.application_cases(owner_id, id),
      CONSTRAINT resume_review_runs_owner_document_fk
        FOREIGN KEY (owner_id, document_id)
        REFERENCES profile.resume_documents(owner_id, id),
      CONSTRAINT resume_review_runs_owner_content_fk
        FOREIGN KEY (owner_id, document_id, content_revision_id)
        REFERENCES profile.resume_document_revisions(owner_id, document_id, id),
      CONSTRAINT resume_review_runs_owner_evidence_fk
        FOREIGN KEY (owner_id, evidence_revision_id)
        REFERENCES profile.resume_evidence_revisions(owner_id, id),
      CONSTRAINT resume_review_runs_public_job_fk
        FOREIGN KEY (published_job_id, published_job_version_id)
        REFERENCES catalog.published_job_versions(published_job_id, id),
      CONSTRAINT resume_review_runs_public_requirement_fk
        FOREIGN KEY (published_job_version_id, requirement_set_id)
        REFERENCES catalog.job_requirement_sets(published_job_version_id, id),
      CONSTRAINT resume_review_runs_private_snapshot_fk
        FOREIGN KEY (owner_id, private_job_snapshot_id, job_context_revision)
        REFERENCES application.private_job_snapshot_revisions(
          owner_id,
          snapshot_id,
          content_revision
        ),
      CONSTRAINT resume_review_runs_context_pair CHECK (
        (
          job_context_kind = 'public'
          AND published_job_id IS NOT NULL
          AND published_job_version_id IS NOT NULL
          AND requirement_set_id IS NOT NULL
          AND private_job_snapshot_id IS NULL
        )
        OR
        (
          job_context_kind = 'private'
          AND published_job_id IS NULL
          AND published_job_version_id IS NULL
          AND requirement_set_id IS NULL
          AND private_job_snapshot_id IS NOT NULL
        )
      ),
      CONSTRAINT resume_review_runs_status_time_consistent CHECK (
        (
          status IN ('completed', 'superseded')
          AND completed_at IS NOT NULL
          AND deleted_at IS NULL
        )
        OR
        (
          status IN ('pending', 'failed')
          AND completed_at IS NULL
          AND deleted_at IS NULL
        )
        OR
        (
          status = 'deleted'
          AND deleted_at IS NOT NULL
        )
      ),
      CONSTRAINT resume_review_runs_update_after_creation CHECK (updated_at >= created_at)
    );

    CREATE TABLE profile.resume_review_findings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL,
      owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
      review_run_id uuid NOT NULL,
      schema_version text NOT NULL DEFAULT 'resume-review-finding-v1' CHECK (
        schema_version = 'resume-review-finding-v1'
      ),
      category text NOT NULL CHECK (
        category IN (
          'content_relevance',
          'evidence_support',
          'expression_clarity',
          'structure_order',
          'ats_readability'
        )
      ),
      severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
      source_block_id uuid NOT NULL,
      evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
        profile.is_unique_string_array(evidence_ids, 500, false)
      ),
      reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z0-9_]{1,100}$'),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT resume_review_findings_owner_id_unique UNIQUE (owner_id, id),
      CONSTRAINT resume_review_findings_owner_run_id_unique UNIQUE (owner_id, review_run_id, id),
      CONSTRAINT resume_review_findings_owner_run_fk
        FOREIGN KEY (owner_id, review_run_id)
        REFERENCES profile.resume_review_runs(owner_id, id)
        ON DELETE CASCADE
    );

    CREATE TABLE profile.resume_review_suggestions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL,
      owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
      review_run_id uuid NOT NULL,
      finding_id uuid NOT NULL,
      schema_version text NOT NULL DEFAULT 'resume-review-suggestion-v1' CHECK (
        schema_version = 'resume-review-suggestion-v1'
      ),
      target_type text NOT NULL CHECK (target_type IN ('block', 'section')),
      target_ids jsonb NOT NULL CHECK (
        profile.is_unique_string_array(target_ids, 500, true)
        AND jsonb_array_length(target_ids) > 0
      ),
      change_type text NOT NULL CHECK (
        change_type IN (
          'rewrite_block',
          'remove_block',
          'split_block',
          'merge_blocks',
          'reorder_section',
          'add_confirmed_evidence'
        )
      ),
      suggested_text text CHECK (
        suggested_text IS NULL OR char_length(btrim(suggested_text)) BETWEEN 1 AND 10000
      ),
      evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
        profile.is_unique_string_array(evidence_ids, 500, false)
      ),
      decision text NOT NULL DEFAULT 'pending' CHECK (
        decision IN ('pending', 'accepted', 'edited', 'rejected')
      ),
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT resume_review_suggestions_owner_id_unique UNIQUE (owner_id, id),
      CONSTRAINT resume_review_suggestions_owner_run_id_unique
        UNIQUE (owner_id, review_run_id, id),
      CONSTRAINT resume_review_suggestions_owner_finding_fk
        FOREIGN KEY (owner_id, review_run_id, finding_id)
        REFERENCES profile.resume_review_findings(owner_id, review_run_id, id)
        ON DELETE CASCADE,
      CONSTRAINT resume_review_suggestions_change_consistent CHECK (
        (
          change_type = 'reorder_section'
          AND target_type = 'section'
          AND jsonb_array_length(target_ids) >= 2
          AND suggested_text IS NULL
        )
        OR
        (
          change_type = 'remove_block'
          AND target_type = 'block'
          AND jsonb_array_length(target_ids) = 1
          AND suggested_text IS NULL
        )
        OR
        (
          change_type IN (
            'rewrite_block',
            'split_block',
            'merge_blocks',
            'add_confirmed_evidence'
          )
          AND target_type = 'block'
          AND (
            (change_type = 'merge_blocks' AND jsonb_array_length(target_ids) >= 2)
            OR (change_type <> 'merge_blocks' AND jsonb_array_length(target_ids) = 1)
          )
          AND suggested_text IS NOT NULL
          AND jsonb_array_length(evidence_ids) > 0
        )
      ),
      CONSTRAINT resume_review_suggestions_update_after_creation CHECK (
        updated_at >= created_at
      )
    );

    CREATE TABLE profile.resume_review_decisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL,
      owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
      review_run_id uuid NOT NULL,
      suggestion_id uuid NOT NULL,
      document_id uuid NOT NULL,
      schema_version text NOT NULL DEFAULT 'resume-review-decision-v1' CHECK (
        schema_version = 'resume-review-decision-v1'
      ),
      based_on_suggestion_revision integer NOT NULL CHECK (based_on_suggestion_revision > 0),
      idempotency_key_hash text NOT NULL CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
      decision text NOT NULL CHECK (decision IN ('accepted', 'edited', 'rejected')),
      edited_text text CHECK (
        edited_text IS NULL OR char_length(btrim(edited_text)) BETWEEN 1 AND 10000
      ),
      result_content_revision_id uuid,
      reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z0-9_]{1,100}$'),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT resume_review_decisions_owner_id_unique UNIQUE (owner_id, id),
      CONSTRAINT resume_review_decisions_owner_idempotency_unique
        UNIQUE (owner_id, idempotency_key_hash),
      CONSTRAINT resume_review_decisions_owner_suggestion_fk
        FOREIGN KEY (owner_id, review_run_id, suggestion_id)
        REFERENCES profile.resume_review_suggestions(owner_id, review_run_id, id),
      CONSTRAINT resume_review_decisions_owner_run_document_fk
        FOREIGN KEY (owner_id, review_run_id, document_id)
        REFERENCES profile.resume_review_runs(owner_id, id, document_id),
      CONSTRAINT resume_review_decisions_result_content_fk
        FOREIGN KEY (owner_id, document_id, result_content_revision_id)
        REFERENCES profile.resume_document_revisions(owner_id, document_id, id),
      CONSTRAINT resume_review_decisions_state_consistent CHECK (
        (
          decision = 'accepted'
          AND edited_text IS NULL
          AND result_content_revision_id IS NOT NULL
          AND reason_code IS NULL
        )
        OR
        (
          decision = 'edited'
          AND edited_text IS NOT NULL
          AND result_content_revision_id IS NOT NULL
          AND reason_code IS NULL
        )
        OR
        (
          decision = 'rejected'
          AND edited_text IS NULL
          AND result_content_revision_id IS NULL
          AND reason_code IS NOT NULL
        )
      )
    );

    CREATE INDEX resume_review_runs_owner_updated_idx
      ON profile.resume_review_runs(owner_id, updated_at DESC, id DESC)
      WHERE deleted_at IS NULL;
    CREATE INDEX resume_review_runs_owner_case_idx
      ON profile.resume_review_runs(owner_id, case_id, created_at DESC);
    CREATE INDEX resume_review_runs_owner_detached_case_idx
      ON profile.resume_review_runs(owner_id, detached_from_case_id, created_at DESC)
      WHERE detached_from_case_id IS NOT NULL;
    CREATE INDEX resume_review_runs_owner_document_idx
      ON profile.resume_review_runs(owner_id, document_id, created_at DESC);
    CREATE INDEX resume_review_findings_owner_run_idx
      ON profile.resume_review_findings(owner_id, review_run_id, created_at, id);
    CREATE INDEX resume_review_suggestions_owner_run_idx
      ON profile.resume_review_suggestions(owner_id, review_run_id, created_at, id);
    CREATE INDEX resume_review_decisions_owner_run_idx
      ON profile.resume_review_decisions(owner_id, review_run_id, created_at, id);

    CREATE FUNCTION profile.validate_resume_review_run_references()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      case_context_kind text;
      case_job_id uuid;
      case_job_version_id uuid;
      case_requirement_set_id uuid;
      case_private_snapshot_id uuid;
      case_context_revision integer;
      document_case_id uuid;
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
          OR NEW.owner_epoch IS DISTINCT FROM OLD.owner_epoch
          OR NEW.document_id IS DISTINCT FROM OLD.document_id
          OR NEW.content_revision_id IS DISTINCT FROM OLD.content_revision_id
          OR NEW.job_context_kind IS DISTINCT FROM OLD.job_context_kind
          OR NEW.published_job_id IS DISTINCT FROM OLD.published_job_id
          OR NEW.published_job_version_id IS DISTINCT FROM OLD.published_job_version_id
          OR NEW.requirement_set_id IS DISTINCT FROM OLD.requirement_set_id
          OR NEW.private_job_snapshot_id IS DISTINCT FROM OLD.private_job_snapshot_id
          OR NEW.job_context_revision IS DISTINCT FROM OLD.job_context_revision
          OR NEW.evidence_revision_id IS DISTINCT FROM OLD.evidence_revision_id THEN
          RAISE EXCEPTION 'IMMUTABLE_REVIEW_RUN_REFERENCES';
        END IF;

        IF NEW.case_id IS DISTINCT FROM OLD.case_id
          OR NEW.detached_from_case_id IS DISTINCT FROM OLD.detached_from_case_id THEN
          IF NOT (
            OLD.case_id IS NOT NULL
            AND OLD.detached_from_case_id IS NULL
            AND NEW.case_id IS NULL
            AND NEW.detached_from_case_id = OLD.case_id
          ) THEN
            RAISE EXCEPTION 'INVALID_REVIEW_CASE_DETACHMENT';
          END IF;
        END IF;

        IF NEW.case_id IS NULL THEN
          RETURN NEW;
        END IF;
      END IF;

      SELECT
        job_context_kind,
        published_job_id,
        published_job_version_id,
        requirement_set_id,
        private_job_snapshot_id,
        job_context_revision
      INTO
        case_context_kind,
        case_job_id,
        case_job_version_id,
        case_requirement_set_id,
        case_private_snapshot_id,
        case_context_revision
      FROM application.application_cases
      WHERE owner_id = NEW.owner_id AND id = NEW.case_id AND deleted_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'REVIEW_CASE_NOT_FOUND';
      END IF;

      SELECT case_id INTO document_case_id
      FROM profile.resume_documents
      WHERE owner_id = NEW.owner_id
        AND id = NEW.document_id
        AND kind = 'case_derived'
        AND deleted_at IS NULL;
      IF NOT FOUND OR document_case_id IS DISTINCT FROM NEW.case_id THEN
        RAISE EXCEPTION 'REVIEW_CASE_DOCUMENT_MISMATCH';
      END IF;

      IF NEW.job_context_kind IS DISTINCT FROM case_context_kind
        OR NEW.job_context_revision IS DISTINCT FROM case_context_revision
        OR NEW.published_job_id IS DISTINCT FROM case_job_id
        OR NEW.published_job_version_id IS DISTINCT FROM case_job_version_id
        OR NEW.requirement_set_id IS DISTINCT FROM case_requirement_set_id
        OR NEW.private_job_snapshot_id IS DISTINCT FROM case_private_snapshot_id THEN
        RAISE EXCEPTION 'REVIEW_CASE_CONTEXT_MISMATCH';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER resume_review_runs_reference_guard
      BEFORE INSERT OR UPDATE ON profile.resume_review_runs
      FOR EACH ROW EXECUTE FUNCTION profile.validate_resume_review_run_references();

    CREATE TRIGGER resume_review_findings_no_update
      BEFORE UPDATE ON profile.resume_review_findings
      FOR EACH ROW EXECUTE FUNCTION profile.prevent_revision_update();
    CREATE TRIGGER resume_review_decisions_no_update
      BEFORE UPDATE ON profile.resume_review_decisions
      FOR EACH ROW EXECUTE FUNCTION profile.prevent_revision_update();

    REVOKE ALL ON TABLE
      profile.resume_review_runs,
      profile.resume_review_findings,
      profile.resume_review_suggestions,
      profile.resume_review_decisions
      FROM PUBLIC, aijob_collector_worker;

    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE profile.resume_review_runs, profile.resume_review_suggestions
      TO aijob_web_api;
    GRANT SELECT, INSERT, DELETE
      ON TABLE profile.resume_review_findings, profile.resume_review_decisions
      TO aijob_web_api;

    GRANT SELECT, UPDATE, DELETE
      ON TABLE profile.resume_review_runs
      TO aijob_match_worker;
    GRANT SELECT, INSERT, DELETE
      ON TABLE profile.resume_review_findings, profile.resume_review_suggestions
      TO aijob_match_worker;
    GRANT SELECT, DELETE
      ON TABLE profile.resume_review_decisions
      TO aijob_match_worker;

    GRANT ALL PRIVILEGES ON TABLE
      profile.resume_review_runs,
      profile.resume_review_findings,
      profile.resume_review_suggestions,
      profile.resume_review_decisions
      TO aijob_ops_cli, aijob_migrator;
  `.execute(db);
}
