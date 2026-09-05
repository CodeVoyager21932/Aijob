import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";
import {
  createCurrentJobEligibilityView,
  createJobVersionEligibilityView,
} from "./037_student_applicable_supply.js";

const OFFICIAL_LIST_FALLBACK_SOURCE_KEYS = [
  "huice-campus-internships",
  "adaps-photonics-internships",
  "pudutech-internships",
  "shining3d-internships",
  "onerobotics-internships",
  // One university announcement is split into role records which all share this Moka list page.
  "nankai-tal-2027",
] as const;

const officialListFallbackSourceKeysSql = sql.raw(
  OFFICIAL_LIST_FALLBACK_SOURCE_KEYS.map((sourceKey) => `'${sourceKey}'`).join(", "),
);

export const jobFactFidelityMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE ingestion.source_job_revisions
        ADD COLUMN application_link_kind text;

      UPDATE ingestion.source_job_revisions AS revision
      SET application_link_kind = CASE
        WHEN revision.apply_url IS NULL THEN 'missing'
        WHEN source.source_key IN (${officialListFallbackSourceKeysSql}) THEN 'official_list_fallback'
        ELSE 'exact'
      END
      FROM ingestion.source_job_records AS record
      JOIN source_control.sources AS source ON source.id = record.source_id
      WHERE record.id = revision.source_job_record_id;

      ALTER TABLE ingestion.source_job_revisions
        ALTER COLUMN application_link_kind SET NOT NULL,
        ADD CONSTRAINT source_job_revisions_application_link_kind_check
          CHECK (
            (application_link_kind = 'missing' AND apply_url IS NULL)
            OR
            (
              application_link_kind IN ('exact', 'official_list_fallback')
              AND apply_url IS NOT NULL
            )
          );

      ALTER TABLE catalog.published_job_versions
        ADD COLUMN application_link_kind text;

      UPDATE catalog.published_job_versions AS version
      SET application_link_kind = CASE
        WHEN version.apply_url IS NULL THEN 'missing'
        WHEN source.source_key IN (${officialListFallbackSourceKeysSql}) THEN 'official_list_fallback'
        ELSE 'exact'
      END
      FROM ingestion.source_job_revisions AS revision
      JOIN ingestion.source_job_records AS record
        ON record.id = revision.source_job_record_id
      JOIN source_control.sources AS source ON source.id = record.source_id
      WHERE revision.id = version.source_job_revision_id;

      ALTER TABLE catalog.published_job_versions
        ALTER COLUMN application_link_kind SET NOT NULL,
        ADD CONSTRAINT published_job_versions_application_link_kind_check
          CHECK (
            (application_link_kind = 'missing' AND apply_url IS NULL)
            OR
            (
              application_link_kind IN ('exact', 'official_list_fallback')
              AND apply_url IS NOT NULL
            )
          );

      -- Expand-only rollout compatibility: pre-038 writers may omit the new classification.
      -- The database derives the same deterministic value until the later Platform slice writes it.
      CREATE FUNCTION ingestion.default_source_job_revision_application_link_kind()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        configured_source_key text;
      BEGIN
        IF NEW.application_link_kind IS NOT NULL THEN
          RETURN NEW;
        END IF;
        IF NEW.apply_url IS NULL THEN
          NEW.application_link_kind := 'missing';
          RETURN NEW;
        END IF;
        SELECT source.source_key
        INTO configured_source_key
        FROM ingestion.source_job_records AS record
        JOIN source_control.sources AS source ON source.id = record.source_id
        WHERE record.id = NEW.source_job_record_id;
        NEW.application_link_kind := CASE
          WHEN configured_source_key IN (${officialListFallbackSourceKeysSql})
            THEN 'official_list_fallback'
          ELSE 'exact'
        END;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER source_job_revisions_default_application_link_kind
        BEFORE INSERT ON ingestion.source_job_revisions
        FOR EACH ROW
        EXECUTE FUNCTION ingestion.default_source_job_revision_application_link_kind();

      CREATE FUNCTION catalog.default_published_job_version_application_link_kind()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        configured_source_key text;
      BEGIN
        IF NEW.application_link_kind IS NOT NULL THEN
          RETURN NEW;
        END IF;
        IF NEW.apply_url IS NULL THEN
          NEW.application_link_kind := 'missing';
          RETURN NEW;
        END IF;
        SELECT source.source_key
        INTO configured_source_key
        FROM ingestion.source_job_revisions AS revision
        JOIN ingestion.source_job_records AS record
          ON record.id = revision.source_job_record_id
        JOIN source_control.sources AS source ON source.id = record.source_id
        WHERE revision.id = NEW.source_job_revision_id;
        NEW.application_link_kind := CASE
          WHEN configured_source_key IN (${officialListFallbackSourceKeysSql})
            THEN 'official_list_fallback'
          ELSE 'exact'
        END;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER published_job_versions_default_application_link_kind
        BEFORE INSERT ON catalog.published_job_versions
        FOR EACH ROW
        EXECUTE FUNCTION catalog.default_published_job_version_application_link_kind();

      ALTER TABLE catalog.job_requirement_sets
        ADD COLUMN IF NOT EXISTS source_units jsonb NOT NULL DEFAULT '[]'::jsonb;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'catalog.job_requirement_sets'::regclass
            AND conname = 'job_requirement_sets_source_units_array_check'
        ) THEN
          ALTER TABLE catalog.job_requirement_sets
            ADD CONSTRAINT job_requirement_sets_source_units_array_check
              CHECK (jsonb_typeof(source_units) = 'array');
        END IF;
      END;
      $$;

      ALTER TABLE application.private_job_snapshot_revisions
        ADD COLUMN IF NOT EXISTS source_units jsonb NOT NULL DEFAULT '[]'::jsonb
          CHECK (jsonb_typeof(source_units) = 'array');

      -- Keep requirement-set ownership and requirement_set_id uniqueness; only lift the
      -- one-projection-per-version restriction so immutable historical projections coexist.
      ALTER TABLE catalog.job_condition_projections
        DROP CONSTRAINT job_condition_projections_pkey,
        ADD CONSTRAINT job_condition_projections_pkey
          PRIMARY KEY (published_job_version_id, requirement_set_id);

      CREATE OR REPLACE FUNCTION catalog.prevent_job_requirement_set_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'IMMUTABLE_JOB_REQUIREMENT_SET';
      END;
      $$;

      DROP TRIGGER IF EXISTS job_requirement_sets_no_update
        ON catalog.job_requirement_sets;
      CREATE TRIGGER job_requirement_sets_no_update
        BEFORE UPDATE ON catalog.job_requirement_sets
        FOR EACH ROW EXECUTE FUNCTION catalog.prevent_job_requirement_set_mutation();

      DROP TRIGGER IF EXISTS job_requirement_sets_no_delete
        ON catalog.job_requirement_sets;
      CREATE TRIGGER job_requirement_sets_no_delete
        BEFORE DELETE ON catalog.job_requirement_sets
        FOR EACH ROW EXECUTE FUNCTION catalog.prevent_job_requirement_set_mutation();

      -- The SQL event gate must accept the same pair semantics as the runtime contract.
      -- Retain the prior validator for every other event, including historical events.
      DO $$ BEGIN
        IF to_regprocedure('application.is_valid_case_event_data_037(text,text,jsonb)') IS NULL THEN
          ALTER FUNCTION application.is_valid_case_event_data(text, text, jsonb)
            RENAME TO is_valid_case_event_data_037;
        END IF;
      END $$;
      CREATE OR REPLACE FUNCTION application.is_valid_case_event_data(
        checked_event_type text, checked_schema_version text, payload jsonb
      ) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT COALESCE(application.is_valid_case_event_data_037(
          checked_event_type, checked_schema_version, payload
        ), false) OR COALESCE((
          checked_event_type = 'job_version_upgraded'
          AND checked_schema_version IN ('case-event-v1', 'case-event-v2')
          AND payload ->> 'schemaVersion' = checked_schema_version
          AND application.jsonb_has_exact_keys(payload, ARRAY[
            'schemaVersion', 'fromPublishedJobVersionId', 'toPublishedJobVersionId',
            'fromRequirementSetId', 'toRequirementSetId', 'reasonCode'
          ])
          AND application.is_uuid_text(payload ->> 'fromPublishedJobVersionId')
          AND application.is_uuid_text(payload ->> 'toPublishedJobVersionId')
          AND application.is_uuid_text(payload ->> 'fromRequirementSetId')
          AND application.is_uuid_text(payload ->> 'toRequirementSetId')
          AND payload ->> 'fromPublishedJobVersionId' = payload ->> 'toPublishedJobVersionId'
          AND payload ->> 'fromRequirementSetId' <> payload ->> 'toRequirementSetId'
          AND application.is_reason_code(payload -> 'reasonCode')
        ), false);
      $$;
      ALTER TABLE application.case_events DROP CONSTRAINT case_events_strict_data;
      ALTER TABLE application.case_events ADD CONSTRAINT case_events_strict_data CHECK (
        application.is_valid_case_event_data(event_type, schema_version, event_data)
      );

      DROP VIEW catalog.job_version_eligibility;
      DROP VIEW catalog.current_job_eligibility;
    `.execute(db);

    await createCurrentJobEligibilityView(db, {
      studentApplicableRequired: true,
      exactApplicationKindRequired: true,
    });
    await createJobVersionEligibilityView(db, {
      studentApplicableRequired: true,
      exactApplicationKindRequired: true,
    });
  },

  async down(db: Kysely<Database>): Promise<void> {
    // Requirement source history, multiple immutable projections per version, and mutation guards
    // are forward-only: removing any of them could erase or make historical requirement facts
    // ambiguous. Only the independently reproducible application-link classification is rolled back.
    await sql`
      DROP VIEW catalog.job_version_eligibility;
      DROP VIEW catalog.current_job_eligibility;
    `.execute(db);

    await createCurrentJobEligibilityView(db, {
      studentApplicableRequired: true,
      exactApplicationKindRequired: false,
    });
    await createJobVersionEligibilityView(db, {
      studentApplicableRequired: true,
      exactApplicationKindRequired: false,
    });

    await sql`
      DROP TRIGGER published_job_versions_default_application_link_kind
        ON catalog.published_job_versions;
      DROP FUNCTION catalog.default_published_job_version_application_link_kind();
      ALTER TABLE catalog.published_job_versions
        DROP CONSTRAINT published_job_versions_application_link_kind_check,
        DROP COLUMN application_link_kind;

      DROP TRIGGER source_job_revisions_default_application_link_kind
        ON ingestion.source_job_revisions;
      DROP FUNCTION ingestion.default_source_job_revision_application_link_kind();
      ALTER TABLE ingestion.source_job_revisions
        DROP CONSTRAINT source_job_revisions_application_link_kind_check,
        DROP COLUMN application_link_kind;
    `.execute(db);
  },
};
