import { randomUUID } from "node:crypto";
import {
  JobGraphScopeSchema,
  JobSearchQuerySchema,
  RecruitmentPlanDraftSchema,
} from "@aijob/contracts";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession } from "../identity/session-repository.js";
import {
  aggregateCurrentGraph,
  getCurrentGraphEvidence,
  getCurrentJobGraph,
  loadGraphRecords,
} from "../insights/current-graph.js";
import { comparePersonalGraph } from "../insights/personal-comparison.js";
import { deleteRequirementFixtures } from "../lib/immutable-fixture-cleanup.js";
import { searchCatalogRecords } from "./filtering.js";
import { lockLocalCatalogMaterialization, materializeLocalCatalog } from "./materialize.js";
import {
  reconcilePublication,
  releaseJobPublicationSuppression,
  suppressJobPublication,
} from "./publication-reconciliation.js";
import { getJobRecruitmentPlan, installRecruitmentPlan } from "./recruitment-plans.js";
import { createCatalogRepository, loadLegacyCatalogRecords } from "./repository.js";
import { enrichOfficialJob } from "./semantic-enrichment.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

interface Fixture {
  organizationId: string;
  sourceId: string;
  recordId: string;
  revisionId: string;
  publishedJobId: string;
  publishedJobVersionId: string;
}

/**
 * ADR-0034 验证节：**自动发布必须配自动撤回**，且四种失格情形每一种都必须导致撤回。
 * 只做单向发布会让指针滞留，对外漂移比完全不发布更糟，因此这些用例是该 ADR 的上线条件。
 */
describeWithDatabase("publication reconciliation", () => {
  let db: Kysely<Database>;
  const fixtures: Fixture[] = [];

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
  });

  afterAll(async () => {
    for (const fixture of fixtures) {
      await db.transaction().execute(async (transaction) => {
        await lockLocalCatalogMaterialization(transaction);
        await transaction
          .deleteFrom("catalog.publication_events")
          .where("published_job_id", "=", fixture.publishedJobId)
          .execute();
        await transaction
          .deleteFrom("catalog.company_quota_selections")
          .where("published_job_id", "=", fixture.publishedJobId)
          .execute();
        await transaction
          .updateTable("catalog.published_jobs")
          .set({ current_version_id: null, public_version_id: null })
          .where("id", "=", fixture.publishedJobId)
          .execute();
        await transaction
          .updateTable("catalog.published_job_versions")
          .set({ active_requirement_set_id: null })
          .where("published_job_id", "=", fixture.publishedJobId)
          .execute();
        await transaction
          .deleteFrom("catalog.job_condition_projections")
          .where(
            "published_job_version_id",
            "in",
            transaction
              .selectFrom("catalog.published_job_versions")
              .select("id")
              .where("published_job_id", "=", fixture.publishedJobId),
          )
          .execute();
        await deleteRequirementFixtures(
          transaction,
          (
            await transaction
              .selectFrom("catalog.published_job_versions")
              .select("id")
              .where("published_job_id", "=", fixture.publishedJobId)
              .execute()
          ).map((row) => row.id),
        );
        await transaction
          .deleteFrom("catalog.published_job_version_revision_links")
          .where("source_job_revision_id", "=", fixture.revisionId)
          .execute();
        await transaction
          .deleteFrom("catalog.published_job_versions")
          .where("published_job_id", "=", fixture.publishedJobId)
          .execute();
        await transaction
          .deleteFrom("catalog.published_jobs")
          .where("id", "=", fixture.publishedJobId)
          .execute();
        await transaction
          .deleteFrom("ingestion.review_items")
          .where("revision_id", "=", fixture.revisionId)
          .execute();
        await transaction
          .deleteFrom("ingestion.source_job_revisions")
          .where("id", "=", fixture.revisionId)
          .execute();
        await transaction
          .deleteFrom("ingestion.source_job_activity_states")
          .where("source_job_record_id", "=", fixture.recordId)
          .execute();
        await transaction
          .deleteFrom("ingestion.source_job_records")
          .where("id", "=", fixture.recordId)
          .execute();
        await transaction
          .deleteFrom("source_control.source_runtime_states")
          .where("source_id", "=", fixture.sourceId)
          .execute();
        await transaction
          .deleteFrom("source_control.source_fetch_targets")
          .where("source_id", "=", fixture.sourceId)
          .execute();
        await transaction
          .deleteFrom("source_control.source_policy_versions")
          .where("source_id", "=", fixture.sourceId)
          .execute();
        await sql`DELETE FROM catalog.recruitment_plan_revisions WHERE source_id=${fixture.sourceId}::uuid`.execute(
          transaction,
        );
        await transaction
          .deleteFrom("source_control.sources")
          .where("id", "=", fixture.sourceId)
          .execute();
        await transaction
          .deleteFrom("source_control.organizations")
          .where("id", "=", fixture.organizationId)
          .execute();
      });
    }
    await db.destroy();
  });

  /** 建一个刚好合格并已发布的岗位，供各用例分别打破其中一项资格。 */
  async function provisionPublishedJob(
    label: string,
    content?: { title: string; requirements: string },
  ): Promise<Fixture> {
    const organizationId = randomUUID();
    const sourceId = randomUUID();
    const recordId = randomUUID();
    const revisionId = randomUUID();
    const host = `${label}.example.test`;

    await db
      .insertInto("source_control.organizations")
      .values({
        id: organizationId,
        slug: `reconcile-${organizationId}`,
        name: `Reconcile ${label}`,
        official_domain: host,
      })
      .execute();
    await db
      .insertInto("source_control.sources")
      .values({
        id: sourceId,
        organization_id: organizationId,
        source_candidate_id: null,
        source_key: `reconcile-${sourceId}`,
        source_type: "organization_career_site",
        name: `Reconcile Source ${label}`,
        current_policy_version: 1,
      })
      .execute();
    await db
      .insertInto("source_control.source_policy_versions")
      .values({
        source_id: sourceId,
        version: 1,
        policy_status: "approved",
        config_registered: true,
        catalog_role: "canonical",
        runtime_scope: "alpha",
        provenance_level: "organization_owned",
        acquisition_mode: "public_api",
        adapter_key: "reconcile-test",
        adapter_version: "1",
        entrypoints: JSON.stringify([`https://${host}/jobs`]),
        crawl_interval: "24h",
        refresh_coverage: "full_scope",
        absence_policy: "close_after_two_complete_absences",
        policy_notes: "Offline reconciliation fixture.",
        reviewed_at: null,
      })
      .execute();
    await db
      .insertInto("source_control.source_runtime_states")
      .values({
        source_id: sourceId,
        policy_version: 1,
        freshness_state: "fresh",
        last_complete_run_at: new Date(),
        consecutive_failures: 0,
        last_error_code: null,
        next_due_at: null,
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_records")
      .values({
        id: recordId,
        source_id: sourceId,
        source_job_id: `job-${recordId}`,
        canonical_source_url: `https://${host}/jobs/${recordId}`,
        first_seen_at: new Date(Date.now() - 60_000),
        last_seen_at: new Date(),
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_revisions")
      .values({
        id: revisionId,
        source_job_record_id: recordId,
        revision_content_hash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
        import_mode: "manual",
        adapter_version: "1",
        normalizer_version: "1",
        company_name: `Reconcile ${label}`,
        title: content?.title ?? `Reconcile ${label} Internship`,
        job_family: JSON.stringify({
          state: "known",
          value: "product",
          evidenceRefs: [`${revisionId}#family`],
        }),
        locations: JSON.stringify({
          state: "known",
          value: ["Shanghai"],
          evidenceRefs: [`${revisionId}#location`],
        }),
        business_groups: JSON.stringify([]),
        entry_scope: "internship",
        source_project_name: null,
        recruit_label_name: "internship",
        recruitment_type: JSON.stringify({
          state: "known",
          value: "internship",
          evidenceRefs: [`${revisionId}#type`],
        }),
        responsibilities: `Responsibilities for ${label}.`,
        requirements: content?.requirements ?? "Current student with product research experience.",
        structured_fields: JSON.stringify({}),
        ingestion_state: "validated",
        publication_state: "review",
        activity_state: "active",
        source_url: `https://${host}/jobs/${recordId}`,
        apply_url: `https://${host}/jobs/${recordId}/apply`,
        quality_flags: JSON.stringify([]),
        created_at: new Date(),
      })
      .execute();

    await materializeLocalCatalog(db);
    const materialized = await db
      .selectFrom("catalog.published_jobs as job")
      .innerJoin(
        "catalog.published_job_versions as version",
        "version.id",
        "job.current_version_id",
      )
      .select("job.id as publishedJobId")
      .where("version.source_job_revision_id", "=", revisionId)
      .executeTakeFirstOrThrow();
    // 限定范围，避免动到共享测试库里其他套件的公开指针。
    await reconcilePublication({ db, publishedJobIds: [materialized.publishedJobId] });

    const row = await db
      .selectFrom("catalog.published_jobs")
      .select(["id as publishedJobId", "public_version_id as publicVersionId"])
      .where("id", "=", materialized.publishedJobId)
      .executeTakeFirstOrThrow();
    expect(row.publicVersionId).not.toBeNull();

    const fixture: Fixture = {
      organizationId,
      sourceId,
      recordId,
      revisionId,
      publishedJobId: row.publishedJobId,
      publishedJobVersionId: row.publicVersionId as string,
    };
    fixtures.push(fixture);
    return fixture;
  }

  const readPointer = async (publishedJobId: string) =>
    (
      await db
        .selectFrom("catalog.published_jobs")
        .select("public_version_id as publicVersionId")
        .where("id", "=", publishedJobId)
        .executeTakeFirstOrThrow()
    ).publicVersionId;

  const latestEvent = async (publishedJobId: string) =>
    db
      .selectFrom("catalog.publication_events")
      .select(["action", "actor", "reason_code", "blocking_reasons", "previous_public_version_id"])
      .where("published_job_id", "=", publishedJobId)
      .orderBy("occurred_at", "desc")
      .orderBy("action", "desc")
      .executeTakeFirstOrThrow();

  it("revokes the pointer when the source policy is paused", async () => {
    const fixture = await provisionPublishedJob("paused");
    await db
      .updateTable("source_control.source_policy_versions")
      .set({ policy_status: "paused" })
      .where("source_id", "=", fixture.sourceId)
      .execute();

    expect(
      await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] }),
    ).toMatchObject({ revoked: 1 });
    expect(await readPointer(fixture.publishedJobId)).toBeNull();
    const event = await latestEvent(fixture.publishedJobId);
    expect(event).toMatchObject({ action: "revoked", actor: "reconciliation" });
    expect(event.blocking_reasons).toContain("SOURCE_POLICY_NOT_LOCAL_ALLOWED");
  });

  it("revokes the pointer when source freshness lapses", async () => {
    const fixture = await provisionPublishedJob("stale");
    await db
      .updateTable("source_control.source_runtime_states")
      .set({ freshness_state: "stale" })
      .where("source_id", "=", fixture.sourceId)
      .execute();

    expect(
      await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] }),
    ).toMatchObject({ revoked: 1 });
    expect(await readPointer(fixture.publishedJobId)).toBeNull();
    expect((await latestEvent(fixture.publishedJobId)).blocking_reasons).toContain(
      "SOURCE_NOT_FRESH",
    );
  });

  // ADR-0035 第八条：职责与任职要求放宽为「至少存在其一」。此前只清空职责即撤回，那条期望
  // 已随判据一起改掉；保留本用例是为了钉住放宽后的边界——少一项不撤回，两项皆缺才撤回。
  it("keeps the pointer when only responsibilities become empty", async () => {
    const fixture = await provisionPublishedJob("one-side");
    await db
      .updateTable("catalog.published_job_versions")
      .set({ responsibilities: "" })
      .where("id", "=", fixture.publishedJobVersionId)
      .execute();

    expect(
      await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] }),
    ).toMatchObject({ published: 0, advanced: 0, revoked: 0 });
    expect(await readPointer(fixture.publishedJobId)).toBe(fixture.publishedJobVersionId);
  });

  it("revokes the pointer when the whole job body becomes empty", async () => {
    const fixture = await provisionPublishedJob("empty");
    await db
      .updateTable("catalog.published_job_versions")
      .set({ responsibilities: "", requirements: "" })
      .where("id", "=", fixture.publishedJobVersionId)
      .execute();

    expect(
      await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] }),
    ).toMatchObject({ revoked: 1 });
    expect(await readPointer(fixture.publishedJobId)).toBeNull();
    expect((await latestEvent(fixture.publishedJobId)).blocking_reasons).toContain(
      "JOB_BODY_MISSING",
    );
  });

  // ADR-0035 第一条：非在校生可投的岗位照常入库，只在对外可见处被筛掉。撤回事件必须说出
  // 是这一条筛掉的，而不是笼统的「不合格」。
  it("revokes the pointer with a named reason when the job stops being student-applicable", async () => {
    const fixture = await provisionPublishedJob("experienced");
    await db
      .updateTable("catalog.published_job_versions")
      .set({ requirements: "至少3年相关工作经验" })
      .where("id", "=", fixture.publishedJobVersionId)
      .execute();

    expect(
      await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] }),
    ).toMatchObject({ revoked: 1 });
    expect(await readPointer(fixture.publishedJobId)).toBeNull();
    const event = await latestEvent(fixture.publishedJobId);
    expect(event.reason_code).toBe("BLOCKED");
    expect(event.blocking_reasons).toContain("JOB_NOT_STUDENT_APPLICABLE");
  });

  it("revokes the pointer when a blocking review item is opened", async () => {
    const fixture = await provisionPublishedJob("review");
    await db
      .insertInto("ingestion.review_items")
      .values({
        id: randomUUID(),
        revision_id: fixture.revisionId,
        reason_code: "STRUCTURED_FIELDS_MISSING",
        status: "open",
        details: JSON.stringify({ note: "reconciliation fixture" }),
        resolved_at: null,
      })
      .execute();

    expect(
      await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] }),
    ).toMatchObject({ revoked: 1 });
    expect(await readPointer(fixture.publishedJobId)).toBeNull();
    expect((await latestEvent(fixture.publishedJobId)).blocking_reasons).toContain(
      "BLOCKING_REVIEW_OPEN",
    );
  });

  it("suppresses on demand, is not restored by reconciliation, and republishes after release", async () => {
    const fixture = await provisionPublishedJob("suppress");

    expect(
      await suppressJobPublication({
        db,
        publishedJobId: fixture.publishedJobId,
        reason: "company objection",
      }),
    ).toEqual({ suppressed: true, revokedPointer: true });
    // 异议即停：不等下一轮对账，指针立即清空。
    expect(await readPointer(fixture.publishedJobId)).toBeNull();
    expect(await latestEvent(fixture.publishedJobId)).toMatchObject({
      action: "suppressed",
      actor: "operator",
      reason_code: "company objection",
    });

    // 对账不得把被强制下架的岗位恢复。
    expect(
      await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] }),
    ).toMatchObject({ published: 0, advanced: 0 });
    expect(await readPointer(fixture.publishedJobId)).toBeNull();

    expect(
      await releaseJobPublicationSuppression({ db, publishedJobId: fixture.publishedJobId }),
    ).toEqual({ released: true });
    // 解除本身不发布，重新发布仍由对账按资格判定。
    expect(await readPointer(fixture.publishedJobId)).toBeNull();
    expect(
      await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] }),
    ).toMatchObject({ published: 1 });
    expect(await readPointer(fixture.publishedJobId)).toBe(fixture.publishedJobVersionId);
  });

  it("rejects a suppression without a reason and is idempotent when already suppressed", async () => {
    const fixture = await provisionPublishedJob("guards");
    await expect(
      suppressJobPublication({ db, publishedJobId: fixture.publishedJobId, reason: "   " }),
    ).rejects.toThrow("PUBLICATION_SUPPRESSION_REASON_REQUIRED");
    await expect(
      suppressJobPublication({ db, publishedJobId: randomUUID(), reason: "missing" }),
    ).rejects.toThrow("PUBLISHED_JOB_NOT_FOUND");

    await suppressJobPublication({
      db,
      publishedJobId: fixture.publishedJobId,
      reason: "first takedown",
    });
    expect(
      await suppressJobPublication({
        db,
        publishedJobId: fixture.publishedJobId,
        reason: "second takedown",
      }),
    ).toEqual({ suppressed: false, revokedPointer: false });
  });

  it("never rewrites the source revision, so the content hash stays byte-identical", async () => {
    const fixture = await provisionPublishedJob("immutable");
    const before = await db
      .selectFrom("ingestion.source_job_revisions")
      .selectAll()
      .where("id", "=", fixture.revisionId)
      .executeTakeFirstOrThrow();

    await suppressJobPublication({
      db,
      publishedJobId: fixture.publishedJobId,
      reason: "immutability probe",
    });
    await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] });
    await releaseJobPublicationSuppression({ db, publishedJobId: fixture.publishedJobId });
    await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] });

    const after = await db
      .selectFrom("ingestion.source_job_revisions")
      .selectAll()
      .where("id", "=", fixture.revisionId)
      .executeTakeFirstOrThrow();
    // ADR-0029 第 11 条：revision_content_hash 的输入包含 publicationState，
    // 因此发布绝不能改写修订，否则哈希与内容不一致。
    expect(after).toEqual(before);
    expect(after.publication_state).toBe("review");
  });
  it("atomically revokes publication when runtime robots policy pauses, without changing official revisions", async () => {
    const blocked = await provisionPublishedJob("robots-hold");
    const healthy = await provisionPublishedJob("robots-healthy");
    const before = await db
      .selectFrom("ingestion.source_job_revisions")
      .selectAll()
      .where("id", "=", blocked.revisionId)
      .executeTakeFirstOrThrow();
    await db
      .updateTable("source_control.source_runtime_states")
      .set({
        automation_paused: true,
        automation_pause_reason: "ROBOTS_NOW_DISALLOWS_TARGET",
        freshness_state: "stale",
      })
      .where("source_id", "=", blocked.sourceId)
      .execute();
    expect(await readPointer(blocked.publishedJobId)).toBeNull();
    expect(await readPointer(healthy.publishedJobId)).toBe(healthy.publishedJobVersionId);
    expect(await latestEvent(blocked.publishedJobId)).toMatchObject({
      reason_code: "ROBOTS_NOW_DISALLOWS_TARGET",
      action: "revoked",
    });
    await reconcilePublication({ db, publishedJobIds: [blocked.publishedJobId] });
    expect(await readPointer(blocked.publishedJobId)).toBeNull();
    expect(
      await db
        .selectFrom("ingestion.source_job_revisions")
        .selectAll()
        .where("id", "=", blocked.revisionId)
        .executeTakeFirstOrThrow(),
    ).toEqual(before);
  });

  it("keeps postgraduate opportunities public instead of hiding them globally", async () => {
    const fixture = await provisionPublishedJob("postgraduate-current");
    await db
      .updateTable("catalog.published_job_versions")
      .set({ requirements: "硕士及以上学历，全日制研究生" })
      .where("id", "=", fixture.publishedJobVersionId)
      .execute();
    expect(
      await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] }),
    ).toMatchObject({ revoked: 0 });
    expect(await readPointer(fixture.publishedJobId)).toBe(fixture.publishedJobVersionId);
  });

  it("serves a filtered current graph and original evidence, then invalidates the warm public cache on revocation", async () => {
    const fixture = await provisionPublishedJob("current-graph", {
      title: "产品运营实习生",
      requirements: "硕士及以上学历；熟练掌握 SQL；985高校优先；无需211背景",
    });
    const scope = JobGraphScopeSchema.parse({
      jobFamily: "operations",
      subrole: "product_operations",
      cities: ["Shanghai"],
      educationLevels: ["硕士"],
      recruitmentTypes: ["internship"],
    });
    const first = await getCurrentJobGraph({ db, scope, local: false });
    const reference = aggregateCurrentGraph(
      await loadGraphRecords(db, scope, false),
      scope,
      first.generation,
    );
    expect(first.sample).toEqual(reference.sample);
    expect(first.items).toEqual(reference.items);
    expect(first.sample).toMatchObject({
      jobCount: 1,
      companyCount: 1,
      parsedJobCount: 1,
      parseCoverage: 1,
    });
    expect(first.items.find((item) => item.key === "tool:sql")).toMatchObject({
      jobCount: 1,
      requiredJobCount: 1,
      mentionRate: 1,
    });
    expect(first.items.find((item) => item.key === "school:985")).toMatchObject({
      preferredJobCount: 1,
      requiredJobCount: 0,
    });
    expect(await getCurrentJobGraph({ db, scope, local: false })).toEqual(first);
    const evidence = await getCurrentGraphEvidence({
      db,
      scope,
      local: false,
      key: "tool:sql",
      offset: 0,
      limit: 1,
    });
    expect(evidence.total).toBe(1);
    expect(evidence.items[0]).toMatchObject({
      jobVersionId: fixture.publishedJobVersionId,
      atom: { sourceText: "熟练掌握 SQL" },
    });
    await suppressJobPublication({
      db,
      publishedJobId: fixture.publishedJobId,
      reason: "graph withdrawal test",
    });
    const after = await getCurrentJobGraph({ db, scope, local: false });
    expect(after.generation).not.toBe(first.generation);
    expect(after.sample.jobCount).toBe(0);
    expect(
      (
        await getCurrentGraphEvidence({
          db,
          scope,
          local: false,
          key: "tool:sql",
          offset: 0,
          limit: 1,
        })
      ).total,
    ).toBe(0);
  });

  it("limits scheduled materialization to its source and keeps unchanged job versions", async () => {
    const a = await provisionPublishedJob("scope-a"),
      b = await provisionPublishedJob("scope-b");
    const before = await db
      .selectFrom("catalog.published_jobs")
      .selectAll()
      .where("id", "in", [a.publishedJobId, b.publishedJobId])
      .orderBy("id")
      .execute();
    const result = await materializeLocalCatalog(db, { sourceId: a.sourceId });
    expect(result).toMatchObject({
      materializedRevisions: 1,
      createdVersions: 0,
      createdRequirementSets: 0,
      quotaSelectedJobs: 1,
      quotaSuppressedJobs: 0,
    });
    expect(
      await db
        .selectFrom("catalog.published_jobs")
        .selectAll()
        .where("id", "in", [a.publishedJobId, b.publishedJobId])
        .orderBy("id")
        .execute(),
    ).toEqual(before);
  });

  it("keeps recruitment seasons explicit, checks evidence and company links, and revokes current plan reads with the job", async () => {
    const fixture = await provisionPublishedJob("plan-current"),
      foreign = await provisionPublishedJob("plan-foreign");
    await db
      .insertInto("source_control.source_fetch_targets")
      .values({
        id: randomUUID(),
        source_id: fixture.sourceId,
        policy_version: 1,
        method: "GET",
        scheme: "https",
        host: "plan-current.example.test",
        port: 443,
        path_prefix: "/jobs/",
        allow_redirects: false,
        allowed_query_parameters: [],
      })
      .execute();
    const draft = RecruitmentPlanDraftSchema.parse({
      sourceKey: `reconcile-${fixture.sourceId}`,
      planKey: "campus-autumn",
      expectedRevision: 0,
      title: "2027 届校园招聘",
      recruitmentYear: 2027,
      batch: "秋招",
      graduationWindow: { from: "2026-09", to: "2027-08", quote: "毕业月份为2026年9月至2027年8月" },
      volunteerRules: { value: "最多两个志愿", quote: "最多两个志愿" },
      evidenceUrl: "https://plan-current.example.test/jobs/campus",
      evidenceText: "2027届校园招聘，毕业月份为2026年9月至2027年8月，最多两个志愿。",
      yearQuote: "2027届校园招聘",
      verifiedAt: new Date().toISOString(),
      jobVersionIds: [fixture.publishedJobVersionId],
      confirmedOfficialEvidence: true,
    });
    const installed = await installRecruitmentPlan({ db, draft });
    expect(await installRecruitmentPlan({ db, draft })).toEqual(installed);
    expect(
      (await getJobRecruitmentPlan({ db, jobId: fixture.publishedJobId, local: false })).plan?.id,
    ).toBe(installed.plan.id);
    await expect(
      installRecruitmentPlan({
        db,
        draft: { ...draft, jobVersionIds: [foreign.publishedJobVersionId] },
      }),
    ).rejects.toMatchObject({ code: "PLAN_JOB_COMPANY_MISMATCH" });
    expect(() =>
      RecruitmentPlanDraftSchema.parse({
        ...draft,
        graduationWindow: { ...draft.graduationWindow, quote: "原文没有的日期" },
      }),
    ).toThrow();
    const next = {
      ...draft,
      recruitmentYear: 2028,
      evidenceText: "2028届校园招聘，毕业月份为2027年9月至2028年8月。",
      yearQuote: "2028届校园招聘",
      graduationWindow: null,
      volunteerRules: null,
      jobVersionIds: [],
    };
    expect((await installRecruitmentPlan({ db, draft: next })).plan.revision).toBe(1);
    expect(
      (await getJobRecruitmentPlan({ db, jobId: fixture.publishedJobId, local: false })).plan
        ?.recruitmentYear,
    ).toBe(2027);
    await suppressJobPublication({
      db,
      publishedJobId: fixture.publishedJobId,
      reason: "plan withdrawal fixture",
    });
    expect(
      (await getJobRecruitmentPlan({ db, jobId: fixture.publishedJobId, local: false })).plan,
    ).toBeNull();
  });

  it("reuses grounded AI semantics, refreshes public graph and isolates personal evidence", async () => {
    const text = "本科、硕士或博士在读；整理项目风险清单。";
    const fixture = await provisionPublishedJob("semantic-ai-personal", {
      title: "项目产品实习生",
      requirements: text,
    });
    const scope = JobGraphScopeSchema.parse({}),
      key = "deliverable:project_risk_fixture",
      modelKey = `fixture-semantic-${randomUUID()}`;
    const before = await db
      .selectFrom("catalog.published_job_versions")
      .selectAll()
      .where("id", "=", fixture.publishedJobVersionId)
      .executeTakeFirstOrThrow();
    await getCurrentJobGraph({ db, scope, local: false });
    let calls = 0;
    const request = {
      db,
      source: {
        jobVersionId: fixture.publishedJobVersionId,
        title: before.title,
        requirements: before.requirements,
        responsibilities: before.responsibilities,
      },
      modelKey,
      budget: { dailyCalls: 10000, dailyTokens: 10000000, concurrency: 2, maxOutputTokens: 256 },
      provider: {
        completeStructured: async <T>(input: { schema: { parse: (value: unknown) => T } }) => {
          calls++;
          return input.schema.parse({
            primaryFamily: null,
            families: [],
            subrole: null,
            domains: [],
            roleQuote: null,
            atoms: [
              {
                key,
                label: "项目风险清单",
                kind: "deliverable",
                necessity: "required",
                negated: false,
                condition: null,
                sourceText: "整理项目风险清单。",
                section: "requirements",
                sourceSpan: { start: text.indexOf("整理"), end: text.length },
              },
            ],
          });
        },
      },
    };
    const owners: string[] = [];
    try {
      expect((await enrichOfficialJob(request)).mode).toBe("ai");
      expect((await enrichOfficialJob(request)).mode).toBe("cache");
      expect(calls).toBe(1);
      expect(
        await db
          .selectFrom("catalog.published_job_versions")
          .selectAll()
          .where("id", "=", fixture.publishedJobVersionId)
          .executeTakeFirstOrThrow(),
      ).toEqual(before);
      expect(
        (await getCurrentJobGraph({ db, scope, local: false })).items.find(
          (item) => item.key === key,
        )?.jobCount,
      ).toBe(1);
      const a = await createAnonymousSession({ db }),
        b = await createAnonymousSession({ db });
      owners.push(a.context.ownerId, b.context.ownerId);
      const evidenceId = randomUUID(),
        revisionId = randomUUID();
      await db
        .insertInto("profile.resume_evidence_revisions")
        .values({
          id: revisionId,
          owner_id: a.context.ownerId,
          owner_epoch: 1,
          revision: 1,
          base_revision: null,
          resume_analysis_id: null,
          schema_version: "resume-evidence-v1",
          document_revision_id: null,
          content_hash: "ab".repeat(32),
          confirmed_at: new Date(),
          evidence: JSON.stringify([
            {
              id: evidenceId,
              resumeAnalysisId: null,
              section: "课程项目",
              originalText: "整理项目风险清单",
              claim: "整理项目风险清单",
              skills: [],
              outcomes: [],
              confirmed: true,
            },
          ]),
        })
        .execute();
      expect(
        (
          await comparePersonalGraph({
            db,
            scope,
            key,
            dataset: "public",
            local: false,
            owner: a.context,
          })
        ).candidates[0]?.evidenceId,
      ).toBe(evidenceId);
      expect(
        (
          await comparePersonalGraph({
            db,
            scope,
            key,
            dataset: "public",
            local: false,
            owner: b.context,
          })
        ).candidates,
      ).toEqual([]);
      await suppressJobPublication({
        db,
        publishedJobId: fixture.publishedJobId,
        reason: "AI graph withdrawal fixture",
      });
      await expect(
        comparePersonalGraph({ db, scope, key, dataset: "public", local: false, owner: a.context }),
      ).rejects.toMatchObject({ code: "GRAPH_REQUIREMENT_NOT_FOUND" });
    } finally {
      for (const ownerId of owners) {
        await db
          .updateTable("identity.owners")
          .set({ status: "deletion_pending" })
          .where("id", "=", ownerId)
          .execute();
        await db
          .deleteFrom("profile.resume_evidence_revisions")
          .where("owner_id", "=", ownerId)
          .execute();
        await db.deleteFrom("identity.owner_sessions").where("owner_id", "=", ownerId).execute();
        await db.deleteFrom("identity.owners").where("id", "=", ownerId).execute();
      }
      await sql`DELETE FROM source_control.public_ai_cache WHERE call_id IN(SELECT id FROM source_control.public_ai_calls WHERE model_key=${modelKey})`.execute(
        db,
      );
      await sql`DELETE FROM source_control.public_ai_calls WHERE model_key=${modelKey}`.execute(db);
    }
  });

  it("matches legacy filter groups, totals, facets and cursors while querying PostgreSQL pages", async () => {
    await provisionPublishedJob("sql-page-one", {
      title: "产品实习生",
      requirements: "本科及以上，熟悉 SQL",
    });
    await provisionPublishedJob("sql-page-two", {
      title: "产品实习生",
      requirements: "硕士在读，熟悉 SQL",
    });
    const companies = ["Reconcile sql-page-one", "Reconcile sql-page-two"];
    for (const local of [false, true]) {
      const legacy = await loadLegacyCatalogRecords(db, local),
        repo = createCatalogRepository({ db, enableLocalMvp: local });
      const queries = [
        {},
        { keyword: "ＳＱＬ" },
        { cities: ["Shanghai"] },
        { cities: ["北京"] },
        { jobFamilies: ["product"] },
        { recruitmentBatches: ["秋招"] },
        { availableWeeklyAttendanceDays: 3 },
        { availableDurationMonths: 3 },
        { educationLevels: ["本科"] },
        { educationLevels: ["硕士"] },
        { minimumSalary: 100 },
        { salaryPeriods: ["month"] },
        { graduationYears: [2027] },
        { latestStartDate: "2026-10-01" },
        { majors: ["计算机"] },
        { workModes: ["onsite"] },
      ];
      for (const criteria of queries) {
        for (const includeUnknownHardConditions of [true, false]) {
          const query = JobSearchQuerySchema.parse({
            ...criteria,
            companies,
            includeUnknownHardConditions,
            limit: 1,
          });
          const expected = searchCatalogRecords(legacy, query),
            actual = await repo.search(query);
          expect(actual, JSON.stringify({ local, query })).toEqual(expected);
          if (actual.nextCursor) {
            const next = { ...query, cursor: actual.nextCursor };
            expect(await repo.search(next)).toEqual(searchCatalogRecords(legacy, next));
          }
        }
      }
    }
  }, 60000);

  it("normalizes scalar requirements into list projections and tolerates malformed legacy lists", async () => {
    const fixture = await provisionPublishedJob("scalar-list-regression", {
      title: "产品实习生",
      requirements: "2027届毕业生；计算机专业；本科及以上；熟悉 SQL",
    });
    const readProjection = () =>
      db
        .selectFrom("catalog.job_condition_projections")
        .selectAll()
        .where("published_job_version_id", "=", fixture.publishedJobVersionId)
        .executeTakeFirstOrThrow();
    const projection = await readProjection();
    expect(projection.graduation_years).toMatchObject({ state: "known", value: [2027] });
    expect(projection.majors).toMatchObject({ state: "known", value: ["计算机"] });
    const original = await db
      .selectFrom("catalog.job_requirement_sets")
      .selectAll()
      .where("id", "=", projection.requirement_set_id)
      .executeTakeFirstOrThrow();
    expect(await materializeLocalCatalog(db)).toMatchObject({
      createdVersions: 0,
      createdRequirementSets: 0,
    });
    expect(await readProjection()).toEqual(projection);
    for (const malformed of ["计算机", null, [], [null], [""], { value: "计算机" }]) {
      // Deliberately corrupt only this synthetic projection, never immutable source evidence.
      const field = JSON.stringify({
        state: "known",
        value: malformed,
        evidenceRefs: [fixture.revisionId],
      });
      await db
        .updateTable("catalog.job_condition_projections")
        .set({
          majors: field,
          graduation_years: field,
          education_levels: field,
          locations: field,
        })
        .where("requirement_set_id", "=", projection.requirement_set_id)
        .execute();
      for (const local of [false, true]) {
        const legacy = await loadLegacyCatalogRecords(db, local);
        const repository = createCatalogRepository({ db, enableLocalMvp: local });
        for (const includeUnknownHardConditions of [true, false]) {
          const query = JobSearchQuerySchema.parse({
            companies: ["Reconcile scalar-list-regression"],
            cities: ["北京"],
            educationLevels: ["本科"],
            majors: ["计算机"],
            graduationYears: [2027],
            includeUnknownHardConditions,
          });
          expect(await repository.search(query)).toEqual(searchCatalogRecords(legacy, query));
        }
        const unfiltered = JobSearchQuerySchema.parse({
          companies: ["Reconcile scalar-list-regression"],
        });
        expect(await repository.search(unfiltered)).toEqual(
          searchCatalogRecords(legacy, unfiltered),
        );
        await expect(
          getCurrentJobGraph({ db, local, scope: JobGraphScopeSchema.parse({ cities: ["北京"] }) }),
        ).resolves.toBeDefined();
      }
    }
    expect(
      await db
        .selectFrom("catalog.job_requirement_sets")
        .selectAll()
        .where("id", "=", projection.requirement_set_id)
        .executeTakeFirstOrThrow(),
    ).toEqual(original);
  }, 60000);
});
