import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";

import type { Database } from "../types.js";

export const privateRequirementContextForwardRepairMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE application.case_requirement_evidence_links
        DROP CONSTRAINT case_requirement_evidence_links_requirement_fk;
      ALTER TABLE application.case_questions
        DROP CONSTRAINT case_questions_requirement_fk,
        DROP CONSTRAINT case_questions_requirement_reference_pair;

      ALTER TABLE application.case_requirement_states
        ADD COLUMN requirement_context_kind text,
        ADD COLUMN requirement_set_revision integer,
        ALTER COLUMN requirement_set_id DROP NOT NULL;

      UPDATE application.case_requirement_states
      SET requirement_context_kind = 'public'
      WHERE requirement_context_kind IS NULL;

      ALTER TABLE application.case_requirement_states
        ALTER COLUMN requirement_context_kind SET NOT NULL,
        ADD CONSTRAINT case_requirement_states_context_kind_check CHECK (
          requirement_context_kind IN ('public', 'private')
        ),
        ADD CONSTRAINT case_requirement_states_context_consistent CHECK (
          (
            requirement_context_kind = 'public'
            AND requirement_set_id IS NOT NULL
            AND requirement_set_revision IS NULL
          )
          OR (
            requirement_context_kind = 'private'
            AND requirement_set_id IS NULL
            AND requirement_set_revision > 0
          )
        ),
        ADD CONSTRAINT case_requirement_states_owner_epoch_case_id_unique
          UNIQUE (owner_id, owner_epoch, case_id, id);

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM application.case_requirement_states AS requirement_state
          LEFT JOIN application.application_cases AS application_case
            ON application_case.owner_id = requirement_state.owner_id
            AND application_case.owner_epoch = requirement_state.owner_epoch
            AND application_case.id = requirement_state.case_id
          WHERE application_case.id IS NULL
            OR application_case.job_context_kind <> 'public'
            OR application_case.requirement_set_id IS DISTINCT FROM
              requirement_state.requirement_set_id
        ) THEN
          RAISE EXCEPTION 'LEGACY_REQUIREMENT_STATE_CONTEXT_MISMATCH';
        END IF;
      END;
      $$;

      ALTER TABLE application.case_requirement_states
        DROP CONSTRAINT case_requirement_states_natural_unique;
      CREATE UNIQUE INDEX case_requirement_states_public_natural_unique_idx
        ON application.case_requirement_states(
          owner_id,
          case_id,
          requirement_set_id,
          requirement_id
        )
        WHERE requirement_context_kind = 'public';
      CREATE UNIQUE INDEX case_requirement_states_private_natural_unique_idx
        ON application.case_requirement_states(
          owner_id,
          case_id,
          requirement_set_revision,
          requirement_id
        )
        WHERE requirement_context_kind = 'private';
      CREATE INDEX case_requirement_states_private_revision_idx
        ON application.case_requirement_states(
          owner_id,
          case_id,
          requirement_set_revision
        )
        WHERE requirement_context_kind = 'private';

      ALTER TABLE application.case_requirement_evidence_links
        ADD COLUMN requirement_state_id uuid;
      UPDATE application.case_requirement_evidence_links AS evidence_link
      SET requirement_state_id = requirement_state.id
      FROM application.case_requirement_states AS requirement_state
      WHERE requirement_state.owner_id = evidence_link.owner_id
        AND requirement_state.owner_epoch = evidence_link.owner_epoch
        AND requirement_state.case_id = evidence_link.case_id
        AND requirement_state.requirement_set_id = evidence_link.requirement_set_id
        AND requirement_state.requirement_id = evidence_link.requirement_id;
      ALTER TABLE application.case_requirement_evidence_links
        ALTER COLUMN requirement_state_id SET NOT NULL,
        ALTER COLUMN requirement_set_id DROP NOT NULL,
        DROP CONSTRAINT case_requirement_evidence_links_natural_unique,
        ADD CONSTRAINT case_requirement_evidence_links_requirement_state_fk
          FOREIGN KEY (owner_id, owner_epoch, case_id, requirement_state_id)
          REFERENCES application.case_requirement_states(
            owner_id,
            owner_epoch,
            case_id,
            id
          )
          ON DELETE CASCADE,
        ADD CONSTRAINT case_requirement_evidence_links_natural_unique
          UNIQUE (
            owner_id,
            requirement_state_id,
            evidence_revision_id,
            evidence_id
          );
      CREATE INDEX case_requirement_evidence_links_requirement_state_idx
        ON application.case_requirement_evidence_links(
          owner_id,
          requirement_state_id
        );

      ALTER TABLE application.case_questions
        ADD COLUMN requirement_state_id uuid;
      UPDATE application.case_questions AS question
      SET requirement_state_id = requirement_state.id
      FROM application.case_requirement_states AS requirement_state
      WHERE requirement_state.owner_id = question.owner_id
        AND requirement_state.owner_epoch = question.owner_epoch
        AND requirement_state.case_id = question.case_id
        AND requirement_state.requirement_set_id = question.requirement_set_id
        AND requirement_state.requirement_id = question.requirement_id;
      ALTER TABLE application.case_questions
        ADD CONSTRAINT case_questions_requirement_reference_consistent CHECK (
          (
            requirement_state_id IS NULL
            AND requirement_set_id IS NULL
            AND requirement_id IS NULL
          )
          OR (
            requirement_state_id IS NOT NULL
            AND requirement_id IS NOT NULL
          )
        ),
        ADD CONSTRAINT case_questions_requirement_state_fk
          FOREIGN KEY (owner_id, owner_epoch, case_id, requirement_state_id)
          REFERENCES application.case_requirement_states(
            owner_id,
            owner_epoch,
            case_id,
            id
          )
          ON DELETE CASCADE;
      CREATE INDEX case_questions_requirement_state_idx
        ON application.case_questions(owner_id, requirement_state_id)
        WHERE requirement_state_id IS NOT NULL;

      CREATE FUNCTION application.validate_case_requirement_state_context()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        pinned_context_kind text;
        pinned_requirement_set_id uuid;
        pinned_requirement_set_revision integer;
      BEGIN
        IF TG_OP = 'UPDATE' AND (
          NEW.owner_id IS DISTINCT FROM OLD.owner_id
          OR NEW.owner_epoch IS DISTINCT FROM OLD.owner_epoch
          OR NEW.case_id IS DISTINCT FROM OLD.case_id
          OR NEW.requirement_context_kind IS DISTINCT FROM OLD.requirement_context_kind
          OR NEW.requirement_set_id IS DISTINCT FROM OLD.requirement_set_id
          OR NEW.requirement_set_revision IS DISTINCT FROM OLD.requirement_set_revision
          OR NEW.requirement_id IS DISTINCT FROM OLD.requirement_id
        ) THEN
          RAISE EXCEPTION 'IMMUTABLE_REQUIREMENT_STATE_CONTEXT';
        END IF;

        SELECT
          application_case.job_context_kind,
          application_case.requirement_set_id,
          private_revision.requirement_set_revision
        INTO
          pinned_context_kind,
          pinned_requirement_set_id,
          pinned_requirement_set_revision
        FROM application.application_cases AS application_case
        LEFT JOIN application.private_job_snapshot_revisions AS private_revision
          ON application_case.job_context_kind = 'private'
          AND private_revision.owner_id = application_case.owner_id
          AND private_revision.snapshot_id = application_case.private_job_snapshot_id
          AND private_revision.content_revision = application_case.job_context_revision
        WHERE application_case.owner_id = NEW.owner_id
          AND application_case.owner_epoch = NEW.owner_epoch
          AND application_case.id = NEW.case_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'REQUIREMENT_STATE_CASE_CONTEXT_NOT_FOUND';
        END IF;

        IF NEW.requirement_context_kind IS DISTINCT FROM pinned_context_kind THEN
          RAISE EXCEPTION 'REQUIREMENT_STATE_CONTEXT_KIND_MISMATCH';
        END IF;

        IF pinned_context_kind = 'public' THEN
          IF NEW.requirement_set_id IS DISTINCT FROM pinned_requirement_set_id
            OR NEW.requirement_set_revision IS NOT NULL THEN
            RAISE EXCEPTION 'PUBLIC_REQUIREMENT_STATE_CONTEXT_MISMATCH';
          END IF;
        ELSIF NEW.requirement_set_id IS NOT NULL
          OR NEW.requirement_set_revision IS DISTINCT FROM pinned_requirement_set_revision THEN
          RAISE EXCEPTION 'PRIVATE_REQUIREMENT_STATE_CONTEXT_MISMATCH';
        END IF;

        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER case_requirement_states_context_guard
        BEFORE INSERT OR UPDATE OF
          owner_id,
          owner_epoch,
          case_id,
          requirement_context_kind,
          requirement_set_id,
          requirement_set_revision,
          requirement_id
        ON application.case_requirement_states
        FOR EACH ROW EXECUTE FUNCTION application.validate_case_requirement_state_context();

      CREATE FUNCTION application.validate_requirement_state_reference()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        referenced_context_kind text;
        referenced_requirement_set_id uuid;
        referenced_requirement_id text;
      BEGIN
        IF NEW.requirement_state_id IS NULL THEN
          RETURN NEW;
        END IF;

        SELECT
          requirement_context_kind,
          requirement_set_id,
          requirement_id
        INTO
          referenced_context_kind,
          referenced_requirement_set_id,
          referenced_requirement_id
        FROM application.case_requirement_states
        WHERE owner_id = NEW.owner_id
          AND owner_epoch = NEW.owner_epoch
          AND case_id = NEW.case_id
          AND id = NEW.requirement_state_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'REQUIREMENT_STATE_REFERENCE_NOT_FOUND';
        END IF;
        IF NEW.requirement_id IS DISTINCT FROM referenced_requirement_id THEN
          RAISE EXCEPTION 'REQUIREMENT_STATE_ID_MISMATCH';
        END IF;
        IF referenced_context_kind = 'public'
          AND NEW.requirement_set_id IS DISTINCT FROM referenced_requirement_set_id THEN
          RAISE EXCEPTION 'PUBLIC_REQUIREMENT_REFERENCE_MISMATCH';
        END IF;
        IF referenced_context_kind = 'private' AND NEW.requirement_set_id IS NOT NULL THEN
          RAISE EXCEPTION 'PRIVATE_REQUIREMENT_REFERENCE_MUST_NOT_USE_PUBLIC_SET';
        END IF;

        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER case_requirement_evidence_links_state_guard
        BEFORE INSERT OR UPDATE OF
          owner_id,
          owner_epoch,
          case_id,
          requirement_state_id,
          requirement_set_id,
          requirement_id
        ON application.case_requirement_evidence_links
        FOR EACH ROW EXECUTE FUNCTION application.validate_requirement_state_reference();
      CREATE TRIGGER case_questions_requirement_state_guard
        BEFORE INSERT OR UPDATE OF
          owner_id,
          owner_epoch,
          case_id,
          requirement_state_id,
          requirement_set_id,
          requirement_id
        ON application.case_questions
        FOR EACH ROW EXECUTE FUNCTION application.validate_requirement_state_reference();

      ALTER FUNCTION application.is_valid_case_event_data(text, text, jsonb)
        RENAME TO is_valid_case_event_data_026;

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
        SELECT COALESCE(
          application.is_valid_case_event_data_026(
            checked_event_type,
            checked_schema_version,
            payload
          ),
          false
        ) OR (
          checked_schema_version = 'case-event-v1'
          AND payload ->> 'schemaVersion' = 'case-event-v1'
          AND CASE checked_event_type
            WHEN 'requirement_state_changed' THEN application.jsonb_has_exact_keys(
              payload,
              ARRAY[
                'schemaVersion',
                'requirementContextKind',
                'requirementSetRevision',
                'requirementId',
                'fromState',
                'toState',
                'reasonCode'
              ]
            )
              AND payload ->> 'requirementContextKind' = 'private'
              AND application.is_positive_integer(payload -> 'requirementSetRevision')
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
                'requirementContextKind',
                'requirementSetRevision',
                'requirementId',
                'evidenceRevisionId',
                'evidenceIds',
                'action'
              ]
            )
              AND payload ->> 'requirementContextKind' = 'private'
              AND application.is_positive_integer(payload -> 'requirementSetRevision')
              AND application.is_bounded_identifier(payload -> 'requirementId', 200)
              AND application.is_uuid_text(payload ->> 'evidenceRevisionId')
              AND application.is_unique_identifier_array(payload -> 'evidenceIds', 500)
              AND jsonb_array_length(payload -> 'evidenceIds') > 0
              AND payload ->> 'action' IN ('linked', 'removed')
            ELSE false
          END
        )
      $$;

      ALTER TABLE application.case_events
        DROP CONSTRAINT case_events_strict_data,
        ADD CONSTRAINT case_events_strict_data CHECK (
          application.is_valid_case_event_data(event_type, schema_version, event_data)
        );

      CREATE OR REPLACE FUNCTION application.enforce_new_case_event_schema()
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
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Forward-only repair: requirement decisions and event history must not be destroyed.
  },
};
