import type { Kysely, Migration, RawBuilder } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

/**
 * ADR-0034 第一、二条：把「够格发布」与「已发布」彻底分开。
 *
 * 迁移 019/020/034 的 `eligible_for_alpha` 都含 `publication_state = 'published'`，而
 * `publication_state` 由适配器产出、`NormalizedOfficialJob.publicationState` 是字面量
 * 类型 `"review"`，全仓没有任何生产代码写入 `published`。于是：
 *
 *   要「已发布」才算「够格发布」，而发布只在「已发布」时发生。
 *
 * 这是结构性死锁而不是严格门槛——放宽 `accessPolicyAccepted` 或任何上游门都不会让公开
 * 供给变成正数。本迁移去掉该条件，`eligible_for_alpha` 的语义改为**发布的前置条件**：
 * 阻塞项为空、来源 `approved`、`runtime_scope` 为 alpha/production、可探知关闭、且未被
 * 强制下架。「已发布」此后仅由 `catalog.published_jobs.public_version_id` 表达。
 *
 * `PUBLICATION_NOT_REVIEWABLE` 阻塞项保持不变（仍允许 `review` 与 `published`），因此
 * `draft`/`suppressed`/`archived` 修订依旧被挡在目录外。适配器仍只能产出 `"review"`：
 * 采集器不得自我决定发布，这条边界是对的。
 *
 * 发布不得改写修订。`revision_content_hash` 的输入包含 `publicationState`，改写
 * `revision.publication_state` 会使内容哈希与实际内容不一致，违反 ADR-0029 第 11 条。
 *
 * 另外两项：
 *
 * - `catalog.published_jobs` 增加强制下架列，履行 ADR-0033 的「异议即停」义务。下架直接
 *   进入 `eligible_for_alpha`，因此对全部公开读取路径**立即生效**，不必等下一轮对账；
 *   且被下架对象不会被对账自动恢复，必须显式解除。刻意不进 `blocking_reasons`，因为
 *   `eligible_for_local_mvp` 是本机内部预览而非对外可见面，与迁移 034 对
 *   `closure_detectable` 的处理一致。
 * - 新增 `catalog.publication_events`，记录对账与人工操作引起的每一次发布状态变化。
 *   刻意不复用 `decision_feedback_audit.audit_events`：那张表按个人数据保留期被
 *   `retention-service` 定期清理，而发布事件不是个人数据，不能随保留期消失。
 */
async function createJobVersionEligibilityView(
  db: Kysely<Database>,
  publication: { requirePublishedRevision: RawBuilder<unknown> | null },
): Promise<void> {
  const publishedRevisionCondition = publication.requirePublishedRevision
    ? sql`AND ${publication.requirePublishedRevision}`
    : sql``;
  const suppressionColumns = publication.requirePublishedRevision
    ? sql``
    : sql`, COALESCE(job.publication_suppressed_at IS NOT NULL, false) AS publication_suppressed`;
  const suppressionCondition = publication.requirePublishedRevision
    ? sql``
    : sql`AND NOT publication_suppressed`;

  await sql`
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
        ${suppressionColumns}
      FROM catalog.published_job_versions AS version
      JOIN catalog.published_jobs AS job
        ON job.id = version.published_job_id
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
      (
        absence_policy = 'close_after_two_complete_absences'
        OR COALESCE(deadline_at->>'state', 'unknown') = 'known'
      ) AS closure_detectable,
      to_jsonb(blockers.values) AS blocking_reasons,
      cardinality(blockers.values) = 0 AS eligible_for_local_mvp,
      cardinality(blockers.values) = 0
        AND policy_status = 'approved'
        ${publishedRevisionCondition}
        AND runtime_scope IN ('alpha', 'production')
        AND (
          absence_policy = 'close_after_two_complete_absences'
          OR COALESCE(deadline_at->>'state', 'unknown') = 'known'
        )
        ${suppressionCondition} AS eligible_for_alpha
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

export const reconciledPublicationMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE catalog.published_jobs
        ADD COLUMN publication_suppressed_at timestamptz,
        ADD COLUMN publication_suppressed_reason text,
        ADD CONSTRAINT published_jobs_suppression_complete CHECK (
          (publication_suppressed_at IS NULL AND publication_suppressed_reason IS NULL)
          OR (publication_suppressed_at IS NOT NULL AND publication_suppressed_reason IS NOT NULL)
        );

      CREATE TABLE catalog.publication_events (
        id uuid PRIMARY KEY,
        published_job_id uuid NOT NULL
          REFERENCES catalog.published_jobs (id) ON DELETE CASCADE,
        published_job_version_id uuid
          REFERENCES catalog.published_job_versions (id) ON DELETE SET NULL,
        previous_public_version_id uuid
          REFERENCES catalog.published_job_versions (id) ON DELETE SET NULL,
        action text NOT NULL CHECK (
          action IN ('published', 'advanced', 'revoked', 'suppressed', 'unsuppressed')
        ),
        actor text NOT NULL CHECK (actor IN ('reconciliation', 'operator')),
        reason_code text NOT NULL,
        blocking_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        CHECK (
          (action IN ('published', 'advanced') AND published_job_version_id IS NOT NULL)
          OR action NOT IN ('published', 'advanced')
        )
      );

      CREATE INDEX publication_events_job_occurred_idx
        ON catalog.publication_events (published_job_id, occurred_at DESC);

      GRANT SELECT ON TABLE catalog.publication_events
        TO aijob_web_api, aijob_match_worker;
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE catalog.publication_events
        TO aijob_collector_worker;
      GRANT ALL PRIVILEGES ON TABLE catalog.publication_events
        TO aijob_ops_cli, aijob_migrator;
    `.execute(db);

    await sql`DROP VIEW catalog.job_version_eligibility;`.execute(db);
    await createJobVersionEligibilityView(db, { requirePublishedRevision: null });
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`DROP VIEW catalog.job_version_eligibility;`.execute(db);
    await createJobVersionEligibilityView(db, {
      requirePublishedRevision: sql`publication_state = 'published'`,
    });

    await sql`
      DROP TABLE catalog.publication_events;

      ALTER TABLE catalog.published_jobs
        DROP CONSTRAINT published_jobs_suppression_complete,
        DROP COLUMN publication_suppressed_reason,
        DROP COLUMN publication_suppressed_at;
    `.execute(db);
  },
};
