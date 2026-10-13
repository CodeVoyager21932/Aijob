import { sql, type Migration } from 'kysely';
export const resumeTemplateLibraryMigration: Migration = {
  async up(db) { await sql`
    CREATE TABLE profile.resume_template_preferences (
      owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
      template_id text NOT NULL, favorite boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
      last_used_at timestamptz, PRIMARY KEY(owner_id,owner_epoch,template_id)
    );
    CREATE TABLE profile.resume_template_receipts (
      owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
      idempotency_key text NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL,
      PRIMARY KEY(owner_id,owner_epoch,idempotency_key)
    );
    CREATE TABLE profile.resume_photos (
      id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
      media_type text NOT NULL CHECK(media_type IN ('image/png','image/jpeg')), width integer NOT NULL CHECK(width BETWEEN 1 AND 6000), height integer NOT NULL CHECK(height BETWEEN 1 AND 6000),
      byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880), content_hash text NOT NULL,
      ciphertext bytea, nonce bytea, auth_tag bytea, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(owner_id,owner_epoch,content_hash)
    );
    CREATE INDEX resume_photos_owner ON profile.resume_photos(owner_id,owner_epoch);
    CREATE TRIGGER template_pref_epoch BEFORE INSERT OR UPDATE ON profile.resume_template_preferences FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
    CREATE TRIGGER template_receipt_epoch BEFORE INSERT ON profile.resume_template_receipts FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
    CREATE TRIGGER resume_photo_epoch BEFORE INSERT OR UPDATE ON profile.resume_photos FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
    GRANT SELECT,INSERT,UPDATE,DELETE ON profile.resume_template_preferences,profile.resume_template_receipts,profile.resume_photos TO aijob_web_api,aijob_match_worker,aijob_ops_cli;
    GRANT ALL ON profile.resume_template_preferences,profile.resume_template_receipts,profile.resume_photos TO aijob_migrator;
  `.execute(db); },
  async down() { throw new Error('Forward-only migration; retain owner template preferences and photos.'); },
};
