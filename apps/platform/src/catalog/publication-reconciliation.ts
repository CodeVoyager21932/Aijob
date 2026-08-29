import { randomUUID } from "node:crypto";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { lockLocalCatalogMaterialization } from "./materialize.js";

/**
 * ADR-0034 第二条：发布由**双向资格对账**驱动，不是逐条人工动作，也不是物化的副作用。
 *
 * 人工判断已经在**来源层**发生：某岗位要 `eligible_for_alpha`，前提是已有人把
 * `policy.status` 改为 `approved`、把 `runtime_scope` 提为 `alpha`，并使六个硬门全过。
 * 在此之后再逐条人工确认岗位不产生任何新信息——1000 条规模下只会退化为橡皮章。
 *
 * 对账是**双向**的，这一点不可拆开实现：
 *
 * | 条件 | 动作 |
 * |---|---|
 * | 某版本 `eligible_for_alpha` 且该岗位无公开指针 | 设 `public_version_id` |
 * | 当前公开版本不再 `eligible_for_alpha` | 清空 `public_version_id` |
 * | 出现更新的合格版本 | 指针前移至最新合格版本 |
 *
 * 只做单向发布会产生对外漂移：来源被 robots 复核自动 `paused`、岗位过期、来源新鲜度过期、
 * 职责或要求被清空、复核项被打开，都会使资格失效而指针滞留。因此撤回与发布在同一次对账里
 * 完成。（`catalog/repository.ts` 的公开查询同时要求指针匹配与实时 `eligible_for_alpha`，
 * 因此用户可见面还有第二道防线；但指针本身仍必须收敛，否则统计与后续恢复都会失真。）
 *
 * 指针前移是安全的：Case 固定自己的岗位版本并要求显式升级（OS-4），公开指针移动不会改变
 * 用户 Case 所依据的内容。
 *
 * 对账**只写** `public_version_id`，不改写任何修订，因此 `revision_content_hash` 与
 * ADR-0029 第 11 条的不可变性保持成立。
 */

export interface PublicationReconciliationResult {
  /** 此前无公开指针，本次首次发布。 */
  published: number;
  /** 指针前移到更新的合格版本。 */
  advanced: number;
  /** 公开版本失去资格，指针被清空。 */
  revoked: number;
}

interface PendingChange {
  publishedJobId: string;
  previousPublicVersionId: string | null;
  targetVersionId: string | null;
  suppressed: boolean;
}

/**
 * 撤回原因。按 ADR-0034 验证节需要逐项区分，因此不折叠成单一「不合格」。
 */
function revocationReason(row: {
  exists: boolean;
  suppressed: boolean;
  blockingReasons: JsonValue;
  closureDetectable: boolean | null;
  policyStatus: string | null;
  runtimeScope: string | null;
}): { reasonCode: string; blockingReasons: JsonValue } {
  const blockingReasons = Array.isArray(row.blockingReasons) ? row.blockingReasons : [];
  if (!row.exists) return { reasonCode: "PUBLIC_VERSION_MISSING", blockingReasons: [] };
  if (row.suppressed) return { reasonCode: "PUBLICATION_SUPPRESSED", blockingReasons };
  if (blockingReasons.length > 0) return { reasonCode: "BLOCKED", blockingReasons };
  if (row.closureDetectable === false) {
    return { reasonCode: "CLOSURE_NOT_DETECTABLE", blockingReasons };
  }
  if (row.policyStatus !== "approved") {
    return { reasonCode: "SOURCE_NOT_APPROVED", blockingReasons };
  }
  if (row.runtimeScope !== "alpha" && row.runtimeScope !== "production") {
    return { reasonCode: "RUNTIME_SCOPE_NOT_PUBLIC", blockingReasons };
  }
  return { reasonCode: "NOT_ELIGIBLE_FOR_ALPHA", blockingReasons };
}

async function recordEvent(
  transaction: Transaction<Database>,
  input: {
    publishedJobId: string;
    publishedJobVersionId: string | null;
    previousPublicVersionId: string | null;
    action: "published" | "advanced" | "revoked" | "suppressed" | "unsuppressed";
    actor: "reconciliation" | "operator";
    reasonCode: string;
    blockingReasons?: JsonValue;
    occurredAt: Date;
  },
): Promise<void> {
  await transaction
    .insertInto("catalog.publication_events")
    .values({
      id: randomUUID(),
      published_job_id: input.publishedJobId,
      published_job_version_id: input.publishedJobVersionId,
      previous_public_version_id: input.previousPublicVersionId,
      action: input.action,
      actor: input.actor,
      reason_code: input.reasonCode,
      blocking_reasons: JSON.stringify(input.blockingReasons ?? []),
      occurred_at: input.occurredAt,
    })
    .execute();
}

/**
 * 找出公开指针与「最新合格版本」不一致的岗位。
 *
 * 单条查询而不是逐岗位往返：`published_jobs` 会长到万级，N+1 在对账周期里不可接受。
 */
async function findPendingChanges(
  transaction: Transaction<Database>,
  publishedJobIds: string[] | null,
): Promise<PendingChange[]> {
  const scope =
    publishedJobIds === null ? sql`` : sql`AND job.id = ANY(${sql.val(publishedJobIds)}::uuid[])`;
  const { rows } = await sql<{
    published_job_id: string;
    previous_public_version_id: string | null;
    target_version_id: string | null;
    suppressed: boolean;
  }>`
    SELECT
      job.id AS published_job_id,
      job.public_version_id AS previous_public_version_id,
      target.published_job_version_id AS target_version_id,
      job.publication_suppressed_at IS NOT NULL AS suppressed
    FROM catalog.published_jobs AS job
    LEFT JOIN LATERAL (
      SELECT eligibility.published_job_version_id
      FROM catalog.job_version_eligibility AS eligibility
      JOIN catalog.published_job_versions AS version
        ON version.id = eligibility.published_job_version_id
      WHERE version.published_job_id = job.id
        AND eligibility.eligible_for_alpha
      ORDER BY version.effective_at DESC, version.created_at DESC, version.id DESC
      LIMIT 1
    ) AS target ON true
    WHERE job.public_version_id IS DISTINCT FROM target.published_job_version_id
      ${scope}
    ORDER BY job.id
  `.execute(transaction);
  return rows.map((row) => ({
    publishedJobId: row.published_job_id,
    previousPublicVersionId: row.previous_public_version_id,
    targetVersionId: row.target_version_id,
    suppressed: row.suppressed,
  }));
}

async function readRevocationContext(
  transaction: Transaction<Database>,
  publishedJobVersionId: string,
): Promise<{
  exists: boolean;
  blockingReasons: JsonValue;
  closureDetectable: boolean | null;
  policyStatus: string | null;
  runtimeScope: string | null;
}> {
  const row = await transaction
    .selectFrom("catalog.job_version_eligibility")
    .select(["blocking_reasons", "closure_detectable", "policy_status", "runtime_scope"])
    .where("published_job_version_id", "=", publishedJobVersionId)
    .executeTakeFirst();
  if (!row) {
    return {
      exists: false,
      blockingReasons: [],
      closureDetectable: null,
      policyStatus: null,
      runtimeScope: null,
    };
  }
  return {
    exists: true,
    blockingReasons: row.blocking_reasons,
    closureDetectable: row.closure_detectable,
    policyStatus: row.policy_status,
    runtimeScope: row.runtime_scope,
  };
}

/**
 * 跑一轮双向对账。与物化共用同一把顾问锁：两者都改 `catalog.published_jobs`。
 */
export async function reconcilePublication(input: {
  db: Kysely<Database>;
  now?: Date;
  /**
   * 只对账这些岗位。省略即全量，这也是周期运行应有的行为。
   * 给定范围用于「刚物化完某个来源就立即收敛它」，以及让测试不去动别的套件的指针。
   */
  publishedJobIds?: string[];
}): Promise<PublicationReconciliationResult> {
  const occurredAt = input.now ?? new Date();
  const scope = input.publishedJobIds ?? null;
  if (scope !== null && scope.length === 0) {
    return { published: 0, advanced: 0, revoked: 0 };
  }
  return input.db.transaction().execute(async (transaction) => {
    await lockLocalCatalogMaterialization(transaction);
    const pending = await findPendingChanges(transaction, scope);
    const result: PublicationReconciliationResult = { published: 0, advanced: 0, revoked: 0 };

    for (const change of pending) {
      await transaction
        .updateTable("catalog.published_jobs")
        .set({ public_version_id: change.targetVersionId })
        .where("id", "=", change.publishedJobId)
        .execute();

      if (change.targetVersionId === null) {
        const context = await readRevocationContext(
          transaction,
          change.previousPublicVersionId as string,
        );
        const { reasonCode, blockingReasons } = revocationReason({
          ...context,
          suppressed: change.suppressed,
        });
        await recordEvent(transaction, {
          publishedJobId: change.publishedJobId,
          publishedJobVersionId: null,
          previousPublicVersionId: change.previousPublicVersionId,
          action: "revoked",
          actor: "reconciliation",
          reasonCode,
          blockingReasons,
          occurredAt,
        });
        result.revoked += 1;
        continue;
      }

      const advanced = change.previousPublicVersionId !== null;
      await recordEvent(transaction, {
        publishedJobId: change.publishedJobId,
        publishedJobVersionId: change.targetVersionId,
        previousPublicVersionId: change.previousPublicVersionId,
        action: advanced ? "advanced" : "published",
        actor: "reconciliation",
        reasonCode: advanced ? "NEWER_ELIGIBLE_VERSION" : "ELIGIBLE_FOR_ALPHA",
        occurredAt,
      });
      if (advanced) result.advanced += 1;
      else result.published += 1;
    }

    return result;
  });
}

/**
 * ADR-0034 第二条第 7 项：人工强制下架，履行 ADR-0033 的「异议即停」义务。
 *
 * 立即清空公开指针而不等下一轮对账。因为 `publication_suppressed` 已进入
 * `eligible_for_alpha`，被下架岗位不会被对账自动恢复，必须显式解除。
 */
export async function suppressJobPublication(input: {
  db: Kysely<Database>;
  publishedJobId: string;
  reason: string;
  now?: Date;
}): Promise<{ suppressed: boolean; revokedPointer: boolean }> {
  const reason = input.reason.trim();
  if (reason === "") throw new Error("PUBLICATION_SUPPRESSION_REASON_REQUIRED");
  const occurredAt = input.now ?? new Date();
  return input.db.transaction().execute(async (transaction) => {
    await lockLocalCatalogMaterialization(transaction);
    const job = await transaction
      .selectFrom("catalog.published_jobs")
      .select(["id", "public_version_id", "publication_suppressed_at"])
      .where("id", "=", input.publishedJobId)
      .executeTakeFirst();
    if (!job) throw new Error("PUBLISHED_JOB_NOT_FOUND");
    if (job.publication_suppressed_at !== null) {
      return { suppressed: false, revokedPointer: false };
    }
    await transaction
      .updateTable("catalog.published_jobs")
      .set({
        publication_suppressed_at: occurredAt,
        publication_suppressed_reason: reason,
        public_version_id: null,
      })
      .where("id", "=", input.publishedJobId)
      .execute();
    await recordEvent(transaction, {
      publishedJobId: input.publishedJobId,
      publishedJobVersionId: null,
      previousPublicVersionId: job.public_version_id,
      action: "suppressed",
      actor: "operator",
      reasonCode: reason,
      occurredAt,
    });
    return { suppressed: true, revokedPointer: job.public_version_id !== null };
  });
}

/**
 * 解除强制下架。刻意**不**在此设置公开指针：是否重新发布由下一轮对账按资格判定。
 */
export async function releaseJobPublicationSuppression(input: {
  db: Kysely<Database>;
  publishedJobId: string;
  now?: Date;
}): Promise<{ released: boolean }> {
  const occurredAt = input.now ?? new Date();
  return input.db.transaction().execute(async (transaction) => {
    await lockLocalCatalogMaterialization(transaction);
    const job = await transaction
      .selectFrom("catalog.published_jobs")
      .select(["id", "publication_suppressed_at"])
      .where("id", "=", input.publishedJobId)
      .executeTakeFirst();
    if (!job) throw new Error("PUBLISHED_JOB_NOT_FOUND");
    if (job.publication_suppressed_at === null) return { released: false };
    await transaction
      .updateTable("catalog.published_jobs")
      .set({ publication_suppressed_at: null, publication_suppressed_reason: null })
      .where("id", "=", input.publishedJobId)
      .execute();
    await recordEvent(transaction, {
      publishedJobId: input.publishedJobId,
      publishedJobVersionId: null,
      previousPublicVersionId: null,
      action: "unsuppressed",
      actor: "operator",
      reasonCode: "SUPPRESSION_RELEASED",
      occurredAt,
    });
    return { released: true };
  });
}
