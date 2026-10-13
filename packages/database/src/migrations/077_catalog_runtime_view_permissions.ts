import { type Migration, sql } from "kysely";

/** Recreated eligibility views lost the read grants installed by migration 021. */
export const catalogRuntimeViewPermissionsMigration: Migration = {
  async up(db) {
    await sql`GRANT SELECT ON catalog.current_job_eligibility, catalog.job_version_eligibility
      TO aijob_web_api, aijob_collector_worker, aijob_match_worker, aijob_ops_cli, aijob_migrator`.execute(
      db,
    );
  },
};
