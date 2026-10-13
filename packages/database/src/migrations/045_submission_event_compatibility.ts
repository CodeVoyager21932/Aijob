import { sql, type Migration } from "kysely";
export const submissionEventCompatibilityMigration: Migration = {
  async up(db) {
    await sql`
    ALTER FUNCTION application.is_valid_case_event_data(text,text,jsonb) RENAME TO is_valid_case_event_data_044;
    CREATE FUNCTION application.is_valid_case_event_data(checked_event_type text,checked_schema_version text,payload jsonb)
    RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
      SELECT COALESCE(application.is_valid_case_event_data_044(checked_event_type,checked_schema_version,payload),false)
      OR COALESCE((checked_event_type='manual_application_recorded'
        AND application.is_valid_case_event_data_044(checked_event_type,checked_schema_version,payload-'submittedMaterialId'-'submittedAt')
        AND (NOT payload ? 'submittedMaterialId' OR application.is_uuid_text(payload->>'submittedMaterialId'))
        AND (NOT payload ? 'submittedAt' OR (jsonb_typeof(payload->'submittedAt')='string' AND payload->>'submittedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$'))
      ),false);
    $$;
    ALTER TABLE application.case_events DROP CONSTRAINT case_events_strict_data;
    ALTER TABLE application.case_events ADD CONSTRAINT case_events_strict_data CHECK(application.is_valid_case_event_data(event_type,schema_version,event_data));
  `.execute(db);
  },
  async down() {
    throw new Error(
      "SUBMISSION_EVENT_HISTORY_REQUIRES_FORWARD_COMPATIBILITY: roll back application code while retaining the additive database schema.",
    );
  },
};
