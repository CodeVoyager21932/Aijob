import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";

import type { Database } from "../types.js";

export const debriefItemDecisionsMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE application.debrief_confirmations
        ADD COLUMN decision_projection_version text NOT NULL DEFAULT 'whole_only',
        ADD CONSTRAINT debrief_confirmations_decision_projection_check CHECK (
          decision_projection_version IN ('whole_only', 'itemized_v1')
        );
      ALTER TABLE application.debrief_confirmations
        ALTER COLUMN decision_projection_version SET DEFAULT 'itemized_v1';

      CREATE TABLE application.debrief_item_decisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        debrief_id uuid NOT NULL,
        schema_version text NOT NULL DEFAULT 'debrief-item-decision-v1'
          CHECK (schema_version = 'debrief-item-decision-v1'),
        based_on_debrief_revision integer NOT NULL CHECK (based_on_debrief_revision > 0),
        item_kind text NOT NULL CHECK (item_kind IN ('expression_issue', 'evidence_gap')),
        item_id uuid NOT NULL,
        decision_value text NOT NULL CHECK (
          decision_value IN ('accepted', 'edited', 'rejected', 'deferred')
        ),
        edited_text text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT debrief_item_decisions_owner_id_unique UNIQUE (owner_id, id),
        CONSTRAINT debrief_item_decisions_owner_item_unique
          UNIQUE (owner_id, debrief_id, item_kind, item_id),
        CONSTRAINT debrief_item_decisions_edited_text_consistent CHECK (
          (
            decision_value = 'edited'
            AND edited_text IS NOT NULL
            AND char_length(btrim(edited_text)) BETWEEN 1 AND 2000
          )
          OR (
            decision_value <> 'edited'
            AND edited_text IS NULL
          )
        ),
        CONSTRAINT debrief_item_decisions_owner_debrief_fk
          FOREIGN KEY (owner_id, owner_epoch, debrief_id)
          REFERENCES application.debriefs(owner_id, owner_epoch, id)
          ON DELETE CASCADE
      );

      CREATE FUNCTION application.validate_debrief_item_decision()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        current_status text;
        current_revision integer;
        current_deleted_at timestamptz;
        referenced_item_exists boolean;
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
          RAISE EXCEPTION 'DEBRIEF_ITEM_DECISION_REVISION_MISMATCH';
        END IF;

        IF NEW.item_kind = 'expression_issue' THEN
          SELECT EXISTS (
            SELECT 1
            FROM application.debriefs AS debrief,
              jsonb_array_elements(debrief.expression_issues) AS item(value)
            WHERE debrief.owner_id = NEW.owner_id
              AND debrief.owner_epoch = NEW.owner_epoch
              AND debrief.id = NEW.debrief_id
              AND item.value ->> 'id' = NEW.item_id::text
          ) INTO referenced_item_exists;
        ELSE
          SELECT EXISTS (
            SELECT 1
            FROM application.debriefs AS debrief,
              jsonb_array_elements(debrief.evidence_gaps) AS item(value)
            WHERE debrief.owner_id = NEW.owner_id
              AND debrief.owner_epoch = NEW.owner_epoch
              AND debrief.id = NEW.debrief_id
              AND item.value ->> 'id' = NEW.item_id::text
          ) INTO referenced_item_exists;
        END IF;

        IF NOT referenced_item_exists THEN
          RAISE EXCEPTION 'DEBRIEF_ITEM_NOT_FOUND';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER debrief_item_decisions_owner_epoch_guard
        BEFORE INSERT OR UPDATE ON application.debrief_item_decisions
        FOR EACH ROW EXECUTE FUNCTION application.assert_active_career_asset_owner_epoch();
      CREATE TRIGGER debrief_item_decisions_reference_guard
        BEFORE INSERT ON application.debrief_item_decisions
        FOR EACH ROW EXECUTE FUNCTION application.validate_debrief_item_decision();
      CREATE TRIGGER debrief_item_decisions_no_update
        BEFORE UPDATE ON application.debrief_item_decisions
        FOR EACH ROW EXECUTE FUNCTION application.prevent_career_asset_history_update();

      CREATE OR REPLACE FUNCTION application.validate_debrief_confirmation()
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

        IF NEW.decision_projection_version <> 'itemized_v1' THEN
          RAISE EXCEPTION 'LEGACY_DEBRIEF_CONFIRMATION_READ_ONLY';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM application.debriefs AS debrief,
            jsonb_array_elements(debrief.expression_issues) AS item(value)
          WHERE debrief.owner_id = NEW.owner_id
            AND debrief.owner_epoch = NEW.owner_epoch
            AND debrief.id = NEW.debrief_id
            AND NOT EXISTS (
              SELECT 1
              FROM application.debrief_item_decisions AS decision
              WHERE decision.owner_id = NEW.owner_id
                AND decision.owner_epoch = NEW.owner_epoch
                AND decision.debrief_id = NEW.debrief_id
                AND decision.based_on_debrief_revision = NEW.based_on_debrief_revision
                AND decision.item_kind = 'expression_issue'
                AND item.value ->> 'id' = decision.item_id::text
            )
        ) OR EXISTS (
          SELECT 1
          FROM application.debriefs AS debrief,
            jsonb_array_elements(debrief.evidence_gaps) AS item(value)
          WHERE debrief.owner_id = NEW.owner_id
            AND debrief.owner_epoch = NEW.owner_epoch
            AND debrief.id = NEW.debrief_id
            AND NOT EXISTS (
              SELECT 1
              FROM application.debrief_item_decisions AS decision
              WHERE decision.owner_id = NEW.owner_id
                AND decision.owner_epoch = NEW.owner_epoch
                AND decision.debrief_id = NEW.debrief_id
                AND decision.based_on_debrief_revision = NEW.based_on_debrief_revision
                AND decision.item_kind = 'evidence_gap'
                AND item.value ->> 'id' = decision.item_id::text
            )
        ) THEN
          RAISE EXCEPTION 'DEBRIEF_ITEM_DECISIONS_INCOMPLETE';
        END IF;
        RETURN NEW;
      END;
      $$;

      REVOKE ALL ON TABLE application.debrief_item_decisions
        FROM PUBLIC, aijob_collector_worker;
      GRANT SELECT, INSERT, DELETE ON TABLE application.debrief_item_decisions
        TO aijob_web_api;
      GRANT SELECT, DELETE ON TABLE application.debrief_item_decisions
        TO aijob_match_worker;
      GRANT ALL PRIVILEGES ON TABLE application.debrief_item_decisions
        TO aijob_ops_cli, aijob_migrator;
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Forward-only expand: confirmed user choices must remain readable.
  },
};
