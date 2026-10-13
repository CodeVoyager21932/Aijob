import { sql, type Migration } from "kysely";

export const opportunityDiscoveryMigration: Migration = {
  async up(db) {
    await sql`
      ALTER TABLE application.saved_searches
        ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
        ADD COLUMN discovery_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN digest_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN digest_time text NOT NULL DEFAULT '09:00' CHECK(digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
        ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Shanghai' CHECK(timezone='Asia/Shanghai'),
        ADD COLUMN next_digest_at timestamptz,
        ADD COLUMN discovery_query_hash text;
      CREATE TABLE source_control.discovery_queries (
        query_hash text PRIMARY KEY, query_text text NOT NULL CHECK(length(query_text)<=500),
        next_due_at timestamptz NOT NULL DEFAULT now(), last_success_at timestamptz,
        last_status text NOT NULL DEFAULT 'pending', enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE source_control.discovery_leads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_url text NOT NULL UNIQUE,
        hostname text NOT NULL, title text NOT NULL, query_hash text NOT NULL REFERENCES source_control.discovery_queries(query_hash),
        status text NOT NULL DEFAULT 'discovered' CHECK(status IN ('discovered','draft','configured','rejected')),
        source_key text, proposal jsonb, first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE source_control.discovery_budget_buckets (
        bucket text PRIMARY KEY, used integer NOT NULL DEFAULT 0 CHECK(used>=0),
        maximum integer NOT NULL CHECK(maximum>0), CHECK(used<=maximum)
      );
      CREATE TABLE catalog.job_change_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES catalog.published_jobs(id) ON DELETE CASCADE,
        previous_version_id uuid, version_id uuid, kind text NOT NULL CHECK(kind IN ('new','updated','closed','reopened')),
        occurred_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX job_change_events_job ON catalog.job_change_events(job_id,occurred_at DESC);
      CREATE FUNCTION catalog.record_job_version_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.current_version_id IS NOT NULL AND NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN
          INSERT INTO catalog.job_change_events(job_id,previous_version_id,version_id,kind)
          VALUES(NEW.id,OLD.current_version_id,NEW.current_version_id,CASE WHEN OLD.current_version_id IS NULL THEN 'new' ELSE 'updated' END);
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER opportunity_version_change AFTER UPDATE OF current_version_id ON catalog.published_jobs
        FOR EACH ROW EXECUTE FUNCTION catalog.record_job_version_change();
      CREATE FUNCTION catalog.record_job_activity_change() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE was_closed boolean; now_closed boolean;
      BEGIN
        was_closed := CASE WHEN TG_OP='INSERT' THEN false ELSE OLD.direct_state='closed' OR OLD.absence_state='closed' END;
        now_closed := NEW.direct_state='closed' OR NEW.absence_state='closed';
        IF was_closed IS DISTINCT FROM now_closed THEN
          INSERT INTO catalog.job_change_events(job_id,previous_version_id,version_id,kind)
          SELECT j.id,j.current_version_id,j.current_version_id,CASE WHEN now_closed THEN 'closed' ELSE 'reopened' END
          FROM catalog.published_jobs j JOIN catalog.published_job_versions v ON v.id=j.current_version_id
          JOIN ingestion.source_job_revisions r ON r.id=v.source_job_revision_id WHERE r.source_job_record_id=NEW.source_job_record_id;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER opportunity_activity_change AFTER INSERT OR UPDATE ON ingestion.source_job_activity_states
        FOR EACH ROW EXECUTE FUNCTION catalog.record_job_activity_change();
      CREATE TABLE application.opportunity_digests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
        search_id uuid NOT NULL REFERENCES application.saved_searches(id) ON DELETE CASCADE, search_revision integer NOT NULL,
        local_date date NOT NULL, label text NOT NULL, initial boolean NOT NULL, partial boolean NOT NULL DEFAULT false, local_preview boolean NOT NULL DEFAULT false,
        status_note text NOT NULL DEFAULT '', read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(search_id,search_revision,local_date), UNIQUE(owner_id,id)
      );
      CREATE TABLE application.opportunity_digest_items (
        digest_id uuid NOT NULL REFERENCES application.opportunity_digests(id) ON DELETE CASCADE,
        job_id uuid NOT NULL, version_id uuid, event_id uuid REFERENCES catalog.job_change_events(id) ON DELETE SET NULL,
        kind text NOT NULL CHECK(kind IN ('initial','new','updated','closed','reopened','unchanged')),
        activity_state text NOT NULL, title text NOT NULL, company_name text NOT NULL, reason text NOT NULL,
        PRIMARY KEY(digest_id,job_id)
      );
      CREATE TRIGGER opportunity_digest_epoch BEFORE INSERT OR UPDATE ON application.opportunity_digests
        FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      ALTER TABLE task_queue.tasks DROP CONSTRAINT tasks_task_type_check, DROP CONSTRAINT tasks_context_check;
      ALTER TABLE task_queue.tasks ADD CONSTRAINT tasks_task_type_check CHECK(task_type IN
        ('crawl','source_discovery','opportunity_digest','resume_analysis','match_run','recommendation_run','resume_tailoring',
         'resume_export','resume_review','resume_review_v2','resume_studio_import','career_assistant','ai_connection_test','owner_deletion'));
      ALTER TABLE task_queue.tasks ADD CONSTRAINT tasks_context_check CHECK(
        (task_type='crawl' AND source_id IS NOT NULL AND policy_version IS NOT NULL AND adapter_version IS NOT NULL AND run_mode IS NOT NULL AND owner_id IS NULL AND owner_epoch IS NULL)
        OR (task_type='source_discovery' AND source_id IS NULL AND policy_version IS NULL AND adapter_version IS NULL AND run_mode IS NULL AND owner_id IS NULL AND owner_epoch IS NULL)
        OR (task_type IN ('opportunity_digest','resume_analysis','match_run','recommendation_run','resume_tailoring','resume_export','resume_review','resume_review_v2','resume_studio_import','career_assistant','ai_connection_test','owner_deletion')
          AND source_id IS NULL AND policy_version IS NULL AND adapter_version IS NULL AND run_mode IS NULL AND owner_id IS NOT NULL AND owner_epoch IS NOT NULL AND owner_epoch>0));
      DROP POLICY tasks_collector_scope ON task_queue.tasks;
      CREATE POLICY tasks_collector_scope ON task_queue.tasks TO aijob_collector_worker
        USING(task_type IN ('crawl','source_discovery')) WITH CHECK(task_type IN ('crawl','source_discovery'));
      DROP POLICY tasks_web_owner_scope ON task_queue.tasks;
      DROP POLICY tasks_match_owner_scope ON task_queue.tasks;
      CREATE POLICY tasks_web_owner_scope ON task_queue.tasks TO aijob_web_api USING(task_type IN
        ('opportunity_digest','resume_analysis','match_run','recommendation_run','resume_tailoring','resume_export','resume_review','resume_review_v2','resume_studio_import','career_assistant','ai_connection_test','owner_deletion'));
      CREATE POLICY tasks_match_owner_scope ON task_queue.tasks TO aijob_match_worker USING(task_type IN
        ('opportunity_digest','resume_analysis','match_run','recommendation_run','resume_tailoring','resume_export','resume_review','resume_review_v2','resume_studio_import','career_assistant','ai_connection_test','owner_deletion'));
      GRANT SELECT,INSERT,UPDATE ON source_control.discovery_queries TO aijob_web_api,aijob_match_worker,aijob_collector_worker;
      GRANT SELECT,INSERT,UPDATE ON source_control.discovery_leads,source_control.discovery_budget_buckets TO aijob_collector_worker;
      GRANT SELECT ON source_control.discovery_budget_buckets TO aijob_web_api,aijob_match_worker;
      GRANT SELECT,INSERT ON catalog.job_change_events TO aijob_collector_worker;
      GRANT SELECT ON catalog.job_change_events TO aijob_web_api,aijob_match_worker;
      GRANT SELECT,INSERT,UPDATE,DELETE ON application.opportunity_digests,application.opportunity_digest_items TO aijob_match_worker;
      GRANT SELECT,UPDATE,DELETE ON application.opportunity_digests TO aijob_web_api;
      GRANT SELECT,DELETE ON application.opportunity_digest_items TO aijob_web_api;
      GRANT UPDATE ON application.saved_searches TO aijob_match_worker;
      GRANT ALL ON source_control.discovery_queries,source_control.discovery_leads,source_control.discovery_budget_buckets,
        catalog.job_change_events,application.opportunity_digests,application.opportunity_digest_items TO aijob_ops_cli,aijob_migrator;
    `.execute(db);
  },
  async down() {
    throw new Error("Forward-only: preserve opportunity subscriptions and history.");
  },
};
