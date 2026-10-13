import { sql, type Migration } from "kysely";
export const projectionRuntimeIntegrityMigration: Migration = {
  async up(db) {
    await sql`
      GRANT SELECT,INSERT,UPDATE,DELETE ON catalog.job_graph_cache TO aijob_match_worker;
      CREATE TRIGGER graph_review AFTER INSERT OR UPDATE OR DELETE ON ingestion.review_items FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_generation();
      CREATE TRIGGER graph_conditions AFTER INSERT OR UPDATE OR DELETE ON catalog.job_condition_projections FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_generation();
      CREATE TRIGGER graph_revision AFTER UPDATE OR DELETE ON ingestion.source_job_revisions FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_generation();
      CREATE TRIGGER graph_organization AFTER UPDATE ON source_control.organizations FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_generation();
      UPDATE catalog.job_graph_generation SET generation=generation+1 WHERE id=true;
    `.execute(db);
  },
  async down() {
    throw new Error(
      "Forward-only runtime integrity; restore a verified backup to roll back database state.",
    );
  },
};
