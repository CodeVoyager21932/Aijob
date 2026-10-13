import { sql, type Migration } from "kysely";
export const semanticEnrichmentMigration: Migration = {
  async up(db) {
    await sql`
  CREATE TABLE source_control.semantic_enrichment_attempts (
    job_version_id uuid NOT NULL REFERENCES catalog.published_job_versions(id) ON DELETE CASCADE,extraction_version text NOT NULL,
    attempt integer NOT NULL DEFAULT 0,mode text NOT NULL DEFAULT 'pending',reason text,next_due_at timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,token uuid,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(job_version_id,extraction_version)
  );
  CREATE INDEX semantic_enrichment_due ON source_control.semantic_enrichment_attempts(next_due_at);
  GRANT SELECT,INSERT,UPDATE,DELETE ON source_control.semantic_enrichment_attempts TO aijob_collector_worker,aijob_ops_cli;
  GRANT ALL ON source_control.semantic_enrichment_attempts TO aijob_migrator;
`.execute(db);
  },
  async down() {
    throw new Error("SEMANTIC_ENRICHMENT_IS_FORWARD_ONLY: retain additive schema during rollback.");
  },
};
