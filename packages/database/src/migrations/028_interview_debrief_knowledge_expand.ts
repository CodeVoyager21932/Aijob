import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";

import type { Database } from "../types.js";

export const interviewDebriefKnowledgeExpandMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      CREATE FUNCTION application.is_unique_bounded_string_array(
        payload jsonb,
        maximum_items integer,
        maximum_length integer
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
              WHERE NOT application.is_bounded_identifier(entry.value, maximum_length)
            )
            AND (
              SELECT count(*) = count(DISTINCT entry.value)
              FROM jsonb_array_elements(payload) AS entry(value)
            )
        END
      $$;

      CREATE FUNCTION application.is_valid_interview_feedback(payload jsonb)
      RETURNS boolean
      LANGUAGE plpgsql
      IMMUTABLE
      PARALLEL SAFE
      AS $$
      DECLARE
        item jsonb;
      BEGIN
        IF NOT application.jsonb_has_exact_keys(
          payload,
          ARRAY['schemaVersion', 'summary', 'strengths', 'items', 'practicePriorities']
        )
          OR payload ->> 'schemaVersion' <> 'interview-feedback-v1'
          OR NOT application.is_bounded_identifier(payload -> 'summary', 4000)
          OR NOT application.is_unique_bounded_string_array(payload -> 'strengths', 20, 1000)
          OR jsonb_typeof(payload -> 'items') <> 'array'
          OR jsonb_array_length(payload -> 'items') > 100
          OR NOT application.is_unique_bounded_string_array(
            payload -> 'practicePriorities',
            20,
            1000
          ) THEN
          RETURN false;
        END IF;

        FOR item IN SELECT value FROM jsonb_array_elements(payload -> 'items')
        LOOP
          IF NOT application.jsonb_has_exact_keys(
            item,
            ARRAY[
              'id',
              'category',
              'severity',
              'message',
              'improvement',
              'turnIds',
              'requirementIds',
              'evidenceIds'
            ]
          )
            OR NOT application.is_uuid_text(item ->> 'id')
            OR item ->> 'category' NOT IN ('relevance', 'structure', 'evidence', 'clarity')
            OR item ->> 'severity' NOT IN ('info', 'warning', 'critical')
            OR NOT application.is_bounded_identifier(item -> 'message', 2000)
            OR NOT (
              item -> 'improvement' = 'null'::jsonb
              OR application.is_bounded_identifier(item -> 'improvement', 2000)
            )
            OR NOT application.is_unique_identifier_array(item -> 'turnIds', 200)
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(item -> 'turnIds') AS turn_id(value)
              WHERE NOT application.is_uuid_text(turn_id.value)
            )
            OR NOT application.is_unique_identifier_array(item -> 'requirementIds', 500)
            OR NOT application.is_unique_identifier_array(item -> 'evidenceIds', 500) THEN
            RETURN false;
          END IF;
        END LOOP;
        RETURN true;
      END;
      $$;

      CREATE FUNCTION application.is_valid_debrief_expression_issues(payload jsonb)
      RETURNS boolean
      LANGUAGE plpgsql
      IMMUTABLE
      PARALLEL SAFE
      AS $$
      DECLARE
        item jsonb;
      BEGIN
        IF jsonb_typeof(payload) <> 'array' OR jsonb_array_length(payload) > 100 THEN
          RETURN false;
        END IF;
        FOR item IN SELECT value FROM jsonb_array_elements(payload)
        LOOP
          IF NOT application.jsonb_has_exact_keys(
            item,
            ARRAY['id', 'description', 'turnIds']
          )
            OR NOT application.is_uuid_text(item ->> 'id')
            OR NOT application.is_bounded_identifier(item -> 'description', 2000)
            OR NOT application.is_unique_identifier_array(item -> 'turnIds', 200)
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(item -> 'turnIds') AS turn_id(value)
              WHERE NOT application.is_uuid_text(turn_id.value)
            ) THEN
            RETURN false;
          END IF;
        END LOOP;
        RETURN true;
      END;
      $$;

      CREATE FUNCTION application.is_valid_debrief_evidence_gaps(payload jsonb)
      RETURNS boolean
      LANGUAGE plpgsql
      IMMUTABLE
      PARALLEL SAFE
      AS $$
      DECLARE
        item jsonb;
      BEGIN
        IF jsonb_typeof(payload) <> 'array' OR jsonb_array_length(payload) > 100 THEN
          RETURN false;
        END IF;
        FOR item IN SELECT value FROM jsonb_array_elements(payload)
        LOOP
          IF NOT application.jsonb_has_exact_keys(
            item,
            ARRAY['id', 'description', 'requirementIds']
          )
            OR NOT application.is_uuid_text(item ->> 'id')
            OR NOT application.is_bounded_identifier(item -> 'description', 2000)
            OR NOT application.is_unique_identifier_array(item -> 'requirementIds', 500) THEN
            RETURN false;
          END IF;
        END LOOP;
        RETURN true;
      END;
      $$;

      CREATE FUNCTION application.is_valid_debrief_practice_plan(payload jsonb)
      RETURNS boolean
      LANGUAGE plpgsql
      IMMUTABLE
      PARALLEL SAFE
      AS $$
      DECLARE
        item jsonb;
      BEGIN
        IF jsonb_typeof(payload) <> 'array' OR jsonb_array_length(payload) > 100 THEN
          RETURN false;
        END IF;
        FOR item IN SELECT value FROM jsonb_array_elements(payload)
        LOOP
          IF NOT application.jsonb_has_exact_keys(
            item,
            ARRAY['id', 'action', 'targetDate']
          )
            OR NOT application.is_uuid_text(item ->> 'id')
            OR NOT application.is_bounded_identifier(item -> 'action', 2000)
            OR NOT (
              item -> 'targetDate' = 'null'::jsonb
              OR (
                jsonb_typeof(item -> 'targetDate') = 'string'
                AND item ->> 'targetDate' ~ '^\d{4}-\d{2}-\d{2}$'
              )
            ) THEN
            RETURN false;
          END IF;
        END LOOP;
        RETURN true;
      END;
      $$;

      CREATE TABLE application.interview_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        case_id uuid,
        detached_from_case_id uuid,
        job_context_kind text NOT NULL CHECK (job_context_kind IN ('public', 'private')),
        published_job_id uuid,
        published_job_version_id uuid,
        requirement_set_id uuid,
        private_job_snapshot_id uuid,
        job_context_revision integer NOT NULL CHECK (job_context_revision > 0),
        evidence_revision_id uuid NOT NULL,
        resume_document_id uuid,
        resume_content_revision_id uuid,
        mode text NOT NULL CHECK (mode IN ('template', 'controlled_ai')),
        status text NOT NULL CHECK (
          status IN ('queued', 'active', 'completed', 'failed', 'deleted')
        ),
        template_version text NOT NULL CHECK (
          char_length(btrim(template_version)) BETWEEN 1 AND 100
        ),
        prompt_version text CHECK (
          prompt_version IS NULL OR char_length(btrim(prompt_version)) BETWEEN 1 AND 100
        ),
        provider_adapter text CHECK (
          provider_adapter IS NULL OR char_length(btrim(provider_adapter)) BETWEEN 1 AND 100
        ),
        model text CHECK (model IS NULL OR char_length(btrim(model)) BETWEEN 1 AND 200),
        revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
        creation_idempotency_key text NOT NULL CHECK (
          char_length(btrim(creation_idempotency_key)) BETWEEN 1 AND 200
        ),
        creation_request_hash text NOT NULL CHECK (creation_request_hash ~ '^[a-f0-9]{64}$'),
        completed_at timestamptz,
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT interview_sessions_owner_id_unique UNIQUE (owner_id, id),
        CONSTRAINT interview_sessions_owner_epoch_id_unique UNIQUE (owner_id, owner_epoch, id),
        CONSTRAINT interview_sessions_owner_creation_key_unique
          UNIQUE (owner_id, creation_idempotency_key),
        CONSTRAINT interview_sessions_case_reference_pair CHECK (
          num_nulls(case_id, detached_from_case_id) = 1
        ),
        CONSTRAINT interview_sessions_owner_case_fk
          FOREIGN KEY (owner_id, case_id)
          REFERENCES application.application_cases(owner_id, id),
        CONSTRAINT interview_sessions_owner_evidence_fk
          FOREIGN KEY (owner_id, evidence_revision_id)
          REFERENCES profile.resume_evidence_revisions(owner_id, id),
        CONSTRAINT interview_sessions_owner_resume_document_fk
          FOREIGN KEY (owner_id, resume_document_id)
          REFERENCES profile.resume_documents(owner_id, id),
        CONSTRAINT interview_sessions_owner_resume_content_fk
          FOREIGN KEY (owner_id, resume_document_id, resume_content_revision_id)
          REFERENCES profile.resume_document_revisions(owner_id, document_id, id),
        CONSTRAINT interview_sessions_public_job_fk
          FOREIGN KEY (published_job_id, published_job_version_id)
          REFERENCES catalog.published_job_versions(published_job_id, id),
        CONSTRAINT interview_sessions_public_requirement_fk
          FOREIGN KEY (published_job_version_id, requirement_set_id)
          REFERENCES catalog.job_requirement_sets(published_job_version_id, id),
        CONSTRAINT interview_sessions_private_snapshot_fk
          FOREIGN KEY (owner_id, private_job_snapshot_id, job_context_revision)
          REFERENCES application.private_job_snapshot_revisions(
            owner_id,
            snapshot_id,
            content_revision
          ),
        CONSTRAINT interview_sessions_context_pair CHECK (
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
        CONSTRAINT interview_sessions_resume_pair CHECK (
          num_nulls(resume_document_id, resume_content_revision_id) IN (0, 2)
        ),
        CONSTRAINT interview_sessions_mode_provider_consistent CHECK (
          (
            mode = 'template'
            AND prompt_version IS NULL
            AND provider_adapter IS NULL
            AND model IS NULL
          )
          OR
          (
            mode = 'controlled_ai'
            AND prompt_version IS NOT NULL
            AND provider_adapter IS NOT NULL
            AND model IS NOT NULL
          )
        ),
        CONSTRAINT interview_sessions_status_time_consistent CHECK (
          (
            status = 'completed'
            AND completed_at IS NOT NULL
            AND deleted_at IS NULL
          )
          OR
          (
            status IN ('queued', 'active', 'failed')
            AND completed_at IS NULL
            AND deleted_at IS NULL
          )
          OR
          (status = 'deleted' AND deleted_at IS NOT NULL)
        ),
        CONSTRAINT interview_sessions_time_order CHECK (
          updated_at >= created_at
          AND (completed_at IS NULL OR completed_at >= created_at)
          AND (deleted_at IS NULL OR deleted_at >= created_at)
        )
      );

      CREATE TABLE application.interview_turns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        interview_session_id uuid NOT NULL,
        sequence integer NOT NULL CHECK (sequence > 0),
        schema_version text NOT NULL DEFAULT 'interview-turn-v1'
          CHECK (schema_version = 'interview-turn-v1'),
        kind text NOT NULL CHECK (kind IN ('question', 'answer', 'follow_up')),
        content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 20000),
        requirement_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
          application.is_unique_identifier_array(requirement_ids, 500)
        ),
        evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
          application.is_unique_identifier_array(evidence_ids, 500)
        ),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT interview_turns_owner_id_unique UNIQUE (owner_id, id),
        CONSTRAINT interview_turns_session_sequence_unique
          UNIQUE (owner_id, interview_session_id, sequence),
        CONSTRAINT interview_turns_owner_session_fk
          FOREIGN KEY (owner_id, owner_epoch, interview_session_id)
          REFERENCES application.interview_sessions(owner_id, owner_epoch, id)
          ON DELETE CASCADE
      );

      CREATE TABLE application.interview_feedback (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        interview_session_id uuid NOT NULL,
        revision integer NOT NULL CHECK (revision > 0),
        schema_version text NOT NULL DEFAULT 'interview-feedback-record-v1'
          CHECK (schema_version = 'interview-feedback-record-v1'),
        generator_mode text NOT NULL CHECK (generator_mode IN ('template', 'controlled_ai')),
        feedback jsonb NOT NULL CHECK (application.is_valid_interview_feedback(feedback)),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT interview_feedback_owner_id_unique UNIQUE (owner_id, id),
        CONSTRAINT interview_feedback_session_revision_unique
          UNIQUE (owner_id, interview_session_id, revision),
        CONSTRAINT interview_feedback_owner_session_fk
          FOREIGN KEY (owner_id, owner_epoch, interview_session_id)
          REFERENCES application.interview_sessions(owner_id, owner_epoch, id)
          ON DELETE CASCADE
      );

      CREATE TABLE application.debriefs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        case_id uuid,
        detached_from_case_id uuid,
        interview_session_id uuid,
        job_context_kind text NOT NULL CHECK (job_context_kind IN ('public', 'private')),
        published_job_id uuid,
        published_job_version_id uuid,
        requirement_set_id uuid,
        private_job_snapshot_id uuid,
        job_context_revision integer NOT NULL CHECK (job_context_revision > 0),
        evidence_revision_id uuid NOT NULL,
        schema_version text NOT NULL DEFAULT 'debrief-v1' CHECK (schema_version = 'debrief-v1'),
        expression_issues jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
          application.is_valid_debrief_expression_issues(expression_issues)
        ),
        evidence_gaps jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
          application.is_valid_debrief_evidence_gaps(evidence_gaps)
        ),
        practice_plan jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
          application.is_valid_debrief_practice_plan(practice_plan)
        ),
        status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
        revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
        creation_idempotency_key text NOT NULL CHECK (
          char_length(btrim(creation_idempotency_key)) BETWEEN 1 AND 200
        ),
        creation_request_hash text NOT NULL CHECK (creation_request_hash ~ '^[a-f0-9]{64}$'),
        confirmed_at timestamptz,
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT debriefs_owner_id_unique UNIQUE (owner_id, id),
        CONSTRAINT debriefs_owner_epoch_id_unique UNIQUE (owner_id, owner_epoch, id),
        CONSTRAINT debriefs_owner_creation_key_unique UNIQUE (owner_id, creation_idempotency_key),
        CONSTRAINT debriefs_case_reference_pair CHECK (
          num_nulls(case_id, detached_from_case_id) = 1
        ),
        CONSTRAINT debriefs_owner_case_fk
          FOREIGN KEY (owner_id, case_id)
          REFERENCES application.application_cases(owner_id, id),
        CONSTRAINT debriefs_owner_session_fk
          FOREIGN KEY (owner_id, owner_epoch, interview_session_id)
          REFERENCES application.interview_sessions(owner_id, owner_epoch, id),
        CONSTRAINT debriefs_owner_evidence_fk
          FOREIGN KEY (owner_id, evidence_revision_id)
          REFERENCES profile.resume_evidence_revisions(owner_id, id),
        CONSTRAINT debriefs_public_job_fk
          FOREIGN KEY (published_job_id, published_job_version_id)
          REFERENCES catalog.published_job_versions(published_job_id, id),
        CONSTRAINT debriefs_public_requirement_fk
          FOREIGN KEY (published_job_version_id, requirement_set_id)
          REFERENCES catalog.job_requirement_sets(published_job_version_id, id),
        CONSTRAINT debriefs_private_snapshot_fk
          FOREIGN KEY (owner_id, private_job_snapshot_id, job_context_revision)
          REFERENCES application.private_job_snapshot_revisions(
            owner_id,
            snapshot_id,
            content_revision
          ),
        CONSTRAINT debriefs_context_pair CHECK (
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
        CONSTRAINT debriefs_status_time_consistent CHECK (
          (status = 'draft' AND confirmed_at IS NULL)
          OR (status = 'confirmed' AND confirmed_at IS NOT NULL)
        ),
        CONSTRAINT debriefs_time_order CHECK (
          updated_at >= created_at
          AND (confirmed_at IS NULL OR confirmed_at >= created_at)
          AND (deleted_at IS NULL OR deleted_at >= created_at)
        )
      );

      CREATE UNIQUE INDEX debriefs_one_active_case_per_owner_idx
        ON application.debriefs(owner_id, case_id)
        WHERE case_id IS NOT NULL AND deleted_at IS NULL;
      CREATE UNIQUE INDEX debriefs_one_detached_case_per_owner_idx
        ON application.debriefs(owner_id, detached_from_case_id)
        WHERE detached_from_case_id IS NOT NULL AND deleted_at IS NULL;

      CREATE TABLE application.debrief_confirmations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        debrief_id uuid NOT NULL,
        schema_version text NOT NULL DEFAULT 'debrief-confirmation-v1'
          CHECK (schema_version = 'debrief-confirmation-v1'),
        based_on_debrief_revision integer NOT NULL CHECK (based_on_debrief_revision > 0),
        idempotency_key_hash text NOT NULL CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
        confirmed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT debrief_confirmations_owner_id_unique UNIQUE (owner_id, id),
        CONSTRAINT debrief_confirmations_owner_debrief_unique UNIQUE (owner_id, debrief_id),
        CONSTRAINT debrief_confirmations_owner_idempotency_unique
          UNIQUE (owner_id, idempotency_key_hash),
        CONSTRAINT debrief_confirmations_owner_debrief_fk
          FOREIGN KEY (owner_id, owner_epoch, debrief_id)
          REFERENCES application.debriefs(owner_id, owner_epoch, id)
          ON DELETE CASCADE
      );

      CREATE TABLE application.knowledge_clips (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        schema_version text NOT NULL DEFAULT 'knowledge-clip-v1'
          CHECK (schema_version = 'knowledge-clip-v1'),
        url text NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 2048),
        title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
        summary text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 1 AND 2000),
        use_cases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
          application.is_unique_bounded_string_array(use_cases, 20, 500)
        ),
        user_notes text CHECK (
          user_notes IS NULL OR char_length(btrim(user_notes)) BETWEEN 1 AND 5000
        ),
        verified_at timestamptz NOT NULL,
        revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
        creation_idempotency_key text NOT NULL CHECK (
          char_length(btrim(creation_idempotency_key)) BETWEEN 1 AND 200
        ),
        creation_request_hash text NOT NULL CHECK (creation_request_hash ~ '^[a-f0-9]{64}$'),
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT knowledge_clips_owner_id_unique UNIQUE (owner_id, id),
        CONSTRAINT knowledge_clips_owner_epoch_id_unique UNIQUE (owner_id, owner_epoch, id),
        CONSTRAINT knowledge_clips_owner_creation_key_unique
          UNIQUE (owner_id, creation_idempotency_key),
        CONSTRAINT knowledge_clips_time_order CHECK (
          updated_at >= created_at
          AND (deleted_at IS NULL OR deleted_at >= created_at)
        )
      );

      CREATE TABLE application.knowledge_clip_case_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        knowledge_clip_id uuid NOT NULL,
        case_id uuid NOT NULL,
        schema_version text NOT NULL DEFAULT 'knowledge-clip-case-link-v1'
          CHECK (schema_version = 'knowledge-clip-case-link-v1'),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT knowledge_clip_case_links_owner_id_unique UNIQUE (owner_id, id),
        CONSTRAINT knowledge_clip_case_links_owner_clip_case_unique
          UNIQUE (owner_id, knowledge_clip_id, case_id),
        CONSTRAINT knowledge_clip_case_links_owner_clip_fk
          FOREIGN KEY (owner_id, owner_epoch, knowledge_clip_id)
          REFERENCES application.knowledge_clips(owner_id, owner_epoch, id)
          ON DELETE CASCADE,
        CONSTRAINT knowledge_clip_case_links_owner_case_fk
          FOREIGN KEY (owner_id, case_id)
          REFERENCES application.application_cases(owner_id, id)
          ON DELETE CASCADE
      );

      CREATE INDEX interview_sessions_owner_updated_idx
        ON application.interview_sessions(owner_id, updated_at DESC, id DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX interview_sessions_owner_case_idx
        ON application.interview_sessions(owner_id, case_id, created_at DESC)
        WHERE case_id IS NOT NULL;
      CREATE INDEX interview_sessions_owner_detached_case_idx
        ON application.interview_sessions(owner_id, detached_from_case_id, created_at DESC)
        WHERE detached_from_case_id IS NOT NULL;
      CREATE INDEX interview_turns_owner_session_idx
        ON application.interview_turns(owner_id, interview_session_id, sequence);
      CREATE INDEX interview_feedback_owner_session_idx
        ON application.interview_feedback(owner_id, interview_session_id, revision DESC);
      CREATE INDEX debriefs_owner_updated_idx
        ON application.debriefs(owner_id, updated_at DESC, id DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX knowledge_clips_owner_updated_idx
        ON application.knowledge_clips(owner_id, updated_at DESC, id DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX knowledge_clip_case_links_owner_case_idx
        ON application.knowledge_clip_case_links(owner_id, case_id, created_at DESC);

      CREATE FUNCTION application.assert_active_career_asset_owner_epoch()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM identity.owners
          WHERE id = NEW.owner_id
            AND epoch = NEW.owner_epoch
            AND status = 'active'
        ) THEN
          RAISE EXCEPTION 'OWNER_EPOCH_STALE';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE FUNCTION application.prevent_career_asset_history_update()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'IMMUTABLE_CAREER_ASSET_HISTORY';
      END;
      $$;

      CREATE FUNCTION application.validate_interview_session()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        application_case application.application_cases%ROWTYPE;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.case_id IS NULL OR NEW.detached_from_case_id IS NOT NULL THEN
            RAISE EXCEPTION 'INTERVIEW_REQUIRES_ACTIVE_CASE';
          END IF;
          SELECT * INTO application_case
          FROM application.application_cases
          WHERE owner_id = NEW.owner_id
            AND owner_epoch = NEW.owner_epoch
            AND id = NEW.case_id
            AND deleted_at IS NULL;
          IF NOT FOUND
            OR application_case.job_context_kind IS DISTINCT FROM NEW.job_context_kind
            OR application_case.published_job_id IS DISTINCT FROM NEW.published_job_id
            OR application_case.published_job_version_id IS DISTINCT FROM NEW.published_job_version_id
            OR application_case.requirement_set_id IS DISTINCT FROM NEW.requirement_set_id
            OR application_case.private_job_snapshot_id IS DISTINCT FROM NEW.private_job_snapshot_id
            OR application_case.job_context_revision IS DISTINCT FROM NEW.job_context_revision THEN
            RAISE EXCEPTION 'INTERVIEW_CASE_CONTEXT_MISMATCH';
          END IF;
        ELSE
          IF NEW.id IS DISTINCT FROM OLD.id
            OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
            OR NEW.owner_epoch IS DISTINCT FROM OLD.owner_epoch
            OR NEW.job_context_kind IS DISTINCT FROM OLD.job_context_kind
            OR NEW.published_job_id IS DISTINCT FROM OLD.published_job_id
            OR NEW.published_job_version_id IS DISTINCT FROM OLD.published_job_version_id
            OR NEW.requirement_set_id IS DISTINCT FROM OLD.requirement_set_id
            OR NEW.private_job_snapshot_id IS DISTINCT FROM OLD.private_job_snapshot_id
            OR NEW.job_context_revision IS DISTINCT FROM OLD.job_context_revision
            OR NEW.evidence_revision_id IS DISTINCT FROM OLD.evidence_revision_id
            OR NEW.resume_document_id IS DISTINCT FROM OLD.resume_document_id
            OR NEW.resume_content_revision_id IS DISTINCT FROM OLD.resume_content_revision_id
            OR NEW.mode IS DISTINCT FROM OLD.mode
            OR NEW.template_version IS DISTINCT FROM OLD.template_version
            OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
            OR NEW.provider_adapter IS DISTINCT FROM OLD.provider_adapter
            OR NEW.model IS DISTINCT FROM OLD.model
            OR NEW.creation_idempotency_key IS DISTINCT FROM OLD.creation_idempotency_key
            OR NEW.creation_request_hash IS DISTINCT FROM OLD.creation_request_hash
            OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'IMMUTABLE_INTERVIEW_INPUTS';
          END IF;
          IF NEW.case_id IS DISTINCT FROM OLD.case_id
            OR NEW.detached_from_case_id IS DISTINCT FROM OLD.detached_from_case_id THEN
            IF NOT (
              OLD.case_id IS NOT NULL
              AND OLD.detached_from_case_id IS NULL
              AND NEW.case_id IS NULL
              AND NEW.detached_from_case_id = OLD.case_id
            ) THEN
              RAISE EXCEPTION 'INVALID_INTERVIEW_CASE_DETACHMENT';
            END IF;
          END IF;
          IF NEW.revision <> OLD.revision + 1
            OR OLD.status = 'deleted'
            OR NOT (
              NEW.status = OLD.status
              OR (OLD.status = 'queued' AND NEW.status IN ('active', 'failed', 'deleted'))
              OR (OLD.status = 'active' AND NEW.status IN ('completed', 'failed', 'deleted'))
              OR (OLD.status = 'failed' AND NEW.status IN ('queued', 'deleted'))
              OR (OLD.status = 'completed' AND NEW.status = 'deleted')
            ) THEN
            RAISE EXCEPTION 'INVALID_INTERVIEW_TRANSITION';
          END IF;
        END IF;

        IF NEW.resume_content_revision_id IS NOT NULL AND NOT EXISTS (
          SELECT 1
          FROM profile.resume_documents AS document
          JOIN profile.resume_document_revisions AS revision
            ON revision.owner_id = document.owner_id
            AND revision.document_id = document.id
            AND revision.id = NEW.resume_content_revision_id
          WHERE document.owner_id = NEW.owner_id
            AND document.id = NEW.resume_document_id
            AND document.kind = 'case_derived'
            AND revision.schema_version = 'resume-content-v1'
            AND document.job_context_kind = NEW.job_context_kind
            AND document.published_job_id IS NOT DISTINCT FROM NEW.published_job_id
            AND document.published_job_version_id IS NOT DISTINCT FROM NEW.published_job_version_id
            AND document.requirement_set_id IS NOT DISTINCT FROM NEW.requirement_set_id
            AND document.private_job_snapshot_id IS NOT DISTINCT FROM NEW.private_job_snapshot_id
            AND document.job_context_revision = NEW.job_context_revision
        ) THEN
          RAISE EXCEPTION 'INTERVIEW_RESUME_CONTEXT_MISMATCH';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE FUNCTION application.validate_interview_turn()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        session_case_id uuid;
        session_evidence_revision_id uuid;
        session_status text;
        session_context_kind text;
        session_requirement_set_id uuid;
        session_context_revision integer;
      BEGIN
        SELECT
          case_id,
          evidence_revision_id,
          status,
          job_context_kind,
          requirement_set_id,
          job_context_revision
        INTO
          session_case_id,
          session_evidence_revision_id,
          session_status,
          session_context_kind,
          session_requirement_set_id,
          session_context_revision
        FROM application.interview_sessions
        WHERE owner_id = NEW.owner_id
          AND owner_epoch = NEW.owner_epoch
          AND id = NEW.interview_session_id;
        IF NOT FOUND OR session_case_id IS NULL OR session_status <> 'active' THEN
          RAISE EXCEPTION 'INTERVIEW_TURN_SESSION_NOT_ACTIVE';
        END IF;
        IF NOT profile.resume_review_evidence_ids_are_confirmed(
          NEW.owner_id,
          session_evidence_revision_id,
          NEW.evidence_ids
        ) THEN
          RAISE EXCEPTION 'INTERVIEW_EVIDENCE_NOT_CONFIRMED';
        END IF;
        IF EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(NEW.requirement_ids) AS requested(requirement_id)
          WHERE NOT EXISTS (
            SELECT 1
            FROM application.case_requirement_states AS requirement_state
            WHERE requirement_state.owner_id = NEW.owner_id
              AND requirement_state.owner_epoch = NEW.owner_epoch
              AND requirement_state.case_id = session_case_id
              AND requirement_state.requirement_id = requested.requirement_id
              AND (
                (
                  session_context_kind = 'public'
                  AND requirement_state.requirement_context_kind = 'public'
                  AND requirement_state.requirement_set_id = session_requirement_set_id
                )
                OR
                (
                  session_context_kind = 'private'
                  AND requirement_state.requirement_context_kind = 'private'
                  AND requirement_state.requirement_set_revision = session_context_revision
                )
              )
          )
        ) THEN
          RAISE EXCEPTION 'INTERVIEW_REQUIREMENT_OUTSIDE_CASE';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE FUNCTION application.validate_interview_feedback()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        session_evidence_revision_id uuid;
        session_mode text;
        session_status text;
        session_case_id uuid;
        session_context_kind text;
        session_requirement_set_id uuid;
        session_context_revision integer;
        item jsonb;
      BEGIN
        SELECT
          evidence_revision_id,
          mode,
          status,
          case_id,
          job_context_kind,
          requirement_set_id,
          job_context_revision
        INTO
          session_evidence_revision_id,
          session_mode,
          session_status,
          session_case_id,
          session_context_kind,
          session_requirement_set_id,
          session_context_revision
        FROM application.interview_sessions
        WHERE owner_id = NEW.owner_id
          AND owner_epoch = NEW.owner_epoch
          AND id = NEW.interview_session_id;
        IF NOT FOUND OR session_status <> 'completed' OR session_mode <> NEW.generator_mode THEN
          RAISE EXCEPTION 'INTERVIEW_FEEDBACK_SESSION_MISMATCH';
        END IF;
        IF NEW.revision <> COALESCE((
          SELECT max(feedback.revision) + 1
          FROM application.interview_feedback AS feedback
          WHERE feedback.owner_id = NEW.owner_id
            AND feedback.interview_session_id = NEW.interview_session_id
        ), 1) THEN
          RAISE EXCEPTION 'INTERVIEW_FEEDBACK_REVISION_MISMATCH';
        END IF;
        FOR item IN SELECT value FROM jsonb_array_elements(NEW.feedback -> 'items')
        LOOP
          IF NOT profile.resume_review_evidence_ids_are_confirmed(
            NEW.owner_id,
            session_evidence_revision_id,
            item -> 'evidenceIds'
          ) THEN
            RAISE EXCEPTION 'INTERVIEW_EVIDENCE_NOT_CONFIRMED';
          END IF;
          IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(item -> 'turnIds') AS requested(turn_id)
            WHERE NOT EXISTS (
              SELECT 1
              FROM application.interview_turns AS turn
              WHERE turn.owner_id = NEW.owner_id
                AND turn.interview_session_id = NEW.interview_session_id
                AND turn.id = requested.turn_id::uuid
            )
          ) THEN
            RAISE EXCEPTION 'INTERVIEW_FEEDBACK_TURN_MISMATCH';
          END IF;
          IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(item -> 'requirementIds') AS requested(requirement_id)
            WHERE NOT EXISTS (
              SELECT 1
              FROM application.case_requirement_states AS requirement_state
              WHERE requirement_state.owner_id = NEW.owner_id
                AND requirement_state.owner_epoch = NEW.owner_epoch
                AND requirement_state.case_id = session_case_id
                AND requirement_state.requirement_id = requested.requirement_id
                AND (
                  (
                    session_context_kind = 'public'
                    AND requirement_state.requirement_context_kind = 'public'
                    AND requirement_state.requirement_set_id = session_requirement_set_id
                  )
                  OR
                  (
                    session_context_kind = 'private'
                    AND requirement_state.requirement_context_kind = 'private'
                    AND requirement_state.requirement_set_revision = session_context_revision
                  )
                )
            )
          ) THEN
            RAISE EXCEPTION 'INTERVIEW_REQUIREMENT_OUTSIDE_CASE';
          END IF;
        END LOOP;
        RETURN NEW;
      END;
      $$;

      CREATE FUNCTION application.validate_debrief()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        application_case application.application_cases%ROWTYPE;
        interview_session application.interview_sessions%ROWTYPE;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.case_id IS NULL OR NEW.detached_from_case_id IS NOT NULL
            OR NEW.status <> 'draft' OR NEW.confirmed_at IS NOT NULL THEN
            RAISE EXCEPTION 'DEBRIEF_REQUIRES_ACTIVE_DRAFT';
          END IF;
          SELECT * INTO application_case
          FROM application.application_cases
          WHERE owner_id = NEW.owner_id
            AND owner_epoch = NEW.owner_epoch
            AND id = NEW.case_id
            AND deleted_at IS NULL;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'DEBRIEF_CASE_CONTEXT_MISMATCH';
          END IF;

          IF NEW.interview_session_id IS NOT NULL THEN
            SELECT * INTO interview_session
            FROM application.interview_sessions
            WHERE owner_id = NEW.owner_id
              AND owner_epoch = NEW.owner_epoch
              AND id = NEW.interview_session_id
              AND case_id = NEW.case_id
              AND status <> 'deleted';
            IF NOT FOUND
              OR interview_session.job_context_kind IS DISTINCT FROM NEW.job_context_kind
              OR interview_session.published_job_id IS DISTINCT FROM NEW.published_job_id
              OR interview_session.published_job_version_id IS DISTINCT FROM NEW.published_job_version_id
              OR interview_session.requirement_set_id IS DISTINCT FROM NEW.requirement_set_id
              OR interview_session.private_job_snapshot_id IS DISTINCT FROM NEW.private_job_snapshot_id
              OR interview_session.job_context_revision IS DISTINCT FROM NEW.job_context_revision
              OR interview_session.evidence_revision_id IS DISTINCT FROM NEW.evidence_revision_id THEN
              RAISE EXCEPTION 'DEBRIEF_INTERVIEW_CONTEXT_MISMATCH';
            END IF;
          ELSIF application_case.job_context_kind IS DISTINCT FROM NEW.job_context_kind
            OR application_case.published_job_id IS DISTINCT FROM NEW.published_job_id
            OR application_case.published_job_version_id IS DISTINCT FROM NEW.published_job_version_id
            OR application_case.requirement_set_id IS DISTINCT FROM NEW.requirement_set_id
            OR application_case.private_job_snapshot_id IS DISTINCT FROM NEW.private_job_snapshot_id
            OR application_case.job_context_revision IS DISTINCT FROM NEW.job_context_revision THEN
            RAISE EXCEPTION 'DEBRIEF_CASE_CONTEXT_MISMATCH';
          END IF;
        ELSE
          IF NEW.id IS DISTINCT FROM OLD.id
            OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
            OR NEW.owner_epoch IS DISTINCT FROM OLD.owner_epoch
            OR NEW.interview_session_id IS DISTINCT FROM OLD.interview_session_id
            OR NEW.job_context_kind IS DISTINCT FROM OLD.job_context_kind
            OR NEW.published_job_id IS DISTINCT FROM OLD.published_job_id
            OR NEW.published_job_version_id IS DISTINCT FROM OLD.published_job_version_id
            OR NEW.requirement_set_id IS DISTINCT FROM OLD.requirement_set_id
            OR NEW.private_job_snapshot_id IS DISTINCT FROM OLD.private_job_snapshot_id
            OR NEW.job_context_revision IS DISTINCT FROM OLD.job_context_revision
            OR NEW.evidence_revision_id IS DISTINCT FROM OLD.evidence_revision_id
            OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
            OR NEW.creation_idempotency_key IS DISTINCT FROM OLD.creation_idempotency_key
            OR NEW.creation_request_hash IS DISTINCT FROM OLD.creation_request_hash
            OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'IMMUTABLE_DEBRIEF_INPUTS';
          END IF;
          IF NEW.case_id IS DISTINCT FROM OLD.case_id
            OR NEW.detached_from_case_id IS DISTINCT FROM OLD.detached_from_case_id THEN
            IF NOT (
              OLD.case_id IS NOT NULL
              AND OLD.detached_from_case_id IS NULL
              AND NEW.case_id IS NULL
              AND NEW.detached_from_case_id = OLD.case_id
            ) THEN
              RAISE EXCEPTION 'INVALID_DEBRIEF_CASE_DETACHMENT';
            END IF;
          END IF;
          IF NEW.revision <> OLD.revision + 1 OR OLD.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'INVALID_DEBRIEF_REVISION';
          END IF;
          IF OLD.status = 'confirmed' AND (
            NEW.status <> 'confirmed'
            OR NEW.expression_issues IS DISTINCT FROM OLD.expression_issues
            OR NEW.evidence_gaps IS DISTINCT FROM OLD.evidence_gaps
            OR NEW.practice_plan IS DISTINCT FROM OLD.practice_plan
            OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
          ) THEN
            RAISE EXCEPTION 'CONFIRMED_DEBRIEF_IMMUTABLE';
          END IF;
          IF OLD.status = 'draft' AND NEW.status = 'confirmed' AND NOT EXISTS (
            SELECT 1
            FROM application.debrief_confirmations AS confirmation
            WHERE confirmation.owner_id = NEW.owner_id
              AND confirmation.owner_epoch = NEW.owner_epoch
              AND confirmation.debrief_id = NEW.id
              AND confirmation.based_on_debrief_revision = OLD.revision
              AND confirmation.confirmed_at = NEW.confirmed_at
          ) THEN
            RAISE EXCEPTION 'DEBRIEF_CONFIRMATION_REQUIRED';
          END IF;
          IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'confirmed') THEN
            RAISE EXCEPTION 'INVALID_DEBRIEF_TRANSITION';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE FUNCTION application.validate_debrief_confirmation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        current_status text;
        current_revision integer;
        current_deleted_at timestamptz;
      BEGIN
        SELECT status, revision, deleted_at
        INTO current_status, current_revision, current_deleted_at
        FROM application.debriefs
        WHERE owner_id = NEW.owner_id
          AND owner_epoch = NEW.owner_epoch
          AND id = NEW.debrief_id
        FOR UPDATE;
        IF NOT FOUND
          OR current_status <> 'draft'
          OR current_deleted_at IS NOT NULL
          OR current_revision <> NEW.based_on_debrief_revision THEN
          RAISE EXCEPTION 'DEBRIEF_CONFIRMATION_REVISION_MISMATCH';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE FUNCTION application.project_debrief_confirmation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        UPDATE application.debriefs
        SET
          status = 'confirmed',
          confirmed_at = NEW.confirmed_at,
          revision = revision + 1,
          updated_at = GREATEST(updated_at, NEW.confirmed_at)
        WHERE owner_id = NEW.owner_id
          AND owner_epoch = NEW.owner_epoch
          AND id = NEW.debrief_id;
        RETURN NEW;
      END;
      $$;

      CREATE FUNCTION application.validate_knowledge_clip_update()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id
          OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
          OR NEW.owner_epoch IS DISTINCT FROM OLD.owner_epoch
          OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
          OR NEW.creation_idempotency_key IS DISTINCT FROM OLD.creation_idempotency_key
          OR NEW.creation_request_hash IS DISTINCT FROM OLD.creation_request_hash
          OR NEW.created_at IS DISTINCT FROM OLD.created_at
          OR NEW.revision <> OLD.revision + 1
          OR OLD.deleted_at IS NOT NULL THEN
          RAISE EXCEPTION 'INVALID_KNOWLEDGE_CLIP_UPDATE';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER interview_sessions_owner_epoch_guard
        BEFORE INSERT OR UPDATE ON application.interview_sessions
        FOR EACH ROW EXECUTE FUNCTION application.assert_active_career_asset_owner_epoch();
      CREATE TRIGGER interview_sessions_reference_guard
        BEFORE INSERT OR UPDATE ON application.interview_sessions
        FOR EACH ROW EXECUTE FUNCTION application.validate_interview_session();
      CREATE TRIGGER interview_turns_owner_epoch_guard
        BEFORE INSERT OR UPDATE ON application.interview_turns
        FOR EACH ROW EXECUTE FUNCTION application.assert_active_career_asset_owner_epoch();
      CREATE TRIGGER interview_turns_reference_guard
        BEFORE INSERT ON application.interview_turns
        FOR EACH ROW EXECUTE FUNCTION application.validate_interview_turn();
      CREATE TRIGGER interview_turns_no_update
        BEFORE UPDATE ON application.interview_turns
        FOR EACH ROW EXECUTE FUNCTION application.prevent_career_asset_history_update();
      CREATE TRIGGER interview_feedback_owner_epoch_guard
        BEFORE INSERT OR UPDATE ON application.interview_feedback
        FOR EACH ROW EXECUTE FUNCTION application.assert_active_career_asset_owner_epoch();
      CREATE TRIGGER interview_feedback_reference_guard
        BEFORE INSERT ON application.interview_feedback
        FOR EACH ROW EXECUTE FUNCTION application.validate_interview_feedback();
      CREATE TRIGGER interview_feedback_no_update
        BEFORE UPDATE ON application.interview_feedback
        FOR EACH ROW EXECUTE FUNCTION application.prevent_career_asset_history_update();
      CREATE TRIGGER debriefs_owner_epoch_guard
        BEFORE INSERT OR UPDATE ON application.debriefs
        FOR EACH ROW EXECUTE FUNCTION application.assert_active_career_asset_owner_epoch();
      CREATE TRIGGER debriefs_reference_guard
        BEFORE INSERT OR UPDATE ON application.debriefs
        FOR EACH ROW EXECUTE FUNCTION application.validate_debrief();
      CREATE TRIGGER debrief_confirmations_owner_epoch_guard
        BEFORE INSERT OR UPDATE ON application.debrief_confirmations
        FOR EACH ROW EXECUTE FUNCTION application.assert_active_career_asset_owner_epoch();
      CREATE TRIGGER debrief_confirmations_reference_guard
        BEFORE INSERT ON application.debrief_confirmations
        FOR EACH ROW EXECUTE FUNCTION application.validate_debrief_confirmation();
      CREATE TRIGGER debrief_confirmations_projection
        AFTER INSERT ON application.debrief_confirmations
        FOR EACH ROW EXECUTE FUNCTION application.project_debrief_confirmation();
      CREATE TRIGGER debrief_confirmations_no_update
        BEFORE UPDATE ON application.debrief_confirmations
        FOR EACH ROW EXECUTE FUNCTION application.prevent_career_asset_history_update();
      CREATE TRIGGER knowledge_clips_owner_epoch_guard
        BEFORE INSERT OR UPDATE ON application.knowledge_clips
        FOR EACH ROW EXECUTE FUNCTION application.assert_active_career_asset_owner_epoch();
      CREATE TRIGGER knowledge_clips_update_guard
        BEFORE UPDATE ON application.knowledge_clips
        FOR EACH ROW EXECUTE FUNCTION application.validate_knowledge_clip_update();
      CREATE TRIGGER knowledge_clip_case_links_owner_epoch_guard
        BEFORE INSERT OR UPDATE ON application.knowledge_clip_case_links
        FOR EACH ROW EXECUTE FUNCTION application.assert_active_career_asset_owner_epoch();
      CREATE TRIGGER knowledge_clip_case_links_no_update
        BEFORE UPDATE ON application.knowledge_clip_case_links
        FOR EACH ROW EXECUTE FUNCTION application.prevent_career_asset_history_update();

      REVOKE ALL ON TABLE
        application.interview_sessions,
        application.interview_turns,
        application.interview_feedback,
        application.debriefs,
        application.debrief_confirmations,
        application.knowledge_clips,
        application.knowledge_clip_case_links
        FROM PUBLIC, aijob_collector_worker;

      GRANT SELECT, INSERT, UPDATE, DELETE
        ON TABLE application.interview_sessions, application.debriefs, application.knowledge_clips
        TO aijob_web_api;
      GRANT SELECT, INSERT, DELETE
        ON TABLE
          application.interview_turns,
          application.interview_feedback,
          application.debrief_confirmations,
          application.knowledge_clip_case_links
        TO aijob_web_api;

      GRANT SELECT, UPDATE, DELETE
        ON TABLE application.interview_sessions, application.debriefs
        TO aijob_match_worker;
      GRANT SELECT, INSERT, DELETE
        ON TABLE application.interview_turns, application.interview_feedback
        TO aijob_match_worker;
      GRANT SELECT, DELETE
        ON TABLE
          application.debrief_confirmations,
          application.knowledge_clips,
          application.knowledge_clip_case_links
        TO aijob_match_worker;

      GRANT ALL PRIVILEGES ON TABLE
        application.interview_sessions,
        application.interview_turns,
        application.interview_feedback,
        application.debriefs,
        application.debrief_confirmations,
        application.knowledge_clips,
        application.knowledge_clip_case_links
        TO aijob_ops_cli, aijob_migrator;
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Forward-only expand: never destroy interview, debrief or knowledge history.
  },
};
