import { type Migration, sql } from "kysely";

/** Preserve the creation/upgrade row lock without letting the web role edit public job facts. */
export const caseCatalogLockMigration: Migration = {
  async up(db) {
    await sql`CREATE FUNCTION catalog.lock_job_for_case(job_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
    BEGIN
      PERFORM 1 FROM catalog.published_jobs WHERE id=job_id FOR UPDATE;
    END $$;
    REVOKE ALL ON FUNCTION catalog.lock_job_for_case(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION catalog.lock_job_for_case(uuid) TO aijob_web_api;`.execute(db);
  },
};
