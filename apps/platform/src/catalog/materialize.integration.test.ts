import { randomUUID } from "node:crypto";
import { JobSearchQuerySchema } from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lockLocalCatalogMaterialization, materializeLocalCatalog } from "./materialize.js";
import { createCatalogRepository } from "./repository.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("catalog materialization revision links", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");
  const ids = {
    organization: randomUUID(),
    source: randomUUID(),
    record: randomUUID(),
    firstRevision: randomUUID(),
    secondRevision: randomUUID(),
  };
  const title = `semantic-link-${randomUUID()}`;
  beforeAll(async () => {
    await migrateToLatest(db);
  });

  afterAll(async () => {
    await db.transaction().execute(async (transaction) => {
      await lockLocalCatalogMaterialization(transaction);
      const materialized = await transaction
        .selectFrom("catalog.published_job_versions as version")
        .innerJoin(
          "catalog.published_job_version_revision_links as link",
          "link.published_job_version_id",
          "version.id",
        )
        .select(["version.id as versionId", "version.published_job_id as jobId"])
        .where("link.source_job_revision_id", "in", [ids.firstRevision, ids.secondRevision])
        .execute();
      const versionIds = [...new Set(materialized.map(({ versionId }) => versionId))];
      const jobIds = [...new Set(materialized.map(({ jobId }) => jobId))];
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
      }
      if (jobIds.length > 0) {
        await transaction
          .updateTable("catalog.published_jobs")
          .set({ current_version_id: null })
          .where("id", "in", jobIds)
          .execute();
        await transaction
          .deleteFrom("catalog.published_job_versions")
          .where("published_job_id", "in", jobIds)
          .execute();
        await transaction.deleteFrom("catalog.published_jobs").where("id", "in", jobIds).execute();
      }
      await transaction
        .deleteFrom("ingestion.review_items")
        .where("revision_id", "in", [ids.firstRevision, ids.secondRevision])
        .execute();
      await transaction
        .deleteFrom("ingestion.source_job_revision_evidence")
        .where("revision_id", "in", [ids.firstRevision, ids.secondRevision])
        .execute();
      await transaction
        .deleteFrom("ingestion.source_job_revisions")
        .where("source_job_record_id", "=", ids.record)
        .execute();
      await transaction
        .deleteFrom("ingestion.source_job_records")
        .where("id", "=", ids.record)
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

  it("reuses one immutable job version while linking an equivalent newer source revision", async () => {
    const firstObservedAt = new Date(Date.now() - 60_000);
    const secondObservedAt = new Date();
    await db
      .insertInto("source_control.organizations")
      .values({
        id: ids.organization,
        slug: `semantic-link-${ids.organization}`,
        name: "Semantic Link Test Company",
        official_domain: "semantic-link.example.test",
      })
      .execute();
    await db
      .insertInto("source_control.sources")
      .values({
        id: ids.source,
        organization_id: ids.organization,
        source_candidate_id: null,
        source_key: `semantic-link-${ids.source}`,
        source_type: "organization_career_site",
        name: "Semantic Link Test Source",
        current_policy_version: 1,
      })
      .execute();
    await db
      .insertInto("source_control.source_policy_versions")
      .values({
        source_id: ids.source,
        version: 1,
        policy_status: "pending_review",
        provenance_level: "organization_owned",
        acquisition_mode: "public_api",
        adapter_key: "semantic-link-test",
        adapter_version: "2",
        entrypoints: JSON.stringify(["https://semantic-link.example.test/jobs"]),
        crawl_interval: null,
        policy_notes: "Offline integration fixture.",
        reviewed_at: null,
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_records")
      .values({
        id: ids.record,
        source_id: ids.source,
        source_job_id: `job-${ids.record}`,
        canonical_source_url: `https://semantic-link.example.test/jobs/${ids.record}`,
        first_seen_at: firstObservedAt,
        last_seen_at: secondObservedAt,
      })
      .execute();

    const revisionValues = (input: {
      id: string;
      adapterVersion: string;
      normalizerVersion: string;
      revisionHash: string;
      createdAt: Date;
    }) => ({
      id: input.id,
      source_job_record_id: ids.record,
      revision_content_hash: input.revisionHash,
      import_mode: "collector",
      adapter_version: input.adapterVersion,
      normalizer_version: input.normalizerVersion,
      company_name: "Semantic Link Test Company",
      title,
      job_family: JSON.stringify({
        state: "known",
        value: "product",
        evidenceRefs: [`${input.id}#job-family`],
      }),
      locations: JSON.stringify({
        state: "known",
        value: ["Beijing"],
        evidenceRefs: [`${input.id}#locations`],
      }),
      business_groups: JSON.stringify([]),
      entry_scope: "internship",
      source_project_name: null,
      recruit_label_name: "internship",
      recruitment_type: JSON.stringify({
        state: "known",
        value: "internship",
        evidenceRefs: [`${input.id}#recruitment-type`],
      }),
      responsibilities: "Support product research and delivery.",
      requirements: "Use SQL for product analysis.",
      structured_fields: JSON.stringify({}),
      ingestion_state: "validated",
      publication_state: "review",
      activity_state: "active",
      source_url: `https://semantic-link.example.test/jobs/${ids.record}`,
      apply_url: `https://semantic-link.example.test/jobs/${ids.record}/apply`,
      quality_flags: JSON.stringify([]),
      created_at: input.createdAt,
    });

    await db
      .insertInto("ingestion.source_job_revisions")
      .values(
        revisionValues({
          id: ids.firstRevision,
          adapterVersion: "1",
          normalizerVersion: "1",
          revisionHash: "1".repeat(64),
          createdAt: firstObservedAt,
        }),
      )
      .execute();
    await materializeLocalCatalog(db);

    const firstMaterialization = await db
      .selectFrom("catalog.published_job_versions as version")
      .innerJoin("catalog.published_jobs as job", "job.id", "version.published_job_id")
      .innerJoin(
        "catalog.published_job_version_revision_links as link",
        "link.published_job_version_id",
        "version.id",
      )
      .select(["job.id as jobId", "version.id as versionId"])
      .where("link.source_job_revision_id", "=", ids.firstRevision)
      .executeTakeFirstOrThrow();
    await db
      .insertInto("ingestion.source_job_revisions")
      .values(
        revisionValues({
          id: ids.secondRevision,
          adapterVersion: "2",
          normalizerVersion: "2",
          revisionHash: "2".repeat(64),
          createdAt: secondObservedAt,
        }),
      )
      .execute();
    await materializeLocalCatalog(db);

    const versions = await db
      .selectFrom("catalog.published_job_versions")
      .select("id")
      .where("published_job_id", "=", firstMaterialization.jobId)
      .execute();
    expect(versions).toEqual([{ id: firstMaterialization.versionId }]);

    const links = await db
      .selectFrom("catalog.published_job_version_revision_links")
      .select(["published_job_version_id", "source_job_revision_id"])
      .where("published_job_version_id", "=", firstMaterialization.versionId)
      .where("source_job_revision_id", "in", [ids.firstRevision, ids.secondRevision])
      .execute();
    expect(new Set(links.map(({ source_job_revision_id }) => source_job_revision_id))).toEqual(
      new Set([ids.firstRevision, ids.secondRevision]),
    );

    const catalog = createCatalogRepository({ db, enableLocalMvp: true });
    const result = await catalog.search(JobSearchQuerySchema.parse({ keyword: title, limit: 10 }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: firstMaterialization.jobId,
      publishedJobVersionId: firstMaterialization.versionId,
    });
  }, 15_000);
});
