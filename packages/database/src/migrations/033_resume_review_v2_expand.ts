import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";

import type { Database } from "../types.js";

export const resumeReviewV2ExpandMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE profile.resume_review_runs
        ADD COLUMN schema_version text NOT NULL DEFAULT 'resume-review-run-v1',
        ADD COLUMN generation_provenance_version text,
        ADD COLUMN template_version text,
        ADD COLUMN privacy_consent_at timestamptz,
        ADD COLUMN provider_adapter text,
        ADD COLUMN model text,
        ADD COLUMN prompt_version text,
        ADD COLUMN output_schema_version text,
        ADD COLUMN safety_policy_version text,
        ADD COLUMN parameters_version text,
        ADD COLUMN used_template_fallback boolean NOT NULL DEFAULT false,
        ADD COLUMN fallback_reason_code text,
        ADD COLUMN failure_code text,
        ADD CONSTRAINT resume_review_runs_schema_version_check CHECK (
          schema_version IN ('resume-review-run-v1', 'resume-review-run-v2')
        ),
        ADD CONSTRAINT resume_review_runs_v1_provenance_empty CHECK (
          schema_version <> 'resume-review-run-v1'
          OR (
            num_nonnulls(
              generation_provenance_version,
              template_version,
              privacy_consent_at,
              provider_adapter,
              model,
              prompt_version,
              output_schema_version,
              safety_policy_version,
              parameters_version,
              fallback_reason_code,
              failure_code
            ) = 0
            AND used_template_fallback = false
          )
        ),
        ADD CONSTRAINT resume_review_runs_v2_provenance_consistent CHECK (
          schema_version <> 'resume-review-run-v2'
          OR (
            generation_provenance_version = 'resume-review-generation-v1'
            AND char_length(btrim(template_version)) BETWEEN 1 AND 100
            AND (provider_adapter IS NULL) = (model IS NULL)
            AND (provider_adapter IS NULL OR char_length(btrim(provider_adapter)) BETWEEN 1 AND 100)
            AND (model IS NULL OR char_length(btrim(model)) BETWEEN 1 AND 100)
            AND used_template_fallback = (fallback_reason_code IS NOT NULL)
            AND (
              fallback_reason_code IS NULL
              OR fallback_reason_code ~ '^[A-Z0-9_]{1,100}$'
            )
            AND (
              (status = 'failed' AND failure_code IS NOT NULL)
              OR (status = 'deleted')
              OR (status NOT IN ('failed', 'deleted') AND failure_code IS NULL)
            )
            AND (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{1,100}$')
            AND (
              (
                mode = 'template'
                AND privacy_consent_at IS NULL
                AND provider_adapter IS NULL
                AND prompt_version IS NULL
                AND output_schema_version IS NULL
                AND safety_policy_version IS NULL
                AND parameters_version IS NULL
                AND used_template_fallback = false
              )
              OR (
                mode = 'controlled_ai'
                AND privacy_consent_at IS NOT NULL
                AND char_length(btrim(prompt_version)) BETWEEN 1 AND 100
                AND char_length(btrim(output_schema_version)) BETWEEN 1 AND 100
                AND char_length(btrim(safety_policy_version)) BETWEEN 1 AND 100
                AND char_length(btrim(parameters_version)) BETWEEN 1 AND 100
              )
            )
          )
        );

      ALTER TABLE profile.resume_review_findings
        DROP CONSTRAINT resume_review_findings_schema_version_check,
        ADD COLUMN requirement_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD CONSTRAINT resume_review_findings_schema_version_check CHECK (
          schema_version IN ('resume-review-finding-v1', 'resume-review-finding-v2')
        ),
        ADD CONSTRAINT resume_review_findings_requirement_ids_check CHECK (
          profile.is_unique_string_array(requirement_ids, 500, false)
          AND (schema_version <> 'resume-review-finding-v1' OR requirement_ids = '[]'::jsonb)
        );

      ALTER TABLE profile.resume_review_suggestions
        DROP CONSTRAINT resume_review_suggestions_schema_version_check,
        ADD COLUMN requirement_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD CONSTRAINT resume_review_suggestions_schema_version_check CHECK (
          schema_version IN ('resume-review-suggestion-v1', 'resume-review-suggestion-v2')
        ),
        ADD CONSTRAINT resume_review_suggestions_requirement_ids_check CHECK (
          profile.is_unique_string_array(requirement_ids, 500, false)
          AND (schema_version <> 'resume-review-suggestion-v1' OR requirement_ids = '[]'::jsonb)
          AND (
            schema_version <> 'resume-review-suggestion-v2'
            OR change_type IN ('remove_block', 'reorder_section')
            OR jsonb_array_length(requirement_ids) > 0
          )
        );

      CREATE FUNCTION profile.resume_review_requirement_ids_are_pinned(
        checked_owner_id uuid,
        checked_review_run_id uuid,
        checked_requirement_ids jsonb
      )
      RETURNS boolean
      LANGUAGE plpgsql
      STABLE
      PARALLEL SAFE
      AS $$
      DECLARE
        checked_context_kind text;
        checked_owner_epoch integer;
        checked_requirement_set_id uuid;
        checked_published_job_version_id uuid;
        checked_private_snapshot_id uuid;
        checked_job_context_revision integer;
        pinned_requirements jsonb;
      BEGIN
        IF NOT profile.is_unique_string_array(checked_requirement_ids, 500, false) THEN
          RETURN false;
        END IF;

        SELECT
          job_context_kind,
          owner_epoch,
          requirement_set_id,
          published_job_version_id,
          private_job_snapshot_id,
          job_context_revision
        INTO
          checked_context_kind,
          checked_owner_epoch,
          checked_requirement_set_id,
          checked_published_job_version_id,
          checked_private_snapshot_id,
          checked_job_context_revision
        FROM profile.resume_review_runs
        WHERE owner_id = checked_owner_id AND id = checked_review_run_id;
        IF NOT FOUND THEN
          RETURN false;
        END IF;

        IF checked_context_kind = 'public' THEN
          SELECT requirements INTO pinned_requirements
          FROM catalog.job_requirement_sets
          WHERE id = checked_requirement_set_id
            AND published_job_version_id = checked_published_job_version_id;
        ELSE
          SELECT requirements INTO pinned_requirements
          FROM application.private_job_snapshot_revisions
          WHERE owner_id = checked_owner_id
            AND owner_epoch = checked_owner_epoch
            AND snapshot_id = checked_private_snapshot_id
            AND content_revision = checked_job_context_revision;
        END IF;

        IF pinned_requirements IS NULL OR jsonb_typeof(pinned_requirements) <> 'array' THEN
          RETURN false;
        END IF;
        RETURN NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(checked_requirement_ids) AS requested(requirement_id)
          WHERE NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(pinned_requirements) AS requirement(value)
            WHERE requirement.value ->> 'id' = requested.requirement_id
          )
        );
      END;
      $$;

      CREATE FUNCTION profile.validate_resume_review_requirement_references()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NOT profile.resume_review_requirement_ids_are_pinned(
          NEW.owner_id,
          NEW.review_run_id,
          NEW.requirement_ids
        ) THEN
          RAISE EXCEPTION 'RESUME_REVIEW_REQUIREMENT_REFERENCE_INVALID';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER resume_review_findings_requirement_guard
        BEFORE INSERT ON profile.resume_review_findings
        FOR EACH ROW EXECUTE FUNCTION profile.validate_resume_review_requirement_references();
      CREATE TRIGGER resume_review_suggestions_requirement_guard
        BEFORE INSERT ON profile.resume_review_suggestions
        FOR EACH ROW EXECUTE FUNCTION profile.validate_resume_review_requirement_references();

      CREATE FUNCTION profile.validate_resume_review_v2_run_update()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.schema_version IS DISTINCT FROM OLD.schema_version
          OR NEW.generation_provenance_version IS DISTINCT FROM OLD.generation_provenance_version
          OR NEW.template_version IS DISTINCT FROM OLD.template_version
          OR NEW.privacy_consent_at IS DISTINCT FROM OLD.privacy_consent_at
          OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
          OR NEW.output_schema_version IS DISTINCT FROM OLD.output_schema_version
          OR NEW.safety_policy_version IS DISTINCT FROM OLD.safety_policy_version
          OR NEW.parameters_version IS DISTINCT FROM OLD.parameters_version THEN
          RAISE EXCEPTION 'IMMUTABLE_REVIEW_GENERATION_PROVENANCE';
        END IF;
        IF OLD.status = 'failed' AND NEW.status = 'pending' THEN
          IF NEW.provider_adapter IS NOT NULL
            OR NEW.model IS NOT NULL
            OR NEW.used_template_fallback
            OR NEW.fallback_reason_code IS NOT NULL
            OR NEW.failure_code IS NOT NULL THEN
            RAISE EXCEPTION 'FAILED_REVIEW_RETRY_OUTCOME_NOT_RESET';
          END IF;
        ELSIF OLD.status <> 'pending' AND (
            NEW.provider_adapter IS DISTINCT FROM OLD.provider_adapter
            OR NEW.model IS DISTINCT FROM OLD.model
            OR NEW.used_template_fallback IS DISTINCT FROM OLD.used_template_fallback
            OR NEW.fallback_reason_code IS DISTINCT FROM OLD.fallback_reason_code
            OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
          ) THEN
            RAISE EXCEPTION 'IMMUTABLE_REVIEW_GENERATION_OUTCOME';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER resume_review_runs_v2_update_guard
        BEFORE UPDATE ON profile.resume_review_runs
        FOR EACH ROW EXECUTE FUNCTION profile.validate_resume_review_v2_run_update();

      ALTER TABLE task_queue.tasks
        DROP CONSTRAINT tasks_task_type_check,
        ADD CONSTRAINT tasks_task_type_check CHECK (
          task_type IN (
            'crawl',
            'resume_analysis',
            'match_run',
            'recommendation_run',
            'resume_tailoring',
            'resume_export',
            'resume_review',
            'resume_review_v2',
            'owner_deletion'
          )
        );
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Expand-only: v2 rows and citations make pre-v2 application rollback unsafe.
  },
};
