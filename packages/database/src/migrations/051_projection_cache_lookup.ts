import { sql, type Migration } from "kysely";
export const projectionCacheLookupMigration: Migration = {
  async up(db) {
    await sql`ALTER TABLE catalog.job_graph_cache ADD COLUMN projection_key text;
    CREATE INDEX projection_cache_lookup ON catalog.job_graph_cache(projection_key,generation);
  `.execute(db);
  },
  async down() {
    throw new Error(
      "Forward-only compatible cache expansion; restore a verified backup for database rollback.",
    );
  },
};
