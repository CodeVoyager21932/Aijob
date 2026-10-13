import { sql, type Migration } from "kysely";

/** Empty and identical writes must not evict every public projection. */
export const projectionChangeDetectionMigration: Migration = {
  async up(db) {
    await sql`
      CREATE FUNCTION catalog.bump_graph_on_insert() RETURNS trigger LANGUAGE plpgsql
      SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
        IF EXISTS(SELECT 1 FROM new_rows) THEN
          UPDATE catalog.job_graph_generation SET generation=generation+1 WHERE id=true;
        END IF; RETURN NULL; END $$;
      CREATE FUNCTION catalog.bump_graph_on_delete() RETURNS trigger LANGUAGE plpgsql
      SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
        IF EXISTS(SELECT 1 FROM old_rows) THEN
          UPDATE catalog.job_graph_generation SET generation=generation+1 WHERE id=true;
        END IF; RETURN NULL; END $$;
      CREATE FUNCTION catalog.bump_graph_on_update() RETURNS trigger LANGUAGE plpgsql
      SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
        IF EXISTS(SELECT to_jsonb(n) FROM new_rows n EXCEPT SELECT to_jsonb(o) FROM old_rows o)
          OR EXISTS(SELECT to_jsonb(o) FROM old_rows o EXCEPT SELECT to_jsonb(n) FROM new_rows n) THEN
          UPDATE catalog.job_graph_generation SET generation=generation+1 WHERE id=true;
        END IF; RETURN NULL; END $$;
    `.execute(db);
    const tables = [
      ["catalog", "published_jobs", "graph_jobs", "IUD"],
      ["catalog", "published_job_versions", "graph_versions", "U"],
      ["catalog", "job_semantic_indexes", "graph_semantics", "IUD"],
      ["ingestion", "source_job_activity_states", "graph_activity", "IUD"],
      ["source_control", "source_policy_versions", "graph_policy", "IUD"],
      ["source_control", "sources", "graph_source", "U"],
      ["source_control", "source_runtime_states", "graph_freshness", "U"],
      ["ingestion", "source_job_records", "graph_verification", "U"],
      ["ingestion", "review_items", "graph_review", "IUD"],
      ["catalog", "job_condition_projections", "graph_conditions", "IUD"],
      ["ingestion", "source_job_revisions", "graph_revision", "UD"],
      ["source_control", "organizations", "graph_organization", "U"],
    ] as const;
    for (const [schema, table, trigger, events] of tables) {
      const target = `${schema}.${table}`;
      await sql.raw(`DROP TRIGGER ${trigger} ON ${target}`).execute(db);
      for (const [code, event, reference] of [
        ["I", "INSERT", "NEW TABLE AS new_rows"],
        ["U", "UPDATE", "OLD TABLE AS old_rows NEW TABLE AS new_rows"],
        ["D", "DELETE", "OLD TABLE AS old_rows"],
      ] as const) {
        if (!events.includes(code)) continue;
        await sql
          .raw(`CREATE TRIGGER ${trigger}_${code.toLowerCase()} AFTER ${event} ON ${target}
          REFERENCING ${reference} FOR EACH STATEMENT EXECUTE FUNCTION catalog.bump_graph_on_${event.toLowerCase()}()`)
          .execute(db);
      }
    }
  },
  async down() {
    throw new Error(
      "Forward-only migration; restore a verified backup to roll back database state.",
    );
  },
};
