import { sql, type Migration } from "kysely";

export const resumeStudioMigration: Migration = {
  async up(db) {
    await sql`
      ALTER TABLE profile.resume_document_revisions ADD COLUMN studio_content jsonb;
      ALTER TABLE profile.resume_layout_revisions ADD COLUMN studio_layout jsonb;
      ALTER TABLE task_queue.tasks DROP CONSTRAINT tasks_task_type_check, ADD CONSTRAINT tasks_task_type_check CHECK(task_type IN ('crawl','resume_analysis','match_run','recommendation_run','resume_tailoring','resume_export','resume_review','resume_review_v2','owner_deletion','resume_studio_import'));
      CREATE TABLE profile.resume_document_drafts (
        document_id uuid PRIMARY KEY, owner_id uuid NOT NULL, owner_epoch bigint NOT NULL,
        revision integer NOT NULL DEFAULT 1 CHECK(revision>0), title text NOT NULL,
        content jsonb NOT NULL, layout jsonb NOT NULL, content_hash text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(owner_id,document_id) REFERENCES profile.resume_documents(owner_id,id) ON DELETE CASCADE
      );
      CREATE TABLE profile.resume_draft_receipts (
        owner_id uuid NOT NULL, owner_epoch bigint NOT NULL, document_id uuid NOT NULL,
        idempotency_key text NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,document_id,idempotency_key),
        FOREIGN KEY(owner_id,document_id) REFERENCES profile.resume_documents(owner_id,id) ON DELETE CASCADE
      );
      CREATE TABLE profile.resume_originals (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL, owner_epoch bigint NOT NULL,
        document_id uuid NOT NULL, filename text NOT NULL, media_type text NOT NULL, byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
        content_hash text NOT NULL, ciphertext bytea NOT NULL, nonce bytea NOT NULL, auth_tag bytea NOT NULL,
        key_version text NOT NULL, status text NOT NULL DEFAULT 'queued', failure_code text, parsed_content jsonb, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(owner_id,document_id,content_hash),
        FOREIGN KEY(owner_id,document_id) REFERENCES profile.resume_documents(owner_id,id) ON DELETE CASCADE
      );
      CREATE TABLE profile.experiences (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
        kind text NOT NULL, title text NOT NULL, entry jsonb NOT NULL, capture_hash text NOT NULL,
        revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(owner_id,id), UNIQUE(owner_id,owner_epoch,capture_hash)
      );
      CREATE TABLE profile.experience_revisions (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL, owner_epoch bigint NOT NULL,
        experience_id uuid NOT NULL, revision integer NOT NULL, entry jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(owner_id,experience_id,revision), FOREIGN KEY(owner_id,experience_id) REFERENCES profile.experiences(owner_id,id) ON DELETE CASCADE
      );
      CREATE TABLE profile.resume_experience_links (
        owner_id uuid NOT NULL, owner_epoch bigint NOT NULL, document_id uuid NOT NULL, entry_id uuid NOT NULL,
        experience_id uuid, capture_revision integer NOT NULL DEFAULT 1, capture_open boolean NOT NULL DEFAULT false,
        PRIMARY KEY(owner_id,document_id,entry_id),
        FOREIGN KEY(owner_id,document_id) REFERENCES profile.resume_documents(owner_id,id) ON DELETE CASCADE,
        FOREIGN KEY(owner_id,experience_id) REFERENCES profile.experiences(owner_id,id) ON DELETE SET NULL (experience_id)
      );
      ALTER TABLE profile.material_snippets ADD COLUMN source_experience_ids jsonb NOT NULL DEFAULT '[]';
      CREATE INDEX resume_originals_owner ON profile.resume_originals(owner_id,owner_epoch,document_id);
      CREATE INDEX experiences_owner ON profile.experiences(owner_id,owner_epoch,updated_at DESC);
      CREATE TRIGGER experience_revision_immutable BEFORE UPDATE ON profile.experience_revisions FOR EACH ROW EXECUTE FUNCTION profile.prevent_revision_update();
      GRANT SELECT,INSERT,UPDATE,DELETE ON profile.resume_document_drafts,profile.resume_draft_receipts,profile.resume_originals,profile.experiences,profile.experience_revisions,profile.resume_experience_links TO aijob_web_api,aijob_ops_cli;
      GRANT SELECT,INSERT,UPDATE,DELETE ON profile.resume_document_drafts,profile.resume_draft_receipts,profile.resume_originals,profile.experiences,profile.experience_revisions,profile.resume_experience_links TO aijob_match_worker;
      GRANT ALL ON profile.resume_document_drafts,profile.resume_draft_receipts,profile.resume_originals,profile.experiences,profile.experience_revisions,profile.resume_experience_links TO aijob_migrator;
    `.execute(db);
    for (const table of ["resume_document_drafts", "resume_draft_receipts", "resume_originals", "experiences", "experience_revisions", "resume_experience_links"]) {
      await sql`CREATE TRIGGER ${sql.id(`${table}_epoch`)} BEFORE INSERT OR UPDATE ON ${sql.id("profile", table)} FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch()`.execute(db);
    }
  },
  async down() { throw new Error("Forward-only: retain user drafts and originals; restore a verified backup for downgrade."); },
};
