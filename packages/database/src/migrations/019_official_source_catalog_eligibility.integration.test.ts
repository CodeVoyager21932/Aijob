import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../index.js";
import { migrateToLatest } from "../migrate.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("official source catalog eligibility migration", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");

  beforeAll(async () => {
    await migrateToLatest(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("fails closed for discovery, test, stale and blocking-review records", async () => {
    const organizationId = randomUUID();
    const cases = [
      {
        key: "canonical",
        catalogRole: "canonical",
        runtimeScope: "local",
        provenanceLevel: "organization_owned",
        freshnessState: "fresh",
        configRegistered: true,
        lastSeenAt: new Date(),
        reviewReason: null,
        expectedBlockers: [],
      },
      {
        key: "discovery",
        catalogRole: "discovery_only",
        runtimeScope: "local",
        provenanceLevel: "university_published",
        freshnessState: "fresh",
        configRegistered: true,
        lastSeenAt: new Date(),
        reviewReason: null,
        expectedBlockers: ["NON_CANONICAL_SOURCE"],
      },
      {
        key: "runtime-test",
        catalogRole: "canonical",
        runtimeScope: "test",
        provenanceLevel: "organization_owned",
        freshnessState: "fresh",
        configRegistered: true,
        lastSeenAt: new Date(),
        reviewReason: null,
        expectedBlockers: ["TEST_RUNTIME_SCOPE"],
      },
      {
        key: "stale",
        catalogRole: "canonical",
        runtimeScope: "local",
        provenanceLevel: "organization_owned",
        freshnessState: "stale",
        configRegistered: true,
        lastSeenAt: new Date(),
        reviewReason: null,
        expectedBlockers: ["SOURCE_NOT_FRESH"],
      },
      {
        key: "blocking-review",
        catalogRole: "canonical",
        runtimeScope: "local",
        provenanceLevel: "organization_owned",
        freshnessState: "fresh",
        configRegistered: true,
        lastSeenAt: new Date(),
        reviewReason: "SOURCE_KIND_CONFLICT",
        expectedBlockers: ["BLOCKING_REVIEW_OPEN"],
      },
      {
        key: "unregistered",
        catalogRole: "canonical",
        runtimeScope: "local",
        provenanceLevel: "organization_owned",
        freshnessState: "fresh",
        configRegistered: false,
        lastSeenAt: new Date(),
        reviewReason: null,
        expectedBlockers: ["SOURCE_CONFIG_NOT_REGISTERED"],
      },
      {
        key: "job-stale",
        catalogRole: "canonical",
        runtimeScope: "local",
        provenanceLevel: "organization_owned",
        freshnessState: "fresh",
        configRegistered: true,
        lastSeenAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        reviewReason: null,
        expectedBlockers: ["JOB_NOT_RECENTLY_VERIFIED"],
      },
    ].map((fixtureCase) => ({
      ...fixtureCase,
      sourceId: randomUUID(),
      recordId: randomUUID(),
      revisionId: randomUUID(),
      jobId: randomUUID(),
      versionId: randomUUID(),
    }));

    try {
      await db
        .insertInto("source_control.organizations")
        .values({
          id: organizationId,
          slug: `eligibility-${organizationId}`,
          name: "Eligibility Test Company",
          official_domain: "eligibility.example.test",
        })
        .execute();

      for (const [index, fixtureCase] of cases.entries()) {
        const sourceKey = `eligibility-${fixtureCase.key}-${fixtureCase.sourceId}`;
        const sourceUrl = `https://eligibility.example.test/jobs/${fixtureCase.recordId}`;
        await db
          .insertInto("source_control.sources")
          .values({
            id: fixtureCase.sourceId,
            organization_id: organizationId,
            source_candidate_id: null,
            source_key: sourceKey,
            source_type:
              fixtureCase.catalogRole === "discovery_only"
                ? "university_employment_site"
                : "organization_career_site",
            name: `Eligibility ${fixtureCase.key}`,
            current_policy_version: 1,
          })
          .execute();
        await db
          .insertInto("source_control.source_policy_versions")
          .values({
            source_id: fixtureCase.sourceId,
            version: 1,
            policy_status: "pending_review",
            config_registered: fixtureCase.configRegistered,
            catalog_role: fixtureCase.catalogRole,
            runtime_scope: fixtureCase.runtimeScope,
            provenance_level: fixtureCase.provenanceLevel,
            acquisition_mode: "deterministic_html",
            adapter_key: "eligibility-test",
            adapter_version: "1",
            entrypoints: JSON.stringify([sourceUrl]),
            crawl_interval: "24h",
            policy_notes: "Offline eligibility migration fixture.",
            reviewed_at: null,
          })
          .execute();
        await db
          .insertInto("source_control.source_runtime_states")
          .values({
            source_id: fixtureCase.sourceId,
            policy_version: 1,
            freshness_state: fixtureCase.freshnessState,
            last_complete_run_at: new Date(),
            consecutive_failures: 0,
            last_error_code: null,
            next_due_at: null,
          })
          .execute();
        await db
          .insertInto("ingestion.source_job_records")
          .values({
            id: fixtureCase.recordId,
            source_id: fixtureCase.sourceId,
            source_job_id: `job-${fixtureCase.recordId}`,
            canonical_source_url: sourceUrl,
            first_seen_at: new Date(),
            last_seen_at: fixtureCase.lastSeenAt,
          })
          .execute();
        await db
          .insertInto("ingestion.source_job_revisions")
          .values({
            id: fixtureCase.revisionId,
            source_job_record_id: fixtureCase.recordId,
            revision_content_hash: String(index + 1).repeat(64),
            import_mode: "manual",
            adapter_version: "1",
            normalizer_version: "1",
            company_name: "Eligibility Test Company",
            title: `Eligibility ${fixtureCase.key} internship`,
            job_family: JSON.stringify({ state: "known", value: "product", evidenceRefs: [] }),
            locations: JSON.stringify({ state: "known", value: ["Shanghai"], evidenceRefs: [] }),
            business_groups: JSON.stringify([]),
            entry_scope: "internship",
            source_project_name: null,
            recruit_label_name: "internship",
            recruitment_type: JSON.stringify({
              state: "known",
              value: "internship",
              evidenceRefs: [],
            }),
            responsibilities: "Support product research and delivery.",
            requirements: "Current student with product analysis skills.",
            structured_fields: JSON.stringify({}),
            ingestion_state: "validated",
            publication_state: "review",
            activity_state: "active",
            source_url: sourceUrl,
            apply_url: `${sourceUrl}/apply`,
            quality_flags: JSON.stringify([]),
          })
          .execute();
        await db
          .insertInto("catalog.published_jobs")
          .values({ id: fixtureCase.jobId, current_version_id: null })
          .execute();
        await db
          .insertInto("catalog.published_job_versions")
          .values({
            id: fixtureCase.versionId,
            published_job_id: fixtureCase.jobId,
            source_job_revision_id: fixtureCase.revisionId,
            content_hash: String(index + 1).repeat(64),
            company_name: "Eligibility Test Company",
            title: `Eligibility ${fixtureCase.key} internship`,
            job_family: JSON.stringify({ state: "known", value: "product", evidenceRefs: [] }),
            locations: JSON.stringify({ state: "known", value: ["Shanghai"], evidenceRefs: [] }),
            responsibilities: "Support product research and delivery.",
            requirements: "Current student with product analysis skills.",
            structured_fields: JSON.stringify({}),
            activity_state: "active",
            source_url: sourceUrl,
            apply_url: `${sourceUrl}/apply`,
            effective_at: new Date(),
          })
          .execute();
        await db
          .insertInto("catalog.published_job_version_revision_links")
          .values({
            published_job_version_id: fixtureCase.versionId,
            source_job_revision_id: fixtureCase.revisionId,
          })
          .execute();
        await db
          .updateTable("catalog.published_jobs")
          .set({ current_version_id: fixtureCase.versionId })
          .where("id", "=", fixtureCase.jobId)
          .executeTakeFirstOrThrow();
        if (fixtureCase.reviewReason) {
          await db
            .insertInto("ingestion.review_items")
            .values({
              id: randomUUID(),
              revision_id: fixtureCase.revisionId,
              reason_code: fixtureCase.reviewReason,
              status: "open",
              details: JSON.stringify({ fixture: true }),
              resolved_at: null,
            })
            .execute();
        }
      }

      const currentRows = await db
        .selectFrom("catalog.current_job_eligibility")
        .select(["source_id", "eligible_for_local_mvp", "blocking_reasons"])
        .where(
          "source_id",
          "in",
          cases.map((fixtureCase) => fixtureCase.sourceId),
        )
        .execute();
      const versionRows = await db
        .selectFrom("catalog.job_version_eligibility")
        .select(["source_id", "eligible_for_local_mvp", "blocking_reasons"])
        .where(
          "source_id",
          "in",
          cases.map((fixtureCase) => fixtureCase.sourceId),
        )
        .execute();

      for (const fixtureCase of cases) {
        const expected = {
          eligible_for_local_mvp: fixtureCase.expectedBlockers.length === 0,
          blocking_reasons: fixtureCase.expectedBlockers,
        };
        expect(currentRows.find((row) => row.source_id === fixtureCase.sourceId)).toMatchObject(
          expected,
        );
        expect(versionRows.find((row) => row.source_id === fixtureCase.sourceId)).toMatchObject(
          expected,
        );
      }
    } finally {
      const sourceIds = cases.map((fixtureCase) => fixtureCase.sourceId);
      const revisionIds = cases.map((fixtureCase) => fixtureCase.revisionId);
      const jobIds = cases.map((fixtureCase) => fixtureCase.jobId);
      await db.deleteFrom("ingestion.review_items").where("revision_id", "in", revisionIds).execute();
      await db
        .updateTable("catalog.published_jobs")
        .set({ current_version_id: null })
        .where("id", "in", jobIds)
        .execute();
      await db
        .deleteFrom("catalog.published_job_version_revision_links")
        .where("source_job_revision_id", "in", revisionIds)
        .execute();
      await db
        .deleteFrom("catalog.published_job_versions")
        .where("published_job_id", "in", jobIds)
        .execute();
      await db.deleteFrom("catalog.published_jobs").where("id", "in", jobIds).execute();
      await db
        .deleteFrom("ingestion.source_job_revisions")
        .where("id", "in", revisionIds)
        .execute();
      await db
        .deleteFrom("ingestion.source_job_records")
        .where(
          "id",
          "in",
          cases.map((fixtureCase) => fixtureCase.recordId),
        )
        .execute();
      await db
        .deleteFrom("source_control.source_runtime_states")
        .where("source_id", "in", sourceIds)
        .execute();
      await db
        .deleteFrom("source_control.source_policy_versions")
        .where("source_id", "in", sourceIds)
        .execute();
      await db.deleteFrom("source_control.sources").where("id", "in", sourceIds).execute();
      await db
        .deleteFrom("source_control.organizations")
        .where("id", "=", organizationId)
        .execute();
    }
  });
});
