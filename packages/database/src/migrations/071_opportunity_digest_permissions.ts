import { type Migration, sql } from "kysely";

/** The digest reads the same eligible catalogue as web; it cannot publish or mutate sources. */
export const opportunityDigestPermissionsMigration: Migration = {
  async up(db) {
    await sql`GRANT SELECT ON catalog.current_job_eligibility, catalog.job_version_eligibility,
      catalog.job_condition_projections, catalog.published_job_version_revision_links TO aijob_match_worker`.execute(
      db,
    );
    // job_graph_cache read/write and job_graph_generation read already belong to
    // match-worker through migrations 042/050; no broad schema grant is needed.
  },
  async down() {
    throw new Error("Forward-only: keep the digest catalogue read permissions.");
  },
};
