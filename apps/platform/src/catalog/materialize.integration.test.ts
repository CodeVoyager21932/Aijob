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

describeWithDatabase("catalog company quota selections (ADR-0021)", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");
  const runMarker = randomUUID().slice(0, 8);
  const largeCompany = `配额大厂测试-${runMarker}`;
  const smeCompany = `配额中小测试-${runMarker}`;
  const ids = {
    largeOrganization: randomUUID(),
    largeSource: randomUUID(),
    smeOrganization: randomUUID(),
    smeSource: randomUUID(),
    largeRecords: Array.from({ length: 12 }, () => randomUUID()),
    smeRecords: Array.from({ length: 2 }, () => randomUUID()),
  };

  beforeAll(async () => {
    await migrateToLatest(db);
  });

  afterAll(async () => {
    await db.transaction().execute(async (transaction) => {
      await lockLocalCatalogMaterialization(transaction);
      const recordIds = [...ids.largeRecords, ...ids.smeRecords];
      const revisions = await transaction
        .selectFrom("ingestion.source_job_revisions")
        .select(["id"])
        .where("source_job_record_id", "in", recordIds)
        .execute();
      const revisionIds = revisions.map(({ id }) => id);
      const materialized =
        revisionIds.length > 0
          ? await transaction
              .selectFrom("catalog.published_job_versions as version")
              .innerJoin(
                "catalog.published_job_version_revision_links as link",
                "link.published_job_version_id",
                "version.id",
              )
              .select(["version.id as versionId", "version.published_job_id as jobId"])
              .where("link.source_job_revision_id", "in", revisionIds)
              .execute()
          : [];
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
      if (revisionIds.length > 0) {
        await transaction
          .deleteFrom("ingestion.review_items")
          .where("revision_id", "in", revisionIds)
          .execute();
        await transaction
          .deleteFrom("ingestion.source_job_revisions")
          .where("id", "in", revisionIds)
          .execute();
      }
      await transaction
        .deleteFrom("ingestion.source_job_records")
        .where("id", "in", recordIds)
        .execute();
      await transaction
        .deleteFrom("source_control.source_policy_versions")
        .where("source_id", "in", [ids.largeSource, ids.smeSource])
        .execute();
      await transaction
        .deleteFrom("source_control.sources")
        .where("id", "in", [ids.largeSource, ids.smeSource])
        .execute();
      await transaction
        .deleteFrom("source_control.organizations")
        .where("id", "in", [ids.largeOrganization, ids.smeOrganization])
        .execute();
    });
    await db.destroy();
  });

  it("caps companies without SME evidence at 10 with priority-track jobs first", async () => {
    const baseTime = Date.now() - 120_000;
    await db
      .insertInto("source_control.organizations")
      .values([
        {
          id: ids.largeOrganization,
          slug: `quota-large-${ids.largeOrganization}`,
          name: largeCompany,
          official_domain: "quota-large.example.test",
        },
        {
          id: ids.smeOrganization,
          slug: `quota-sme-${ids.smeOrganization}`,
          name: smeCompany,
          official_domain: "quota-sme.example.test",
          scale_band: "medium",
          scale_evidence_url: "https://quota-sme.example.test/about",
          scale_evidence_text: "合成证据：200-500 人。",
          scale_verified_at: new Date(),
        },
      ])
      .execute();
    await db
      .insertInto("source_control.sources")
      .values([
        {
          id: ids.largeSource,
          organization_id: ids.largeOrganization,
          source_candidate_id: null,
          source_key: `quota-large-${ids.largeSource}`,
          source_type: "organization_career_site",
          name: "Quota Large Test Source",
          current_policy_version: 1,
        },
        {
          id: ids.smeSource,
          organization_id: ids.smeOrganization,
          source_candidate_id: null,
          source_key: `quota-sme-${ids.smeSource}`,
          source_type: "university_employment_site",
          name: "Quota SME Test Source",
          current_policy_version: 1,
        },
      ])
      .execute();
    await db
      .insertInto("source_control.source_policy_versions")
      .values(
        [ids.largeSource, ids.smeSource].map((sourceId) => ({
          source_id: sourceId,
          version: 1,
          policy_status: "pending_review",
          provenance_level: "organization_owned",
          acquisition_mode: "public_api",
          adapter_key: "quota-test",
          adapter_version: "1",
          entrypoints: JSON.stringify(["https://quota.example.test/jobs"]),
          crawl_interval: null,
          policy_notes: "Offline integration fixture.",
          reviewed_at: null,
        })),
      )
      .execute();

    const insertJob = async (input: {
      recordId: string;
      sourceId: string;
      companyName: string;
      title: string;
      family: string | null;
      createdAt: Date;
    }) => {
      await db
        .insertInto("ingestion.source_job_records")
        .values({
          id: input.recordId,
          source_id: input.sourceId,
          source_job_id: `job-${input.recordId}`,
          canonical_source_url: `https://quota.example.test/jobs/${input.recordId}`,
          first_seen_at: input.createdAt,
          last_seen_at: input.createdAt,
        })
        .execute();
      await db
        .insertInto("ingestion.source_job_revisions")
        .values({
          id: randomUUID(),
          source_job_record_id: input.recordId,
          revision_content_hash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
          import_mode: "collector",
          adapter_version: "1",
          normalizer_version: "1",
          company_name: input.companyName,
          title: input.title,
          job_family: JSON.stringify(
            input.family
              ? { state: "known", value: input.family, evidenceRefs: ["quota-test"] }
              : { state: "unknown", reason: "not_yet_verified" },
          ),
          locations: JSON.stringify({
            state: "known",
            value: ["北京"],
            evidenceRefs: ["quota-test"],
          }),
          business_groups: JSON.stringify([]),
          entry_scope: "实习生",
          source_project_name: null,
          recruit_label_name: "实习",
          recruitment_type: JSON.stringify({
            state: "known",
            value: "实习",
            evidenceRefs: ["quota-test"],
          }),
          responsibilities: "Support quota regression checks.",
          requirements: "熟悉 SQL 数据分析。",
          structured_fields: JSON.stringify({}),
          ingestion_state: "validated",
          publication_state: "review",
          activity_state: "active",
          source_url: `https://quota.example.test/jobs/${input.recordId}`,
          apply_url: `https://quota.example.test/jobs/${input.recordId}/apply`,
          quality_flags: JSON.stringify([]),
          created_at: input.createdAt,
        })
        .execute();
    };

    // 大厂：前 6 条为非优先职能、后 6 条为优先轨道，验证择优不是按时间先来先选。
    for (const [index, recordId] of ids.largeRecords.entries()) {
      await insertJob({
        recordId,
        sourceId: ids.largeSource,
        companyName: largeCompany,
        title: `quota-large-${runMarker}-${String(index).padStart(2, "0")}`,
        family: index < 6 ? null : "engineering",
        createdAt: new Date(baseTime + index * 1000),
      });
    }
    for (const [index, recordId] of ids.smeRecords.entries()) {
      await insertJob({
        recordId,
        sourceId: ids.smeSource,
        companyName: smeCompany,
        title: `quota-sme-${runMarker}-${index}`,
        family: "operations",
        createdAt: new Date(baseTime + index * 1000),
      });
    }

    const result = await materializeLocalCatalog(db);
    expect(result.quotaSelectedJobs).toBeGreaterThan(0);

    const selections = await db
      .selectFrom("catalog.company_quota_selections")
      .selectAll()
      .where("company_name", "in", [largeCompany, smeCompany])
      .orderBy("selection_rank")
      .execute();
    const largeRows = selections.filter((row) => row.company_name === largeCompany);
    const smeRows = selections.filter((row) => row.company_name === smeCompany);
    expect(largeRows).toHaveLength(12);
    expect(largeRows.every((row) => row.quota === 10 && row.supply === 12)).toBe(true);
    expect(largeRows.filter((row) => row.selected)).toHaveLength(10);
    expect(smeRows).toHaveLength(2);
    expect(smeRows.every((row) => row.quota === 30 && row.selected)).toBe(true);

    // 优先轨道岗位必须整体排在非优先岗位之前（ADR-0020/0021 择优规则）。
    const largeTitles = await db
      .selectFrom("catalog.company_quota_selections as quota")
      .innerJoin("catalog.published_jobs as job", "job.id", "quota.published_job_id")
      .innerJoin(
        "catalog.published_job_versions as version",
        "version.id",
        "job.current_version_id",
      )
      .select(["quota.selection_rank", "quota.selected", "version.title"])
      .where("quota.company_name", "=", largeCompany)
      .orderBy("quota.selection_rank")
      .execute();
    const prioritySuffixes = largeTitles.slice(0, 6).map((row) => Number(row.title.slice(-2)));
    expect(prioritySuffixes.every((suffix) => suffix >= 6)).toBe(true);
    expect(largeTitles.slice(10).every((row) => !row.selected)).toBe(true);

    const catalog = createCatalogRepository({ db, enableLocalMvp: true });
    const searched = await catalog.search(
      JobSearchQuerySchema.parse({ keyword: `quota-large-${runMarker}`, limit: 20 }),
    );
    expect(searched.items).toHaveLength(10);
    expect(searched.companyQuotaGaps).toContainEqual({
      companyName: largeCompany,
      scaleBand: "unknown",
      quota: 10,
      supply: 12,
      selected: 10,
    });
  }, 30_000);
});
