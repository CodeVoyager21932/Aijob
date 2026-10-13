import { sql, type Migration } from "kysely";
export const materialsAndSubmissionsMigration: Migration = {
  async up(db) {
    await sql`
    ALTER TABLE profile.resume_documents ADD COLUMN direction_scope jsonb, ADD COLUMN copied_from_revision_id uuid;
    CREATE TABLE application.submitted_materials (
      id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
      case_id uuid NOT NULL, case_revision integer NOT NULL, document_id uuid NOT NULL,
      content_revision_id uuid NOT NULL, layout_revision_id uuid NOT NULL, title text NOT NULL,
      content jsonb NOT NULL, layout jsonb NOT NULL, content_hash text NOT NULL,
      submitted_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(owner_id,case_id,case_revision), FOREIGN KEY(owner_id,case_id) REFERENCES application.application_cases(owner_id,id) ON DELETE CASCADE
    );
    CREATE INDEX submitted_materials_owner_case ON application.submitted_materials(owner_id,owner_epoch,case_id,submitted_at DESC);
    CREATE TRIGGER submitted_material_epoch BEFORE INSERT ON application.submitted_materials FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
    CREATE TRIGGER submitted_material_immutable BEFORE UPDATE ON application.submitted_materials FOR EACH ROW EXECUTE FUNCTION application.prevent_career_asset_history_update();
    CREATE TABLE profile.material_snippets (
      id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
      kind text NOT NULL CHECK(kind IN ('introduction','project_long','project_short','email','other')), title text NOT NULL,
      body text NOT NULL, source_document_id uuid, source_content_revision_id uuid, source_block_ids jsonb NOT NULL DEFAULT '[]',
      revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX material_snippets_owner ON profile.material_snippets(owner_id,owner_epoch,updated_at DESC);
    CREATE TRIGGER material_snippet_epoch BEFORE INSERT OR UPDATE ON profile.material_snippets FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
    GRANT SELECT,INSERT,DELETE ON application.submitted_materials TO aijob_web_api;
    GRANT SELECT,INSERT,UPDATE,DELETE ON profile.material_snippets TO aijob_web_api;
    GRANT SELECT,DELETE ON application.submitted_materials,profile.material_snippets TO aijob_match_worker;
    GRANT ALL ON application.submitted_materials,profile.material_snippets TO aijob_ops_cli,aijob_migrator;
  `.execute(db);
  },
  async down() {
    throw new Error(
      "MATERIALS_CONTAIN_USER_HISTORY: retain additive schema during application rollback; use an explicitly verified backup for destructive downgrade.",
    );
  },
};
