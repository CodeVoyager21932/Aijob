import { sql, type Migration } from "kysely";
export const directionGraphV2Migration: Migration = {
  async up(db) {
    await sql`
      CREATE TABLE catalog.job_concept_projections (
        job_version_id uuid NOT NULL, extraction_version text NOT NULL,
        atom_index integer NOT NULL, concept_key text NOT NULL, kind text NOT NULL,
        negated boolean NOT NULL, necessity text NOT NULL, conditional boolean NOT NULL,
        duty boolean NOT NULL, atom jsonb NOT NULL,
        PRIMARY KEY(job_version_id,extraction_version,atom_index),
        FOREIGN KEY(job_version_id,extraction_version) REFERENCES catalog.job_semantic_indexes(job_version_id,extraction_version) ON DELETE CASCADE
      );
      CREATE INDEX concept_projection_lookup ON catalog.job_concept_projections(extraction_version,concept_key,job_version_id);
      CREATE INDEX concept_projection_kind ON catalog.job_concept_projections(extraction_version,kind,job_version_id);
      CREATE FUNCTION catalog.project_graph_v2_atoms() RETURNS trigger LANGUAGE plpgsql
        SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        IF NEW.extraction_version <> 'role-semantics-v2' THEN RETURN NEW; END IF;
        INSERT INTO catalog.job_concept_projections(job_version_id,extraction_version,atom_index,concept_key,kind,negated,necessity,conditional,duty,atom)
        SELECT NEW.job_version_id,NEW.extraction_version,a.n::integer,a.value->>'key',a.value->>'kind',
          (a.value->>'negated')::boolean,a.value->>'necessity',COALESCE(a.value->>'condition','')<>'',a.value->>'section'='responsibilities',a.value
        FROM jsonb_array_elements(NEW.atoms) WITH ORDINALITY a(value,n);
        RETURN NEW;
      END $$;
      CREATE TRIGGER graph_v2_projection AFTER INSERT ON catalog.job_semantic_indexes FOR EACH ROW EXECUTE FUNCTION catalog.project_graph_v2_atoms();
      CREATE TABLE catalog.semantic_reindex_runs (
        id uuid PRIMARY KEY, extraction_version text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz, processed integer NOT NULL DEFAULT 0, failed integer NOT NULL DEFAULT 0,
        failures jsonb NOT NULL DEFAULT '[]'
      );
      GRANT SELECT ON catalog.job_concept_projections TO aijob_web_api,aijob_match_worker;
      GRANT SELECT,INSERT,UPDATE,DELETE ON catalog.job_concept_projections,catalog.semantic_reindex_runs TO aijob_collector_worker,aijob_ops_cli;
      GRANT ALL ON catalog.job_concept_projections,catalog.semantic_reindex_runs TO aijob_migrator;
    `.execute(db);
  },
  async down() { throw new Error("Forward-only: retain graph v2 projections and v1 compatibility."); },
};
