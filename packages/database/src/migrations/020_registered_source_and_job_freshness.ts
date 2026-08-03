import type { Kysely, Migration, RawBuilder } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

async function createEligibilityViews(
  db: Kysely<Database>,
  blockers: {
    currentConfig: RawBuilder<unknown>;
    currentJobFreshness: RawBuilder<unknown>;
    versionConfig: RawBuilder<unknown>;
    versionJobFreshness: RawBuilder<unknown>;
  },
): Promise<void> {
  await sql`
    CREATE VIEW catalog.current_job_eligibility AS
    WITH base AS (
      SELECT
        preview.*,
        policy.catalog_role,
        policy.runtime_scope,
        COALESCE(runtime.freshness_state, 'unknown') AS freshness_state,
        CASE
          WHEN
            COALESCE(activity.effective_activity_state, preview.activity_state) = 'closed'
            OR catalog.deadline_shanghai_date(revision.deadline_at)
              < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
            THEN 'closed'
          ELSE COALESCE(activity.effective_activity_state, preview.activity_state)
        END AS effective_activity_state
      FROM catalog.internal_job_previews AS preview
      JOIN ingestion.source_job_revisions AS revision
        ON revision.id = preview.revision_id
      JOIN source_control.sources AS source
        ON source.id = preview.source_id
      JOIN source_control.source_policy_versions AS policy
        ON policy.source_id = source.id
        AND policy.version = source.current_policy_version
      LEFT JOIN source_control.source_runtime_states AS runtime
        ON runtime.source_id = source.id
      LEFT JOIN LATERAL (
        SELECT version.id AS published_job_version_id
        FROM catalog.published_jobs AS job
        JOIN catalog.published_job_versions AS version
          ON version.id = job.current_version_id
        JOIN catalog.published_job_version_revision_links AS link
          ON link.published_job_version_id = version.id
          AND link.source_job_revision_id = preview.revision_id
        LIMIT 1
      ) AS published ON true
      LEFT JOIN catalog.current_job_effective_activity AS activity
        ON activity.published_job_version_id = published.published_job_version_id
    )
    SELECT
      base.*,
      to_jsonb(blockers.values) AS blocking_reasons,
      cardinality(blockers.values) = 0 AS eligible_for_local_mvp,
      cardinality(blockers.values) = 0
        AND policy_status = 'approved'
        AND runtime_scope IN ('alpha', 'production') AS eligible_for_alpha
    FROM base
    CROSS JOIN LATERAL (
      SELECT
        array_remove(
          ARRAY[
            CASE WHEN catalog_role <> 'canonical' THEN 'NON_CANONICAL_SOURCE' END,
            CASE WHEN runtime_scope = 'test' THEN 'TEST_RUNTIME_SCOPE' END,
            ${blockers.currentConfig},
            CASE
              WHEN policy_status NOT IN ('pending_review', 'approved')
                THEN 'SOURCE_POLICY_NOT_LOCAL_ALLOWED'
            END,
            CASE WHEN ingestion_state <> 'validated' THEN 'INGESTION_NOT_VALIDATED' END,
            CASE
              WHEN publication_state NOT IN ('review', 'published')
                THEN 'PUBLICATION_NOT_REVIEWABLE'
            END,
            CASE WHEN effective_activity_state <> 'active' THEN 'JOB_NOT_ACTIVE' END,
            CASE WHEN freshness_state <> 'fresh' THEN 'SOURCE_NOT_FRESH' END,
            ${blockers.currentJobFreshness},
            CASE WHEN btrim(responsibilities) = '' THEN 'RESPONSIBILITIES_MISSING' END,
            CASE WHEN btrim(requirements) = '' THEN 'REQUIREMENTS_MISSING' END,
            CASE WHEN apply_url IS NULL THEN 'EXACT_APPLICATION_NOT_AVAILABLE' END,
            CASE
              WHEN review_reasons ?| ARRAY[
                'SOURCE_KIND_CONFLICT',
                'STRUCTURED_FIELDS_MISSING',
                'ROLE_LEVEL_DUTIES_NOT_STATED',
                'TARGET_SCOPE_REVIEW_REQUIRED',
                'MANUAL_BROWSER_IMPORT_REQUIRES_REVIEW',
                'MANUAL_OFFICIAL_ACCOUNT_IMPORT_REQUIRES_REVIEW'
              ]
                THEN 'BLOCKING_REVIEW_OPEN'
            END
          ]::text[],
          NULL
        ) AS values
    ) AS blockers;

    CREATE VIEW catalog.job_version_eligibility AS
    WITH base AS (
      SELECT
        version.id AS published_job_version_id,
        revision.id AS revision_id,
        source.id AS source_id,
        revision.ingestion_state,
        revision.publication_state,
        policy.policy_status,
        policy.catalog_role,
        policy.runtime_scope,
        COALESCE(runtime.freshness_state, 'unknown') AS freshness_state,
        activity.effective_activity_state,
        version.responsibilities,
        version.requirements,
        version.apply_url,
        EXISTS (
          SELECT 1
          FROM ingestion.review_items AS review
          WHERE review.revision_id = revision.id
            AND review.status = 'open'
            AND review.reason_code IN (
              'SOURCE_KIND_CONFLICT',
              'STRUCTURED_FIELDS_MISSING',
              'ROLE_LEVEL_DUTIES_NOT_STATED',
              'TARGET_SCOPE_REVIEW_REQUIRED',
              'MANUAL_BROWSER_IMPORT_REQUIRES_REVIEW',
              'MANUAL_OFFICIAL_ACCOUNT_IMPORT_REQUIRES_REVIEW'
            )
        ) AS has_blocking_review
      FROM catalog.published_job_versions AS version
      JOIN ingestion.source_job_revisions AS revision
        ON revision.id = version.source_job_revision_id
      JOIN ingestion.source_job_records AS record
        ON record.id = revision.source_job_record_id
      JOIN source_control.sources AS source
        ON source.id = record.source_id
      JOIN source_control.source_policy_versions AS policy
        ON policy.source_id = source.id
        AND policy.version = source.current_policy_version
      LEFT JOIN source_control.source_runtime_states AS runtime
        ON runtime.source_id = source.id
      JOIN catalog.current_job_effective_activity AS activity
        ON activity.published_job_version_id = version.id
    )
    SELECT
      base.*,
      to_jsonb(blockers.values) AS blocking_reasons,
      cardinality(blockers.values) = 0 AS eligible_for_local_mvp,
      cardinality(blockers.values) = 0
        AND policy_status = 'approved'
        AND publication_state = 'published'
        AND runtime_scope IN ('alpha', 'production') AS eligible_for_alpha
    FROM base
    CROSS JOIN LATERAL (
      SELECT
        array_remove(
          ARRAY[
            CASE WHEN catalog_role <> 'canonical' THEN 'NON_CANONICAL_SOURCE' END,
            CASE WHEN runtime_scope = 'test' THEN 'TEST_RUNTIME_SCOPE' END,
            ${blockers.versionConfig},
            CASE
              WHEN policy_status NOT IN ('pending_review', 'approved')
                THEN 'SOURCE_POLICY_NOT_LOCAL_ALLOWED'
            END,
            CASE WHEN ingestion_state <> 'validated' THEN 'INGESTION_NOT_VALIDATED' END,
            CASE
              WHEN publication_state NOT IN ('review', 'published')
                THEN 'PUBLICATION_NOT_REVIEWABLE'
            END,
            CASE WHEN effective_activity_state <> 'active' THEN 'JOB_NOT_ACTIVE' END,
            CASE WHEN freshness_state <> 'fresh' THEN 'SOURCE_NOT_FRESH' END,
            ${blockers.versionJobFreshness},
            CASE WHEN btrim(responsibilities) = '' THEN 'RESPONSIBILITIES_MISSING' END,
            CASE WHEN btrim(requirements) = '' THEN 'REQUIREMENTS_MISSING' END,
            CASE WHEN apply_url IS NULL THEN 'EXACT_APPLICATION_NOT_AVAILABLE' END,
            CASE WHEN has_blocking_review THEN 'BLOCKING_REVIEW_OPEN' END
          ]::text[],
          NULL
        ) AS values
    ) AS blockers;
  `.execute(db);
}

const noBlocker = sql`NULL::text`;

export const registeredSourceAndJobFreshnessMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      DROP VIEW catalog.job_version_eligibility;
      DROP VIEW catalog.current_job_eligibility;

      ALTER TABLE source_control.source_policy_versions
        ADD COLUMN config_registered boolean NOT NULL DEFAULT false;
    `.execute(db);

    await createEligibilityViews(db, {
      currentConfig: sql`
        CASE WHEN NOT EXISTS (
          SELECT 1
          FROM source_control.sources AS configured_source
          JOIN source_control.source_policy_versions AS configured_policy
            ON configured_policy.source_id = configured_source.id
            AND configured_policy.version = configured_source.current_policy_version
          WHERE configured_source.id = base.source_id
            AND configured_policy.config_registered
        ) THEN 'SOURCE_CONFIG_NOT_REGISTERED' END
      `,
      currentJobFreshness: sql`
        CASE WHEN NOT EXISTS (
          SELECT 1
          FROM ingestion.source_job_records AS verified_record
          JOIN source_control.sources AS configured_source
            ON configured_source.id = verified_record.source_id
          JOIN source_control.source_policy_versions AS configured_policy
            ON configured_policy.source_id = configured_source.id
            AND configured_policy.version = configured_source.current_policy_version
          WHERE verified_record.id = base.job_id
            AND configured_policy.crawl_interval ~ '^\\d+h$'
            AND verified_record.last_seen_at >= CURRENT_TIMESTAMP
              - ((regexp_replace(configured_policy.crawl_interval, 'h$', ''))::integer
                * interval '1 hour')
        ) THEN 'JOB_NOT_RECENTLY_VERIFIED' END
      `,
      versionConfig: sql`
        CASE WHEN NOT EXISTS (
          SELECT 1
          FROM source_control.sources AS configured_source
          JOIN source_control.source_policy_versions AS configured_policy
            ON configured_policy.source_id = configured_source.id
            AND configured_policy.version = configured_source.current_policy_version
          WHERE configured_source.id = base.source_id
            AND configured_policy.config_registered
        ) THEN 'SOURCE_CONFIG_NOT_REGISTERED' END
      `,
      versionJobFreshness: sql`
        CASE WHEN NOT EXISTS (
          SELECT 1
          FROM ingestion.source_job_revisions AS verified_revision
          JOIN ingestion.source_job_records AS verified_record
            ON verified_record.id = verified_revision.source_job_record_id
          JOIN source_control.sources AS configured_source
            ON configured_source.id = verified_record.source_id
          JOIN source_control.source_policy_versions AS configured_policy
            ON configured_policy.source_id = configured_source.id
            AND configured_policy.version = configured_source.current_policy_version
          WHERE verified_revision.id = base.revision_id
            AND configured_policy.crawl_interval ~ '^\\d+h$'
            AND verified_record.last_seen_at >= CURRENT_TIMESTAMP
              - ((regexp_replace(configured_policy.crawl_interval, 'h$', ''))::integer
                * interval '1 hour')
        ) THEN 'JOB_NOT_RECENTLY_VERIFIED' END
      `,
    });
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      DROP VIEW catalog.job_version_eligibility;
      DROP VIEW catalog.current_job_eligibility;

      ALTER TABLE source_control.source_policy_versions
        DROP COLUMN config_registered;
    `.execute(db);

    await createEligibilityViews(db, {
      currentConfig: noBlocker,
      currentJobFreshness: noBlocker,
      versionConfig: noBlocker,
      versionJobFreshness: noBlocker,
    });
  },
};
