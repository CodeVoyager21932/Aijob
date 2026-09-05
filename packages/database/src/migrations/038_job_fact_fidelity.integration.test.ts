import { randomUUID } from "node:crypto";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../index.js";
import { migrateToForTesting, migrateToLatest } from "../migrate.js";
import { jobFactFidelityMigration } from "./038_job_fact_fidelity.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const unknown = JSON.stringify({ state: "unknown", reason: "source_not_stated" });

const projectionValues = {
  locations: unknown,
  weekly_attendance_days: unknown,
  duration_months: unknown,
  earliest_start_date: unknown,
  graduation_years: unknown,
  student_status: unknown,
  education_levels: unknown,
  majors: unknown,
  languages: unknown,
};

describeWithDatabase("job fact fidelity migration", () => {
  const databaseName = `aijob_test_job_fact_fidelity_${randomUUID().replaceAll("-", "")}`;
  const organizationId = randomUUID();
  const fixtures = [
    {
      label: "fallback",
      sourceKey: "huice-campus-internships",
      applyUrl: "https://huice.example.test/campus/jobs",
      expectedKind: "official_list_fallback",
    },
    {
      label: "exact",
      sourceKey: `exact-${randomUUID()}`,
      applyUrl: "https://exact.example.test/jobs/1/apply",
      expectedKind: "exact",
    },
    {
      label: "missing",
      sourceKey: `missing-${randomUUID()}`,
      applyUrl: null,
      expectedKind: "missing",
    },
  ].map((fixture) => ({
    ...fixture,
    sourceId: randomUUID(),
    recordId: randomUUID(),
    revisionId: randomUUID(),
    jobId: randomUUID(),
    versionId: randomUUID(),
  }));
  const oldRequirementSetId = randomUUID();
  const secondRequirementSetId = randomUUID();

  let adminDb: Kysely<Database>;
  let db: Kysely<Database>;

  beforeAll(async () => {
    const adminUrl = new URL(databaseUrl as string);
    adminDb = createDatabase(adminUrl.toString());
    await sql.raw(`CREATE DATABASE "${databaseName}"`).execute(adminDb);

    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${databaseName}`;
    db = createDatabase(testUrl.toString());
    await migrateToForTesting(db, "037_student_applicable_supply");

    await db
      .insertInto("source_control.organizations")
      .values({
        id: organizationId,
        slug: `job-fidelity-${organizationId}`,
        name: "Job fidelity fixture",
        official_domain: "fidelity.example.test",
      })
      .execute();

    for (const [index, fixture] of fixtures.entries()) {
      const sourceUrl = `https://${fixture.label}.example.test/jobs/${fixture.recordId}`;
      await db
        .insertInto("source_control.sources")
        .values({
          id: fixture.sourceId,
          organization_id: organizationId,
          source_candidate_id: null,
          source_key: fixture.sourceKey,
          source_type: "organization_career_site",
          name: `Job fidelity ${fixture.label}`,
          current_policy_version: 1,
        })
        .execute();
      await db
        .insertInto("source_control.source_policy_versions")
        .values({
          source_id: fixture.sourceId,
          version: 1,
          policy_status: "pending_review",
          config_registered: true,
          catalog_role: "canonical",
          runtime_scope: "local",
          provenance_level: "organization_owned",
          acquisition_mode: "deterministic_html",
          adapter_key: "job-fidelity-test",
          adapter_version: "1",
          entrypoints: JSON.stringify([sourceUrl]),
          crawl_interval: "24h",
          policy_notes: "Offline migration fixture.",
          reviewed_at: null,
        })
        .execute();
      await db
        .insertInto("source_control.source_runtime_states")
        .values({
          source_id: fixture.sourceId,
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
          id: fixture.recordId,
          source_id: fixture.sourceId,
          source_job_id: `source-job-${fixture.label}`,
          canonical_source_url: sourceUrl,
          first_seen_at: new Date(),
          last_seen_at: new Date(),
        })
        .execute();
      await db
        .insertInto("ingestion.source_job_revisions")
        .values({
          id: fixture.revisionId,
          source_job_record_id: fixture.recordId,
          revision_content_hash: String(index + 1).repeat(64),
          import_mode: "manual",
          adapter_version: "1",
          normalizer_version: "1",
          company_name: "Job fidelity fixture",
          title: `${fixture.label} internship`,
          job_family: unknown,
          locations: unknown,
          business_groups: JSON.stringify([]),
          entry_scope: "internship",
          source_project_name: null,
          recruit_label_name: "internship",
          recruitment_type: unknown,
          responsibilities: "Support product delivery.",
          requirements: "本科在读，每周到岗四天。",
          structured_fields: JSON.stringify({}),
          ingestion_state: "validated",
          publication_state: "review",
          activity_state: "active",
          source_url: sourceUrl,
          apply_url: fixture.applyUrl,
          quality_flags: JSON.stringify([]),
        })
        .execute();
      await db
        .insertInto("catalog.published_jobs")
        .values({ id: fixture.jobId, current_version_id: null })
        .execute();
      await db
        .insertInto("catalog.published_job_versions")
        .values({
          id: fixture.versionId,
          published_job_id: fixture.jobId,
          source_job_revision_id: fixture.revisionId,
          content_hash: String(index + 4).repeat(64),
          company_name: "Job fidelity fixture",
          title: `${fixture.label} internship`,
          job_family: unknown,
          locations: unknown,
          responsibilities: "Support product delivery.",
          requirements: "本科在读，每周到岗四天。",
          structured_fields: JSON.stringify({}),
          activity_state: "active",
          source_url: sourceUrl,
          apply_url: fixture.applyUrl,
          effective_at: new Date(),
        })
        .execute();
      await db
        .insertInto("catalog.published_job_version_revision_links")
        .values({
          published_job_version_id: fixture.versionId,
          source_job_revision_id: fixture.revisionId,
        })
        .execute();
      await db
        .updateTable("catalog.published_jobs")
        .set({ current_version_id: fixture.versionId })
        .where("id", "=", fixture.jobId)
        .executeTakeFirstOrThrow();
    }

    const fallbackVersionId = fixtures[0]?.versionId as string;
    await db
      .insertInto("catalog.job_requirement_sets")
      .values([
        {
          id: oldRequirementSetId,
          published_job_version_id: fallbackVersionId,
          schema_version: "job-requirements-v4",
          requirements: JSON.stringify([]),
          content_hash: "a".repeat(64),
        },
        {
          id: secondRequirementSetId,
          published_job_version_id: fallbackVersionId,
          schema_version: "job-requirements-v5",
          requirements: JSON.stringify([]),
          content_hash: "b".repeat(64),
        },
      ])
      .execute();
    await db
      .insertInto("catalog.job_condition_projections")
      .values({
        published_job_version_id: fallbackVersionId,
        requirement_set_id: oldRequirementSetId,
        ...projectionValues,
      })
      .execute();

    await migrateToLatest(db);
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    if (adminDb) {
      await sql.raw(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).execute(adminDb);
      await adminDb.destroy();
    }
  }, 120_000);

  it("backfills Beisen fallback, exact and missing classifications in both fact tables", async () => {
    const revisionRows = await db
      .selectFrom("ingestion.source_job_revisions")
      .select(["id", "application_link_kind"])
      .where(
        "id",
        "in",
        fixtures.map((fixture) => fixture.revisionId),
      )
      .execute();
    const versionRows = await db
      .selectFrom("catalog.published_job_versions")
      .select(["id", "application_link_kind"])
      .where(
        "id",
        "in",
        fixtures.map((fixture) => fixture.versionId),
      )
      .execute();

    for (const fixture of fixtures) {
      expect(revisionRows.find((row) => row.id === fixture.revisionId)?.application_link_kind).toBe(
        fixture.expectedKind,
      );
      expect(versionRows.find((row) => row.id === fixture.versionId)?.application_link_kind).toBe(
        fixture.expectedKind,
      );
    }
  });

  it("keeps fallback locally eligible while naming the missing exact Alpha handoff", async () => {
    const fallback = fixtures[0] as (typeof fixtures)[number];
    const [current, version] = await Promise.all([
      db
        .selectFrom("catalog.current_job_eligibility")
        .select(["eligible_for_local_mvp", "alpha_blocking_reasons", "application_link_kind"])
        .where("source_id", "=", fallback.sourceId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("catalog.job_version_eligibility")
        .select(["eligible_for_local_mvp", "alpha_blocking_reasons", "application_link_kind"])
        .where("published_job_version_id", "=", fallback.versionId)
        .executeTakeFirstOrThrow(),
    ]);

    for (const row of [current, version]) {
      expect(row.eligible_for_local_mvp).toBe(true);
      expect(row.application_link_kind).toBe("official_list_fallback");
      expect(row.alpha_blocking_reasons).toContain("EXACT_APPLICATION_NOT_AVAILABLE");
    }
  });

  it("defaults legacy requirement source units to an array", async () => {
    const requirementSet = await db
      .selectFrom("catalog.job_requirement_sets")
      .select(["schema_version", "content_hash", "requirements", "source_units"])
      .where("id", "=", oldRequirementSetId)
      .executeTakeFirstOrThrow();
    expect(requirementSet).toMatchObject({
      schema_version: "job-requirements-v4",
      content_hash: "a".repeat(64),
      requirements: [],
      source_units: [],
    });
  });

  it("preserves the old projection and allows a second set for the same version", async () => {
    const fallbackVersionId = (fixtures[0] as (typeof fixtures)[number]).versionId;
    await db
      .insertInto("catalog.job_condition_projections")
      .values({
        published_job_version_id: fallbackVersionId,
        requirement_set_id: secondRequirementSetId,
        ...projectionValues,
      })
      .execute();

    const projections = await db
      .selectFrom("catalog.job_condition_projections")
      .select(["published_job_version_id", "requirement_set_id"])
      .where("published_job_version_id", "=", fallbackVersionId)
      .orderBy("requirement_set_id")
      .execute();
    expect(projections).toHaveLength(2);
    expect(projections.map((row) => row.requirement_set_id)).toEqual(
      [oldRequirementSetId, secondRequirementSetId].sort(),
    );
  });

  it("rejects requirement set updates and deletes", async () => {
    await expect(
      db
        .updateTable("catalog.job_requirement_sets")
        .set({ schema_version: "mutated" })
        .where("id", "=", oldRequirementSetId)
        .execute(),
    ).rejects.toThrow("IMMUTABLE_JOB_REQUIREMENT_SET");
    await expect(
      db.deleteFrom("catalog.job_requirement_sets").where("id", "=", oldRequirementSetId).execute(),
    ).rejects.toThrow("IMMUTABLE_JOB_REQUIREMENT_SET");
  });

  it("accepts same-version requirement upgrades but rejects no-op and malformed events", async () => {
    const versionId = (fixtures[0] as (typeof fixtures)[number]).versionId;
    for (const schemaVersion of ["case-event-v1", "case-event-v2"]) {
      const event = {
        schemaVersion,
        fromPublishedJobVersionId: versionId,
        toPublishedJobVersionId: versionId,
        fromRequirementSetId: oldRequirementSetId,
        toRequirementSetId: secondRequirementSetId,
        reasonCode: "USER_CONFIRMED",
      };
      const valid = async (payload: unknown) => {
        const result = await sql<{ valid: boolean }>`SELECT application.is_valid_case_event_data(
          'job_version_upgraded', ${schemaVersion}, ${JSON.stringify(payload)}::jsonb
        ) AS valid`.execute(db);
        return result.rows[0]?.valid;
      };
      expect(await valid(event)).toBe(true);
      expect(await valid({ ...event, toRequirementSetId: oldRequirementSetId })).toBe(false);
      expect(await valid({ ...event, toRequirementSetId: "invalid" })).toBe(false);
      expect(await valid({ ...event, extra: true })).toBe(false);
      expect(await valid({ ...event, schemaVersion: "invalid" })).toBe(false);
    }
  });

  it("rolls back derived link columns without deleting requirement history", async () => {
    await jobFactFidelityMigration.down?.(db);

    const columns = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE (table_schema, table_name) IN (
        ('ingestion', 'source_job_revisions'),
        ('catalog', 'published_job_versions')
      )
        AND column_name = 'application_link_kind'
    `.execute(db);
    expect(columns.rows).toEqual([]);

    const requirementSets = await db
      .selectFrom("catalog.job_requirement_sets")
      .select(["id", "source_units"])
      .where("id", "in", [oldRequirementSetId, secondRequirementSetId])
      .execute();
    expect(requirementSets).toHaveLength(2);
    expect(requirementSets.every((row) => Array.isArray(row.source_units))).toBe(true);

    const fallbackVersionId = (fixtures[0] as (typeof fixtures)[number]).versionId;
    const projections = await db
      .selectFrom("catalog.job_condition_projections")
      .select("requirement_set_id")
      .where("published_job_version_id", "=", fallbackVersionId)
      .execute();
    expect(projections).toHaveLength(2);
  });
});
