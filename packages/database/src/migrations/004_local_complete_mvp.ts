import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

const unknownField = sql`'{"state":"unknown","reason":"not_yet_verified"}'::jsonb`;

export const localCompleteMvpMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      CREATE SCHEMA IF NOT EXISTS identity;
      CREATE SCHEMA IF NOT EXISTS profile;
      CREATE SCHEMA IF NOT EXISTS matching;
      CREATE SCHEMA IF NOT EXISTS decision;

      CREATE TABLE identity.owners (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        status text NOT NULL DEFAULT 'active' CHECK (
          status IN ('active', 'deletion_pending', 'deleted')
        ),
        epoch bigint NOT NULL DEFAULT 1 CHECK (epoch > 0),
        retention_expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT owners_deleted_state_consistent CHECK (
          (status = 'deleted' AND deleted_at IS NOT NULL)
          OR (status <> 'deleted' AND deleted_at IS NULL)
        )
      );

      CREATE TABLE identity.owner_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
        csrf_token_hash text NOT NULL CHECK (csrf_token_hash ~ '^[a-f0-9]{64}$'),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT owner_sessions_expiry_after_creation CHECK (expires_at > created_at)
      );

      ALTER TABLE task_queue.tasks
        DROP CONSTRAINT tasks_task_type_check,
        DROP CONSTRAINT tasks_run_mode_check,
        ALTER COLUMN source_id DROP NOT NULL,
        ALTER COLUMN policy_version DROP NOT NULL,
        ALTER COLUMN adapter_version DROP NOT NULL,
        ALTER COLUMN run_mode DROP NOT NULL,
        ADD COLUMN owner_id uuid REFERENCES identity.owners(id),
        ADD COLUMN owner_epoch bigint,
        ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD CONSTRAINT tasks_task_type_check CHECK (
          task_type IN (
            'crawl',
            'resume_analysis',
            'match_run',
            'recommendation_run',
            'resume_tailoring',
            'resume_export',
            'owner_deletion'
          )
        ),
        ADD CONSTRAINT tasks_run_mode_check CHECK (
          run_mode IS NULL OR run_mode IN ('scheduled', 'manual', 'probe', 'fixture_replay')
        ),
        ADD CONSTRAINT tasks_context_check CHECK (
          (
            task_type = 'crawl'
            AND source_id IS NOT NULL
            AND policy_version IS NOT NULL
            AND adapter_version IS NOT NULL
            AND run_mode IS NOT NULL
            AND owner_id IS NULL
            AND owner_epoch IS NULL
          )
          OR
          (
            task_type <> 'crawl'
            AND source_id IS NULL
            AND policy_version IS NULL
            AND adapter_version IS NULL
            AND run_mode IS NULL
            AND owner_id IS NOT NULL
            AND owner_epoch IS NOT NULL
            AND owner_epoch > 0
          )
        );

      CREATE INDEX tasks_owner_claim_idx
        ON task_queue.tasks(owner_id, owner_epoch, status, available_at)
        WHERE owner_id IS NOT NULL AND status = 'queued';

      CREATE TABLE profile.resume_analyses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        input_kind text NOT NULL CHECK (input_kind IN ('pdf', 'docx', 'pasted_text')),
        status text NOT NULL CHECK (
          status IN ('queued', 'processing', 'needs_input', 'succeeded', 'failed', 'deleted')
        ),
        original_filename text,
        media_type text,
        byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
        content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
        encryption_key_version text NOT NULL,
        raw_ciphertext bytea,
        raw_nonce bytea,
        raw_auth_tag bytea,
        extracted_text_ciphertext bytea,
        extracted_text_nonce bytea,
        extracted_text_auth_tag bytea,
        pii_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
        analysis_result jsonb,
        privacy_confirmed_at timestamptz,
        purge_after timestamptz NOT NULL DEFAULT now() + interval '24 hours',
        purged_at timestamptz,
        failure_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT resume_analyses_file_metadata CHECK (
          (
            input_kind = 'pasted_text'
            AND original_filename IS NULL
            AND media_type = 'text/plain'
          )
          OR
          (
            input_kind = 'pdf'
            AND media_type = 'application/pdf'
            AND (
              (purged_at IS NULL AND original_filename IS NOT NULL)
              OR (purged_at IS NOT NULL AND original_filename IS NULL)
            )
          )
          OR
          (
            input_kind = 'docx'
            AND media_type =
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            AND (
              (purged_at IS NULL AND original_filename IS NOT NULL)
              OR (purged_at IS NOT NULL AND original_filename IS NULL)
            )
          )
        ),
        CONSTRAINT resume_analyses_raw_encryption_tuple CHECK (
          num_nonnulls(raw_ciphertext, raw_nonce, raw_auth_tag) IN (0, 3)
          AND (raw_nonce IS NULL OR octet_length(raw_nonce) = 12)
          AND (raw_auth_tag IS NULL OR octet_length(raw_auth_tag) = 16)
        ),
        CONSTRAINT resume_analyses_text_encryption_tuple CHECK (
          num_nonnulls(
            extracted_text_ciphertext,
            extracted_text_nonce,
            extracted_text_auth_tag
          ) IN (0, 3)
          AND (extracted_text_nonce IS NULL OR octet_length(extracted_text_nonce) = 12)
          AND (extracted_text_auth_tag IS NULL OR octet_length(extracted_text_auth_tag) = 16)
        ),
        CONSTRAINT resume_analyses_raw_lifecycle CHECK (
          raw_ciphertext IS NOT NULL OR purged_at IS NOT NULL OR status IN ('failed', 'deleted')
        ),
        CONSTRAINT resume_analyses_purged_content_erased CHECK (
          purged_at IS NULL
          OR (
            raw_ciphertext IS NULL
            AND raw_nonce IS NULL
            AND raw_auth_tag IS NULL
            AND extracted_text_ciphertext IS NULL
            AND extracted_text_nonce IS NULL
            AND extracted_text_auth_tag IS NULL
            AND analysis_result IS NULL
            AND original_filename IS NULL
          )
        ),
        CONSTRAINT resume_analyses_result_metadata_only CHECK (
          analysis_result IS NULL
          OR (
            jsonb_typeof(analysis_result) = 'object'
            AND analysis_result ->> 'version' = 'resume-analysis-storage-v1'
            AND analysis_result - ARRAY['version', 'candidateEvidenceCount']::text[] = '{}'::jsonb
            AND CASE
              WHEN
                jsonb_typeof(analysis_result -> 'candidateEvidenceCount') = 'number'
                AND analysis_result ->> 'candidateEvidenceCount' ~ '^(0|[1-9][0-9]{0,2})$'
              THEN (analysis_result ->> 'candidateEvidenceCount')::integer BETWEEN 0 AND 100
              ELSE false
            END
          )
        ),
        CONSTRAINT resume_analyses_purge_deadline CHECK (
          purge_after <= created_at + interval '24 hours'
        )
      );

      CREATE INDEX resume_analyses_owner_created_idx
        ON profile.resume_analyses(owner_id, created_at DESC);
      CREATE INDEX resume_analyses_purge_idx
        ON profile.resume_analyses(purge_after)
        WHERE purged_at IS NULL;

      CREATE TABLE profile.profile_fact_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        revision integer NOT NULL CHECK (revision > 0),
        base_revision integer,
        facts jsonb NOT NULL CHECK (jsonb_typeof(facts) = 'array'),
        content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
        confirmed_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (owner_id, revision),
        FOREIGN KEY (owner_id, base_revision)
          REFERENCES profile.profile_fact_revisions(owner_id, revision)
      );

      CREATE TABLE profile.job_preference_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        revision integer NOT NULL CHECK (revision > 0),
        base_revision integer,
        preferences jsonb NOT NULL CHECK (jsonb_typeof(preferences) = 'object'),
        content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
        confirmed_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (owner_id, revision),
        FOREIGN KEY (owner_id, base_revision)
          REFERENCES profile.job_preference_revisions(owner_id, revision)
      );

      CREATE TABLE profile.resume_evidence_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        resume_analysis_id uuid REFERENCES profile.resume_analyses(id) ON DELETE SET NULL,
        revision integer NOT NULL CHECK (revision > 0),
        base_revision integer,
        evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array'),
        content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
        confirmed_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (owner_id, revision),
        FOREIGN KEY (owner_id, base_revision)
          REFERENCES profile.resume_evidence_revisions(owner_id, revision)
      );

      ALTER TABLE ingestion.source_job_revisions
        ADD COLUMN department jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN job_code jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN employment_type jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN recruitment_batch jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN weekly_attendance_days jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN duration_months jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN earliest_start_date jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN graduation_years jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN education_levels jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN majors jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN languages jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN salary jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN work_mode jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN posted_at jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN deadline_at jsonb NOT NULL DEFAULT ${unknownField};

      ALTER TABLE catalog.published_job_versions
        ADD COLUMN department jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN job_code jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN recruitment_type jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN employment_type jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN recruitment_batch jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN weekly_attendance_days jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN duration_months jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN earliest_start_date jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN graduation_years jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN education_levels jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN majors jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN languages jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN salary jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN work_mode jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN posted_at jsonb NOT NULL DEFAULT ${unknownField},
        ADD COLUMN deadline_at jsonb NOT NULL DEFAULT ${unknownField};

      CREATE TABLE matching.match_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        published_job_version_id uuid NOT NULL
          REFERENCES catalog.published_job_versions(id),
        requirement_set_id uuid NOT NULL REFERENCES catalog.job_requirement_sets(id),
        profile_fact_revision_id uuid NOT NULL REFERENCES profile.profile_fact_revisions(id),
        preference_revision_id uuid NOT NULL REFERENCES profile.job_preference_revisions(id),
        evidence_revision_id uuid NOT NULL REFERENCES profile.resume_evidence_revisions(id),
        rule_version text NOT NULL,
        dictionary_version text NOT NULL,
        template_version text NOT NULL,
        status text NOT NULL CHECK (
          status IN ('queued', 'processing', 'needs_input', 'succeeded', 'failed', 'deleted')
        ),
        request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        idempotency_key text NOT NULL,
        result jsonb,
        failure_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        UNIQUE (owner_id, idempotency_key)
      );

      CREATE TABLE matching.recommendation_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        profile_fact_revision_id uuid NOT NULL REFERENCES profile.profile_fact_revisions(id),
        preference_revision_id uuid NOT NULL REFERENCES profile.job_preference_revisions(id),
        evidence_revision_id uuid NOT NULL REFERENCES profile.resume_evidence_revisions(id),
        candidate_job_version_ids jsonb NOT NULL CHECK (
          jsonb_typeof(candidate_job_version_ids) = 'array'
        ),
        candidate_set_hash text NOT NULL CHECK (candidate_set_hash ~ '^[a-f0-9]{64}$'),
        strategy_version text NOT NULL,
        status text NOT NULL CHECK (
          status IN ('queued', 'processing', 'needs_input', 'succeeded', 'failed', 'deleted')
        ),
        request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        idempotency_key text NOT NULL,
        failure_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        UNIQUE (owner_id, idempotency_key)
      );

      CREATE TABLE matching.recommendation_items (
        recommendation_run_id uuid NOT NULL
          REFERENCES matching.recommendation_runs(id) ON DELETE CASCADE,
        ordinal integer NOT NULL CHECK (ordinal >= 0),
        published_job_version_id uuid NOT NULL
          REFERENCES catalog.published_job_versions(id),
        match_run_id uuid NOT NULL REFERENCES matching.match_runs(id),
        reason_codes jsonb NOT NULL CHECK (jsonb_typeof(reason_codes) = 'array'),
        unknown_requirement_ids jsonb NOT NULL CHECK (
          jsonb_typeof(unknown_requirement_ids) = 'array'
        ),
        PRIMARY KEY (recommendation_run_id, ordinal),
        UNIQUE (recommendation_run_id, published_job_version_id)
      );

      CREATE TABLE matching.resume_tailoring_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        resume_analysis_id uuid NOT NULL REFERENCES profile.resume_analyses(id),
        published_job_version_id uuid NOT NULL
          REFERENCES catalog.published_job_versions(id),
        requirement_set_id uuid NOT NULL REFERENCES catalog.job_requirement_sets(id),
        evidence_revision_id uuid NOT NULL REFERENCES profile.resume_evidence_revisions(id),
        provider_adapter text NOT NULL,
        model text NOT NULL,
        prompt_version text NOT NULL,
        schema_version text NOT NULL,
        template_version text NOT NULL,
        privacy_consent_at timestamptz NOT NULL,
        used_template_fallback boolean NOT NULL DEFAULT false,
        status text NOT NULL CHECK (
          status IN ('queued', 'processing', 'needs_input', 'succeeded', 'failed', 'deleted')
        ),
        request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        idempotency_key text NOT NULL,
        failure_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        UNIQUE (owner_id, idempotency_key)
      );

      CREATE TABLE matching.resume_tailoring_segments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tailoring_run_id uuid NOT NULL
          REFERENCES matching.resume_tailoring_runs(id) ON DELETE CASCADE,
        ordinal integer NOT NULL CHECK (ordinal >= 0),
        original_text text NOT NULL,
        suggested_text text NOT NULL,
        reason text NOT NULL,
        requirement_ids jsonb NOT NULL CHECK (jsonb_typeof(requirement_ids) = 'array'),
        evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(evidence_ids) = 'array'),
        decision text NOT NULL DEFAULT 'pending' CHECK (
          decision IN ('pending', 'accepted', 'rejected', 'edited')
        ),
        edited_text text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tailoring_run_id, ordinal),
        CONSTRAINT resume_tailoring_segments_edit_consistent CHECK (
          (decision = 'edited' AND edited_text IS NOT NULL)
          OR (decision <> 'edited' AND edited_text IS NULL)
        )
      );

      CREATE TABLE matching.resume_exports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        tailoring_run_id uuid NOT NULL REFERENCES matching.resume_tailoring_runs(id),
        status text NOT NULL CHECK (
          status IN ('queued', 'processing', 'succeeded', 'failed', 'deleted')
        ),
        file_name text NOT NULL,
        media_type text NOT NULL CHECK (
          media_type =
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ),
        byte_size integer CHECK (byte_size > 0),
        encryption_key_version text NOT NULL,
        ciphertext bytea,
        nonce bytea,
        auth_tag bytea,
        expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
        failure_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        CONSTRAINT resume_exports_encryption_tuple CHECK (
          num_nonnulls(ciphertext, nonce, auth_tag) IN (0, 3)
          AND (nonce IS NULL OR octet_length(nonce) = 12)
          AND (auth_tag IS NULL OR octet_length(auth_tag) = 16)
        ),
        CONSTRAINT resume_exports_expiry_limit CHECK (
          expires_at <= created_at + interval '24 hours'
        )
      );

      CREATE TABLE decision.job_decisions (
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        published_job_id uuid NOT NULL REFERENCES catalog.published_jobs(id),
        status text NOT NULL CHECK (
          status IN ('undecided', 'saved', 'preparing_to_apply', 'applied', 'abandoned')
        ),
        reason text,
        revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
        official_link_opened_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (owner_id, published_job_id)
      );

      CREATE TABLE decision.owner_deletions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        requested_owner_epoch bigint NOT NULL CHECK (requested_owner_epoch > 0),
        status text NOT NULL CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
        failure_code text,
        requested_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        UNIQUE (owner_id, requested_owner_epoch)
      );

      CREATE INDEX match_runs_owner_created_idx
        ON matching.match_runs(owner_id, created_at DESC);
      CREATE INDEX recommendation_runs_owner_created_idx
        ON matching.recommendation_runs(owner_id, created_at DESC);
      CREATE INDEX tailoring_runs_owner_created_idx
        ON matching.resume_tailoring_runs(owner_id, created_at DESC);
      CREATE INDEX job_decisions_owner_updated_idx
        ON decision.job_decisions(owner_id, updated_at DESC);

      CREATE FUNCTION matching.protect_immutable_run_context()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF (
          to_jsonb(NEW)
            - ARRAY['status', 'result', 'failure_code', 'completed_at']
        ) IS DISTINCT FROM (
          to_jsonb(OLD)
            - ARRAY['status', 'result', 'failure_code', 'completed_at']
        ) THEN
          RAISE EXCEPTION 'IMMUTABLE_RUN_CONTEXT';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER match_runs_immutable_context
        BEFORE UPDATE ON matching.match_runs
        FOR EACH ROW EXECUTE FUNCTION matching.protect_immutable_run_context();

      CREATE TRIGGER recommendation_runs_immutable_context
        BEFORE UPDATE ON matching.recommendation_runs
        FOR EACH ROW EXECUTE FUNCTION matching.protect_immutable_run_context();

      CREATE TRIGGER tailoring_runs_immutable_context
        BEFORE UPDATE ON matching.resume_tailoring_runs
        FOR EACH ROW EXECUTE FUNCTION matching.protect_immutable_run_context();

      CREATE FUNCTION matching.protect_tailoring_segment_evidence()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF (
          to_jsonb(NEW) - ARRAY['decision', 'edited_text', 'updated_at']
        ) IS DISTINCT FROM (
          to_jsonb(OLD) - ARRAY['decision', 'edited_text', 'updated_at']
        ) THEN
          RAISE EXCEPTION 'IMMUTABLE_TAILORING_EVIDENCE';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER tailoring_segments_immutable_evidence
        BEFORE UPDATE ON matching.resume_tailoring_segments
        FOR EACH ROW EXECUTE FUNCTION matching.protect_tailoring_segment_evidence();
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      DROP SCHEMA IF EXISTS decision CASCADE;
      DROP SCHEMA IF EXISTS matching CASCADE;

      ALTER TABLE catalog.published_job_versions
        DROP COLUMN deadline_at,
        DROP COLUMN posted_at,
        DROP COLUMN work_mode,
        DROP COLUMN salary,
        DROP COLUMN languages,
        DROP COLUMN majors,
        DROP COLUMN education_levels,
        DROP COLUMN graduation_years,
        DROP COLUMN earliest_start_date,
        DROP COLUMN duration_months,
        DROP COLUMN weekly_attendance_days,
        DROP COLUMN recruitment_batch,
        DROP COLUMN employment_type,
        DROP COLUMN recruitment_type,
        DROP COLUMN job_code,
        DROP COLUMN department;

      ALTER TABLE ingestion.source_job_revisions
        DROP COLUMN deadline_at,
        DROP COLUMN posted_at,
        DROP COLUMN work_mode,
        DROP COLUMN salary,
        DROP COLUMN languages,
        DROP COLUMN majors,
        DROP COLUMN education_levels,
        DROP COLUMN graduation_years,
        DROP COLUMN earliest_start_date,
        DROP COLUMN duration_months,
        DROP COLUMN weekly_attendance_days,
        DROP COLUMN recruitment_batch,
        DROP COLUMN employment_type,
        DROP COLUMN job_code,
        DROP COLUMN department;

      DROP INDEX IF EXISTS task_queue.tasks_owner_claim_idx;

      ALTER TABLE task_queue.tasks
        DROP CONSTRAINT tasks_context_check,
        DROP CONSTRAINT tasks_run_mode_check,
        DROP CONSTRAINT tasks_task_type_check,
        DROP COLUMN payload,
        DROP COLUMN owner_epoch,
        DROP COLUMN owner_id,
        ALTER COLUMN run_mode SET NOT NULL,
        ALTER COLUMN adapter_version SET NOT NULL,
        ALTER COLUMN policy_version SET NOT NULL,
        ALTER COLUMN source_id SET NOT NULL,
        ADD CONSTRAINT tasks_task_type_check CHECK (
          task_type IN ('crawl', 'resume_analysis', 'match_run', 'owner_deletion')
        ),
        ADD CONSTRAINT tasks_run_mode_check CHECK (run_mode IN ('probe', 'scheduled'));

      DROP SCHEMA IF EXISTS profile CASCADE;
      DROP SCHEMA IF EXISTS identity CASCADE;
    `.execute(db);
  },
};
