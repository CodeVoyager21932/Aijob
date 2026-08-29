import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../index.js";
import { migrateToLatest } from "../migrate.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const knownDeadline = (value: string) =>
  JSON.stringify({ state: "known", value, evidenceRefs: ["fixture#deadline"] });
const unknownField = JSON.stringify({ state: "unknown", reason: "source_not_stated" });

/**
 * ADR-0032 第二条：`canonical` 岗位必须能探知关闭。
 * 三层：明示截止日期、列表型且消失即关闭、以及不可探知的冻结单条公告。
 */
describeWithDatabase("closure-detectable canonical jobs migration", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");

  beforeAll(async () => {
    await migrateToLatest(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("blocks only the frozen single posting that can never be observed as closed", async () => {
    const organizationId = randomUUID();
    const cases = [
      {
        key: "list-backed",
        refreshCoverage: "full_scope",
        absencePolicy: "close_after_two_complete_absences",
        deadline: unknownField,
        closureDetectable: true,
      },
      {
        key: "explicit-deadline",
        refreshCoverage: "tracked_records",
        absencePolicy: "none",
        // 明示且未过期的截止日期：过期即自动失效，陈旧上限为 0。
        deadline: knownDeadline("2099-12-31"),
        closureDetectable: true,
      },
      {
        key: "frozen-single-posting",
        refreshCoverage: "tracked_records",
        absencePolicy: "none",
        deadline: unknownField,
        closureDetectable: false,
      },
      {
        key: "observed-but-never-closed",
        // 全量刷新能观察到缺失，但政策不据此关闭 → 陈旧时长仍无上限。
        refreshCoverage: "full_scope",
        absencePolicy: "none",
        deadline: unknownField,
        closureDetectable: false,
      },
    ].map((fixtureCase, index) => ({
      ...fixtureCase,
      index,
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
          slug: `closure-fixture-${organizationId.slice(0, 8)}`,
          name: "Closure Fixture Company",
          official_domain: "closure-fixture.example.com",
        })
        .execute();

      for (const fixtureCase of cases) {
        const sourceUrl = `https://closure-fixture.example.com/${fixtureCase.key}`;
        await db
          .insertInto("source_control.sources")
          .values({
            id: fixtureCase.sourceId,
            organization_id: organizationId,
            source_key: `closure-${fixtureCase.key}-${fixtureCase.sourceId.slice(0, 8)}`,
            name: `Closure ${fixtureCase.key}`,
            source_type: "organization_career_site",
            current_policy_version: 1,
          })
          .execute();
        await db
          .insertInto("source_control.source_policy_versions")
          .values({
            source_id: fixtureCase.sourceId,
            version: 1,
            policy_status: "pending_review",
            config_registered: true,
            catalog_role: "canonical",
            runtime_scope: "local",
            provenance_level: "organization_owned",
            acquisition_mode: "deterministic_html",
            adapter_key: "closure-test",
            adapter_version: "1",
            entrypoints: JSON.stringify([sourceUrl]),
            crawl_interval: "24h",
            refresh_coverage: fixtureCase.refreshCoverage,
            absence_policy: fixtureCase.absencePolicy,
            policy_notes: "Offline closure-detectability fixture.",
            reviewed_at: null,
          })
          .execute();
        await db
          .insertInto("source_control.source_runtime_states")
          .values({
            source_id: fixtureCase.sourceId,
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
            id: fixtureCase.recordId,
            source_id: fixtureCase.sourceId,
            source_job_id: `job-${fixtureCase.recordId}`,
            canonical_source_url: sourceUrl,
            first_seen_at: new Date(),
            last_seen_at: new Date(),
          })
          .execute();
        await db
          .insertInto("ingestion.source_job_revisions")
          .values({
            id: fixtureCase.revisionId,
            source_job_record_id: fixtureCase.recordId,
            revision_content_hash: String(fixtureCase.index + 1).repeat(64),
            import_mode: "manual",
            adapter_version: "1",
            normalizer_version: "1",
            company_name: "Closure Fixture Company",
            title: `Closure ${fixtureCase.key} internship`,
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
            requirements: "Current student, bachelor and above.",
            structured_fields: JSON.stringify({}),
            deadline_at: fixtureCase.deadline,
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
            content_hash: String(fixtureCase.index + 1).repeat(64),
            company_name: "Closure Fixture Company",
            title: `Closure ${fixtureCase.key} internship`,
            job_family: JSON.stringify({ state: "known", value: "product", evidenceRefs: [] }),
            locations: JSON.stringify({ state: "known", value: ["Shanghai"], evidenceRefs: [] }),
            responsibilities: "Support product research and delivery.",
            requirements: "Current student, bachelor and above.",
            structured_fields: JSON.stringify({}),
            deadline_at: fixtureCase.deadline,
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
      }

      const sourceIds = cases.map((fixtureCase) => fixtureCase.sourceId);
      const currentRows = await db
        .selectFrom("catalog.current_job_eligibility")
        .select([
          "source_id",
          "closure_detectable",
          "eligible_for_local_mvp",
          "eligible_for_alpha",
          "blocking_reasons",
        ])
        .where("source_id", "in", sourceIds)
        .execute();
      const versionRows = await db
        .selectFrom("catalog.job_version_eligibility")
        .select([
          "source_id",
          "closure_detectable",
          "eligible_for_local_mvp",
          "eligible_for_alpha",
          "blocking_reasons",
        ])
        .where("source_id", "in", sourceIds)
        .execute();

      expect(currentRows).toHaveLength(cases.length);
      expect(versionRows).toHaveLength(cases.length);

      for (const fixtureCase of cases) {
        const current = currentRows.find((row) => row.source_id === fixtureCase.sourceId);
        const version = versionRows.find((row) => row.source_id === fixtureCase.sourceId);
        if (!current || !version) throw new Error(`CLOSURE_FIXTURE_ROW_MISSING:${fixtureCase.key}`);

        expect(current.closure_detectable, fixtureCase.key).toBe(fixtureCase.closureDetectable);
        expect(version.closure_detectable, fixtureCase.key).toBe(fixtureCase.closureDetectable);

        // 本机内部预览刻意不受可探知性约束，四个案例都应保持 local_mvp 合格。
        expect(current.blocking_reasons, fixtureCase.key).toEqual([]);
        expect(current.eligible_for_local_mvp, fixtureCase.key).toBe(true);
        expect(version.eligible_for_local_mvp, fixtureCase.key).toBe(true);

        // 这些夹具是 pending_review + local scope，因此都还进不了 Alpha；
        // 可探知性是 Alpha 的必要条件之一，此处一并验证它不会把不可探知的放行。
        expect(current.eligible_for_alpha, fixtureCase.key).toBe(false);
        expect(version.eligible_for_alpha, fixtureCase.key).toBe(false);
      }

      // 可探知性必须真正区分四个案例，否则该列没有守门作用。
      expect(currentRows.filter((row) => row.closure_detectable)).toHaveLength(2);
      expect(currentRows.filter((row) => !row.closure_detectable)).toHaveLength(2);
    } finally {
      const sourceIds = cases.map((fixtureCase) => fixtureCase.sourceId);
      await db
        .deleteFrom("catalog.published_job_version_revision_links")
        .where(
          "published_job_version_id",
          "in",
          cases.map((fixtureCase) => fixtureCase.versionId),
        )
        .execute();
      await db
        .updateTable("catalog.published_jobs")
        .set({ current_version_id: null })
        .where(
          "id",
          "in",
          cases.map((fixtureCase) => fixtureCase.jobId),
        )
        .execute();
      await db
        .deleteFrom("catalog.published_job_versions")
        .where(
          "id",
          "in",
          cases.map((fixtureCase) => fixtureCase.versionId),
        )
        .execute();
      await db
        .deleteFrom("catalog.published_jobs")
        .where(
          "id",
          "in",
          cases.map((fixtureCase) => fixtureCase.jobId),
        )
        .execute();
      await db
        .deleteFrom("ingestion.source_job_revisions")
        .where(
          "id",
          "in",
          cases.map((fixtureCase) => fixtureCase.revisionId),
        )
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
      await db.deleteFrom("source_control.organizations").where("id", "=", organizationId).execute();
    }
  });
});
