import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";

import type { Database } from "../types.js";

export const caseMutationEventV2ForwardRepairMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER FUNCTION application.is_valid_case_event_data(text, text, jsonb)
        RENAME TO is_valid_case_event_data_026b;

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
          application.is_valid_case_event_data_026b(
            checked_event_type,
            checked_schema_version,
            payload
          ),
          false
        ) OR (
          checked_schema_version = 'case-event-v2'
          AND payload ->> 'schemaVersion' = 'case-event-v2'
          AND CASE checked_event_type
            WHEN 'requirement_state_changed' THEN (
              application.jsonb_has_exact_keys(
                payload,
                ARRAY[
                  'schemaVersion',
                  'requirementSetId',
                  'requirementId',
                  'fromState',
                  'toState',
                  'noteChanged',
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
                AND jsonb_typeof(payload -> 'noteChanged') = 'boolean'
                AND (
                  payload -> 'fromState' = 'null'::jsonb
                  OR payload ->> 'fromState' <> payload ->> 'toState'
                  OR payload ->> 'noteChanged' = 'true'
                )
                AND application.is_reason_code(payload -> 'reasonCode')
            ) OR (
              application.jsonb_has_exact_keys(
                payload,
                ARRAY[
                  'schemaVersion',
                  'requirementContextKind',
                  'requirementSetRevision',
                  'requirementId',
                  'fromState',
                  'toState',
                  'noteChanged',
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
                AND jsonb_typeof(payload -> 'noteChanged') = 'boolean'
                AND (
                  payload -> 'fromState' = 'null'::jsonb
                  OR payload ->> 'fromState' <> payload ->> 'toState'
                  OR payload ->> 'noteChanged' = 'true'
                )
                AND application.is_reason_code(payload -> 'reasonCode')
            )
            WHEN 'requirement_evidence_changed' THEN ((
              application.jsonb_has_exact_keys(
                payload,
                ARRAY[
                  'schemaVersion',
                  'requirementSetId',
                  'requirementId',
                  'evidenceRevisionId',
                  'linkedEvidenceIds',
                  'removedEvidenceIds'
                ]
              )
                AND application.is_uuid_text(payload ->> 'requirementSetId')
                AND application.is_bounded_identifier(payload -> 'requirementId', 200)
            ) OR (
              application.jsonb_has_exact_keys(
                payload,
                ARRAY[
                  'schemaVersion',
                  'requirementContextKind',
                  'requirementSetRevision',
                  'requirementId',
                  'evidenceRevisionId',
                  'linkedEvidenceIds',
                  'removedEvidenceIds'
                ]
              )
                AND payload ->> 'requirementContextKind' = 'private'
                AND application.is_positive_integer(payload -> 'requirementSetRevision')
                AND application.is_bounded_identifier(payload -> 'requirementId', 200)
            ))
              AND application.is_uuid_text(payload ->> 'evidenceRevisionId')
              AND application.is_unique_identifier_array(payload -> 'linkedEvidenceIds', 500)
              AND application.is_unique_identifier_array(payload -> 'removedEvidenceIds', 500)
              AND (
                jsonb_array_length(payload -> 'linkedEvidenceIds')
                + jsonb_array_length(payload -> 'removedEvidenceIds')
              ) > 0
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(payload -> 'linkedEvidenceIds') AS linked(value)
                JOIN jsonb_array_elements(payload -> 'removedEvidenceIds') AS removed(value)
                  ON removed.value = linked.value
              )
            WHEN 'question_updated' THEN application.jsonb_has_exact_keys(
              payload,
              ARRAY[
                'schemaVersion',
                'questionId',
                'fromStatus',
                'toStatus',
                'answerChanged'
              ]
            )
              AND application.is_uuid_text(payload ->> 'questionId')
              AND payload ->> 'fromStatus' IN ('open', 'answered', 'dismissed')
              AND payload ->> 'toStatus' IN ('open', 'answered', 'dismissed')
              AND jsonb_typeof(payload -> 'answerChanged') = 'boolean'
              AND (
                payload ->> 'fromStatus' <> payload ->> 'toStatus'
                OR payload ->> 'answerChanged' = 'true'
              )
            ELSE false
          END
        )
      $$;

      ALTER TABLE application.case_events
        DROP CONSTRAINT case_events_schema_version_check,
        ADD CONSTRAINT case_events_schema_version_check CHECK (
          schema_version IN (
            'legacy-case-event-v0',
            'case-event-v1',
            'case-event-v2'
          )
        ),
        DROP CONSTRAINT case_events_strict_data,
        ADD CONSTRAINT case_events_strict_data CHECK (
          application.is_valid_case_event_data(event_type, schema_version, event_data)
        );

      CREATE OR REPLACE FUNCTION application.enforce_new_case_event_schema()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.schema_version NOT IN ('case-event-v1', 'case-event-v2') THEN
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
    // Forward-only repair: immutable Case history and v2 audit events must remain readable.
  },
};
