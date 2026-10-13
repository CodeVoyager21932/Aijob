import { sql, type Migration } from "kysely";

/** Preview bytes expire; immutable content revisions and explicitly retained files do not. */
export const nativePreviewArtifactsMigration: Migration = {
  async up(db) {
    await sql`
      ALTER TABLE profile.resume_export_artifacts
        ADD COLUMN purpose text NOT NULL DEFAULT 'retained' CHECK (purpose IN ('preview','retained')),
        ADD COLUMN expires_at timestamptz,
        ADD COLUMN render_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
      CREATE INDEX resume_preview_expiry ON profile.resume_export_artifacts(expires_at)
        WHERE purpose='preview' AND state<>'deleted';
      CREATE TABLE profile.native_checkpoint_visibility (
        owner_id uuid NOT NULL, owner_epoch bigint NOT NULL,
        document_id uuid NOT NULL, content_revision_id uuid PRIMARY KEY,
        layout_revision_id uuid NOT NULL, retained boolean NOT NULL DEFAULT false,
        FOREIGN KEY (owner_id,document_id) REFERENCES profile.resume_documents(owner_id,id) ON DELETE CASCADE,
        FOREIGN KEY (owner_id,content_revision_id) REFERENCES profile.resume_document_revisions(owner_id,id) ON DELETE CASCADE,
        FOREIGN KEY (owner_id,layout_revision_id) REFERENCES profile.resume_layout_revisions(owner_id,id) ON DELETE CASCADE
      );
      CREATE TRIGGER native_checkpoint_owner_epoch BEFORE INSERT OR UPDATE ON profile.native_checkpoint_visibility
        FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      GRANT SELECT,INSERT,UPDATE,DELETE ON profile.native_checkpoint_visibility TO aijob_web_api,aijob_ops_cli;
      GRANT SELECT,DELETE ON profile.native_checkpoint_visibility TO aijob_match_worker;
      GRANT ALL ON profile.native_checkpoint_visibility TO aijob_migrator;
    `.execute(db);
  },
  async down() { throw new Error("Forward-only: preserve retained native revisions."); },
};
