import { randomUUID } from "node:crypto";
import { JobSearchQuerySchema } from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession, type OwnerContext } from "../identity/session-repository.js";
import { createJobInsightRun } from "../insights/service.js";
import { readLocalBootstrapCatalogStats } from "../local-bootstrap.js";
import { lockLocalCatalogMaterialization, materializeLocalCatalog } from "./materialize.js";
import { reconcilePublication } from "./publication-reconciliation.js";
import { createCatalogRepository } from "./repository.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/**
 * ADR-0034 第一、二条：物化不发布，发布由双向资格对账驱动，且指针前移到最新**合格**版本。
 *
 * 这里刻意不用 `publication_state` 制造公开与本机的分歧——适配器恒产出 `"review"`，
 * 用它当开关是此前那个循环依赖的来源。分歧改由 ADR-0032 的 `closure_detectable` 制造：
 * 来源 `absence_policy = 'none'`，于是「能否探知关闭」逐版本取决于是否有已知截止日期。
 * 无截止日期的版本进不了 Alpha，但仍进本机预览——这正是 Alpha 比 local 多一层的语义。
 */
describeWithDatabase("catalog public version pointer", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");
  const ids = {
    organization: randomUUID(),
    source: randomUUID(),
    record: randomUUID(),
    firstRevision: randomUUID(),
    secondRevision: randomUUID(),
    undetectableRevision: randomUUID(),
  };
  const revisionIds = [ids.firstRevision, ids.secondRevision, ids.undetectableRevision];
  const marker = randomUUID().slice(0, 8);
  const firstTitle = `first-${marker}`;
  const secondTitle = `second-${marker}`;
  const undetectableTitle = `undetectable-${marker}`;
  let insightOwner: OwnerContext | null = null;

  beforeAll(async () => {
    await migrateToLatest(db);
    await sql`
      ANALYZE
        source_control.organizations,
        source_control.sources,
        source_control.source_policy_versions,
        source_control.source_runtime_states,
        ingestion.source_job_records,
        ingestion.source_job_revisions,
        catalog.published_jobs,
        catalog.published_job_versions,
        catalog.published_job_version_revision_links,
        catalog.job_requirement_sets,
        catalog.job_condition_projections
    `.execute(db);
  });

  afterAll(async () => {
    if (insightOwner) {
      await db
        .deleteFrom("matching.job_insight_runs")
        .where("owner_id", "=", insightOwner.ownerId)
        .execute();
      await db
        .deleteFrom("identity.owner_sessions")
        .where("owner_id", "=", insightOwner.ownerId)
        .execute();
      await db.deleteFrom("identity.owners").where("id", "=", insightOwner.ownerId).execute();
    }
    await db.transaction().execute(async (transaction) => {
      await lockLocalCatalogMaterialization(transaction);
      const jobs = await transaction
        .selectFrom("catalog.published_jobs as job")
        .innerJoin(
          "catalog.published_job_versions as version",
          "version.published_job_id",
          "job.id",
        )
        .innerJoin(
          "catalog.published_job_version_revision_links as link",
          "link.published_job_version_id",
          "version.id",
        )
        .select(["job.id as jobId", "version.id as versionId"])
        .where("link.source_job_revision_id", "in", revisionIds)
        .execute();
      const jobIds = [...new Set(jobs.map(({ jobId }) => jobId))];
      const versionIds = [...new Set(jobs.map(({ versionId }) => versionId))];
      if (jobIds.length > 0) {
        await transaction
          .deleteFrom("catalog.publication_events")
          .where("published_job_id", "in", jobIds)
          .execute();
        await transaction
          .deleteFrom("catalog.company_quota_selections")
          .where("published_job_id", "in", jobIds)
          .execute();
        await transaction
          .updateTable("catalog.published_jobs")
          .set({ current_version_id: null, public_version_id: null })
          .where("id", "in", jobIds)
          .execute();
      }
      if (versionIds.length > 0) {
        await transaction
          .updateTable("catalog.published_job_versions")
          .set({ active_requirement_set_id: null })
          .where("id", "in", versionIds)
          .execute();
        await transaction
          .deleteFrom("catalog.job_requirement_sets")
          .where("published_job_version_id", "in", versionIds)
          .execute();
        await transaction
          .deleteFrom("catalog.published_job_versions")
          .where("id", "in", versionIds)
          .execute();
      }
      if (jobIds.length > 0) {
        await transaction.deleteFrom("catalog.published_jobs").where("id", "in", jobIds).execute();
      }
      await transaction
        .deleteFrom("ingestion.source_job_revisions")
        .where("id", "in", revisionIds)
        .execute();
      await transaction
        .deleteFrom("ingestion.source_job_records")
        .where("id", "=", ids.record)
        .execute();
      await transaction
        .deleteFrom("source_control.source_runtime_states")
        .where("source_id", "=", ids.source)
        .execute();
      await transaction
        .deleteFrom("source_control.source_policy_versions")
        .where("source_id", "=", ids.source)
        .execute();
      await transaction.deleteFrom("source_control.sources").where("id", "=", ids.source).execute();
      await transaction
        .deleteFrom("source_control.organizations")
        .where("id", "=", ids.organization)
        .execute();
    });
    await db.destroy();
  });

  it("publishes, advances and holds the public pointer purely by eligibility", async () => {
    const publicJobsBefore = (await readLocalBootstrapCatalogStats(db)).publicJobs;
    const firstObservedAt = new Date(Date.now() - 60_000);
    await db
      .insertInto("source_control.organizations")
      .values({
        id: ids.organization,
        slug: `public-pointer-${ids.organization}`,
        name: "Public Pointer Test Company",
        official_domain: "public-pointer.example.test",
      })
      .execute();
    await db
      .insertInto("source_control.sources")
      .values({
        id: ids.source,
        organization_id: ids.organization,
        source_candidate_id: null,
        source_key: `public-pointer-${ids.source}`,
        source_type: "organization_career_site",
        name: "Public Pointer Test Source",
        current_policy_version: 1,
      })
      .execute();
    await db
      .insertInto("source_control.source_policy_versions")
      .values({
        source_id: ids.source,
        version: 1,
        policy_status: "approved",
        config_registered: true,
        catalog_role: "canonical",
        runtime_scope: "alpha",
        provenance_level: "organization_owned",
        acquisition_mode: "public_api",
        adapter_key: "public-pointer-test",
        adapter_version: "1",
        entrypoints: JSON.stringify(["https://public-pointer.example.test/jobs"]),
        crawl_interval: "24h",
        // ADR-0032/0034：`absence_policy = 'none'` 让「能否探知关闭」逐版本取决于截止日期，
        // 从而用一个**只约束 Alpha** 的条件制造公开与本机预览的分歧。
        refresh_coverage: "tracked_records",
        absence_policy: "none",
        policy_notes: "Offline public pointer fixture.",
        reviewed_at: null,
      })
      .execute();
    await db
      .insertInto("source_control.source_runtime_states")
      .values({
        source_id: ids.source,
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
        id: ids.record,
        source_id: ids.source,
        source_job_id: `job-${ids.record}`,
        canonical_source_url: `https://public-pointer.example.test/jobs/${ids.record}`,
        first_seen_at: firstObservedAt,
        last_seen_at: new Date(),
      })
      .execute();

    const revision = (input: {
      id: string;
      title: string;
      deadline: string | null;
      hashCharacter: string;
      createdAt: Date;
    }) => ({
      id: input.id,
      source_job_record_id: ids.record,
      revision_content_hash: input.hashCharacter.repeat(64),
      import_mode: "manual" as const,
      adapter_version: "1",
      normalizer_version: "1",
      company_name: "Public Pointer Test Company",
      title: input.title,
      job_family: JSON.stringify({
        state: "known",
        value: "product",
        evidenceRefs: [`${input.id}#family`],
      }),
      locations: JSON.stringify({
        state: "known",
        value: ["Shanghai"],
        evidenceRefs: [`${input.id}#location`],
      }),
      business_groups: JSON.stringify([]),
      entry_scope: "internship",
      source_project_name: null,
      recruit_label_name: "internship",
      recruitment_type: JSON.stringify({
        state: "known",
        value: "internship",
        evidenceRefs: [`${input.id}#type`],
      }),
      deadline_at: JSON.stringify(
        input.deadline === null
          ? { state: "unknown", reason: "source_not_stated" }
          : { state: "known", value: input.deadline, evidenceRefs: [`${input.id}#deadline`] },
      ),
      responsibilities: `Responsibilities for ${input.title}.`,
      requirements: "Current student with product research experience.",
      structured_fields: JSON.stringify({}),
      ingestion_state: "validated",
      // ADR-0034：适配器恒产出 `review`，发布不再由该列表达。
      publication_state: "review",
      activity_state: "active",
      source_url: `https://public-pointer.example.test/jobs/${ids.record}`,
      apply_url: `https://public-pointer.example.test/jobs/${ids.record}/apply`,
      quality_flags: JSON.stringify([]),
      created_at: input.createdAt,
    });

    const readPointers = async (jobId: string) =>
      db
        .selectFrom("catalog.published_jobs")
        .select(["current_version_id as currentVersionId", "public_version_id as publicVersionId"])
        .where("id", "=", jobId)
        .executeTakeFirstOrThrow();

    await db
      .insertInto("ingestion.source_job_revisions")
      .values(
        revision({
          id: ids.firstRevision,
          title: firstTitle,
          deadline: "2027-06-30",
          hashCharacter: "1",
          createdAt: firstObservedAt,
        }),
      )
      .execute();
    await materializeLocalCatalog(db);

    const materialized = await db
      .selectFrom("catalog.published_jobs as job")
      .innerJoin(
        "catalog.published_job_versions as version",
        "version.id",
        "job.current_version_id",
      )
      .select([
        "job.id as jobId",
        "job.current_version_id as currentVersionId",
        "job.public_version_id as publicVersionId",
      ])
      .where("version.source_job_revision_id", "=", ids.firstRevision)
      .executeTakeFirstOrThrow();
    // 物化只负责 current_version_id：这一条就是此前那个循环依赖的解除点。
    expect(materialized.publicVersionId).toBeNull();

    expect(await reconcilePublication({ db, publishedJobIds: [materialized.jobId] })).toMatchObject({ published: 1, revoked: 0 });
    const published = await readPointers(materialized.jobId);
    expect(published.publicVersionId).toBe(materialized.currentVersionId);
    expect(
      await db
        .selectFrom("catalog.publication_events")
        .select(["action", "actor", "reason_code"])
        .where("published_job_id", "=", materialized.jobId)
        .orderBy("occurred_at", "desc")
        .executeTakeFirstOrThrow(),
    ).toMatchObject({
      action: "published",
      actor: "reconciliation",
      reason_code: "ELIGIBLE_FOR_ALPHA",
    });

    await db
      .insertInto("ingestion.source_job_revisions")
      .values(
        revision({
          id: ids.secondRevision,
          title: secondTitle,
          deadline: "2027-07-31",
          hashCharacter: "2",
          createdAt: new Date(),
        }),
      )
      .execute();
    await materializeLocalCatalog(db);
    const beforeAdvance = await readPointers(materialized.jobId);
    expect(beforeAdvance.currentVersionId).not.toBe(materialized.currentVersionId);
    // 物化推进了本机预览，但没有动公开指针。
    expect(beforeAdvance.publicVersionId).toBe(published.publicVersionId);

    expect(await reconcilePublication({ db, publishedJobIds: [materialized.jobId] })).toMatchObject({ advanced: 1, revoked: 0 });
    const advanced = await readPointers(materialized.jobId);
    expect(advanced.publicVersionId).toBe(advanced.currentVersionId);

    await db
      .insertInto("ingestion.source_job_revisions")
      .values(
        revision({
          id: ids.undetectableRevision,
          title: undetectableTitle,
          deadline: null,
          hashCharacter: "3",
          createdAt: new Date(Date.now() + 1_000),
        }),
      )
      .execute();
    await materializeLocalCatalog(db);
    // 最新版本无已知截止日期且来源不按缺席关闭，因此不可探知关闭 → 不合格进入 Alpha。
    expect(await reconcilePublication({ db, publishedJobIds: [materialized.jobId] })).toMatchObject({
      published: 0,
      advanced: 0,
      revoked: 0,
    });
    const held = await readPointers(materialized.jobId);
    expect(held.currentVersionId).not.toBe(advanced.currentVersionId);
    expect(held.publicVersionId).toBe(advanced.publicVersionId);

    const localCatalog = createCatalogRepository({ db, enableLocalMvp: true });
    const publicCatalog = createCatalogRepository({ db, enableLocalMvp: false });
    expect(
      await localCatalog.search(
        JobSearchQuerySchema.parse({ keyword: undetectableTitle, limit: 10 }),
      ),
    ).toMatchObject({ items: [{ title: undetectableTitle }] });
    expect(
      await publicCatalog.search(JobSearchQuerySchema.parse({ keyword: secondTitle, limit: 10 })),
    ).toMatchObject({ items: [{ title: secondTitle }] });
    expect(
      await publicCatalog.search(
        JobSearchQuerySchema.parse({ keyword: undetectableTitle, limit: 10 }),
      ),
    ).toMatchObject({ items: [] });

    const session = await createAnonymousSession({ db });
    insightOwner = session.context;
    const insightRequest = {
      scope: { jobFamily: "product" as const, cities: [], companyScaleBands: [] },
      evidenceRevisionId: null,
    };
    const localInsight = await createJobInsightRun({
      db,
      owner: session.context,
      request: insightRequest,
      idempotencyKey: `local-${marker}`,
      enableLocalMvp: true,
    });
    const publicInsight = await createJobInsightRun({
      db,
      owner: session.context,
      request: insightRequest,
      idempotencyKey: `public-${marker}`,
      enableLocalMvp: false,
    });
    expect(localInsight.candidateJobVersionIds).toContain(held.currentVersionId);
    expect(localInsight.candidateJobVersionIds).not.toContain(held.publicVersionId);
    expect(publicInsight.candidateJobVersionIds).toContain(held.publicVersionId);
    expect(publicInsight.candidateJobVersionIds).not.toContain(held.currentVersionId);
    expect((await readLocalBootstrapCatalogStats(db)).publicJobs).toBe(publicJobsBefore + 1);

    // 岗位关闭后公开侧立刻消失，且对账把滞留指针撤回。
    await db
      .insertInto("ingestion.source_job_activity_states")
      .values({
        source_job_record_id: ids.record,
        absence_state: "closed",
        direct_state: "active",
        consecutive_complete_absences: 2,
        last_seen_run_id: null,
        last_absent_run_id: null,
        last_absent_at: new Date(),
        closed_reason: "two_complete_absences",
      })
      .execute();
    const closedPublicInsight = await createJobInsightRun({
      db,
      owner: session.context,
      request: insightRequest,
      idempotencyKey: `public-closed-${marker}`,
      enableLocalMvp: false,
    });
    expect(closedPublicInsight.candidateJobVersionIds).not.toContain(held.publicVersionId);
    expect(await reconcilePublication({ db, publishedJobIds: [materialized.jobId] })).toMatchObject({ revoked: 1 });
    expect((await readPointers(materialized.jobId)).publicVersionId).toBeNull();
    expect((await readLocalBootstrapCatalogStats(db)).publicJobs).toBe(publicJobsBefore);
  }, 45_000);
});
