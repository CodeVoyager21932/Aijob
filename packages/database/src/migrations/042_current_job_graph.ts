import { sql, type Migration } from "kysely";
export const currentJobGraphMigration: Migration = {
  async up(db) {
    await sql`
      CREATE TABLE catalog.job_semantic_indexes (
        job_version_id uuid NOT NULL REFERENCES catalog.published_job_versions(id) ON DELETE CASCADE,
        extraction_version text NOT NULL, source_hash text NOT NULL,
        primary_family text, families text[] NOT NULL, subrole text, domains text[] NOT NULL,
        education_levels text[] NOT NULL, atoms jsonb NOT NULL, mode text NOT NULL DEFAULT 'rules',
        created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_version_id, extraction_version)
      );
      CREATE INDEX job_semantics_families ON catalog.job_semantic_indexes USING gin(families);
      CREATE INDEX job_semantics_education ON catalog.job_semantic_indexes USING gin(education_levels);
      CREATE INDEX job_semantics_subrole ON catalog.job_semantic_indexes(subrole);
      CREATE INDEX job_semantics_atoms ON catalog.job_semantic_indexes USING gin(atoms jsonb_path_ops);
      CREATE TABLE catalog.job_graph_generation(id boolean PRIMARY KEY DEFAULT true CHECK(id), generation bigint NOT NULL DEFAULT 1);
      INSERT INTO catalog.job_graph_generation(id) VALUES (true);
      CREATE TABLE catalog.job_graph_cache (
        cache_key text PRIMARY KEY, generation bigint NOT NULL, result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 minute')
      );
      CREATE INDEX job_graph_cache_expiry ON catalog.job_graph_cache(expires_at);
      CREATE FUNCTION catalog.bump_graph_generation() RETURNS trigger LANGUAGE plpgsql
        SECURITY DEFINER SET search_path = pg_catalog AS $$
        BEGIN UPDATE catalog.job_graph_generation SET generation = generation + 1 WHERE id = true; RETURN NULL; END $$;
      CREATE TRIGGER graph_jobs AFTER INSERT OR UPDATE OR DELETE ON catalog.published_jobs FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_generation();
      CREATE TRIGGER graph_versions AFTER UPDATE ON catalog.published_job_versions FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_generation();
      CREATE TRIGGER graph_semantics AFTER INSERT OR UPDATE OR DELETE ON catalog.job_semantic_indexes FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_generation();
      CREATE TRIGGER graph_activity AFTER INSERT OR UPDATE OR DELETE ON ingestion.source_job_activity_states FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_generation();
      CREATE TRIGGER graph_policy AFTER INSERT OR UPDATE OR DELETE ON source_control.source_policy_versions FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_generation();
      CREATE TRIGGER graph_source AFTER UPDATE ON source_control.sources FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_generation();
      CREATE TRIGGER graph_freshness AFTER UPDATE ON source_control.source_runtime_states FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_generation();
      CREATE TRIGGER graph_verification AFTER UPDATE ON ingestion.source_job_records FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_generation();
      GRANT SELECT ON catalog.job_semantic_indexes, catalog.job_graph_generation TO aijob_web_api, aijob_match_worker;
      GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.job_graph_cache TO aijob_web_api;
      GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.job_semantic_indexes, catalog.job_graph_cache TO aijob_collector_worker, aijob_ops_cli;
      GRANT SELECT ON catalog.job_graph_generation TO aijob_collector_worker, aijob_ops_cli;
      GRANT ALL ON catalog.job_semantic_indexes, catalog.job_graph_cache, catalog.job_graph_generation TO aijob_migrator;
    `.execute(db);
  },
  async down() {
    throw new Error(
      "Forward-only migration; restore a verified backup to roll back database state.",
    );
  },
};
