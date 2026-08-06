import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "../types.js";

export async function applyApplicationCaseForwardContract(db: Kysely<Database>): Promise<void> {
  await sql`
    CREATE TABLE application.private_job_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES identity.owners(id),
      owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
      current_content_revision integer CHECK (current_content_revision > 0),
      current_requirement_set_revision integer CHECK (current_requirement_set_revision > 0),
      creation_idempotency_key text NOT NULL CHECK (
        char_length(btrim(creation_idempotency_key)) BETWEEN 1 AND 200
      ),
      creation_request_hash text NOT NULL CHECK (creation_request_hash ~ '^[a-f0-9]{64}$'),
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT private_job_snapshots_owner_id_unique UNIQUE (owner_id, id),
      CONSTRAINT private_job_snapshots_owner_creation_key_unique
        UNIQUE (owner_id, creation_idempotency_key),
      CONSTRAINT private_job_snapshots_current_revision_pair CHECK (
        num_nulls(current_content_revision, current_requirement_set_revision) IN (0, 2)
      ),
      CONSTRAINT private_job_snapshots_delete_after_creation CHECK (
        deleted_at IS NULL OR deleted_at >= created_at
      ),
      CONSTRAINT private_job_snapshots_update_after_creation CHECK (updated_at >= created_at)
    );

    CREATE TABLE application.private_job_snapshot_revisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL,
      owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
      snapshot_id uuid NOT NULL,
      content_revision integer NOT NULL CHECK (content_revision > 0),
      requirement_set_revision integer NOT NULL CHECK (requirement_set_revision > 0),
      title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
      company_name text CHECK (
        company_name IS NULL OR char_length(btrim(company_name)) BETWEEN 1 AND 240
      ),
      source_label text NOT NULL CHECK (char_length(btrim(source_label)) BETWEEN 1 AND 120),
      official_url text CHECK (official_url IS NULL OR official_url ~ '^https://'),
      source_provided boolean NOT NULL,
      content_text text NOT NULL CHECK (char_length(btrim(content_text)) BETWEEN 1 AND 200000),
      requirements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(requirements) = 'array'
      ),
      content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT private_job_snapshot_revisions_owner_id_unique UNIQUE (owner_id, id),
      CONSTRAINT private_job_snapshot_revisions_owner_snapshot_revision_unique
        UNIQUE (owner_id, snapshot_id, content_revision),
      CONSTRAINT private_job_snapshot_revisions_owner_snapshot_requirement_unique
        UNIQUE (owner_id, snapshot_id, content_revision, requirement_set_revision),
      CONSTRAINT private_job_snapshot_revisions_owner_snapshot_fk
        FOREIGN KEY (owner_id, snapshot_id)
        REFERENCES application.private_job_snapshots(owner_id, id)
        ON DELETE CASCADE,
      CONSTRAINT private_job_snapshot_revisions_source_consistent CHECK (
        official_url IS NULL OR source_provided
      )
    );

    ALTER TABLE application.private_job_snapshots
      ADD CONSTRAINT private_job_snapshots_current_revision_fk
        FOREIGN KEY (
          owner_id,
          id,
          current_content_revision,
          current_requirement_set_revision
        )
        REFERENCES application.private_job_snapshot_revisions(
          owner_id,
          snapshot_id,
          content_revision,
          requirement_set_revision
        );

    CREATE INDEX private_job_snapshots_owner_updated_idx
      ON application.private_job_snapshots(owner_id, updated_at DESC, id DESC)
      WHERE deleted_at IS NULL;
    CREATE INDEX private_job_snapshot_revisions_owner_snapshot_idx
      ON application.private_job_snapshot_revisions(owner_id, snapshot_id, content_revision DESC);

    CREATE FUNCTION application.prevent_private_job_snapshot_revision_update()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'IMMUTABLE_PRIVATE_JOB_SNAPSHOT_REVISION';
    END;
    $$;

    CREATE TRIGGER private_job_snapshot_revisions_no_update
      BEFORE UPDATE ON application.private_job_snapshot_revisions
      FOR EACH ROW EXECUTE FUNCTION application.prevent_private_job_snapshot_revision_update();

    ALTER TABLE application.application_cases
      ADD COLUMN job_context_kind text NOT NULL DEFAULT 'public' CHECK (
        job_context_kind IN ('public', 'private')
      ),
      ADD COLUMN private_job_snapshot_id uuid,
      ADD COLUMN job_context_revision integer NOT NULL DEFAULT 1 CHECK (
        job_context_revision > 0
      );

    ALTER TABLE application.application_cases
      ALTER COLUMN published_job_id DROP NOT NULL,
      ALTER COLUMN published_job_version_id DROP NOT NULL,
      ALTER COLUMN requirement_set_id DROP NOT NULL,
      ALTER COLUMN expires_at DROP NOT NULL,
      DROP CONSTRAINT application_cases_expiry_after_creation,
      DROP CONSTRAINT application_cases_retention_limit;

    DROP INDEX application.application_cases_one_active_job_per_owner_idx;
    DROP INDEX application.application_cases_expiry_idx;

    ALTER TABLE application.application_cases
      ADD CONSTRAINT application_cases_job_context_pair CHECK (
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
      ADD CONSTRAINT application_cases_private_snapshot_revision_fk
        FOREIGN KEY (owner_id, private_job_snapshot_id, job_context_revision)
        REFERENCES application.private_job_snapshot_revisions(
          owner_id,
          snapshot_id,
          content_revision
        );

    CREATE UNIQUE INDEX application_cases_one_active_public_job_per_owner_idx
      ON application.application_cases(owner_id, published_job_id)
      WHERE job_context_kind = 'public' AND ended_at IS NULL AND deleted_at IS NULL;
    CREATE UNIQUE INDEX application_cases_one_active_private_job_per_owner_idx
      ON application.application_cases(owner_id, private_job_snapshot_id)
      WHERE job_context_kind = 'private' AND ended_at IS NULL AND deleted_at IS NULL;
    CREATE INDEX application_cases_private_snapshot_idx
      ON application.application_cases(owner_id, private_job_snapshot_id, job_context_revision)
      WHERE private_job_snapshot_id IS NOT NULL;
    CREATE INDEX application_cases_legacy_expiry_idx
      ON application.application_cases(expires_at, id)
      WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

    ALTER TABLE application.case_events
      ADD COLUMN schema_version text NOT NULL DEFAULT 'legacy-case-event-v0' CHECK (
        schema_version IN ('legacy-case-event-v0', 'case-event-v1')
      );
    ALTER TABLE application.case_events
      ALTER COLUMN schema_version SET DEFAULT 'case-event-v1';

    CREATE FUNCTION application.jsonb_has_exact_keys(payload jsonb, expected_keys text[])
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT
        jsonb_typeof(payload) = 'object'
        AND payload ?& expected_keys
        AND payload - expected_keys = '{}'::jsonb
    $$;

    CREATE FUNCTION application.is_uuid_text(value text)
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    $$;

    CREATE FUNCTION application.is_reason_code(value jsonb)
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT
        value = 'null'::jsonb
        OR (
          jsonb_typeof(value) = 'string'
          AND trim(both '"' from value::text) ~ '^[A-Z0-9_]{1,100}$'
        )
    $$;

    CREATE FUNCTION application.is_bounded_identifier(value jsonb, maximum_length integer)
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT
        jsonb_typeof(value) = 'string'
        AND char_length(btrim(trim(both '"' from value::text))) BETWEEN 1 AND maximum_length
    $$;

    CREATE FUNCTION application.is_positive_integer(value jsonb)
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT jsonb_typeof(value) = 'number' AND value::text ~ '^[1-9][0-9]*$'
    $$;

    CREATE FUNCTION application.is_unique_identifier_array(
      payload jsonb,
      maximum_items integer
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
            WHERE NOT application.is_bounded_identifier(entry.value, 200)
          )
          AND (
            SELECT count(*) = count(DISTINCT entry.value)
            FROM jsonb_array_elements(payload) AS entry(value)
          )
      END
    $$;

    CREATE FUNCTION application.is_valid_case_event_data(
      checked_event_type text,
      checked_schema_version text,
      payload jsonb
    )
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT CASE
        WHEN checked_schema_version = 'legacy-case-event-v0' THEN true
        WHEN checked_schema_version <> 'case-event-v1' THEN false
        WHEN payload ->> 'schemaVersion' <> 'case-event-v1' THEN false
        ELSE CASE checked_event_type
          WHEN 'case_created' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY['schemaVersion', 'initialStage', 'jobContextKind', 'jobContextRevision']
          )
            AND payload ->> 'initialStage' IN (
              'interested',
              'preparing',
              'applied',
              'interviewing',
              'resolved'
            )
            AND payload ->> 'jobContextKind' IN ('public', 'private')
            AND application.is_positive_integer(payload -> 'jobContextRevision')
          WHEN 'stage_transitioned' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY['schemaVersion', 'fromStage', 'toStage', 'outcome', 'reasonCode']
          )
            AND payload ->> 'fromStage' IN (
              'interested',
              'preparing',
              'applied',
              'interviewing',
              'resolved'
            )
            AND payload ->> 'toStage' IN (
              'interested',
              'preparing',
              'applied',
              'interviewing',
              'resolved'
            )
            AND payload ->> 'fromStage' <> payload ->> 'toStage'
            AND (
              (
                payload ->> 'toStage' = 'resolved'
                AND payload ->> 'outcome' IN (
                  'offer',
                  'rejected',
                  'withdrawn',
                  'expired',
                  'unknown'
                )
              )
              OR (
                payload ->> 'toStage' <> 'resolved'
                AND payload -> 'outcome' = 'null'::jsonb
              )
            )
            AND application.is_reason_code(payload -> 'reasonCode')
          WHEN 'outcome_corrected' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY['schemaVersion', 'fromOutcome', 'toOutcome', 'reasonCode']
          )
            AND payload ->> 'fromOutcome' IN (
              'offer',
              'rejected',
              'withdrawn',
              'expired',
              'unknown'
            )
            AND payload ->> 'toOutcome' IN (
              'offer',
              'rejected',
              'withdrawn',
              'expired',
              'unknown'
            )
            AND payload ->> 'fromOutcome' <> payload ->> 'toOutcome'
            AND application.is_reason_code(payload -> 'reasonCode')
          WHEN 'job_version_upgraded' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY[
              'schemaVersion',
              'fromPublishedJobVersionId',
              'toPublishedJobVersionId',
              'fromRequirementSetId',
              'toRequirementSetId',
              'reasonCode'
            ]
          )
            AND application.is_uuid_text(payload ->> 'fromPublishedJobVersionId')
            AND application.is_uuid_text(payload ->> 'toPublishedJobVersionId')
            AND payload ->> 'fromPublishedJobVersionId' <> payload ->> 'toPublishedJobVersionId'
            AND application.is_uuid_text(payload ->> 'fromRequirementSetId')
            AND application.is_uuid_text(payload ->> 'toRequirementSetId')
            AND application.is_reason_code(payload -> 'reasonCode')
          WHEN 'requirement_state_changed' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY[
              'schemaVersion',
              'requirementSetId',
              'requirementId',
              'fromState',
              'toState',
              'reasonCode'
            ]
          )
            AND application.is_uuid_text(payload ->> 'requirementSetId')
            AND application.is_bounded_identifier(payload -> 'requirementId', 200)
            AND (
              payload -> 'fromState' = 'null'::jsonb
              OR payload ->> 'fromState' IN ('confirmed', 'needs_work', 'unconfirmed')
            )
            AND payload ->> 'toState' IN ('confirmed', 'needs_work', 'unconfirmed')
            AND (
              payload -> 'fromState' = 'null'::jsonb
              OR payload ->> 'fromState' <> payload ->> 'toState'
            )
            AND application.is_reason_code(payload -> 'reasonCode')
          WHEN 'requirement_evidence_changed' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY[
              'schemaVersion',
              'requirementSetId',
              'requirementId',
              'evidenceRevisionId',
              'evidenceIds',
              'action'
            ]
          )
            AND application.is_uuid_text(payload ->> 'requirementSetId')
            AND application.is_bounded_identifier(payload -> 'requirementId', 200)
            AND application.is_uuid_text(payload ->> 'evidenceRevisionId')
            AND application.is_unique_identifier_array(payload -> 'evidenceIds', 500)
            AND jsonb_array_length(payload -> 'evidenceIds') > 0
            AND payload ->> 'action' IN ('linked', 'removed')
          WHEN 'question_added' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY['schemaVersion', 'questionId', 'requirementId']
          )
            AND application.is_uuid_text(payload ->> 'questionId')
            AND (
              payload -> 'requirementId' = 'null'::jsonb
              OR application.is_bounded_identifier(payload -> 'requirementId', 200)
            )
          WHEN 'question_updated' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY['schemaVersion', 'questionId', 'fromStatus', 'toStatus']
          )
            AND application.is_uuid_text(payload ->> 'questionId')
            AND payload ->> 'fromStatus' IN ('open', 'answered', 'dismissed')
            AND payload ->> 'toStatus' IN ('open', 'answered', 'dismissed')
            AND payload ->> 'fromStatus' <> payload ->> 'toStatus'
          WHEN 'official_link_opened' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY['schemaVersion', 'jobContextKind', 'officialUrlHash']
          )
            AND payload ->> 'jobContextKind' IN ('public', 'private')
            AND payload ->> 'officialUrlHash' ~ '^[a-f0-9]{64}$'
          WHEN 'manual_application_recorded' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY['schemaVersion', 'fromStage', 'toStage', 'reasonCode']
          )
            AND payload ->> 'fromStage' IN (
              'interested',
              'preparing',
              'applied',
              'interviewing',
              'resolved'
            )
            AND payload ->> 'toStage' = 'applied'
            AND payload ->> 'fromStage' <> 'applied'
            AND application.is_reason_code(payload -> 'reasonCode')
          WHEN 'resume_document_derived' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY['schemaVersion', 'documentId', 'contentRevisionId']
          )
            AND application.is_uuid_text(payload ->> 'documentId')
            AND application.is_uuid_text(payload ->> 'contentRevisionId')
          WHEN 'interview_started' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY['schemaVersion', 'interviewSessionId', 'mode']
          )
            AND application.is_uuid_text(payload ->> 'interviewSessionId')
            AND payload ->> 'mode' IN ('template', 'controlled_ai')
          WHEN 'debrief_confirmed' THEN application.jsonb_has_exact_keys(
            payload,
            ARRAY['schemaVersion', 'debriefId', 'evidenceRevisionId']
          )
            AND application.is_uuid_text(payload ->> 'debriefId')
            AND (
              payload -> 'evidenceRevisionId' = 'null'::jsonb
              OR application.is_uuid_text(payload ->> 'evidenceRevisionId')
            )
          ELSE false
        END
      END
    $$;

    ALTER TABLE application.case_events
      ADD CONSTRAINT case_events_strict_data CHECK (
        application.is_valid_case_event_data(event_type, schema_version, event_data)
      );

    CREATE FUNCTION application.enforce_new_case_event_schema()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.schema_version <> 'case-event-v1' THEN
        RAISE EXCEPTION 'LEGACY_CASE_EVENT_READ_ONLY';
      END IF;
      IF NOT application.is_valid_case_event_data(
        NEW.event_type,
        NEW.schema_version,
        NEW.event_data
      ) THEN
        RAISE EXCEPTION 'INVALID_CASE_EVENT_DATA';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER case_events_strict_insert
      BEFORE INSERT ON application.case_events
      FOR EACH ROW EXECUTE FUNCTION application.enforce_new_case_event_schema();

    REVOKE ALL ON TABLE
      application.private_job_snapshots,
      application.private_job_snapshot_revisions
      FROM PUBLIC, aijob_collector_worker;

    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE application.private_job_snapshots
      TO aijob_web_api;
    GRANT SELECT, INSERT, DELETE
      ON TABLE application.private_job_snapshot_revisions
      TO aijob_web_api;

    GRANT SELECT, DELETE
      ON TABLE
        application.private_job_snapshots,
        application.private_job_snapshot_revisions,
        application.case_events,
        application.case_requirement_states,
        application.case_requirement_evidence_links,
        application.case_questions
      TO aijob_match_worker;

    GRANT ALL PRIVILEGES
      ON TABLE
        application.private_job_snapshots,
        application.private_job_snapshot_revisions
      TO aijob_ops_cli, aijob_migrator;
  `.execute(db);
}
