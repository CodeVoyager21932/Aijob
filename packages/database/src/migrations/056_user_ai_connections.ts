import { sql, type Migration } from "kysely";

export const userAiConnectionsMigration: Migration = {
  async up(db) {
    await sql`
      CREATE TABLE profile.ai_connections (
        owner_id uuid PRIMARY KEY REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
        id uuid NOT NULL DEFAULT gen_random_uuid(), revision integer NOT NULL DEFAULT 1, settings jsonb NOT NULL,
        test_status text, test_error text, tested_at timestamptz, test_revision integer,
        ciphertext bytea NOT NULL, nonce bytea NOT NULL, auth_tag bytea NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE profile.ai_usage (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
        connection_revision integer NOT NULL, purpose text NOT NULL, model text NOT NULL,
        reserved_tokens integer NOT NULL CHECK(reserved_tokens>0),
        status text NOT NULL CHECK(status IN ('running','completed','failed')),
        lease_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
        error_code text
      );
      CREATE INDEX ai_usage_owner_window ON profile.ai_usage(owner_id,owner_epoch,created_at DESC);
      CREATE TRIGGER ai_connection_epoch BEFORE INSERT OR UPDATE ON profile.ai_connections FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      CREATE TRIGGER ai_usage_epoch BEFORE INSERT OR UPDATE ON profile.ai_usage FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      ALTER TABLE profile.assistant_turns ADD COLUMN provider_revision integer, ADD COLUMN provider_connection_id uuid;
      ALTER TABLE task_queue.tasks DROP CONSTRAINT tasks_task_type_check, ADD CONSTRAINT tasks_task_type_check CHECK(task_type IN ('crawl','resume_analysis','match_run','recommendation_run','resume_tailoring','resume_export','resume_review','resume_review_v2','owner_deletion','resume_studio_import','career_assistant','ai_connection_test'));
      GRANT SELECT,INSERT,UPDATE,DELETE ON profile.ai_connections,profile.ai_usage TO aijob_web_api,aijob_match_worker,aijob_ops_cli;
      GRANT ALL ON profile.ai_connections,profile.ai_usage TO aijob_migrator;
      COMMENT ON TABLE profile.ai_connections IS 'User supplied API credentials encrypted with an owner-bound derived key. Never returned to the browser or used by another owner.';
      COMMENT ON TABLE profile.ai_usage IS 'Owner visible rolling 24-hour usage; token reservations are conservative upper estimates, not billing amounts.';
    `.execute(db);
  },
  async down() {
    throw new Error("Forward-only migration; restore a verified backup.");
  },
};
