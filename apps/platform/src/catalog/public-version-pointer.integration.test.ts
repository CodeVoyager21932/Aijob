import { randomUUID } from "node:crypto";
import { JobSearchQuerySchema } from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession, type OwnerContext } from "../identity/session-repository.js";
import { createJobInsightRun } from "../insights/service.js";
import { readLocalBootstrapCatalogStats } from "../local-bootstrap.js";
import { lockLocalCatalogMaterialization, materializeLocalCatalog } from "./materialize.js";
import { createCatalogRepository } from "./repository.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("catalog public version pointer", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");
  const ids = {
    organization: randomUUID(),
    source: randomUUID(),
    record: randomUUID(),
    publishedRevision: randomUUID(),
    reviewRevision: randomUUID(),
  };
  const marker = randomUUID().slice(0, 8);
  const publishedTitle = `published-${marker}`;
  const reviewTitle = `review-${marker}`;
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
        .where("link.source_job_revision_id", "in", [ids.publishedRevision, ids.reviewRevision])
        .execute();
      const jobIds = [...new Set(jobs.map(({ jobId }) => jobId))];
      const versionIds = [...new Set(jobs.map(({ versionId }) => versionId))];
      if (jobIds.length > 0) {
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
        .where("id", "in", [ids.publishedRevision, ids.reviewRevision])
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

  it("keeps the last published version public while local preview advances", async () => {
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
      publicationState: "review" | "published";
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
      responsibilities: `Responsibilities for ${input.title}.`,
      requirements: "Current student with product research experience.",
      structured_fields: JSON.stringify({}),
      ingestion_state: "validated",
      publication_state: input.publicationState,
      activity_state: "active",
      source_url: `https://public-pointer.example.test/jobs/${ids.record}`,
      apply_url: `https://public-pointer.example.test/jobs/${ids.record}/apply`,
      quality_flags: JSON.stringify([]),
      created_at: input.createdAt,
    });

    await db
      .insertInto("ingestion.source_job_revisions")
      .values(
        revision({
          id: ids.publishedRevision,
          title: publishedTitle,
          publicationState: "published",
          hashCharacter: "1",
          createdAt: firstObservedAt,
        }),
      )
      .execute();
    await materializeLocalCatalog(db);

    const initial = await db
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
      .where("version.source_job_revision_id", "=", ids.publishedRevision)
      .executeTakeFirstOrThrow();
    expect(initial.publicVersionId).toBe(initial.currentVersionId);

    await db
      .insertInto("ingestion.source_job_revisions")
      .values(
        revision({
          id: ids.reviewRevision,
          title: reviewTitle,
          publicationState: "review",
          hashCharacter: "2",
          createdAt: new Date(),
        }),
      )
      .execute();
    await materializeLocalCatalog(db);

    const advanced = await db
      .selectFrom("catalog.published_jobs")
      .select(["current_version_id as currentVersionId", "public_version_id as publicVersionId"])
      .where("id", "=", initial.jobId)
      .executeTakeFirstOrThrow();
    expect(advanced.currentVersionId).not.toBe(initial.currentVersionId);
    expect(advanced.publicVersionId).toBe(initial.publicVersionId);

    const localCatalog = createCatalogRepository({ db, enableLocalMvp: true });
    const publicCatalog = createCatalogRepository({ db, enableLocalMvp: false });
    expect(
      await localCatalog.search(JobSearchQuerySchema.parse({ keyword: reviewTitle, limit: 10 })),
    ).toMatchObject({ items: [{ title: reviewTitle }] });
    expect(
      await publicCatalog.search(
        JobSearchQuerySchema.parse({ keyword: publishedTitle, limit: 10 }),
      ),
    ).toMatchObject({ items: [{ title: publishedTitle }] });
    expect(
      await publicCatalog.search(JobSearchQuerySchema.parse({ keyword: reviewTitle, limit: 10 })),
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
    expect(localInsight.candidateJobVersionIds).toContain(advanced.currentVersionId);
    expect(localInsight.candidateJobVersionIds).not.toContain(advanced.publicVersionId);
    expect(publicInsight.candidateJobVersionIds).toContain(advanced.publicVersionId);
    expect(publicInsight.candidateJobVersionIds).not.toContain(advanced.currentVersionId);
    expect((await readLocalBootstrapCatalogStats(db)).publicJobs).toBe(publicJobsBefore + 1);

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
    expect(closedPublicInsight.candidateJobVersionIds).not.toContain(advanced.publicVersionId);
    expect((await readLocalBootstrapCatalogStats(db)).publicJobs).toBe(publicJobsBefore);
  }, 30_000);
});
