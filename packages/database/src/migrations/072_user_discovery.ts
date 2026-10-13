import { type Migration, sql } from "kysely";

export const userDiscoveryMigration: Migration = {
  async up(db) {
    await sql`
      CREATE TABLE profile.discovery_settings (
        owner_id uuid PRIMARY KEY REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
        id uuid NOT NULL DEFAULT gen_random_uuid(), revision integer NOT NULL DEFAULT 1,
        mode text NOT NULL CHECK(mode IN ('existing_sources','ai_connection','tavily')),
        adapter text NOT NULL DEFAULT 'auto', ciphertext bytea, nonce bytea, auth_tag bytea,
        capability text NOT NULL DEFAULT 'unchecked', capability_code text, checked_at timestamptz,
        connection_id uuid, connection_revision integer, adapter_version text,
        next_search_at timestamptz NOT NULL DEFAULT now(), last_search_at timestamptz, last_search_status text,
        legacy_pending boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE profile.discovery_usage (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
        settings_id uuid NOT NULL, settings_revision integer NOT NULL,
        connection_id uuid, connection_revision integer, adapter text NOT NULL, model text,
        task_id uuid NOT NULL, query_hash text NOT NULL, purpose text NOT NULL,
        status text NOT NULL DEFAULT 'running', tool_calls integer, model_tokens integer,
        error_code text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
      );
      CREATE INDEX discovery_usage_owner_time ON profile.discovery_usage(owner_id,owner_epoch,created_at);
      CREATE TABLE profile.discovery_cache (
        owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
        cache_key text NOT NULL, leads jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(owner_id,owner_epoch,cache_key)
      );
      CREATE TABLE profile.discovery_schedule (
        owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
        search_id uuid PRIMARY KEY REFERENCES application.saved_searches(id) ON DELETE CASCADE,
        next_due_at timestamptz NOT NULL DEFAULT now(), query_cursor integer NOT NULL DEFAULT 0
      );
      CREATE TABLE profile.discovery_legacy_bindings (
        fingerprint text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL
      );
      CREATE TRIGGER discovery_settings_epoch BEFORE INSERT OR UPDATE ON profile.discovery_settings FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      CREATE TRIGGER discovery_usage_epoch BEFORE INSERT OR UPDATE ON profile.discovery_usage FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      CREATE TRIGGER discovery_cache_epoch BEFORE INSERT OR UPDATE ON profile.discovery_cache FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      CREATE TRIGGER discovery_schedule_epoch BEFORE INSERT OR UPDATE ON profile.discovery_schedule FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      GRANT SELECT,INSERT,UPDATE,DELETE ON profile.discovery_settings,profile.discovery_usage,profile.discovery_cache,profile.discovery_schedule,profile.discovery_legacy_bindings TO aijob_web_api,aijob_match_worker,aijob_ops_cli;
      GRANT ALL ON profile.discovery_settings,profile.discovery_usage,profile.discovery_cache,profile.discovery_schedule,profile.discovery_legacy_bindings TO aijob_migrator;
      -- Collector may inspect only the legacy opt-out, never any credential column.
      CREATE VIEW source_control.legacy_discovery_demand AS
        SELECT s.discovery_query_hash FROM application.saved_searches s JOIN identity.owners o ON o.id=s.owner_id
        WHERE s.discovery_enabled AND s.owner_epoch=o.epoch AND o.status='active'
          AND (o.retention_expires_at IS NULL OR o.retention_expires_at>now())
          AND NOT EXISTS(SELECT 1 FROM profile.discovery_settings d WHERE d.owner_id=s.owner_id AND d.owner_epoch=s.owner_epoch AND NOT d.legacy_pending);
      GRANT SELECT ON source_control.legacy_discovery_demand TO aijob_web_api,aijob_match_worker,aijob_collector_worker,aijob_ops_cli;
      ALTER TABLE task_queue.tasks DROP CONSTRAINT tasks_task_type_check, DROP CONSTRAINT tasks_context_check;
      ALTER TABLE task_queue.tasks ADD CONSTRAINT tasks_task_type_check CHECK(task_type IN
        ('crawl','source_discovery','user_source_discovery','opportunity_digest','resume_analysis','match_run','recommendation_run','resume_tailoring','resume_export','resume_review','resume_review_v2','resume_studio_import','career_assistant','ai_connection_test','owner_deletion'));
      ALTER TABLE task_queue.tasks ADD CONSTRAINT tasks_context_check CHECK(
        (task_type='crawl' AND source_id IS NOT NULL AND policy_version IS NOT NULL AND adapter_version IS NOT NULL AND run_mode IS NOT NULL AND owner_id IS NULL AND owner_epoch IS NULL)
        OR (task_type='source_discovery' AND source_id IS NULL AND policy_version IS NULL AND adapter_version IS NULL AND run_mode IS NULL AND owner_id IS NULL AND owner_epoch IS NULL)
        OR (task_type IN ('user_source_discovery','opportunity_digest','resume_analysis','match_run','recommendation_run','resume_tailoring','resume_export','resume_review','resume_review_v2','resume_studio_import','career_assistant','ai_connection_test','owner_deletion')
          AND source_id IS NULL AND policy_version IS NULL AND adapter_version IS NULL AND run_mode IS NULL AND owner_id IS NOT NULL AND owner_epoch IS NOT NULL AND owner_epoch>0));
      DROP POLICY tasks_web_owner_scope ON task_queue.tasks;
      DROP POLICY tasks_match_owner_scope ON task_queue.tasks;
      CREATE POLICY tasks_web_owner_scope ON task_queue.tasks TO aijob_web_api USING(task_type IN
        ('user_source_discovery','opportunity_digest','resume_analysis','match_run','recommendation_run','resume_tailoring','resume_export','resume_review','resume_review_v2','resume_studio_import','career_assistant','ai_connection_test','owner_deletion'));
      CREATE POLICY tasks_match_owner_scope ON task_queue.tasks TO aijob_match_worker USING(task_type IN
        ('user_source_discovery','opportunity_digest','resume_analysis','match_run','recommendation_run','resume_tailoring','resume_export','resume_review','resume_review_v2','resume_studio_import','career_assistant','ai_connection_test','owner_deletion'));
      CREATE FUNCTION source_control.submit_user_discovery_lead(task uuid, fence bigint, worker text, url text, host text, title text, query_hash text, query_text text)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM task_queue.tasks t JOIN identity.owners o ON o.id=t.owner_id
          JOIN profile.discovery_settings d ON d.owner_id=o.id AND d.owner_epoch=o.epoch
          WHERE t.id=task AND t.task_type='user_source_discovery' AND t.status='running' AND t.lease_owner=worker
          AND t.fencing_token=fence AND t.lease_until>now() AND o.status='active' AND t.owner_epoch=o.epoch
          AND (o.retention_expires_at IS NULL OR o.retention_expires_at>now())
          AND d.id::text=t.payload->>'settingsId' AND d.revision::text=t.payload->>'revision')
        THEN RAISE EXCEPTION 'DISCOVERY_LEASE_LOST'; END IF;
        IF length(url)>2000 OR url !~ '^https://[a-zA-Z0-9.-]+[/?:]' OR length(host)>253 OR length(title)>300 OR length(query_text)>500
        THEN RAISE EXCEPTION 'DISCOVERY_LEAD_INVALID'; END IF;
        INSERT INTO source_control.discovery_queries(query_hash,query_text,enabled) VALUES(query_hash,query_text,false) ON CONFLICT DO NOTHING;
        INSERT INTO source_control.discovery_leads(canonical_url,hostname,title,query_hash) VALUES(url,host,title,query_hash)
          ON CONFLICT(canonical_url) DO UPDATE SET last_seen_at=now();
      END $$;
      REVOKE ALL ON FUNCTION source_control.submit_user_discovery_lead(uuid,bigint,text,text,text,text,text,text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION source_control.submit_user_discovery_lead(uuid,bigint,text,text,text,text,text,text) TO aijob_match_worker,aijob_ops_cli;
      CREATE FUNCTION source_control.reserve_user_tavily_budget(task uuid, fence bigint, worker text, day_bucket text, month_bucket text)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      DECLARE exhausted boolean;
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM task_queue.tasks t JOIN identity.owners o ON o.id=t.owner_id
          WHERE t.id=task AND t.task_type='user_source_discovery' AND t.status='running' AND t.lease_owner=worker AND t.fencing_token=fence
          AND t.lease_until>now() AND o.status='active' AND t.owner_epoch=o.epoch)
        THEN RAISE EXCEPTION 'DISCOVERY_LEASE_LOST'; END IF;
        IF day_bucket <> 'tavily:day:'||to_char(now() AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')
          OR month_bucket <> 'tavily:month:'||to_char(now() AT TIME ZONE 'Asia/Shanghai','YYYY-MM')
        THEN RAISE EXCEPTION 'DISCOVERY_BUCKET_INVALID'; END IF;
        INSERT INTO source_control.discovery_budget_buckets(bucket,maximum) VALUES(day_bucket,20),(month_bucket,500) ON CONFLICT DO NOTHING;
        PERFORM bucket FROM source_control.discovery_budget_buckets WHERE bucket IN(day_bucket,month_bucket) ORDER BY bucket FOR UPDATE;
        SELECT bool_or(used>=maximum) INTO exhausted FROM source_control.discovery_budget_buckets WHERE bucket IN(day_bucket,month_bucket);
        IF exhausted THEN RETURN false; END IF;
        UPDATE source_control.discovery_budget_buckets SET used=used+1 WHERE bucket IN(day_bucket,month_bucket);
        RETURN true;
      END $$;
      REVOKE ALL ON FUNCTION source_control.reserve_user_tavily_budget(uuid,bigint,text,text,text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION source_control.reserve_user_tavily_budget(uuid,bigint,text,text,text) TO aijob_match_worker,aijob_ops_cli;
    `.execute(db);
  },
  async down() {
    throw new Error("Forward-only: preserve personal discovery settings.");
  },
};
