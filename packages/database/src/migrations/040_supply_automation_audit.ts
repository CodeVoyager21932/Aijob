import { sql, type Migration } from "kysely";

export const supplyAutomationAuditMigration: Migration = {
  async up(db) {
    await sql`
      ALTER TABLE ingestion.crawl_runs ADD COLUMN access_observations jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE source_control.source_policy_versions ADD COLUMN access_policy_evidence jsonb;
      ALTER TABLE catalog.job_requirement_sets ADD COLUMN extraction_version text NOT NULL DEFAULT 'deterministic-v1';
      CREATE TABLE source_control.operator_actions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_key text NOT NULL,
        action text NOT NULL CHECK (action IN ('configuration_draft','configuration_install','refresh','resume')),
        proposal_hash text, previous_hash text, evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL CHECK (status IN ('prepared','completed','failed')),
        created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
      );
      CREATE INDEX operator_actions_source_time ON source_control.operator_actions(source_key, created_at DESC);
      GRANT SELECT ON source_control.operator_actions TO aijob_collector_worker;
      GRANT SELECT, INSERT, UPDATE ON source_control.operator_actions TO aijob_ops_cli;
      GRANT ALL ON source_control.operator_actions TO aijob_migrator;
      CREATE FUNCTION source_control.revoke_publication_on_access_pause() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.automation_paused AND NEW.automation_pause_reason IN
          ('ROBOTS_NOW_DISALLOWS_TARGET', 'ROBOTS_UNAVAILABLE_ON_RECHECK', 'TERMS_PROHIBIT_AGGREGATION', 'ACCESS_POLICY_EVIDENCE_MISSING')
        THEN
          WITH affected AS MATERIALIZED (
            SELECT job.id, job.public_version_id
            FROM catalog.published_jobs job
            JOIN catalog.published_job_versions version ON version.id = job.public_version_id
            JOIN ingestion.source_job_revisions revision ON revision.id = version.source_job_revision_id
            JOIN ingestion.source_job_records record ON record.id = revision.source_job_record_id
            WHERE record.source_id = NEW.source_id AND job.publication_suppressed_at IS NULL
            FOR UPDATE OF job
          ), changed AS (
            UPDATE catalog.published_jobs job SET public_version_id = NULL,
              publication_suppressed_at = now(), publication_suppressed_reason = 'SOURCE_ACCESS_PAUSE:' || NEW.source_id::text
            FROM affected WHERE job.id = affected.id RETURNING job.id
          )
          INSERT INTO catalog.publication_events(id, published_job_id, published_job_version_id, previous_public_version_id,
            action, actor, reason_code, blocking_reasons, occurred_at)
          SELECT gen_random_uuid(), affected.id, NULL, affected.public_version_id, 'revoked', 'reconciliation',
            NEW.automation_pause_reason, '[]'::jsonb, now()
          FROM affected JOIN changed ON changed.id = affected.id;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER source_access_pause_revokes_publication AFTER UPDATE ON source_control.source_runtime_states
        FOR EACH ROW EXECUTE FUNCTION source_control.revoke_publication_on_access_pause();
    `.execute(db);
  },
  // Additive fields remain available when rolling the application back.
  async down() {
    throw new Error(
      "Forward-only migration; restore a verified backup to roll back database state.",
    );
  },
};
