import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

async function createInternalJobPreviewsView(
  db: Kysely<Database>,
  enforceScheduledAcceptance: boolean,
): Promise<void> {
  const acceptedRevisionPredicate = enforceScheduledAcceptance
    ? sql`
        AND (
          candidate_revision.import_mode = 'manual'
          OR EXISTS (
            SELECT 1
            FROM ingestion.source_job_revision_evidence AS accepted_evidence
            JOIN ingestion.crawl_fetches AS accepted_fetch
              ON accepted_fetch.id = accepted_evidence.crawl_fetch_id
            JOIN ingestion.crawl_runs AS accepted_run
              ON accepted_run.id = accepted_fetch.crawl_run_id
            WHERE accepted_evidence.revision_id = candidate_revision.id
              AND (
                accepted_run.run_mode <> 'scheduled'
                OR accepted_run.automation_acceptance = 'accepted'
              )
          )
        )
      `
    : sql``;

  await sql`
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
      source.source_type,
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
        ${acceptedRevisionPredicate}
      ORDER BY candidate_revision.created_at DESC, candidate_revision.id DESC
      LIMIT 1
    ) AS revision ON true
    JOIN source_control.sources AS source ON source.id = record.source_id
    JOIN source_control.organizations AS organization ON organization.id = source.organization_id
    JOIN source_control.source_policy_versions AS policy
      ON policy.source_id = source.id
      AND policy.version = source.current_policy_version;
  `.execute(db);
}

export async function backfillHistoricalPublicVersionPointers(db: Kysely<Database>): Promise<void> {
  await sql`
    WITH latest_published_versions AS (
      SELECT DISTINCT ON (version.published_job_id)
        version.published_job_id,
        version.id AS public_version_id
      FROM catalog.published_job_versions AS version
      JOIN catalog.published_job_version_revision_links AS link
        ON link.published_job_version_id = version.id
      JOIN ingestion.source_job_revisions AS revision
        ON revision.id = link.source_job_revision_id
      WHERE revision.ingestion_state = 'validated'
        AND revision.publication_state = 'published'
      ORDER BY
        version.published_job_id,
        revision.created_at DESC,
        revision.id DESC,
        version.id DESC
    )
    UPDATE catalog.published_jobs AS job
    SET public_version_id = latest.public_version_id
    FROM latest_published_versions AS latest
    WHERE job.id = latest.published_job_id
      AND job.public_version_id IS DISTINCT FROM latest.public_version_id;
  `.execute(db);
}

export const sourceRefreshAutomationMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`DROP VIEW catalog.internal_job_previews`.execute(db);

    await sql`
      ALTER TABLE source_control.source_policy_versions
        ADD COLUMN refresh_coverage text NOT NULL DEFAULT 'tracked_records',
        ADD COLUMN absence_policy text NOT NULL DEFAULT 'none',
        ADD CONSTRAINT source_policy_refresh_coverage_check CHECK (
          refresh_coverage IN ('full_scope', 'tracked_records', 'manual_snapshot')
        ),
        ADD CONSTRAINT source_policy_absence_policy_check CHECK (
          absence_policy IN ('none', 'close_after_two_complete_absences')
        ),
        ADD CONSTRAINT source_policy_absence_scope_check CHECK (
          absence_policy = 'none' OR refresh_coverage = 'full_scope'
        );

      ALTER TABLE source_control.source_runtime_states
        ADD COLUMN automation_paused boolean NOT NULL DEFAULT false,
        ADD COLUMN automation_pause_reason text,
        ADD COLUMN manual_snapshot_required boolean NOT NULL DEFAULT false,
        ADD COLUMN manual_snapshot_due_at timestamptz,
        ADD COLUMN last_successful_run_at timestamptz,
        ADD COLUMN last_scheduled_run_at timestamptz,
        ADD CONSTRAINT source_runtime_automation_pause_check CHECK (
          automation_paused OR automation_pause_reason IS NULL
        ),
        ADD CONSTRAINT source_runtime_manual_snapshot_check CHECK (
          manual_snapshot_required OR manual_snapshot_due_at IS NULL
        );

      ALTER TABLE ingestion.crawl_runs
        ADD COLUMN automation_acceptance text NOT NULL DEFAULT 'not_applicable';

      UPDATE ingestion.crawl_runs
      SET automation_acceptance = CASE
        WHEN run_mode = 'scheduled' AND finished_at IS NULL THEN 'pending'
        WHEN run_mode = 'scheduled' THEN 'rejected'
        ELSE 'not_applicable'
      END;

      ALTER TABLE ingestion.crawl_runs
        ADD CONSTRAINT crawl_runs_automation_acceptance_check CHECK (
          automation_acceptance IN ('not_applicable', 'pending', 'accepted', 'rejected')
        ),
        ADD CONSTRAINT crawl_runs_scheduled_acceptance_check CHECK (
          (run_mode = 'scheduled' AND automation_acceptance <> 'not_applicable')
          OR (run_mode <> 'scheduled' AND automation_acceptance = 'not_applicable')
        );

      ALTER TABLE catalog.published_jobs
        ADD COLUMN public_version_id uuid,
        ADD CONSTRAINT published_jobs_public_version_same_job_fk
        FOREIGN KEY (id, public_version_id)
        REFERENCES catalog.published_job_versions(published_job_id, id);

      WITH published_representatives AS (
        SELECT DISTINCT ON (link.published_job_version_id)
          link.published_job_version_id,
          revision.id AS revision_id
        FROM catalog.published_job_version_revision_links AS link
        JOIN ingestion.source_job_revisions AS revision
          ON revision.id = link.source_job_revision_id
        WHERE revision.ingestion_state = 'validated'
          AND revision.publication_state = 'published'
        ORDER BY
          link.published_job_version_id,
          revision.created_at DESC,
          revision.id DESC
      )
      UPDATE catalog.published_job_versions AS version
      SET source_job_revision_id = representative.revision_id
      FROM published_representatives AS representative
      WHERE representative.published_job_version_id = version.id;

      CREATE TABLE source_control.refresh_circuit_breaker (
        id text PRIMARY KEY CHECK (id = 'global'),
        open_until timestamptz,
        reason text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (open_until IS NOT NULL OR reason IS NULL)
      );

      INSERT INTO source_control.refresh_circuit_breaker (id) VALUES ('global');

      CREATE TABLE ingestion.source_job_activity_states (
        source_job_record_id uuid PRIMARY KEY
          REFERENCES ingestion.source_job_records(id) ON DELETE CASCADE,
        absence_state text NOT NULL DEFAULT 'active' CHECK (
          absence_state IN ('active', 'uncertain', 'closed')
        ),
        direct_state text NOT NULL DEFAULT 'active' CHECK (
          direct_state IN ('active', 'closed')
        ),
        direct_reason text,
        direct_evidence_run_id uuid REFERENCES ingestion.crawl_runs(id),
        consecutive_complete_absences integer NOT NULL DEFAULT 0 CHECK (
          consecutive_complete_absences BETWEEN 0 AND 2
        ),
        last_seen_run_id uuid REFERENCES ingestion.crawl_runs(id),
        last_absent_run_id uuid REFERENCES ingestion.crawl_runs(id),
        last_absent_at timestamptz,
        closed_reason text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (
          (direct_state = 'active' AND direct_reason IS NULL)
          OR (
            direct_state = 'closed'
            AND direct_reason IN ('official_closed', 'http_404', 'http_410')
            AND direct_evidence_run_id IS NOT NULL
          )
        ),
        CHECK (
          (absence_state = 'active' AND consecutive_complete_absences = 0 AND closed_reason IS NULL)
          OR (absence_state = 'uncertain' AND consecutive_complete_absences = 1 AND closed_reason IS NULL)
          OR (
            absence_state = 'closed'
            AND consecutive_complete_absences = 2
            AND closed_reason = 'two_complete_absences'
          )
        )
      );

      CREATE INDEX source_job_activity_state_idx
        ON ingestion.source_job_activity_states(absence_state, updated_at);
    `.execute(db);

    await createInternalJobPreviewsView(db, true);

    await sql`
      CREATE FUNCTION catalog.deadline_shanghai_date(value jsonb)
      RETURNS date
      LANGUAGE plpgsql
      STABLE
      AS $$
      DECLARE
        raw_value text;
      BEGIN
        IF jsonb_typeof(value) <> 'object' OR value ->> 'state' <> 'known' THEN
          RETURN NULL;
        END IF;
        raw_value := value ->> 'value';
        IF raw_value IS NULL THEN
          RETURN NULL;
        END IF;
        IF raw_value ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN
          RETURN raw_value::date;
        END IF;
        RETURN (raw_value::timestamptz AT TIME ZONE 'Asia/Shanghai')::date;
      EXCEPTION WHEN others THEN
        RETURN NULL;
      END;
      $$;

      CREATE VIEW catalog.current_job_effective_activity AS
      SELECT
        version.published_job_id,
        version.id AS published_job_version_id,
        record.id AS source_job_record_id,
        CASE
          WHEN version.activity_state = 'closed' OR revision.activity_state = 'closed' THEN 'closed'
          WHEN activity.direct_state = 'closed' THEN 'closed'
          WHEN
            catalog.deadline_shanghai_date(version.deadline_at)
              < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
            THEN 'closed'
          WHEN activity.absence_state = 'closed' THEN 'closed'
          WHEN
            version.activity_state = 'uncertain'
            OR revision.activity_state = 'uncertain'
            OR activity.absence_state = 'uncertain'
            THEN 'uncertain'
          ELSE 'active'
        END AS effective_activity_state
      FROM catalog.published_job_versions AS version
      JOIN ingestion.source_job_revisions AS revision
        ON revision.id = version.source_job_revision_id
      JOIN ingestion.source_job_records AS record
        ON record.id = revision.source_job_record_id
      LEFT JOIN ingestion.source_job_activity_states AS activity
        ON activity.source_job_record_id = record.id;
    `.execute(db);

    await backfillHistoricalPublicVersionPointers(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`DROP VIEW catalog.current_job_effective_activity`.execute(db);
    await sql`DROP FUNCTION catalog.deadline_shanghai_date(jsonb)`.execute(db);
    await sql`DROP VIEW catalog.internal_job_previews`.execute(db);

    await sql`
      DROP TABLE ingestion.source_job_activity_states;
      DROP TABLE source_control.refresh_circuit_breaker;

      ALTER TABLE catalog.published_jobs
        DROP CONSTRAINT published_jobs_public_version_same_job_fk,
        DROP COLUMN public_version_id;

      ALTER TABLE ingestion.crawl_runs
        DROP CONSTRAINT crawl_runs_scheduled_acceptance_check,
        DROP CONSTRAINT crawl_runs_automation_acceptance_check,
        DROP COLUMN automation_acceptance;

      ALTER TABLE source_control.source_runtime_states
        DROP CONSTRAINT source_runtime_manual_snapshot_check,
        DROP CONSTRAINT source_runtime_automation_pause_check,
        DROP COLUMN last_scheduled_run_at,
        DROP COLUMN last_successful_run_at,
        DROP COLUMN manual_snapshot_due_at,
        DROP COLUMN manual_snapshot_required,
        DROP COLUMN automation_pause_reason,
        DROP COLUMN automation_paused;

      ALTER TABLE source_control.source_policy_versions
        DROP CONSTRAINT source_policy_absence_scope_check,
        DROP CONSTRAINT source_policy_absence_policy_check,
        DROP CONSTRAINT source_policy_refresh_coverage_check,
        DROP COLUMN absence_policy,
        DROP COLUMN refresh_coverage;
    `.execute(db);

    await createInternalJobPreviewsView(db, false);
  },
};
