import type { Kysely, Migration, RawBuilder } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

/**
 * ADR-0032 第二条：`canonical` 来源必须能探知岗位关闭，否则「已截止但仍显示」没有上限。
 *
 * 三层可探知性：
 * - 岗位带明示截止日期 → 过期即失效，陈旧上限 0。
 * - 列表型来源且从列表消失即视为关闭（`absence_policy =
 *   'close_after_two_complete_absences'`，现有校验已要求其 `refresh_coverage = 'full_scope'`）
 *   → 陈旧上限为一个刷新周期。
 * - 冻结单条公告：既不在任何列表里，也没有截止日期 → **永远探知不到**，陈旧无上限。
 *
 * 目标是「任何**用户可见**岗位的已截止仍显示时长不超过 7 天」，因此本迁移把可探知性
 * 加在 `eligible_for_alpha` 上，并新增 `closure_detectable` 列供审计计数。
 *
 * 刻意**不**改 `blocking_reasons` 与 `eligible_for_local_mvp`：`local_mvp` 按约束是
 * 本机内部预览而非真实用户面，把它一起阻塞既无用户保护收益，又会让新来源在配好
 * absence policy 之前无法本机预览。Alpha 比 local 多一层要求，与 ADR-0029 既有模式一致。
 *
 * 只观察到缺失而不据此关闭（`refresh_coverage = 'full_scope'` 但
 * `absence_policy = 'none'`）同样不算可探知，因为陈旧时长仍无上限；此类来源可改用
 * `close_after_two_complete_absences` 合规通过。
 */
async function createEligibilityViews(
  db: Kysely<Database>,
  closure: { current: RawBuilder<unknown>; version: RawBuilder<unknown> },
): Promise<void> {
  await sql`
    CREATE VIEW catalog.current_job_eligibility AS
    WITH base AS (
      SELECT
        preview.*,
        policy.catalog_role,
        policy.runtime_scope,
        policy.absence_policy,
        policy.refresh_coverage,
        revision.deadline_at,
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
      ${closure.current} AS closure_detectable,
      to_jsonb(blockers.values) AS blocking_reasons,
      cardinality(blockers.values) = 0 AS eligible_for_local_mvp,
      cardinality(blockers.values) = 0
        AND policy_status = 'approved'
        AND runtime_scope IN ('alpha', 'production')
        AND ${closure.current} AS eligible_for_alpha
    FROM base
    CROSS JOIN LATERAL (
      SELECT
        array_remove(
          ARRAY[
            CASE WHEN catalog_role <> 'canonical' THEN 'NON_CANONICAL_SOURCE' END,
            CASE WHEN runtime_scope = 'test' THEN 'TEST_RUNTIME_SCOPE' END,
            CASE WHEN NOT EXISTS (
              SELECT 1
              FROM source_control.sources AS configured_source
              JOIN source_control.source_policy_versions AS configured_policy
                ON configured_policy.source_id = configured_source.id
                AND configured_policy.version = configured_source.current_policy_version
              WHERE configured_source.id = base.source_id
                AND configured_policy.config_registered
            ) THEN 'SOURCE_CONFIG_NOT_REGISTERED' END,
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
            ) THEN 'JOB_NOT_RECENTLY_VERIFIED' END,
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
        policy.absence_policy,
        policy.refresh_coverage,
        version.deadline_at,
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
      ${closure.version} AS closure_detectable,
      to_jsonb(blockers.values) AS blocking_reasons,
      cardinality(blockers.values) = 0 AS eligible_for_local_mvp,
      cardinality(blockers.values) = 0
        AND policy_status = 'approved'
        AND publication_state = 'published'
        AND runtime_scope IN ('alpha', 'production')
        AND ${closure.version} AS eligible_for_alpha
    FROM base
    CROSS JOIN LATERAL (
      SELECT
        array_remove(
          ARRAY[
            CASE WHEN catalog_role <> 'canonical' THEN 'NON_CANONICAL_SOURCE' END,
            CASE WHEN runtime_scope = 'test' THEN 'TEST_RUNTIME_SCOPE' END,
            CASE WHEN NOT EXISTS (
              SELECT 1
              FROM source_control.sources AS configured_source
              JOIN source_control.source_policy_versions AS configured_policy
                ON configured_policy.source_id = configured_source.id
                AND configured_policy.version = configured_source.current_policy_version
              WHERE configured_source.id = base.source_id
                AND configured_policy.config_registered
            ) THEN 'SOURCE_CONFIG_NOT_REGISTERED' END,
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
            ) THEN 'JOB_NOT_RECENTLY_VERIFIED' END,
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

/**
 * 可探知关闭 = 列表型且消失即关闭，或岗位带已知截止日期。
 */
const closureDetectable = sql`(
  absence_policy = 'close_after_two_complete_absences'
  OR COALESCE(deadline_at->>'state', 'unknown') = 'known'
)`;

/** 回滚为 034 之前的语义：不约束可探知性。 */
const alwaysDetectable = sql`true`;

export const closureDetectableCanonicalJobsMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      DROP VIEW catalog.job_version_eligibility;
      DROP VIEW catalog.current_job_eligibility;
    `.execute(db);

    await createEligibilityViews(db, {
      current: closureDetectable,
      version: closureDetectable,
    });
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      DROP VIEW catalog.job_version_eligibility;
      DROP VIEW catalog.current_job_eligibility;
    `.execute(db);

    await createEligibilityViews(db, {
      current: alwaysDetectable,
      version: alwaysDetectable,
    });
  },
};
