import { sql, type Migration } from 'kysely';
export const semanticProjectionRefreshMigration: Migration = {
  async up(db) {
    await sql`
      CREATE OR REPLACE FUNCTION catalog.project_graph_v2_atoms() RETURNS trigger LANGUAGE plpgsql
      SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        IF NEW.extraction_version <> 'role-semantics-v2' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND OLD.atoms IS NOT DISTINCT FROM NEW.atoms THEN RETURN NEW; END IF;
        DELETE FROM catalog.job_concept_projections WHERE job_version_id=NEW.job_version_id AND extraction_version=NEW.extraction_version;
        INSERT INTO catalog.job_concept_projections(job_version_id,extraction_version,atom_index,concept_key,kind,negated,necessity,conditional,duty,atom)
        SELECT NEW.job_version_id,NEW.extraction_version,a.n::integer,a.value->>'key',a.value->>'kind',
          (a.value->>'negated')::boolean,a.value->>'necessity',COALESCE(a.value->>'condition','')<>'',a.value->>'section'='responsibilities',a.value
        FROM jsonb_array_elements(NEW.atoms) WITH ORDINALITY a(value,n);
        RETURN NEW;
      END $$;
      DROP TRIGGER graph_v2_projection ON catalog.job_semantic_indexes;
      CREATE TRIGGER graph_v2_projection AFTER INSERT OR UPDATE OF atoms ON catalog.job_semantic_indexes FOR EACH ROW EXECUTE FUNCTION catalog.project_graph_v2_atoms();
    `.execute(db);
  },
  async down() { throw new Error('Forward-only: use the v2-compatible previous application build.'); },
};
