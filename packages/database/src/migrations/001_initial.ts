import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

export const initialMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE SCHEMA IF NOT EXISTS source_control;
      CREATE SCHEMA IF NOT EXISTS task_queue;
      CREATE SCHEMA IF NOT EXISTS ingestion;
      CREATE SCHEMA IF NOT EXISTS catalog;
      CREATE SCHEMA IF NOT EXISTS decision_feedback_audit;

      CREATE TABLE source_control.organizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL UNIQUE,
        name text NOT NULL,
        official_domain text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE source_control.source_candidates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES source_control.organizations(id),
        source_key text NOT NULL UNIQUE,
        name text NOT NULL,
        entrypoint_url text NOT NULL,
        provenance_level text NOT NULL CHECK (
          provenance_level IN (
            'organization_owned',
            'verified_ats_tenant',
            'university_published',
            'official_account_link',
            'unverified'
          )
        ),
        acquisition_mode text NOT NULL CHECK (
          acquisition_mode IN ('public_api', 'json_ld', 'deterministic_html', 'browser_required')
        ),
        candidate_status text NOT NULL CHECK (
          candidate_status IN ('candidate', 'technical_probe', 'pilot', 'watch', 'rejected')
        ),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE source_control.source_assessments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_candidate_id uuid NOT NULL REFERENCES source_control.source_candidates(id),
        assessment_hash text NOT NULL,
        assessor text NOT NULL,
        hard_gates jsonb NOT NULL,
        scores jsonb NOT NULL,
        total_score integer NOT NULL CHECK (total_score BETWEEN 0 AND 100),
        decision text NOT NULL CHECK (decision IN ('pilot', 'watch', 'reject', 'ineligible')),
        evidence_notes text NOT NULL,
        assessed_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (source_candidate_id, assessment_hash)
      );

      CREATE TABLE source_control.sources (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES source_control.organizations(id),
        source_candidate_id uuid REFERENCES source_control.source_candidates(id),
        source_key text NOT NULL UNIQUE,
        name text NOT NULL,
        current_policy_version integer NOT NULL CHECK (current_policy_version > 0),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE source_control.source_policy_versions (
        source_id uuid NOT NULL REFERENCES source_control.sources(id),
        version integer NOT NULL CHECK (version > 0),
        policy_status text NOT NULL CHECK (
          policy_status IN ('pending_review', 'approved', 'paused', 'blocked', 'retired')
        ),
        provenance_level text NOT NULL,
        acquisition_mode text NOT NULL,
        adapter_key text NOT NULL,
        adapter_version text NOT NULL,
        entrypoints jsonb NOT NULL,
        crawl_interval text,
        policy_notes text NOT NULL,
        reviewed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (source_id, version)
      );

      CREATE TABLE source_control.source_fetch_targets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id uuid NOT NULL,
        policy_version integer NOT NULL,
        method text NOT NULL CHECK (method IN ('GET', 'POST')),
        scheme text NOT NULL CHECK (scheme = 'https'),
        host text NOT NULL,
        port integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
        path_prefix text NOT NULL CHECK (path_prefix LIKE '/%'),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (source_id, policy_version)
          REFERENCES source_control.source_policy_versions(source_id, version),
        UNIQUE (source_id, policy_version, method, scheme, host, port, path_prefix)
      );

      CREATE TABLE source_control.source_apply_targets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id uuid NOT NULL,
        policy_version integer NOT NULL,
        method text NOT NULL CHECK (method = 'GET'),
        scheme text NOT NULL CHECK (scheme = 'https'),
        host text NOT NULL,
        port integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
        path_prefix text NOT NULL CHECK (path_prefix LIKE '/%'),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (source_id, policy_version)
          REFERENCES source_control.source_policy_versions(source_id, version),
        UNIQUE (source_id, policy_version, method, scheme, host, port, path_prefix)
      );

      CREATE TABLE source_control.source_runtime_states (
        source_id uuid PRIMARY KEY REFERENCES source_control.sources(id),
        policy_version integer NOT NULL,
        freshness_state text NOT NULL CHECK (freshness_state IN ('fresh', 'due', 'stale', 'unknown')),
        last_complete_run_at timestamptz,
        consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
        last_error_code text,
        next_due_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (source_id, policy_version)
          REFERENCES source_control.source_policy_versions(source_id, version)
      );

      CREATE TABLE task_queue.tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        task_type text NOT NULL CHECK (
          task_type IN ('crawl', 'resume_analysis', 'match_run', 'owner_deletion')
        ),
        source_id uuid NOT NULL REFERENCES source_control.sources(id),
        policy_version integer NOT NULL,
        adapter_version text NOT NULL,
        run_mode text NOT NULL CHECK (run_mode IN ('probe', 'scheduled')),
        idempotency_key text NOT NULL UNIQUE,
        status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead')),
        attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
        max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
        available_at timestamptz NOT NULL DEFAULT now(),
        backoff_policy jsonb NOT NULL,
        lease_owner text,
        lease_until timestamptz,
        heartbeat_at timestamptz,
        fencing_token bigint NOT NULL DEFAULT 0,
        last_error_code text,
        last_error_summary text,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        FOREIGN KEY (source_id, policy_version)
          REFERENCES source_control.source_policy_versions(source_id, version)
      );

      CREATE TABLE ingestion.crawl_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id uuid NOT NULL REFERENCES task_queue.tasks(id),
        source_id uuid NOT NULL REFERENCES source_control.sources(id),
        policy_version integer NOT NULL,
        adapter_version text NOT NULL,
        run_mode text NOT NULL CHECK (run_mode IN ('probe', 'scheduled')),
        completion text CHECK (completion IN ('complete', 'partial', 'failed')),
        reported_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
        request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
        discovered_count integer NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
        normalized_count integer NOT NULL DEFAULT 0 CHECK (normalized_count >= 0),
        rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
        error_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz
      );

      CREATE TABLE ingestion.snapshot_objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id uuid NOT NULL REFERENCES source_control.sources(id),
        content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
        object_key text NOT NULL UNIQUE,
        original_byte_size integer NOT NULL CHECK (original_byte_size >= 0),
        stored_byte_size integer NOT NULL CHECK (stored_byte_size >= 0),
        content_type text NOT NULL,
        content_encoding text NOT NULL CHECK (content_encoding = 'gzip'),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (source_id, content_hash)
      );

      CREATE TABLE ingestion.crawl_fetches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        crawl_run_id uuid NOT NULL REFERENCES ingestion.crawl_runs(id),
        snapshot_object_id uuid REFERENCES ingestion.snapshot_objects(id),
        method text NOT NULL CHECK (method IN ('GET', 'POST')),
        request_url text NOT NULL,
        final_url text NOT NULL,
        request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
        http_status integer,
        content_type text,
        response_headers jsonb NOT NULL,
        fetch_result text NOT NULL CHECK (
          fetch_result IN ('success', 'http_error', 'schema_error', 'network_error', 'policy_error')
        ),
        error_code text,
        fetched_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE ingestion.source_job_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id uuid NOT NULL REFERENCES source_control.sources(id),
        source_job_id text NOT NULL,
        canonical_source_url text NOT NULL,
        first_seen_at timestamptz NOT NULL,
        last_seen_at timestamptz NOT NULL,
        UNIQUE (source_id, source_job_id)
      );

      CREATE TABLE ingestion.source_job_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_job_record_id uuid NOT NULL REFERENCES ingestion.source_job_records(id),
        revision_content_hash text NOT NULL CHECK (revision_content_hash ~ '^[a-f0-9]{64}$'),
        import_mode text NOT NULL CHECK (import_mode IN ('collector', 'manual')),
        adapter_version text NOT NULL,
        normalizer_version text NOT NULL,
        company_name text NOT NULL,
        title text NOT NULL,
        job_family jsonb NOT NULL,
        locations jsonb NOT NULL,
        business_groups jsonb NOT NULL,
        entry_scope text NOT NULL,
        source_project_name text,
        recruit_label_name text,
        recruitment_type jsonb NOT NULL,
        responsibilities text NOT NULL,
        requirements text NOT NULL,
        structured_fields jsonb NOT NULL,
        ingestion_state text NOT NULL CHECK (
          ingestion_state IN ('discovered', 'parsed', 'validated', 'rejected')
        ),
        publication_state text NOT NULL CHECK (
          publication_state IN ('draft', 'review', 'published', 'suppressed', 'archived')
        ),
        activity_state text NOT NULL CHECK (activity_state IN ('active', 'uncertain', 'closed')),
        source_url text NOT NULL,
        apply_url text,
        quality_flags jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (source_job_record_id, revision_content_hash)
      );

      CREATE TABLE ingestion.source_job_revision_evidence (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        revision_id uuid NOT NULL REFERENCES ingestion.source_job_revisions(id),
        crawl_fetch_id uuid NOT NULL REFERENCES ingestion.crawl_fetches(id),
        evidence_role text NOT NULL CHECK (evidence_role IN ('list', 'detail', 'apply_check')),
        field_name text NOT NULL,
        json_pointer text NOT NULL,
        raw_value_hash text NOT NULL CHECK (raw_value_hash ~ '^[a-f0-9]{64}$'),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (revision_id, crawl_fetch_id, evidence_role, field_name, json_pointer)
      );

      CREATE TABLE ingestion.review_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        revision_id uuid NOT NULL REFERENCES ingestion.source_job_revisions(id),
        reason_code text NOT NULL,
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz,
        UNIQUE (revision_id, reason_code)
      );

      CREATE TABLE catalog.published_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        current_version_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE catalog.published_job_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        published_job_id uuid NOT NULL REFERENCES catalog.published_jobs(id),
        source_job_revision_id uuid NOT NULL REFERENCES ingestion.source_job_revisions(id),
        content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
        company_name text NOT NULL,
        title text NOT NULL,
        job_family jsonb NOT NULL,
        locations jsonb NOT NULL,
        responsibilities text NOT NULL,
        requirements text NOT NULL,
        structured_fields jsonb NOT NULL,
        activity_state text NOT NULL CHECK (activity_state IN ('active', 'uncertain', 'closed')),
        source_url text NOT NULL,
        apply_url text,
        effective_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (published_job_id, content_hash)
      );

      ALTER TABLE catalog.published_jobs
        ADD CONSTRAINT published_jobs_current_version_fk
        FOREIGN KEY (current_version_id) REFERENCES catalog.published_job_versions(id);

      CREATE TABLE catalog.job_requirement_sets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        published_job_version_id uuid NOT NULL REFERENCES catalog.published_job_versions(id),
        schema_version text NOT NULL,
        requirements jsonb NOT NULL,
        content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (published_job_version_id, content_hash)
      );

      CREATE TABLE decision_feedback_audit.audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type text NOT NULL,
        actor_type text NOT NULL,
        subject_type text NOT NULL,
        subject_id text NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX crawl_tasks_claim_idx
        ON task_queue.tasks(status, available_at)
        WHERE status = 'queued';
      CREATE INDEX crawl_runs_source_started_idx
        ON ingestion.crawl_runs(source_id, started_at DESC);
      CREATE INDEX crawl_fetches_run_idx
        ON ingestion.crawl_fetches(crawl_run_id, fetched_at);
      CREATE INDEX source_job_revisions_record_created_idx
        ON ingestion.source_job_revisions(source_job_record_id, created_at DESC);
      CREATE INDEX review_items_open_idx
        ON ingestion.review_items(status, created_at)
        WHERE status = 'open';

      CREATE VIEW catalog.internal_job_previews AS
      SELECT
        record.id AS job_id,
        revision.id AS revision_id,
        record.source_job_id,
        source.id AS source_id,
        source.source_key,
        source.name AS source_name,
        revision.company_name,
        organization.official_domain,
        'organization_career_site'::text AS source_type,
        policy.provenance_level,
        policy.policy_status,
        revision.title,
        revision.job_family,
        revision.locations,
        revision.business_groups,
        revision.entry_scope,
        revision.source_project_name,
        revision.recruit_label_name,
        revision.recruitment_type,
        revision.responsibilities,
        revision.requirements,
        revision.import_mode,
        revision.structured_fields,
        revision.ingestion_state,
        revision.publication_state,
        revision.activity_state,
        revision.source_url,
        revision.apply_url,
        revision.quality_flags,
        COALESCE(
          (
            SELECT jsonb_agg(item.reason_code ORDER BY item.reason_code)
            FROM ingestion.review_items AS item
            WHERE item.revision_id = revision.id AND item.status = 'open'
          ),
          '[]'::jsonb
        ) AS review_reasons,
        record.first_seen_at,
        record.last_seen_at AS last_verified_at
      FROM ingestion.source_job_records AS record
      JOIN LATERAL (
        SELECT candidate_revision.*
        FROM ingestion.source_job_revisions AS candidate_revision
        WHERE candidate_revision.source_job_record_id = record.id
        ORDER BY candidate_revision.created_at DESC, candidate_revision.id DESC
        LIMIT 1
      ) AS revision ON true
      JOIN source_control.sources AS source ON source.id = record.source_id
      JOIN source_control.organizations AS organization ON organization.id = source.organization_id
      JOIN source_control.source_policy_versions AS policy
        ON policy.source_id = source.id
        AND policy.version = source.current_policy_version;
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      DROP SCHEMA IF EXISTS decision_feedback_audit CASCADE;
      DROP SCHEMA IF EXISTS catalog CASCADE;
      DROP SCHEMA IF EXISTS ingestion CASCADE;
      DROP SCHEMA IF EXISTS task_queue CASCADE;
      DROP SCHEMA IF EXISTS source_control CASCADE;
    `.execute(db);
  },
};
