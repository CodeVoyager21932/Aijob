import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../index.js";
import { migrateToLatest } from "../migrate.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("adapter descriptors and manual runs migration", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");

  beforeAll(async () => {
    await migrateToLatest(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("persists adapter options and accepts manual crawl runs", async () => {
    const organizationId = randomUUID();
    const sourceId = randomUUID();
    const taskId = randomUUID();
    const runId = randomUUID();

    await db
      .insertInto("source_control.organizations")
      .values({
        id: organizationId,
        slug: `adapter-descriptor-${organizationId}`,
        name: "Adapter Descriptor Test Company",
        official_domain: "adapter-descriptor.example.test",
      })
      .execute();
    await db
      .insertInto("source_control.sources")
      .values({
        id: sourceId,
        organization_id: organizationId,
        source_candidate_id: null,
        source_key: `adapter-descriptor-${sourceId}`,
        source_type: "organization_career_site",
        name: "Adapter Descriptor Test Source",
        current_policy_version: 1,
      })
      .execute();
    await db
      .insertInto("source_control.source_policy_versions")
      .values({
        source_id: sourceId,
        version: 1,
        policy_status: "pending_review",
        provenance_level: "official_first_party",
        acquisition_mode: "browser_required",
        adapter_key: "bytedance-manual-browser-snapshot",
        adapter_version: "test-v1",
        adapter_options: JSON.stringify({ capture: "visible-content" }),
        entrypoints: JSON.stringify(["https://adapter-descriptor.example.test/jobs"]),
        crawl_interval: null,
        refresh_coverage: "manual_snapshot",
        absence_policy: "none",
        policy_notes: "migration test",
        reviewed_at: null,
      })
      .execute();
    await db
      .insertInto("task_queue.tasks")
      .values({
        id: taskId,
        task_type: "crawl",
        source_id: sourceId,
        policy_version: 1,
        adapter_version: "test-v1",
        run_mode: "manual",
        idempotency_key: `manual-${taskId}`,
        status: "succeeded",
        attempt: 1,
        max_attempts: 1,
        available_at: new Date(),
        backoff_policy: JSON.stringify({}),
        lease_owner: null,
        lease_until: null,
        heartbeat_at: null,
        last_error_code: null,
        last_error_summary: null,
        completed_at: new Date(),
      })
      .execute();
    await db
      .insertInto("ingestion.crawl_runs")
      .values({
        id: runId,
        task_id: taskId,
        source_id: sourceId,
        policy_version: 1,
        adapter_version: "test-v1",
        run_mode: "manual",
        completion: "partial",
        reported_totals: JSON.stringify({}),
        request_count: 0,
        discovered_count: 1,
        normalized_count: 1,
        rejected_count: 0,
        error_summary: JSON.stringify([]),
        finished_at: new Date(),
      })
      .execute();

    const policy = await db
      .selectFrom("source_control.source_policy_versions")
      .select("adapter_options")
      .where("source_id", "=", sourceId)
      .where("version", "=", 1)
      .executeTakeFirstOrThrow();
    const run = await db
      .selectFrom("ingestion.crawl_runs")
      .select("run_mode")
      .where("id", "=", runId)
      .executeTakeFirstOrThrow();

    expect(policy.adapter_options).toEqual({ capture: "visible-content" });
    expect(run.run_mode).toBe("manual");
  });
});
