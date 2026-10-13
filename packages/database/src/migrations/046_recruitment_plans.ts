import { sql, type Migration } from "kysely";
export const recruitmentPlansMigration: Migration = {
  async up(db) {
    await sql`
  CREATE TABLE catalog.recruitment_plan_revisions (
    id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES source_control.sources(id), plan_key text NOT NULL,
    recruitment_year integer NOT NULL CHECK(recruitment_year BETWEEN 2000 AND 2100), revision integer NOT NULL CHECK(revision>0),
    plan jsonb NOT NULL, content_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(source_id,plan_key,recruitment_year,revision)
  );
  CREATE TRIGGER recruitment_plan_immutable BEFORE UPDATE ON catalog.recruitment_plan_revisions FOR EACH ROW EXECUTE FUNCTION application.prevent_career_asset_history_update();
  CREATE TABLE catalog.job_recruitment_plans (
    job_version_id uuid PRIMARY KEY REFERENCES catalog.published_job_versions(id) ON DELETE CASCADE,
    plan_revision_id uuid NOT NULL REFERENCES catalog.recruitment_plan_revisions(id), updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE application.case_recruitment_plans (
    case_id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
    plan_revision_id uuid NOT NULL REFERENCES catalog.recruitment_plan_revisions(id),
    FOREIGN KEY(owner_id,case_id) REFERENCES application.application_cases(owner_id,id) ON DELETE CASCADE
  );
  CREATE TRIGGER case_plan_immutable BEFORE UPDATE ON application.case_recruitment_plans FOR EACH ROW EXECUTE FUNCTION application.prevent_career_asset_history_update();
  CREATE TRIGGER case_plan_epoch BEFORE INSERT ON application.case_recruitment_plans FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
  GRANT SELECT ON catalog.recruitment_plan_revisions,catalog.job_recruitment_plans TO aijob_web_api,aijob_collector_worker,aijob_match_worker;
  GRANT SELECT,INSERT,DELETE ON application.case_recruitment_plans TO aijob_web_api;
  GRANT SELECT,DELETE ON application.case_recruitment_plans TO aijob_match_worker;
  GRANT ALL ON catalog.recruitment_plan_revisions,catalog.job_recruitment_plans,application.case_recruitment_plans TO aijob_ops_cli,aijob_migrator;
`.execute(db);
  },
  async down() {
    throw new Error(
      "RECRUITMENT_PLAN_HISTORY_IS_FORWARD_ONLY: retain schema during application rollback.",
    );
  },
};
