import {sql, type Migration} from "kysely";
/** Actual submitted bytes survive later edits and deletion of their source draft. */
export const submittedMaterialFilesMigration: Migration = {
  async up(db) {
    await sql`
      CREATE TABLE application.submitted_material_files (
        material_id uuid PRIMARY KEY REFERENCES application.submitted_materials(id) ON DELETE CASCADE,
        owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
        artifact_id uuid NOT NULL, format text NOT NULL CHECK(format IN ('pdf','docx')),
        file_name text NOT NULL, media_type text NOT NULL, content_hash text NOT NULL,
        ciphertext bytea NOT NULL, nonce bytea NOT NULL, auth_tag bytea NOT NULL
      );
      CREATE TRIGGER submitted_file_epoch BEFORE INSERT OR UPDATE ON application.submitted_material_files
        FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      GRANT SELECT,INSERT,DELETE ON application.submitted_material_files TO aijob_web_api,aijob_ops_cli;
      GRANT SELECT,DELETE ON application.submitted_material_files TO aijob_match_worker;
      GRANT ALL ON application.submitted_material_files TO aijob_migrator;
    `.execute(db);
  },
  async down() {throw new Error("Forward-only: preserve actual submitted files.");},
};
