import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../index.js";
import { migrateToForTesting, migrateToLatest } from "../migrate.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/**
 * ADR-0034 第一、二条的数据库侧验证：
 *
 * - `eligible_for_alpha` 不再要求修订已是 `published`。这一条是解除死锁的关键：适配器恒产出
 *   `review`，旧口径下公开供给恒为 0，与门槛严格程度无关。
 * - 强制下架直接进入 `eligible_for_alpha`，因此对全部公开读取路径立即生效。
 * - `PUBLICATION_NOT_REVIEWABLE` 未被放宽，`draft`/`suppressed`/`archived` 修订仍被挡住。
 * - 迁移可回滚，回滚后重新出现 `publication_state = 'published'` 条件。
 */
describeWithDatabase("reconciled publication migration", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");
  const ids = {
    organization: randomUUID(),
    source: randomUUID(),
    record: randomUUID(),
    revision: randomUUID(),
    publishedJob: randomUUID(),
    publishedVersion: randomUUID(),
  };

  beforeAll(async () => {
    await migrateToLatest(db);
  });

  afterAll(async () => {
    await migrateToLatest(db);
    await db
      .deleteFrom("catalog.publication_events")
      .where("published_job_id", "=", ids.publishedJob)
      .execute();
    await db
      .updateTable("catalog.published_jobs")
      .set({ current_version_id: null, public_version_id: null })
      .where("id", "=", ids.publishedJob)
      .execute();
    await db
      .deleteFrom("catalog.published_job_versions")
      .where("id", "=", ids.publishedVersion)
      .execute();
    await db.deleteFrom("catalog.published_jobs").where("id", "=", ids.publishedJob).execute();
    await db.deleteFrom("ingestion.source_job_revisions").where("id", "=", ids.revision).execute();
    await db.deleteFrom("ingestion.source_job_records").where("id", "=", ids.record).execute();
    await db
      .deleteFrom("source_control.source_runtime_states")
      .where("source_id", "=", ids.source)
      .execute();
    await db
      .deleteFrom("source_control.source_policy_versions")
      .where("source_id", "=", ids.source)
      .execute();
    await db.deleteFrom("source_control.sources").where("id", "=", ids.source).execute();
    await db
      .deleteFrom("source_control.organizations")
      .where("id", "=", ids.organization)
      .execute();
    await db.destroy();
  });

  async function seedEligibleVersion(): Promise<void> {
    await db
      .insertInto("source_control.organizations")
      .values({
        id: ids.organization,
        slug: `migration-035-${ids.organization}`,
        name: "Migration 035 Company",
        official_domain: "migration-035.example.test",
      })
      .execute();
    await db
      .insertInto("source_control.sources")
      .values({
        id: ids.source,
        organization_id: ids.organization,
        source_candidate_id: null,
        source_key: `migration-035-${ids.source}`,
        source_type: "organization_career_site",
        name: "Migration 035 Source",
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
        adapter_key: "migration-035-test",
        adapter_version: "1",
        entrypoints: JSON.stringify(["https://migration-035.example.test/jobs"]),
        crawl_interval: "24h",
        refresh_coverage: "full_scope",
        absence_policy: "close_after_two_complete_absences",
        policy_notes: "Offline migration fixture.",
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
        canonical_source_url: `https://migration-035.example.test/jobs/${ids.record}`,
        first_seen_at: new Date(Date.now() - 60_000),
        last_seen_at: new Date(),
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_revisions")
      .values({
        id: ids.revision,
        source_job_record_id: ids.record,
        revision_content_hash: "a".repeat(64),
        import_mode: "manual",
        adapter_version: "1",
        normalizer_version: "1",
        company_name: "Migration 035 Company",
        title: "Migration 035 Internship",
        job_family: JSON.stringify({
          state: "known",
          value: "product",
          evidenceRefs: [`${ids.revision}#family`],
        }),
        locations: JSON.stringify({
          state: "known",
          value: ["Shanghai"],
          evidenceRefs: [`${ids.revision}#location`],
        }),
        business_groups: JSON.stringify([]),
        entry_scope: "internship",
        source_project_name: null,
        recruit_label_name: "internship",
        recruitment_type: JSON.stringify({
          state: "known",
          value: "internship",
          evidenceRefs: [`${ids.revision}#type`],
        }),
        responsibilities: "Support product research.",
        requirements: "Current student.",
        structured_fields: JSON.stringify({}),
        ingestion_state: "validated",
        // 这正是生产实况：适配器恒产出 review。
        publication_state: "review",
        activity_state: "active",
        source_url: `https://migration-035.example.test/jobs/${ids.record}`,
        apply_url: `https://migration-035.example.test/jobs/${ids.record}/apply`,
        quality_flags: JSON.stringify([]),
        created_at: new Date(),
      })
      .execute();
    await db
      .insertInto("catalog.published_jobs")
      .values({ id: ids.publishedJob, current_version_id: null })
      .execute();
    await db
      .insertInto("catalog.published_job_versions")
      .values({
        id: ids.publishedVersion,
        published_job_id: ids.publishedJob,
        source_job_revision_id: ids.revision,
        content_hash: "b".repeat(64),
        company_name: "Migration 035 Company",
        title: "Migration 035 Internship",
        job_family: JSON.stringify({
          state: "known",
          value: "product",
          evidenceRefs: [`${ids.revision}#family`],
        }),
        locations: JSON.stringify({
          state: "known",
          value: ["Shanghai"],
          evidenceRefs: [`${ids.revision}#location`],
        }),
        responsibilities: "Support product research.",
        requirements: "Current student.",
        structured_fields: JSON.stringify({}),
        activity_state: "active",
        source_url: `https://migration-035.example.test/jobs/${ids.record}`,
        apply_url: `https://migration-035.example.test/jobs/${ids.record}/apply`,
        effective_at: new Date(),
      })
      .execute();
    await db
      .updateTable("catalog.published_jobs")
      .set({ current_version_id: ids.publishedVersion })
      .where("id", "=", ids.publishedJob)
      .execute();
  }

  const readEligibility = async () =>
    db
      .selectFrom("catalog.job_version_eligibility")
      .select([
        "eligible_for_alpha",
        "eligible_for_local_mvp",
        "publication_suppressed",
        "blocking_reasons",
        "publication_state",
      ])
      .where("published_job_version_id", "=", ids.publishedVersion)
      .executeTakeFirstOrThrow();

  it("treats a review revision as eligible for alpha, which the pre-035 view could never do", async () => {
    await seedEligibleVersion();
    const eligibility = await readEligibility();

    expect(eligibility.publication_state).toBe("review");
    expect(eligibility.blocking_reasons).toEqual([]);
    // 解除死锁：修订仍是 review，但已够格发布。
    expect(eligibility.eligible_for_alpha).toBe(true);
    expect(eligibility.eligible_for_local_mvp).toBe(true);
    expect(eligibility.publication_suppressed).toBe(false);

    // 「已发布」是独立事实，仍需对账写入，资格本身不发布任何东西。
    expect(
      (
        await db
          .selectFrom("catalog.published_jobs")
          .select("public_version_id")
          .where("id", "=", ids.publishedJob)
          .executeTakeFirstOrThrow()
      ).public_version_id,
    ).toBeNull();
  });

  it("makes forced suppression block alpha immediately without touching local preview", async () => {
    await db
      .updateTable("catalog.published_jobs")
      .set({
        publication_suppressed_at: new Date(),
        publication_suppressed_reason: "company objection",
      })
      .where("id", "=", ids.publishedJob)
      .execute();

    const suppressed = await readEligibility();
    expect(suppressed.publication_suppressed).toBe(true);
    expect(suppressed.eligible_for_alpha).toBe(false);
    // 强制下架只约束对外可见面，本机内部预览不受影响，与迁移 034 对 closure_detectable 的处理一致。
    expect(suppressed.eligible_for_local_mvp).toBe(true);
    expect(suppressed.blocking_reasons).toEqual([]);

    await db
      .updateTable("catalog.published_jobs")
      .set({ publication_suppressed_at: null, publication_suppressed_reason: null })
      .where("id", "=", ids.publishedJob)
      .execute();
    expect((await readEligibility()).eligible_for_alpha).toBe(true);
  });

  it("requires suppression timestamp and reason to be set together", async () => {
    await expect(
      db
        .updateTable("catalog.published_jobs")
        .set({ publication_suppressed_at: new Date(), publication_suppressed_reason: null })
        .where("id", "=", ids.publishedJob)
        .execute(),
    ).rejects.toThrow(/published_jobs_suppression_complete/);
  });

  it("still blocks revisions that are not reviewable", async () => {
    await db
      .updateTable("ingestion.source_job_revisions")
      .set({ publication_state: "archived" })
      .where("id", "=", ids.revision)
      .execute();

    const archived = await readEligibility();
    expect(archived.blocking_reasons).toContain("PUBLICATION_NOT_REVIEWABLE");
    expect(archived.eligible_for_alpha).toBe(false);
    expect(archived.eligible_for_local_mvp).toBe(false);

    await db
      .updateTable("ingestion.source_job_revisions")
      .set({ publication_state: "review" })
      .where("id", "=", ids.revision)
      .execute();
  });

  it("grants the publication event log to the intended runtime roles only", async () => {
    const { rows } = await sql<{ grantee: string; privilege_type: string }>`
      SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'catalog'
        AND table_name = 'publication_events'
        AND grantee LIKE 'aijob_%'
      ORDER BY grantee, privilege_type
    `.execute(db);
    const byRole = new Map<string, Set<string>>();
    for (const row of rows) {
      const privileges = byRole.get(row.grantee) ?? new Set<string>();
      privileges.add(row.privilege_type);
      byRole.set(row.grantee, privileges);
    }

    expect([...(byRole.get("aijob_web_api") ?? [])]).toEqual(["SELECT"]);
    expect([...(byRole.get("aijob_match_worker") ?? [])]).toEqual(["SELECT"]);
    expect([...(byRole.get("aijob_collector_worker") ?? [])].sort()).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
    for (const role of ["aijob_ops_cli", "aijob_migrator"]) {
      expect([...(byRole.get(role) ?? [])]).toContain("INSERT");
      expect([...(byRole.get(role) ?? [])]).toContain("DELETE");
    }
  });

  it("restores the pre-035 publication condition when rolled back", async () => {
    await migrateToForTesting(db, "034_closure_detectable_canonical_jobs");
    const { rows } = await sql<{ definition: string }>`
      SELECT pg_get_viewdef('catalog.job_version_eligibility'::regclass, true) AS definition
    `.execute(db);
    const definition = rows[0]?.definition ?? "";
    expect(definition).toContain("publication_state = 'published'");
    expect(definition).not.toContain("publication_suppressed");

    const { rows: columns } = await sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM information_schema.columns
      WHERE table_schema = 'catalog'
        AND table_name = 'published_jobs'
        AND column_name IN ('publication_suppressed_at', 'publication_suppressed_reason')
    `.execute(db);
    expect(columns[0]?.count).toBe("0");
  });
});
