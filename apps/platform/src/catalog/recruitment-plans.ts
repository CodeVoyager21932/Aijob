import { randomUUID } from "node:crypto";
import {
  RecruitmentPlanSchema,
  RecruitmentPlanResponseSchema,
  type RecruitmentPlanDraft,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { sql, type Kysely, type Transaction } from "kysely";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { validateNavigationUrl } from "../ingestion/safe-http.js";
import type { SourceTarget } from "../sources/source-config.js";
import { createCatalogRepository } from "./repository.js";

export async function installRecruitmentPlan(input: {
  db: Kysely<Database>;
  draft: RecruitmentPlanDraft;
}) {
  const draft = input.draft;
  if (new Date(draft.verifiedAt).getTime() > Date.now() + 300000)
    throw new ServiceError(400, "PLAN_VERIFICATION_IN_FUTURE", "核验时间不能晚于当前时间。");
  return input.db.transaction().execute(async (tx) => {
    const source = await tx
      .selectFrom("source_control.sources")
      .select(["id", "organization_id", "current_policy_version"])
      .where("source_key", "=", draft.sourceKey)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const targets = [];
    for (const table of [
      "source_control.source_fetch_targets",
      "source_control.source_apply_targets",
    ] as const) {
      targets.push(
        ...(await tx
          .selectFrom(table)
          .selectAll()
          .where("source_id", "=", source.id)
          .where("policy_version", "=", source.current_policy_version)
          .where("method", "=", "GET")
          .execute()),
      );
    }
    validateNavigationUrl(
      draft.evidenceUrl,
      "GET",
      targets.map((target) => ({
        method: "GET",
        scheme: target.scheme,
        host: target.host,
        port: target.port,
        pathPrefix: target.path_prefix,
        allowRedirects: target.allow_redirects,
        allowedQueryParameters: target.allowed_query_parameters,
      })) as SourceTarget[],
    );
    const { rows } = await sql<{
      revision: number;
      content_hash: string;
      plan: unknown;
    }>`SELECT revision,content_hash,plan FROM catalog.recruitment_plan_revisions WHERE source_id=${source.id}::uuid AND plan_key=${draft.planKey} AND recruitment_year=${draft.recruitmentYear} ORDER BY revision DESC LIMIT 1`.execute(
      tx,
    );
    const {
      expectedRevision,
      jobVersionIds,
      confirmedOfficialEvidence: _confirmedOfficialEvidence,
      ...facts
    } = draft;
    const hash = hashCanonicalJson(facts),
      previous = rows[0];
    let plan: ReturnType<typeof RecruitmentPlanSchema.parse>;
    if (previous?.content_hash === hash) plan = RecruitmentPlanSchema.parse(previous.plan);
    else {
      if ((previous?.revision ?? 0) !== expectedRevision)
        throw new ServiceError(
          409,
          "RECRUITMENT_PLAN_REVISION_CONFLICT",
          "招聘计划已更新，请重新核对修订。",
        );
      plan = RecruitmentPlanSchema.parse({
        ...facts,
        id: randomUUID(),
        revision: expectedRevision + 1,
      });
      await sql`INSERT INTO catalog.recruitment_plan_revisions(id,source_id,plan_key,recruitment_year,revision,plan,content_hash) VALUES (${plan.id}::uuid,${source.id}::uuid,${plan.planKey},${plan.recruitmentYear},${plan.revision},${JSON.stringify(plan)}::jsonb,${hash})`.execute(
        tx,
      );
    }
    for (const versionId of jobVersionIds) {
      const row = await tx
        .selectFrom("catalog.published_job_versions as version")
        .innerJoin(
          "ingestion.source_job_revisions as revision",
          "revision.id",
          "version.source_job_revision_id",
        )
        .innerJoin(
          "ingestion.source_job_records as record",
          "record.id",
          "revision.source_job_record_id",
        )
        .innerJoin("source_control.sources as source", "source.id", "record.source_id")
        .select("source.organization_id")
        .where("version.id", "=", versionId)
        .executeTakeFirst();
      if (row?.organization_id !== source.organization_id)
        throw new ServiceError(
          400,
          "PLAN_JOB_COMPANY_MISMATCH",
          "只能显式关联同一企业的岗位版本。",
        );
      await sql`INSERT INTO catalog.job_recruitment_plans(job_version_id,plan_revision_id) VALUES (${versionId}::uuid,${plan.id}::uuid) ON CONFLICT(job_version_id) DO UPDATE SET plan_revision_id=EXCLUDED.plan_revision_id,updated_at=now()`.execute(
        tx,
      );
    }
    return {
      plan,
      linkedVersions: jobVersionIds.length,
      notice:
        "关联仅适用于本次显式选择的岗位版本。新招聘季、新岗位版本不自动继承；已创建申请的计划修订保持固定。",
    };
  });
}
export async function pinRecruitmentPlan(
  tx: Transaction<Database>,
  owner: OwnerScope,
  caseId: string,
  jobVersionId: string,
) {
  await sql`INSERT INTO application.case_recruitment_plans(case_id,owner_id,owner_epoch,plan_revision_id)
    SELECT ${caseId}::uuid,${owner.ownerId}::uuid,${owner.ownerEpoch},plan_revision_id FROM catalog.job_recruitment_plans WHERE job_version_id=${jobVersionId}::uuid`.execute(
    tx,
  );
}
export async function getJobRecruitmentPlan(input: {
  db: Kysely<Database>;
  jobId: string;
  local: boolean;
}) {
  const job = await createCatalogRepository({ db: input.db, enableLocalMvp: input.local }).get(
    input.jobId,
  );
  if (!job)
    return RecruitmentPlanResponseSchema.parse({
      plan: null,
      context: "current",
      notice: "当前岗位不可见。",
    });
  const { rows } = await sql<{
    plan: unknown;
  }>`SELECT revision.plan FROM catalog.job_recruitment_plans link JOIN catalog.recruitment_plan_revisions revision ON revision.id=link.plan_revision_id
    JOIN source_control.sources source ON source.id=revision.source_id JOIN source_control.source_policy_versions policy ON policy.source_id=source.id AND policy.version=source.current_policy_version
    WHERE link.job_version_id=${job.publishedJobVersionId}::uuid AND policy.policy_status IN (${input.local ? sql`'approved','pending_review'` : sql`'approved'`})
    AND policy.catalog_role='canonical' ${input.local ? sql`` : sql`AND policy.runtime_scope IN ('alpha','production')`}
    AND NOT EXISTS (SELECT 1 FROM source_control.source_runtime_states runtime WHERE runtime.source_id=source.id AND runtime.automation_paused=true AND runtime.automation_pause_reason IN ('ROBOTS_NOW_DISALLOWS_TARGET','ROBOTS_UNAVAILABLE_ON_RECHECK','TERMS_PROHIBIT_AGGREGATION','ACCESS_POLICY_EVIDENCE_MISSING'))`.execute(
    input.db,
  );
  return RecruitmentPlanResponseSchema.parse({
    plan: rows[0]?.plan ?? null,
    context: "current",
    notice: rows.length
      ? "招聘计划来自企业官方依据；资格仍由你结合原文核对。"
      : "尚未关联已核验的招聘计划，未说明的规则不会补写。",
  });
}
export async function getCaseRecruitmentPlan(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
}) {
  return input.db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    const { rows } = await sql<{
      plan: unknown;
    }>`SELECT revision.plan FROM application.case_recruitment_plans link JOIN catalog.recruitment_plan_revisions revision ON revision.id=link.plan_revision_id
      JOIN application.application_cases c ON c.id=link.case_id AND c.owner_id=link.owner_id
      WHERE link.case_id=${input.caseId}::uuid AND link.owner_id=${input.owner.ownerId}::uuid AND link.owner_epoch=${input.owner.ownerEpoch} AND c.deleted_at IS NULL`.execute(
      tx,
    );
    return RecruitmentPlanResponseSchema.parse({
      plan: rows[0]?.plan ?? null,
      context: "case_snapshot",
      notice: rows.length
        ? "保留创建申请时的计划修订。后续公告变更请回到官方页面核对。"
        : "本申请未留存招聘计划，旧记录不自动补入其他招聘季的规则。",
    });
  });
}
