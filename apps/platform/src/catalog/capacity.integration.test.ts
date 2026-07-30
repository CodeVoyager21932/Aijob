import { randomUUID } from "node:crypto";
import type { MatchRunResult } from "@aijob/contracts";
import { JobSearchQuerySchema } from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compareRecommendations } from "../matching/ranking.js";
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
  const db = createDatabase(databaseUrl ?? "postgresql://unused");

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
            provenance_level: "organization_owned",
            acquisition_mode: "public_api",
            adapter_key: "offline-capacity-fixture",
            adapter_version: "1",
            entrypoints: JSON.stringify(["https://capacity.example.test/jobs"]),
            crawl_interval: null,
            policy_notes: "Synthetic offline capacity fixture; never fetched.",
            reviewed_at: null,
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
});
