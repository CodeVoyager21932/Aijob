import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

export const applicationCaseCoreExpandMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      CREATE SCHEMA IF NOT EXISTS application;
      REVOKE ALL ON SCHEMA application FROM PUBLIC;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'published_job_versions_job_id_id_unique'
            AND conrelid = 'catalog.published_job_versions'::regclass
        ) THEN
          ALTER TABLE catalog.published_job_versions
            ADD CONSTRAINT published_job_versions_job_id_id_unique
              UNIQUE (published_job_id, id);
        END IF;
      END
      $$;

      CREATE TABLE application.application_cases (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        published_job_id uuid NOT NULL,
        published_job_version_id uuid NOT NULL,
        requirement_set_id uuid NOT NULL,
        stage text NOT NULL DEFAULT 'interested' CHECK (
          stage IN ('interested', 'preparing', 'applied', 'interviewing', 'resolved')
        ),
        outcome text CHECK (
          outcome IS NULL OR outcome IN ('offer', 'rejected', 'withdrawn', 'expired', 'unknown')
        ),
        revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
        creation_idempotency_key text NOT NULL CHECK (
          char_length(btrim(creation_idempotency_key)) BETWEEN 1 AND 200
        ),
        creation_request_hash text NOT NULL CHECK (
          creation_request_hash ~ '^[a-f0-9]{64}$'
        ),
        expires_at timestamptz NOT NULL,
        ended_at timestamptz,
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT application_cases_owner_id_id_unique UNIQUE (owner_id, id),
        CONSTRAINT application_cases_owner_creation_key_unique
          UNIQUE (owner_id, creation_idempotency_key),
        CONSTRAINT application_cases_job_version_owner_fk
          FOREIGN KEY (published_job_id, published_job_version_id)
          REFERENCES catalog.published_job_versions(published_job_id, id),
        CONSTRAINT application_cases_requirement_set_owner_fk
          FOREIGN KEY (published_job_version_id, requirement_set_id)
          REFERENCES catalog.job_requirement_sets(published_job_version_id, id),
        CONSTRAINT application_cases_resolution_consistent CHECK (
          (
            stage = 'resolved'
            AND outcome IS NOT NULL
            AND ended_at IS NOT NULL
          )
          OR
          (
            stage <> 'resolved'
            AND outcome IS NULL
            AND ended_at IS NULL
          )
        ),
        CONSTRAINT application_cases_expiry_after_creation CHECK (expires_at > created_at),
        CONSTRAINT application_cases_retention_limit CHECK (
          expires_at <= created_at + interval '30 days'
        ),
        CONSTRAINT application_cases_end_after_creation CHECK (
          ended_at IS NULL OR ended_at >= created_at
        ),
        CONSTRAINT application_cases_delete_after_creation CHECK (
          deleted_at IS NULL OR deleted_at >= created_at
        ),
        CONSTRAINT application_cases_update_after_creation CHECK (
          updated_at >= created_at
        )
      );

      CREATE UNIQUE INDEX application_cases_one_active_job_per_owner_idx
        ON application.application_cases(owner_id, published_job_id)
        WHERE ended_at IS NULL AND deleted_at IS NULL;
      CREATE INDEX application_cases_owner_updated_idx
        ON application.application_cases(owner_id, updated_at DESC, id DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX application_cases_expiry_idx
        ON application.application_cases(expires_at, id)
        WHERE deleted_at IS NULL;
      CREATE INDEX application_cases_job_version_idx
        ON application.application_cases(published_job_id, published_job_version_id);
      CREATE INDEX application_cases_requirement_set_idx
        ON application.application_cases(published_job_version_id, requirement_set_id);

      CREATE TABLE application.case_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        case_id uuid NOT NULL,
        sequence integer NOT NULL CHECK (sequence > 0),
        event_type text NOT NULL CHECK (
          event_type IN (
            'case_created',
            'stage_transitioned',
            'outcome_corrected',
            'job_version_upgraded',
            'requirement_state_changed',
            'requirement_evidence_changed',
            'question_added',
            'question_updated',
            'official_link_opened',
            'manual_application_recorded',
            'resume_document_derived',
            'interview_started',
            'debrief_confirmed'
          )
        ),
        actor_type text NOT NULL CHECK (actor_type IN ('owner', 'system')),
        event_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
          jsonb_typeof(event_data) = 'object'
        ),
        idempotency_scope text NOT NULL CHECK (
          char_length(btrim(idempotency_scope)) BETWEEN 1 AND 200
        ),
        idempotency_key text NOT NULL CHECK (
          char_length(btrim(idempotency_key)) BETWEEN 1 AND 200
        ),
        request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT case_events_owner_case_fk
          FOREIGN KEY (owner_id, case_id)
          REFERENCES application.application_cases(owner_id, id)
          ON DELETE CASCADE,
        CONSTRAINT case_events_owner_case_sequence_unique
          UNIQUE (owner_id, case_id, sequence),
        CONSTRAINT case_events_owner_idempotency_unique
          UNIQUE (owner_id, idempotency_scope, idempotency_key)
      );

      CREATE TABLE application.case_requirement_states (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        case_id uuid NOT NULL,
        requirement_set_id uuid NOT NULL REFERENCES catalog.job_requirement_sets(id),
        requirement_id text NOT NULL CHECK (
          char_length(btrim(requirement_id)) BETWEEN 1 AND 200
        ),
        state text NOT NULL CHECK (state IN ('confirmed', 'needs_work', 'unconfirmed')),
        user_note text CHECK (user_note IS NULL OR char_length(user_note) <= 2000),
        revision integer NOT NULL CHECK (revision > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT case_requirement_states_owner_case_fk
          FOREIGN KEY (owner_id, case_id)
          REFERENCES application.application_cases(owner_id, id)
          ON DELETE CASCADE,
        CONSTRAINT case_requirement_states_natural_unique
          UNIQUE (owner_id, case_id, requirement_set_id, requirement_id),
        CONSTRAINT case_requirement_states_update_after_creation CHECK (
          updated_at >= created_at
        )
      );
      CREATE INDEX case_requirement_states_requirement_set_idx
        ON application.case_requirement_states(requirement_set_id);

      CREATE TABLE application.case_requirement_evidence_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        case_id uuid NOT NULL,
        requirement_set_id uuid NOT NULL,
        requirement_id text NOT NULL CHECK (
          char_length(btrim(requirement_id)) BETWEEN 1 AND 200
        ),
        evidence_revision_id uuid NOT NULL,
        evidence_id text NOT NULL CHECK (
          char_length(btrim(evidence_id)) BETWEEN 1 AND 200
        ),
        revision integer NOT NULL CHECK (revision > 0),
        linked_at timestamptz NOT NULL DEFAULT now(),
        removed_at timestamptz,
        CONSTRAINT case_requirement_evidence_links_requirement_fk
          FOREIGN KEY (owner_id, case_id, requirement_set_id, requirement_id)
          REFERENCES application.case_requirement_states(
            owner_id,
            case_id,
            requirement_set_id,
            requirement_id
          )
          ON DELETE CASCADE,
        CONSTRAINT case_requirement_evidence_links_owner_evidence_fk
          FOREIGN KEY (owner_id, evidence_revision_id)
          REFERENCES profile.resume_evidence_revisions(owner_id, id),
        CONSTRAINT case_requirement_evidence_links_natural_unique
          UNIQUE (
            owner_id,
            case_id,
            requirement_set_id,
            requirement_id,
            evidence_revision_id,
            evidence_id
          ),
        CONSTRAINT case_requirement_evidence_links_removal_order CHECK (
          removed_at IS NULL OR removed_at >= linked_at
        )
      );
      CREATE INDEX case_requirement_evidence_links_owner_evidence_idx
        ON application.case_requirement_evidence_links(owner_id, evidence_revision_id);

      CREATE TABLE application.case_questions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        case_id uuid NOT NULL,
        requirement_set_id uuid,
        requirement_id text CHECK (
          requirement_id IS NULL
          OR char_length(btrim(requirement_id)) BETWEEN 1 AND 200
        ),
        question text NOT NULL CHECK (char_length(btrim(question)) BETWEEN 1 AND 1000),
        answer text CHECK (answer IS NULL OR char_length(btrim(answer)) BETWEEN 1 AND 3000),
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'dismissed')),
        revision integer NOT NULL CHECK (revision > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT case_questions_owner_case_fk
          FOREIGN KEY (owner_id, case_id)
          REFERENCES application.application_cases(owner_id, id)
          ON DELETE CASCADE,
        CONSTRAINT case_questions_requirement_reference_pair CHECK (
          num_nulls(requirement_set_id, requirement_id) IN (0, 2)
        ),
        CONSTRAINT case_questions_requirement_fk
          FOREIGN KEY (owner_id, case_id, requirement_set_id, requirement_id)
          REFERENCES application.case_requirement_states(
            owner_id,
            case_id,
            requirement_set_id,
            requirement_id
          )
          ON DELETE CASCADE,
        CONSTRAINT case_questions_answer_consistent CHECK (
          (status = 'answered' AND answer IS NOT NULL)
          OR (status IN ('open', 'dismissed') AND answer IS NULL)
        ),
        CONSTRAINT case_questions_update_after_creation CHECK (updated_at >= created_at)
      );
      CREATE INDEX case_questions_owner_case_idx
        ON application.case_questions(owner_id, case_id);
      CREATE INDEX case_questions_requirement_set_idx
        ON application.case_questions(requirement_set_id)
        WHERE requirement_set_id IS NOT NULL;

      CREATE FUNCTION application.prevent_case_event_update()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'IMMUTABLE_CASE_EVENT';
      END;
      $$;

      CREATE TRIGGER case_events_no_update
        BEFORE UPDATE ON application.case_events
        FOR EACH ROW EXECUTE FUNCTION application.prevent_case_event_update();

      REVOKE ALL ON ALL TABLES IN SCHEMA application FROM PUBLIC, aijob_collector_worker;
      REVOKE ALL ON SCHEMA application FROM aijob_collector_worker;

      GRANT USAGE ON SCHEMA application
        TO aijob_web_api, aijob_match_worker, aijob_ops_cli, aijob_migrator;

      GRANT SELECT, INSERT, UPDATE, DELETE
        ON TABLE application.application_cases
        TO aijob_web_api;
      GRANT SELECT, INSERT ON TABLE application.case_events TO aijob_web_api;
      GRANT SELECT, INSERT, UPDATE, DELETE
        ON TABLE application.case_requirement_states,
          application.case_requirement_evidence_links,
          application.case_questions
        TO aijob_web_api;

      GRANT SELECT, DELETE ON TABLE application.application_cases TO aijob_match_worker;
      GRANT SELECT ON TABLE application.case_events,
        application.case_requirement_states,
        application.case_requirement_evidence_links,
        application.case_questions
        TO aijob_match_worker;

      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA application
        TO aijob_ops_cli, aijob_migrator;
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Forward-only expand migration: rolling back must not destroy immutable personal history.
  },
};
