import { randomUUID } from "node:crypto";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lockLocalCatalogMaterialization, materializeLocalCatalog } from "./materialize.js";
import {
  reconcilePublication,
  releaseJobPublicationSuppression,
  suppressJobPublication,
} from "./publication-reconciliation.js";

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
        await transaction
          .deleteFrom("catalog.job_requirement_sets")
          .where(
            "published_job_version_id",
            "in",
            transaction
              .selectFrom("catalog.published_job_versions")
              .select("id")
              .where("published_job_id", "=", fixture.publishedJobId),
          )
          .execute();
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
          .deleteFrom("source_control.source_policy_versions")
          .where("source_id", "=", fixture.sourceId)
          .execute();
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
  async function provisionPublishedJob(label: string): Promise<Fixture> {
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
        title: `Reconcile ${label} Internship`,
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
        requirements: "Current student with product research experience.",
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

    expect(await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] })).toMatchObject({ revoked: 1 });
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

    expect(await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] })).toMatchObject({ revoked: 1 });
    expect(await readPointer(fixture.publishedJobId)).toBeNull();
    expect((await latestEvent(fixture.publishedJobId)).blocking_reasons).toContain(
      "SOURCE_NOT_FRESH",
    );
  });

  it("revokes the pointer when responsibilities become empty", async () => {
    const fixture = await provisionPublishedJob("empty");
    await db
      .updateTable("catalog.published_job_versions")
      .set({ responsibilities: "" })
      .where("id", "=", fixture.publishedJobVersionId)
      .execute();

    expect(await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] })).toMatchObject({ revoked: 1 });
    expect(await readPointer(fixture.publishedJobId)).toBeNull();
    expect((await latestEvent(fixture.publishedJobId)).blocking_reasons).toContain(
      "RESPONSIBILITIES_MISSING",
    );
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

    expect(await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] })).toMatchObject({ revoked: 1 });
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
    expect(await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] })).toMatchObject({ published: 0, advanced: 0 });
    expect(await readPointer(fixture.publishedJobId)).toBeNull();

    expect(
      await releaseJobPublicationSuppression({ db, publishedJobId: fixture.publishedJobId }),
    ).toEqual({ released: true });
    // 解除本身不发布，重新发布仍由对账按资格判定。
    expect(await readPointer(fixture.publishedJobId)).toBeNull();
    expect(await reconcilePublication({ db, publishedJobIds: [fixture.publishedJobId] })).toMatchObject({ published: 1 });
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
});
