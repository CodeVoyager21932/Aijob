import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

export const officialSourceCatalogEligibilityMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE source_control.source_policy_versions
        ADD COLUMN catalog_role text NOT NULL DEFAULT 'disabled'
          CHECK (catalog_role IN ('canonical', 'discovery_only', 'disabled')),
        ADD COLUMN runtime_scope text NOT NULL DEFAULT 'local'
          CHECK (runtime_scope IN ('test', 'local', 'alpha', 'production'));

      UPDATE source_control.source_policy_versions
      SET catalog_role = CASE
        WHEN provenance_level IN ('organization_owned', 'verified_ats_tenant') THEN 'canonical'
        WHEN provenance_level IN ('university_published', 'official_account_link') THEN 'discovery_only'
        ELSE 'disabled'
      END;

      UPDATE source_control.source_policy_versions AS policy
      SET runtime_scope = 'test'
      FROM source_control.sources AS source
      WHERE source.id = policy.source_id
        AND (source.source_key LIKE '%-test' OR source.source_key LIKE 'test-%');

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
              CASE WHEN btrim(responsibilities) = '' THEN 'RESPONSIBILITIES_MISSING' END,
              CASE WHEN btrim(requirements) = '' THEN 'REQUIREMENTS_MISSING' END,
              CASE WHEN apply_url IS NULL THEN 'EXACT_APPLICATION_NOT_AVAILABLE' END,
              CASE WHEN has_blocking_review THEN 'BLOCKING_REVIEW_OPEN' END
            ]::text[],
            NULL
          ) AS values
      ) AS blockers;
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      DROP VIEW catalog.job_version_eligibility;
      DROP VIEW catalog.current_job_eligibility;

      ALTER TABLE source_control.source_policy_versions
        DROP COLUMN runtime_scope,
        DROP COLUMN catalog_role;
    `.execute(db);
  },
};
