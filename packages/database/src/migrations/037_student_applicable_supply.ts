import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

/**
 * ADR-0035 第一条：供给单位从「实习岗位」改为「在校生可投岗位」。
 *
 * 此前过滤发生在适配器里——`beisen-zhiye-adapter` 等对标题做「实习」字样检查，不含即整条
 * 丢弃。慧策租户请求的是 `category="2"`（校园招聘），抓回来后又被标题过滤全部拒绝，也就是
 * **校招岗位被取回后被扔掉了**。而目标用户是在校生，临近毕业时校招才是主场。
 *
 * 判定改为逐岗位的可达性检出，并从适配器上移到资格层：适配器只负责忠实解析，不负责裁剪
 * 供给范围。
 *
 * 判定实现为数据库函数而不是在视图里内联，原因是同一套短语已经存在于
 * `packages/contracts/src/job-reachability.ts`。两份实现必然走偏，因此这里做成单一函数，
 * 并由集成测试用真实语料对账 TypeScript 与 SQL 的判定一致（A1 已验证该方法可行）。
 *
 * 判定只做**显式短语检出**，绝不推断：正文没有出现限校词不得推断为「不限校」，完全没有
 * 学历信号归入 `unknown`。
 *
 * `unknown` **计入**可投（ADR-0035）。这与 ADR-0032 原先「`unknown` 不计入配额」相反，
 * 理由是那条规则用于聚合比例门槛（已撤销），而这里是逐条准入：正文未写学历要求更可能是
 * 不限而非限制，把未说明当排除等于用 `unknown` 做否定推断。A1 实测 345 条中 `unknown`
 * 占 96 条（27.8%），排除它会凭空丢掉近三成真实供给。
 *
 * 该条件是 **Alpha 专属**，不进 `blocking_reasons`：本机 `local_mvp` 仍显示全部岗位并暴露
 * 判定结果，这样才能测量「排除掉了多少」。与 `closure_detectable`、来源新鲜度、投递入口
 * 缺失的处置一致——入库能看见，对外才筛。
 */
const REACHABILITY_FUNCTION = sql`
  CREATE FUNCTION catalog.job_reachability_verdict(
    requirements text,
    responsibilities text
  )
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  AS $$
  DECLARE
    corpus text;
    undergraduate boolean;
    postgraduate boolean;
  BEGIN
    corpus := COALESCE(requirements, '') || ' ' || COALESCE(responsibilities, '');

    -- 明确限定学校层次，优先级最高。
    IF corpus ~ '(985|211|双一流|重点院校|名校|QS)' THEN
      RETURN 'not_reachable_school_restricted';
    END IF;

    -- 明示多年工作经验（ADR-0035 新增）。刻意只匹配「年」而不匹配「月」，
    -- 因为「3 个月实习经验」是在校生能满足的；也要求出现「经验」二字，
    -- 避免把「培养 2 年」这类培养周期误判为经验门槛。
    IF corpus ~ '[0-9]+\\s*年[^。；;]{0,6}经验' AND corpus !~ '实习经验' THEN
      RETURN 'not_reachable_experience_required';
    END IF;

    undergraduate := corpus ~ '(本科|学士|大专|专科)';
    postgraduate := corpus ~ '(硕士|研究生|博士)';

    IF postgraduate AND NOT undergraduate THEN
      RETURN 'not_reachable_postgrad_only';
    END IF;
    IF undergraduate OR corpus ~ '(学历不限|不限学历|专业不限|不限专业)' THEN
      RETURN 'reachable';
    END IF;
    RETURN 'unknown';
  END;
  $$;
`;

/**
 * 「对外才筛」的条件必须**具名**，不能内联进 `eligible_for_alpha` 的布尔表达式。
 *
 * 第一版把新鲜度、投递入口与可投性直接 AND 进 `eligible_for_alpha`，结果是
 * `publication-reconciliation` 撤回公开指针时 `blocking_reasons` 为空、原因码退化为笼统的
 * `NOT_ELIGIBLE_FOR_ALPHA`——ADR-0034 明确要求逐项区分撤回原因，那一版把它抹掉了。
 *
 * 因此这些条件与本机阻塞项同构：各自产出原因码，汇成 `alpha_blocking_reasons`，
 * `eligible_for_alpha` 再要求该数组为空。本机 `local_mvp` 只看 `blocking_reasons`，
 * 对外可见看两者之和，且两边都能说出「为什么」。
 */
export const ALPHA_ONLY_REASON_CODES = [
  "SOURCE_NOT_FRESH",
  "JOB_NOT_RECENTLY_VERIFIED",
  "EXACT_APPLICATION_NOT_AVAILABLE",
  "JOB_NOT_STUDENT_APPLICABLE",
] as const;

/**
 * 「岗位在 `crawl_interval` 内被核验过」。版本级视图按修订回溯到记录，当前级视图直接持有
 * 记录 id，因此两份 SQL 的 WHERE 不同，其余逐字一致。
 */
const versionRecentlyVerifiedBlocker = sql`
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
  ) THEN 'JOB_NOT_RECENTLY_VERIFIED' END`;

const currentRecentlyVerifiedBlocker = sql`
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
  ) THEN 'JOB_NOT_RECENTLY_VERIFIED' END`;

/** 回滚形态下 `alpha_blocking_reasons` 恒为空数组：列保留，语义归零。 */
const noAlphaBlockers = sql`NULL`;

/**
 * 重建 `catalog.job_version_eligibility`。
 *
 * 相对迁移 035 的改动，其余逐字保持：
 * 1. 新增 `reachability_verdict`、`student_applicable` 与 `alpha_blocking_reasons` 三列；
 * 2. `RESPONSIBILITIES_MISSING` 与 `REQUIREMENTS_MISSING` 合并为
 *    `JOB_BODY_MISSING`——按 ADR-0035 第八条放宽为「至少存在其一」；
 * 3. `SOURCE_NOT_FRESH`、`JOB_NOT_RECENTLY_VERIFIED` 与
 *    `EXACT_APPLICATION_NOT_AVAILABLE` 从 `blocking_reasons` 移入
 *    `alpha_blocking_reasons`（ADR-0035 第七、九条）；
 * 4. 新增的可投性判据 `JOB_NOT_STUDENT_APPLICABLE` 同样只进 `alpha_blocking_reasons`。
 */
async function createJobVersionEligibilityView(
  db: Kysely<Database>,
  options: { studentApplicableRequired: boolean },
): Promise<void> {
  // 回滚形态**不得**引用该函数：回滚会把函数删掉，视图若仍 SELECT 它就建不起来。
  const reachabilityVerdictExpression = options.studentApplicableRequired
    ? sql`catalog.job_reachability_verdict(version.requirements, version.responsibilities)`
    : sql`'unknown'::text`;
  const bodyBlockers = options.studentApplicableRequired
    ? sql`CASE WHEN btrim(responsibilities) = '' AND btrim(requirements) = '' THEN 'JOB_BODY_MISSING' END`
    : sql`
        CASE WHEN btrim(responsibilities) = '' THEN 'RESPONSIBILITIES_MISSING' END,
        CASE WHEN btrim(requirements) = '' THEN 'REQUIREMENTS_MISSING' END,
        CASE WHEN apply_url IS NULL THEN 'EXACT_APPLICATION_NOT_AVAILABLE' END`;
  const legacyFreshnessBlockers = options.studentApplicableRequired
    ? sql``
    : sql`
        CASE WHEN freshness_state <> 'fresh' THEN 'SOURCE_NOT_FRESH' END,
        ${versionRecentlyVerifiedBlocker},`;
  const alphaBlockers = options.studentApplicableRequired
    ? sql`
        CASE WHEN freshness_state <> 'fresh' THEN 'SOURCE_NOT_FRESH' END,
        ${versionRecentlyVerifiedBlocker},
        CASE WHEN apply_url IS NULL THEN 'EXACT_APPLICATION_NOT_AVAILABLE' END,
        CASE
          WHEN reachability_verdict NOT IN ('reachable', 'unknown')
            THEN 'JOB_NOT_STUDENT_APPLICABLE'
        END`
    : noAlphaBlockers;

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
        ) AS has_blocking_review,
        COALESCE(job.publication_suppressed_at IS NOT NULL, false) AS publication_suppressed,
        ${reachabilityVerdictExpression} AS reachability_verdict
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
      reachability_verdict IN ('reachable', 'unknown') AS student_applicable,
      (
        absence_policy = 'close_after_two_complete_absences'
        OR COALESCE(deadline_at->>'state', 'unknown') = 'known'
      ) AS closure_detectable,
      to_jsonb(blockers.values) AS blocking_reasons,
      to_jsonb(alpha_blockers.values) AS alpha_blocking_reasons,
      cardinality(blockers.values) = 0 AS eligible_for_local_mvp,
      cardinality(blockers.values) = 0
        AND cardinality(alpha_blockers.values) = 0
        AND policy_status = 'approved'
        AND runtime_scope IN ('alpha', 'production')
        AND (
          absence_policy = 'close_after_two_complete_absences'
          OR COALESCE(deadline_at->>'state', 'unknown') = 'known'
        )
        AND NOT publication_suppressed AS eligible_for_alpha
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
            ${legacyFreshnessBlockers}
            ${bodyBlockers},
            CASE WHEN has_blocking_review THEN 'BLOCKING_REVIEW_OPEN' END
          ]::text[],
          NULL
        ) AS values
    ) AS blockers
    CROSS JOIN LATERAL (
      SELECT array_remove(ARRAY[${alphaBlockers}]::text[], NULL) AS values
    ) AS alpha_blockers;
  `.execute(db);
}

/**
 * 重建 `catalog.current_job_eligibility`——本机 `local_mvp` 预览与 `/v1/jobs` 读的正是这一份。
 *
 * 迁移 037 第一版只改了版本级视图，于是 ADR-0035 第九条（新鲜度只约束对外可见）在本机预览上
 * 根本没生效：`SOURCE_NOT_FRESH` 与 `JOB_NOT_RECENTLY_VERIFIED` 仍在这里阻塞，而这两项恰好是
 * 实测阻塞量最大的两项（223 与 110 条）。同一条政策在两个视图给出不同阻塞项本身也是错的。
 *
 * 因此两个视图在此对齐：同样的 `JOB_BODY_MISSING` 合并、同样的 `alpha_blocking_reasons`、
 * 同样的可投性判据。
 */
async function createCurrentJobEligibilityView(
  db: Kysely<Database>,
  options: { studentApplicableRequired: boolean },
): Promise<void> {
  const reachabilityVerdictExpression = options.studentApplicableRequired
    ? sql`catalog.job_reachability_verdict(preview.requirements, preview.responsibilities)`
    : sql`'unknown'::text`;
  const bodyBlockers = options.studentApplicableRequired
    ? sql`CASE WHEN btrim(responsibilities) = '' AND btrim(requirements) = '' THEN 'JOB_BODY_MISSING' END`
    : sql`
        CASE WHEN btrim(responsibilities) = '' THEN 'RESPONSIBILITIES_MISSING' END,
        CASE WHEN btrim(requirements) = '' THEN 'REQUIREMENTS_MISSING' END,
        CASE WHEN apply_url IS NULL THEN 'EXACT_APPLICATION_NOT_AVAILABLE' END`;
  const legacyFreshnessBlockers = options.studentApplicableRequired
    ? sql``
    : sql`
        CASE WHEN freshness_state <> 'fresh' THEN 'SOURCE_NOT_FRESH' END,
        ${currentRecentlyVerifiedBlocker},`;
  const alphaBlockers = options.studentApplicableRequired
    ? sql`
        CASE WHEN freshness_state <> 'fresh' THEN 'SOURCE_NOT_FRESH' END,
        ${currentRecentlyVerifiedBlocker},
        CASE WHEN apply_url IS NULL THEN 'EXACT_APPLICATION_NOT_AVAILABLE' END,
        CASE
          WHEN reachability_verdict NOT IN ('reachable', 'unknown')
            THEN 'JOB_NOT_STUDENT_APPLICABLE'
        END`
    : noAlphaBlockers;

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
        ${reachabilityVerdictExpression} AS reachability_verdict,
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
      reachability_verdict IN ('reachable', 'unknown') AS student_applicable,
      (
        absence_policy = 'close_after_two_complete_absences'
        OR COALESCE(deadline_at->>'state', 'unknown') = 'known'
      ) AS closure_detectable,
      to_jsonb(blockers.values) AS blocking_reasons,
      to_jsonb(alpha_blockers.values) AS alpha_blocking_reasons,
      cardinality(blockers.values) = 0 AS eligible_for_local_mvp,
      cardinality(blockers.values) = 0
        AND cardinality(alpha_blockers.values) = 0
        AND policy_status = 'approved'
        AND runtime_scope IN ('alpha', 'production')
        AND (
          absence_policy = 'close_after_two_complete_absences'
          OR COALESCE(deadline_at->>'state', 'unknown') = 'known'
        ) AS eligible_for_alpha
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
            ${legacyFreshnessBlockers}
            ${bodyBlockers},
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
    ) AS blockers
    CROSS JOIN LATERAL (
      SELECT array_remove(ARRAY[${alphaBlockers}]::text[], NULL) AS values
    ) AS alpha_blockers;
  `.execute(db);
}

export const studentApplicableSupplyMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      DROP VIEW catalog.job_version_eligibility;
      DROP VIEW catalog.current_job_eligibility;
    `.execute(db);
    await REACHABILITY_FUNCTION.execute(db);
    await createCurrentJobEligibilityView(db, { studentApplicableRequired: true });
    await createJobVersionEligibilityView(db, { studentApplicableRequired: true });
  },

  async down(db: Kysely<Database>): Promise<void> {
    // 顺序要紧：回滚视图仍然 SELECT 该函数（`reachability_verdict` 列在两个形态里都存在），
    // 因此必须先建不引用它的视图，再删函数。此前顺序相反，导致
    // `cannot drop function ... because other objects depend on it`。
    await sql`
      DROP VIEW catalog.job_version_eligibility;
      DROP VIEW catalog.current_job_eligibility;
    `.execute(db);
    await sql`DROP FUNCTION catalog.job_reachability_verdict(text, text);`.execute(db);
    await createCurrentJobEligibilityView(db, { studentApplicableRequired: false });
    await createJobVersionEligibilityView(db, { studentApplicableRequired: false });
  },
};
