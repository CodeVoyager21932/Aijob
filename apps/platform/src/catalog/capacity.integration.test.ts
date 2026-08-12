import { randomUUID } from "node:crypto";
import type { MatchRunResult } from "@aijob/contracts";
import { JobSearchQuerySchema } from "@aijob/contracts";
import { createDatabase, type Database, type JsonValue, migrateToLatest } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession } from "../identity/session-repository.js";
import { enqueueRecommendationRun } from "../matching/service.js";
import { compareRecommendations } from "../matching/ranking.js";
import {
  putJobPreferences,
  putProfileFacts,
  putResumeEvidence,
} from "../profile/revision-repository.js";
import { createCatalogRepository } from "./repository.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const rollbackSignal = new Error("CAPACITY_FIXTURE_ROLLBACK");

const tiedMatchResult: MatchRunResult = {
  eligibility: { status: "no_explicit_conflict", reasons: [] },
  evidence: { status: "partial_evidence", reasons: [] },
  preference: { status: "not_set", reasons: [] },
  coverage: {
    eligibility: { required: 0, evaluated: 0, met: 0, conflicts: 0, unknown: 0 },
    evidence: { applicable: 1, supported: 0, partial: 1, missing: 0, unknown: 0 },
    preference: { configured: 0, compared: 0, conflicts: 0, unknown: 0 },
  },
  basisState: "partial",
  gaps: [],
  unknownRequirementIds: [],
};

describeWithDatabase("single-PostgreSQL 1000-job capacity regression", () => {
  const db: Kysely<Database> = createDatabase(databaseUrl ?? "postgresql://unused");

  beforeAll(async () => {
    await migrateToLatest(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("filters the PG-backed catalog and deterministically ranks 1000 stable IDs", async () => {
    await expect(
      db.transaction().execute(async (transaction) => {
        const organizationId = randomUUID();
        const sourceId = randomUUID();
        const now = new Date();
        const families = [
          "product",
          "operations",
          "engineering",
          "data_ai",
          "design",
          "marketing",
          "sales_business",
          "finance",
          "people_admin_legal",
          "research_consulting",
          "supply_chain_manufacturing",
          "other",
        ] as const;
        const records = Array.from({ length: 1_000 }, (_, index) => ({
          recordId: randomUUID(),
          revisionId: randomUUID(),
          sourceJobId: `capacity-${index.toString().padStart(4, "0")}`,
          family: families[index % families.length] ?? "other",
          index,
        }));

        await transaction
          .insertInto("source_control.organizations")
          .values({
            id: organizationId,
            slug: `capacity-${organizationId}`,
            name: "Capacity Fixture Company",
            official_domain: "capacity.example.test",
          })
          .execute();
        await transaction
          .insertInto("source_control.sources")
          .values({
            id: sourceId,
            organization_id: organizationId,
            source_candidate_id: null,
            source_key: `capacity-${sourceId}`,
            source_type: "organization_career_site",
            name: "Capacity Fixture Source",
            current_policy_version: 1,
          })
          .execute();
        await transaction
          .insertInto("source_control.source_policy_versions")
          .values({
            source_id: sourceId,
            version: 1,
            policy_status: "pending_review",
            config_registered: true,
            catalog_role: "canonical",
            runtime_scope: "local",
            provenance_level: "organization_owned",
            acquisition_mode: "public_api",
            adapter_key: "offline-capacity-fixture",
            adapter_version: "1",
            entrypoints: JSON.stringify(["https://capacity.example.test/jobs"]),
            crawl_interval: "24h",
            policy_notes: "Synthetic offline capacity fixture; never fetched.",
            reviewed_at: null,
          })
          .execute();
        await transaction
          .insertInto("source_control.source_runtime_states")
          .values({
            source_id: sourceId,
            policy_version: 1,
            freshness_state: "fresh",
            last_complete_run_at: now,
            consecutive_failures: 0,
            last_error_code: null,
            next_due_at: null,
          })
          .execute();
        await transaction
          .insertInto("ingestion.source_job_records")
          .values(
            records.map((record) => ({
              id: record.recordId,
              source_id: sourceId,
              source_job_id: record.sourceJobId,
              canonical_source_url: `https://capacity.example.test/jobs/${record.sourceJobId}`,
              first_seen_at: now,
              last_seen_at: now,
            })),
          )
          .execute();

        const unknown = JSON.stringify({ state: "unknown", reason: "source_not_stated" });
        await transaction
          .insertInto("ingestion.source_job_revisions")
          .values(
            records.map((record) => ({
              id: record.revisionId,
              source_job_record_id: record.recordId,
              revision_content_hash: record.index.toString(16).padStart(64, "0"),
              import_mode: "manual",
              adapter_version: "1",
              normalizer_version: "1",
              company_name: "Capacity Fixture Company",
              title: `${record.family} internship ${record.index}`,
              job_family: JSON.stringify({
                state: "known",
                value: record.family,
                evidenceRefs: [`${record.revisionId}#family`],
              }),
              locations: JSON.stringify({
                state: "known",
                value: [record.index % 2 === 0 ? "上海" : "北京"],
                evidenceRefs: [`${record.revisionId}#locations`],
              }),
              business_groups: JSON.stringify([]),
              entry_scope: "实习",
              source_project_name: null,
              recruit_label_name: "实习",
              recruitment_type: JSON.stringify({
                state: "known",
                value: "实习",
                evidenceRefs: [`${record.revisionId}#recruitment-type`],
              }),
              responsibilities: "完成岗位职责。",
              requirements: "在校实习生。",
              structured_fields: JSON.stringify({
                weeklyAttendanceDays: unknown,
                durationMonths: unknown,
              }),
              ingestion_state: "validated",
              publication_state: "review",
              activity_state: "active",
              source_url: `https://capacity.example.test/jobs/${record.sourceJobId}`,
              apply_url: `https://capacity.example.test/jobs/${record.sourceJobId}/apply`,
              quality_flags: JSON.stringify([]),
            })),
          )
          .execute();
        await sql`ANALYZE ingestion.source_job_records, ingestion.source_job_revisions`.execute(
          transaction,
        );

        const repository = createCatalogRepository({ db: transaction, enableLocalMvp: true });
        const companyCatalog = await repository.search(
          JobSearchQuerySchema.parse({ companies: ["Capacity Fixture Company"], limit: 1 }),
        );
        const engineering = await repository.search(
          JobSearchQuerySchema.parse({
            companies: ["Capacity Fixture Company"],
            jobFamilies: ["engineering"],
            limit: 100,
          }),
        );
        expect(engineering.items).toHaveLength(84);
        expect(
          engineering.items.every(
            (item) => item.jobFamily.state === "known" && item.jobFamily.value === "engineering",
          ),
        ).toBe(true);
        expect(
          companyCatalog.facets
            .find((facet) => facet.key === "jobFamily")
            ?.values.filter((value) => families.includes(value.value as (typeof families)[number])),
        ).toHaveLength(12);

        const persistedIds = await transaction
          .selectFrom("ingestion.source_job_revisions")
          .select("id")
          .where(
            "source_job_record_id",
            "in",
            records.map((record) => record.recordId),
          )
          .execute();
        const ranked = persistedIds
          .map(({ id }) => ({
            publishedJobVersionId: id,
            result: tiedMatchResult,
            lastVerifiedAt: now,
          }))
          .sort(compareRecommendations);
        expect(ranked).toHaveLength(1_000);
        expect(ranked.map(({ publishedJobVersionId }) => publishedJobVersionId)).toEqual(
          persistedIds.map(({ id }) => id).sort((left, right) => left.localeCompare(right)),
        );

        throw rollbackSignal;
      }),
    ).rejects.toBe(rollbackSignal);
  }, 30_000);

  it("queues and freezes all 1000 visible candidates from 100 official-source companies", async () => {
    const fixtureKey = randomUUID();
    const now = new Date();
    const organizations = Array.from({ length: 100 }, (_, companyIndex) => ({
      id: randomUUID(),
      slug: `recommendation-capacity-${fixtureKey}-${companyIndex}`,
      name: `Recommendation Capacity ${fixtureKey} ${companyIndex.toString().padStart(3, "0")}`,
      official_domain: `capacity-${companyIndex}.${fixtureKey}.example.test`,
    }));
    const sources = organizations.map((organization, companyIndex) => ({
      id: randomUUID(),
      organization_id: organization.id,
      source_candidate_id: null,
      source_key: `recommendation-capacity-${fixtureKey}-${companyIndex}`,
      source_type: "organization_career_site" as const,
      name: `${organization.name} official careers`,
      current_policy_version: 1,
    }));
    const jobs = Array.from({ length: 1_000 }, (_, index) => {
      const companyIndex = Math.floor(index / 10);
      const organization = organizations[companyIndex] as (typeof organizations)[number];
      const source = sources[companyIndex] as (typeof sources)[number];
      return {
        index,
        organization,
        source,
        recordId: randomUUID(),
        revisionId: randomUUID(),
        publishedJobId: randomUUID(),
        publishedVersionId: randomUUID(),
        requirementSetId: randomUUID(),
        sourceJobId: `recommendation-${fixtureKey}-${index.toString().padStart(4, "0")}`,
      };
    });
    let ownerId: string | null = null;

    try {
      await db.insertInto("source_control.organizations").values(organizations).execute();
      await db.insertInto("source_control.sources").values(sources).execute();
      await db
        .insertInto("source_control.source_policy_versions")
        .values(
          sources.map((source, index) => ({
            source_id: source.id,
            version: 1,
            policy_status: "pending_review" as const,
            config_registered: true,
            catalog_role: "canonical" as const,
            runtime_scope: "local" as const,
            provenance_level: "organization_owned" as const,
            acquisition_mode: "public_api" as const,
            adapter_key: "offline-recommendation-capacity-fixture",
            adapter_version: "1",
            entrypoints: JSON.stringify([
              `https://${organizations[index]?.official_domain}/jobs`,
            ]) as JsonValue,
            crawl_interval: "24h",
            policy_notes: "Synthetic offline capacity fixture; never fetched.",
            reviewed_at: null,
          })),
        )
        .execute();
      await db
        .insertInto("source_control.source_runtime_states")
        .values(
          sources.map((source) => ({
            source_id: source.id,
            policy_version: 1,
            freshness_state: "fresh" as const,
            last_complete_run_at: now,
            consecutive_failures: 0,
            last_error_code: null,
            next_due_at: null,
          })),
        )
        .execute();
      await db
        .insertInto("ingestion.source_job_records")
        .values(
          jobs.map((job) => ({
            id: job.recordId,
            source_id: job.source.id,
            source_job_id: job.sourceJobId,
            canonical_source_url: `https://${job.organization.official_domain}/jobs/${job.sourceJobId}`,
            first_seen_at: now,
            last_seen_at: now,
          })),
        )
        .execute();

      const unknown = JSON.stringify({ state: "unknown", reason: "source_not_stated" });
      await db
        .insertInto("ingestion.source_job_revisions")
        .values(
          jobs.map((job) => ({
            id: job.revisionId,
            source_job_record_id: job.recordId,
            revision_content_hash: job.index.toString(16).padStart(64, "0"),
            import_mode: "manual" as const,
            adapter_version: "1",
            normalizer_version: "1",
            company_name: job.organization.name,
            title: `capacity-e2e-${fixtureKey} internship ${job.index}`,
            job_family: JSON.stringify({
              state: "known",
              value: job.index % 2 === 0 ? "engineering" : "data_ai",
              evidenceRefs: [`${job.revisionId}#family`],
            }),
            locations: JSON.stringify({
              state: "known",
              value: [job.index % 2 === 0 ? "上海" : "北京"],
              evidenceRefs: [`${job.revisionId}#locations`],
            }),
            business_groups: JSON.stringify([]),
            entry_scope: "internship",
            source_project_name: null,
            recruit_label_name: "实习",
            recruitment_type: JSON.stringify({
              state: "known",
              value: "internship",
              evidenceRefs: [`${job.revisionId}#recruitment-type`],
            }),
            responsibilities: "完成容量验证岗位职责。",
            requirements: "在校实习生，能够完成容量验证任务。",
            structured_fields: JSON.stringify({}),
            ingestion_state: "validated" as const,
            publication_state: "review" as const,
            activity_state: "active" as const,
            source_url: `https://${job.organization.official_domain}/jobs/${job.sourceJobId}`,
            apply_url: `https://${job.organization.official_domain}/jobs/${job.sourceJobId}/apply`,
            quality_flags: JSON.stringify([]),
          })),
        )
        .execute();
      await db
        .insertInto("catalog.published_jobs")
        .values(jobs.map((job) => ({ id: job.publishedJobId, current_version_id: null })))
        .execute();
      await db
        .insertInto("catalog.published_job_versions")
        .values(
          jobs.map((job) => ({
            id: job.publishedVersionId,
            published_job_id: job.publishedJobId,
            source_job_revision_id: job.revisionId,
            content_hash: (job.index + 1_000).toString(16).padStart(64, "0"),
            company_name: job.organization.name,
            title: `capacity-e2e-${fixtureKey} internship ${job.index}`,
            job_family: JSON.stringify({
              state: "known",
              value: job.index % 2 === 0 ? "engineering" : "data_ai",
              evidenceRefs: [`${job.revisionId}#family`],
            }),
            locations: JSON.stringify({
              state: "known",
              value: [job.index % 2 === 0 ? "上海" : "北京"],
              evidenceRefs: [`${job.revisionId}#locations`],
            }),
            department: unknown,
            job_code: JSON.stringify({
              state: "known",
              value: job.sourceJobId,
              evidenceRefs: [`${job.revisionId}#code`],
            }),
            recruitment_type: JSON.stringify({
              state: "known",
              value: "internship",
              evidenceRefs: [`${job.revisionId}#type`],
            }),
            employment_type: JSON.stringify({
              state: "known",
              value: "internship",
              evidenceRefs: [`${job.revisionId}#employment`],
            }),
            recruitment_batch: unknown,
            weekly_attendance_days: unknown,
            duration_months: unknown,
            earliest_start_date: unknown,
            graduation_years: unknown,
            education_levels: unknown,
            majors: unknown,
            languages: unknown,
            salary: unknown,
            work_mode: unknown,
            posted_at: unknown,
            deadline_at: unknown,
            responsibilities: "完成容量验证岗位职责。",
            requirements: "在校实习生，能够完成容量验证任务。",
            structured_fields: JSON.stringify({}),
            activity_state: "active" as const,
            source_url: `https://${job.organization.official_domain}/jobs/${job.sourceJobId}`,
            apply_url: `https://${job.organization.official_domain}/jobs/${job.sourceJobId}/apply`,
            effective_at: now,
          })),
        )
        .execute();
      await db
        .insertInto("catalog.published_job_version_revision_links")
        .values(
          jobs.map((job) => ({
            published_job_version_id: job.publishedVersionId,
            source_job_revision_id: job.revisionId,
          })),
        )
        .execute();
      await db
        .insertInto("catalog.job_requirement_sets")
        .values(
          jobs.map((job) => ({
            id: job.requirementSetId,
            published_job_version_id: job.publishedVersionId,
            schema_version: "capacity-v1",
            requirements: JSON.stringify([]),
            content_hash: (job.index + 2_000).toString(16).padStart(64, "0"),
          })),
        )
        .execute();
      await db
        .insertInto("catalog.job_condition_projections")
        .values(
          jobs.map((job) => ({
            published_job_version_id: job.publishedVersionId,
            requirement_set_id: job.requirementSetId,
            locations: JSON.stringify({
              state: "known",
              value: [job.index % 2 === 0 ? "上海" : "北京"],
              evidenceRefs: [`${job.requirementSetId}#city`],
            }),
            weekly_attendance_days: unknown,
            duration_months: unknown,
            earliest_start_date: unknown,
            graduation_years: unknown,
            student_status: unknown,
            education_levels: unknown,
            majors: unknown,
            languages: unknown,
          })),
        )
        .execute();

      const pointerRows = JSON.stringify(
        jobs.map((job) => ({
          published_job_id: job.publishedJobId,
          published_version_id: job.publishedVersionId,
          requirement_set_id: job.requirementSetId,
        })),
      );
      await sql`
        UPDATE catalog.published_job_versions AS version
        SET active_requirement_set_id = fixture.requirement_set_id::uuid
        FROM jsonb_to_recordset(${pointerRows}::jsonb) AS fixture(
          published_version_id text,
          requirement_set_id text
        )
        WHERE version.id = fixture.published_version_id::uuid
      `.execute(db);
      await sql`
        UPDATE catalog.published_jobs AS job
        SET current_version_id = fixture.published_version_id::uuid
        FROM jsonb_to_recordset(${pointerRows}::jsonb) AS fixture(
          published_job_id text,
          published_version_id text
        )
        WHERE job.id = fixture.published_job_id::uuid
      `.execute(db);
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

      const repository = createCatalogRepository({ db, enableLocalMvp: true });
      const catalogItems = [];
      let cursor: string | undefined;
      do {
        const page = await repository.search(
          JobSearchQuerySchema.parse({ keyword: `capacity-e2e-${fixtureKey}`, limit: 100, cursor }),
        );
        catalogItems.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(catalogItems).toHaveLength(1_000);
      expect(catalogItems.every((item) => item.publishedJobVersionId !== null)).toBe(true);

      const session = await createAnonymousSession({ db });
      ownerId = session.context.ownerId;
      const facts = await putProfileFacts({
        db,
        owner: session.context,
        expectedRevision: 0,
        facts: [{ key: "current_student", value: true }],
      });
      const preferences = await putJobPreferences({
        db,
        owner: session.context,
        expectedRevision: 0,
        preferences: { cities: [], jobFamilies: [], companyNames: [], workModes: [] },
      });
      const evidence = await putResumeEvidence({
        db,
        owner: session.context,
        expectedRevision: 0,
        resumeAnalysisId: null,
        document: {
          schemaVersion: "resume-document-v1",
          sections: [
            {
              id: randomUUID(),
              ordinal: 0,
              title: "容量验证",
              blocks: [
                {
                  id: randomUUID(),
                  ordinal: 0,
                  text: "用于验证一千条岗位推荐候选链路。",
                },
              ],
            },
          ],
        },
        evidence: [],
      });
      const request = {
        profileFactRevisionId: facts.id,
        preferenceRevisionId: preferences.id,
        evidenceRevisionId: evidence.id,
        candidateJobVersionIds: catalogItems.map((item) => item.publishedJobVersionId as string),
      };
      const [created, replay] = await Promise.all([
        enqueueRecommendationRun(db, session.context, request, `capacity-${fixtureKey}`, {
          enableLocalMvp: true,
        }),
        enqueueRecommendationRun(db, session.context, request, `capacity-${fixtureKey}`, {
          enableLocalMvp: true,
        }),
      ]);
      expect(replay.id).toBe(created.id);
      expect(created.catalogState).toBe("current");

      const stored = await db
        .selectFrom("matching.recommendation_runs")
        .select([
          "candidate_job_version_ids",
          "candidate_freshness_snapshots",
          "candidate_requirement_set_ids",
        ])
        .where("id", "=", created.id)
        .executeTakeFirstOrThrow();
      const arrays = [
        stored.candidate_job_version_ids,
        stored.candidate_freshness_snapshots,
        stored.candidate_requirement_set_ids,
      ].map((value) => (typeof value === "string" ? JSON.parse(value) : value));
      expect(arrays[0]).toHaveLength(1_000);
      expect(arrays[1]).toHaveLength(1_000);
      expect(arrays[2]).toHaveLength(1_000);
      expect(new Set((arrays[0] as string[]).map((candidateId) => candidateId)).size).toBe(1_000);
      const queuedTasks = await db
        .selectFrom("task_queue.tasks")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("owner_id", "=", ownerId)
        .where("task_type", "=", "recommendation_run")
        .executeTakeFirstOrThrow();
      expect(Number(queuedTasks.count)).toBe(1);
    } finally {
      if (ownerId) {
        await db.deleteFrom("task_queue.tasks").where("owner_id", "=", ownerId).execute();
        await db
          .deleteFrom("matching.recommendation_items")
          .where("owner_id", "=", ownerId)
          .execute();
        await db.deleteFrom("matching.match_runs").where("owner_id", "=", ownerId).execute();
        await db
          .deleteFrom("matching.recommendation_runs")
          .where("owner_id", "=", ownerId)
          .execute();
        await db
          .deleteFrom("profile.resume_evidence_revisions")
          .where("owner_id", "=", ownerId)
          .execute();
        await db
          .deleteFrom("profile.resume_document_revisions")
          .where("owner_id", "=", ownerId)
          .execute();
        await db
          .deleteFrom("profile.job_preference_revisions")
          .where("owner_id", "=", ownerId)
          .execute();
        await db
          .deleteFrom("profile.profile_fact_revisions")
          .where("owner_id", "=", ownerId)
          .execute();
        await db.deleteFrom("identity.owner_sessions").where("owner_id", "=", ownerId).execute();
        await db.deleteFrom("identity.owners").where("id", "=", ownerId).execute();
      }

      const publishedJobIds = jobs.map((job) => job.publishedJobId);
      const versionIds = jobs.map((job) => job.publishedVersionId);
      const revisionIds = jobs.map((job) => job.revisionId);
      const recordIds = jobs.map((job) => job.recordId);
      await db
        .updateTable("catalog.published_job_versions")
        .set({ active_requirement_set_id: null })
        .where("id", "in", versionIds)
        .execute();
      await db
        .deleteFrom("catalog.job_condition_projections")
        .where("published_job_version_id", "in", versionIds)
        .execute();
      await db
        .deleteFrom("catalog.job_requirement_sets")
        .where("published_job_version_id", "in", versionIds)
        .execute();
      await db
        .updateTable("catalog.published_jobs")
        .set({ current_version_id: null, public_version_id: null })
        .where("id", "in", publishedJobIds)
        .execute();
      await db
        .deleteFrom("catalog.published_job_version_revision_links")
        .where("published_job_version_id", "in", versionIds)
        .execute();
      await db.deleteFrom("catalog.published_job_versions").where("id", "in", versionIds).execute();
      await db.deleteFrom("catalog.published_jobs").where("id", "in", publishedJobIds).execute();
      await db
        .deleteFrom("ingestion.review_items")
        .where("revision_id", "in", revisionIds)
        .execute();
      await db
        .deleteFrom("ingestion.source_job_revision_evidence")
        .where("revision_id", "in", revisionIds)
        .execute();
      await db
        .deleteFrom("ingestion.source_job_revisions")
        .where("id", "in", revisionIds)
        .execute();
      await db.deleteFrom("ingestion.source_job_records").where("id", "in", recordIds).execute();
      await db
        .deleteFrom("source_control.source_runtime_states")
        .where(
          "source_id",
          "in",
          sources.map((source) => source.id),
        )
        .execute();
      await db
        .deleteFrom("source_control.source_policy_versions")
        .where(
          "source_id",
          "in",
          sources.map((source) => source.id),
        )
        .execute();
      await db
        .deleteFrom("source_control.sources")
        .where(
          "id",
          "in",
          sources.map((source) => source.id),
        )
        .execute();
      await db
        .deleteFrom("source_control.organizations")
        .where(
          "id",
          "in",
          organizations.map((organization) => organization.id),
        )
        .execute();
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
    }
  }, 120_000);
});
