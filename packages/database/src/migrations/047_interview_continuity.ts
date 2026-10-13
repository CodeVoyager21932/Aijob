import { sql, type Migration } from "kysely";
export const interviewContinuityMigration: Migration = {
  async up(db) {
    await sql`
  CREATE TABLE application.interview_continuity (
    session_id uuid PRIMARY KEY REFERENCES application.interview_sessions(id) ON DELETE CASCADE,
    owner_id uuid NOT NULL REFERENCES identity.owners(id),owner_epoch bigint NOT NULL,
    context jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TRIGGER interview_continuity_epoch BEFORE INSERT ON application.interview_continuity FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
  CREATE TRIGGER interview_continuity_immutable BEFORE UPDATE ON application.interview_continuity FOR EACH ROW EXECUTE FUNCTION application.prevent_career_asset_history_update();
  GRANT SELECT,INSERT,DELETE ON application.interview_continuity TO aijob_web_api;
  GRANT SELECT,DELETE ON application.interview_continuity TO aijob_match_worker;
  GRANT ALL ON application.interview_continuity TO aijob_ops_cli,aijob_migrator;
`.execute(db);
  },
  async down() {
    throw new Error(
      "INTERVIEW_CONTINUITY_IS_FORWARD_ONLY: preserve fixed material and question context during rollback.",
    );
  },
};
