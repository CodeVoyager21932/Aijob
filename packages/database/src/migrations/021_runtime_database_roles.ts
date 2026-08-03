import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

export const runtimeDatabaseRolesMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aijob_web_api') THEN
          CREATE ROLE aijob_web_api NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aijob_collector_worker') THEN
          CREATE ROLE aijob_collector_worker NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aijob_match_worker') THEN
          CREATE ROLE aijob_match_worker NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aijob_ops_cli') THEN
          CREATE ROLE aijob_ops_cli NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aijob_migrator') THEN
          CREATE ROLE aijob_migrator NOLOGIN;
        END IF;
      END
      $$;

      GRANT USAGE ON SCHEMA source_control, task_queue, ingestion, catalog
        TO aijob_web_api, aijob_collector_worker, aijob_match_worker;
      GRANT USAGE ON SCHEMA identity, profile, matching, decision
        TO aijob_web_api, aijob_match_worker;
      GRANT USAGE ON SCHEMA source_control, task_queue, ingestion, catalog,
        identity, profile, matching, decision
        TO aijob_ops_cli, aijob_migrator;

      GRANT SELECT ON ALL TABLES IN SCHEMA source_control, catalog
        TO aijob_web_api, aijob_match_worker;
      GRANT SELECT ON ALL TABLES IN SCHEMA ingestion
        TO aijob_web_api, aijob_match_worker;
      REVOKE ALL ON TABLE ingestion.snapshot_objects, ingestion.crawl_fetches,
        ingestion.crawl_runs
        FROM aijob_web_api, aijob_match_worker;

      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA
        identity, profile, matching, decision
        TO aijob_web_api;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA
        profile, matching, decision
        TO aijob_match_worker;
      GRANT SELECT ON TABLE identity.owners TO aijob_match_worker;

      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA
        source_control, ingestion, catalog
        TO aijob_collector_worker;

      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE task_queue.tasks
        TO aijob_web_api, aijob_collector_worker, aijob_match_worker;

      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA source_control, task_queue,
        ingestion, catalog, identity, profile, matching, decision
        TO aijob_ops_cli, aijob_migrator;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA source_control, task_queue,
        ingestion, catalog, identity, profile, matching, decision
        TO aijob_web_api, aijob_collector_worker, aijob_match_worker,
          aijob_ops_cli, aijob_migrator;

      ALTER TABLE task_queue.tasks ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS tasks_collector_scope ON task_queue.tasks;
      CREATE POLICY tasks_collector_scope ON task_queue.tasks
        FOR ALL TO aijob_collector_worker
        USING (task_type = 'crawl')
        WITH CHECK (task_type = 'crawl');

      DROP POLICY IF EXISTS tasks_web_owner_scope ON task_queue.tasks;
      CREATE POLICY tasks_web_owner_scope ON task_queue.tasks
        FOR ALL TO aijob_web_api
        USING (task_type <> 'crawl')
        WITH CHECK (task_type <> 'crawl');

      DROP POLICY IF EXISTS tasks_match_owner_scope ON task_queue.tasks;
      CREATE POLICY tasks_match_owner_scope ON task_queue.tasks
        FOR ALL TO aijob_match_worker
        USING (task_type <> 'crawl')
        WITH CHECK (task_type <> 'crawl');

      DROP POLICY IF EXISTS tasks_ops_scope ON task_queue.tasks;
      CREATE POLICY tasks_ops_scope ON task_queue.tasks
        FOR ALL TO aijob_ops_cli
        USING (true)
        WITH CHECK (true);

      DROP POLICY IF EXISTS tasks_migrator_scope ON task_queue.tasks;
      CREATE POLICY tasks_migrator_scope ON task_queue.tasks
        FOR ALL TO aijob_migrator
        USING (true)
        WITH CHECK (true);
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      DROP POLICY IF EXISTS tasks_migrator_scope ON task_queue.tasks;
      DROP POLICY IF EXISTS tasks_ops_scope ON task_queue.tasks;
      DROP POLICY IF EXISTS tasks_match_owner_scope ON task_queue.tasks;
      DROP POLICY IF EXISTS tasks_web_owner_scope ON task_queue.tasks;
      DROP POLICY IF EXISTS tasks_collector_scope ON task_queue.tasks;
      ALTER TABLE task_queue.tasks DISABLE ROW LEVEL SECURITY;

      DROP OWNED BY aijob_web_api;
      DROP OWNED BY aijob_collector_worker;
      DROP OWNED BY aijob_match_worker;
      DROP OWNED BY aijob_ops_cli;
      DROP OWNED BY aijob_migrator;
      DROP ROLE aijob_web_api;
      DROP ROLE aijob_collector_worker;
      DROP ROLE aijob_match_worker;
      DROP ROLE aijob_ops_cli;
      DROP ROLE aijob_migrator;
    `.execute(db);
  },
};
