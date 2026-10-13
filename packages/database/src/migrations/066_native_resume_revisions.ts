import { type Migration, sql } from "kysely";

export const nativeResumeRevisionsMigration: Migration = {
  async up(db) {
    // Preserve each historical constraint verbatim, adding only the native branch.
    await sql`
      DO $$ DECLARE r record; definition text; BEGIN
        FOR r IN SELECT conname, conrelid, pg_get_constraintdef(oid) AS definition FROM pg_constraint
          WHERE conname IN ('resume_document_revisions_forward_schema_version','resume_document_revisions_forward_base_consistent','resume_document_revisions_mutation_receipt_pair',
          'resume_layout_revisions_forward_schema','resume_layout_revisions_mutation_receipt_pair','resume_layout_revisions_template_key_check')
          AND connamespace='profile'::regnamespace LOOP
          definition := r.definition;
          IF r.conrelid='profile.resume_document_revisions'::regclass THEN
            definition := replace(definition, 'schema_version = ''resume-content-v1''::text', 'schema_version = ANY (ARRAY[''resume-content-v1''::text, ''aijob-native-content-v1''::text])');
            definition := replace(definition, '''resume-document-v2''::text, ''resume-content-v1''::text', '''resume-document-v2''::text, ''resume-content-v1''::text, ''aijob-native-content-v1''::text');
          ELSE
            definition := replace(definition, 'schema_version = ''resume-layout-v2''::text', 'schema_version = ANY (ARRAY[''resume-layout-v2''::text, ''aijob-native-layout-v1''::text])');
            definition := replace(definition, '''resume-layout-v1''::text, ''resume-layout-v2''::text', '''resume-layout-v1''::text, ''resume-layout-v2''::text, ''aijob-native-layout-v1''::text');
            definition := replace(definition, '''cn_compact_technical''::text', '''cn_compact_technical''::text, ''native''::text');
          END IF;
          IF definition=r.definition THEN RAISE EXCEPTION 'NATIVE_CONSTRAINT_NOT_EXPANDED: %',r.conname; END IF;
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.conrelid::regclass,r.conname);
          EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',r.conrelid::regclass,r.conname,definition);
        END LOOP;
      END $$;
      ALTER TABLE profile.resume_document_revisions ADD CONSTRAINT native_content_envelope CHECK (
        schema_version <> 'aijob-native-content-v1' OR COALESCE(
          studio_content->>'schemaVersion'='aijob-native-resume-v1' AND jsonb_typeof(studio_content->'data')='object'
          AND NOT (studio_content->'data' ? 'metadata') AND sections='[]'::jsonb, false));
      ALTER TABLE profile.resume_layout_revisions ADD CONSTRAINT native_layout_envelope CHECK (
        (template_key='native')=(schema_version='aijob-native-layout-v1') AND
        (schema_version <> 'aijob-native-layout-v1' OR COALESCE(studio_layout->>'schemaVersion'='aijob-native-layout-v1'
          AND jsonb_typeof(studio_layout->'metadata')='object',false)));
      CREATE OR REPLACE FUNCTION profile.enforce_new_resume_content_schema() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.schema_version='aijob-native-content-v1' THEN RETURN NEW; END IF;
        IF NEW.document_id IS NOT NULL AND NEW.schema_version <> 'resume-content-v1' THEN RAISE EXCEPTION 'LEGACY_RESUME_CONTENT_READ_ONLY'; END IF;
        IF NEW.schema_version='resume-content-v1' AND NOT profile.is_valid_resume_semantic_sections(NEW.sections) THEN RAISE EXCEPTION 'INVALID_RESUME_SEMANTIC_CONTENT'; END IF;
        RETURN NEW; END $$;
      CREATE OR REPLACE FUNCTION profile.enforce_new_resume_layout_schema() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.schema_version='aijob-native-layout-v1' THEN RETURN NEW; END IF;
        IF NEW.schema_version <> 'resume-layout-v2' THEN RAISE EXCEPTION 'LEGACY_RESUME_LAYOUT_READ_ONLY'; END IF;
        IF NOT profile.is_valid_resume_layout_v2(NEW.section_order,NEW.settings) THEN RAISE EXCEPTION 'INVALID_RESUME_LAYOUT_SETTINGS'; END IF;
        RETURN NEW; END $$;
    `.execute(db);
  },
  async down() {
    throw new Error("Forward-only: native immutable revisions require a compatible reader.");
  },
};
