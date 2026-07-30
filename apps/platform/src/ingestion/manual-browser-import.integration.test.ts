import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importManualBrowserSnapshot } from "./manual-browser-import.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const sourceKey = "bytedance-manual-test";

describeWithDatabase("manual browser snapshot import", () => {
  let db: Kysely<Database>;
  let workspaceRoot: string;
  let snapshotFile: string;

  async function cleanup(): Promise<void> {
    const source = await db
      .selectFrom("source_control.sources")
      .select(["id", "organization_id", "source_candidate_id"])
      .where("source_key", "=", sourceKey)
      .executeTakeFirst();
    if (!source) return;

    const records = await db
      .selectFrom("ingestion.source_job_records")
      .select("id")
      .where("source_id", "=", source.id)
      .execute();
    const recordIds = records.map((record) => record.id);
    if (recordIds.length > 0) {
      const revisions = await db
        .selectFrom("ingestion.source_job_revisions")
        .select("id")
        .where("source_job_record_id", "in", recordIds)
        .execute();
      const revisionIds = revisions.map((revision) => revision.id);
      if (revisionIds.length > 0) {
        await db
          .deleteFrom("ingestion.source_job_revision_evidence")
          .where("revision_id", "in", revisionIds)
          .execute();
        await db
          .deleteFrom("ingestion.review_items")
          .where("revision_id", "in", revisionIds)
          .execute();
      }
      await db
        .deleteFrom("ingestion.source_job_revisions")
        .where("source_job_record_id", "in", recordIds)
        .execute();
      await db.deleteFrom("ingestion.source_job_records").where("id", "in", recordIds).execute();
    }

    const tasks = await db
      .selectFrom("task_queue.tasks")
      .select("id")
      .where("source_id", "=", source.id)
      .execute();
    const taskIds = tasks.map((task) => task.id);
    if (taskIds.length > 0) {
      const runs = await db
        .selectFrom("ingestion.crawl_runs")
        .select("id")
        .where("task_id", "in", taskIds)
        .execute();
      const runIds = runs.map((run) => run.id);
      if (runIds.length > 0) {
        await db
          .deleteFrom("ingestion.crawl_fetches")
          .where("crawl_run_id", "in", runIds)
          .execute();
        await db.deleteFrom("ingestion.crawl_runs").where("id", "in", runIds).execute();
      }
      await db.deleteFrom("task_queue.tasks").where("id", "in", taskIds).execute();
    }
    await db.deleteFrom("ingestion.snapshot_objects").where("source_id", "=", source.id).execute();
    await db
      .deleteFrom("source_control.source_runtime_states")
      .where("source_id", "=", source.id)
      .execute();
    await db
      .deleteFrom("source_control.source_fetch_targets")
      .where("source_id", "=", source.id)
      .execute();
    await db
      .deleteFrom("source_control.source_apply_targets")
      .where("source_id", "=", source.id)
      .execute();
    await db
      .deleteFrom("source_control.source_policy_versions")
      .where("source_id", "=", source.id)
      .execute();
    await db.deleteFrom("source_control.sources").where("id", "=", source.id).execute();
    if (source.source_candidate_id) {
      await db
        .deleteFrom("source_control.source_assessments")
        .where("source_candidate_id", "=", source.source_candidate_id)
        .execute();
      await db
        .deleteFrom("source_control.source_candidates")
        .where("id", "=", source.source_candidate_id)
        .execute();
    }
    await db
      .deleteFrom("source_control.organizations")
      .where("id", "=", source.organization_id)
      .execute();
  }

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await cleanup();
    workspaceRoot = await mkdtemp(join(tmpdir(), "aijob-manual-browser-"));
    const importRoot = join(workspaceRoot, ".data", "browser-imports");
    await mkdir(importRoot, { recursive: true });
    snapshotFile = join(importRoot, "bytedance.synthetic.json");
    const fixture = await readFile(
      new URL(
        "../../../../fixtures/ingestion/bytedance-manual-browser.synthetic.json",
        import.meta.url,
      ),
      "utf8",
    );
    await writeFile(snapshotFile, fixture, "utf8");
  });

  afterAll(async () => {
    await cleanup();
    await db.destroy();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("stores a zero-network manual task, manual revisions and reuses the same snapshot", async () => {
    const first = await importManualBrowserSnapshot({
      db,
      appEnv: "test",
      enableLocalMvp: true,
      workspaceRoot,
      snapshotDirectory: join(workspaceRoot, ".data", "job-snapshots"),
      sourceKey,
      sourceConfigDirectory: fileURLToPath(
        new URL("../../../../fixtures/source-configs/", import.meta.url),
      ),
      filePath: snapshotFile,
    });
    expect(first).toMatchObject({
      reused: false,
      discoveredCount: 2,
      normalizedCount: 2,
      createdRevisionCount: 2,
    });

    const second = await importManualBrowserSnapshot({
      db,
      appEnv: "test",
      enableLocalMvp: true,
      workspaceRoot,
      snapshotDirectory: join(workspaceRoot, ".data", "job-snapshots"),
      sourceKey,
      sourceConfigDirectory: fileURLToPath(
        new URL("../../../../fixtures/source-configs/", import.meta.url),
      ),
      filePath: snapshotFile,
    });
    expect(second).toMatchObject({
      reused: true,
      taskId: first.taskId,
      runId: first.runId,
      normalizedCount: 2,
      createdRevisionCount: 0,
    });

    const run = await db
      .selectFrom("ingestion.crawl_runs")
      .select(["request_count", "discovered_count", "normalized_count", "completion"])
      .where("id", "=", first.runId)
      .executeTakeFirstOrThrow();
    expect(run).toEqual({
      request_count: 0,
      discovered_count: 2,
      normalized_count: 2,
      completion: "partial",
    });
    const source = await db
      .selectFrom("source_control.sources")
      .select("id")
      .where("source_key", "=", sourceKey)
      .executeTakeFirstOrThrow();
    const revisions = await db
      .selectFrom("ingestion.source_job_revisions as revision")
      .innerJoin(
        "ingestion.source_job_records as record",
        "record.id",
        "revision.source_job_record_id",
      )
      .select(["revision.import_mode", "revision.recruitment_type"])
      .where("record.source_id", "=", source.id)
      .execute();
    expect(revisions).toHaveLength(2);
    expect(revisions.every((revision) => revision.import_mode === "manual")).toBe(true);
    expect(
      revisions.every((revision) => JSON.stringify(revision.recruitment_type).includes("实习")),
    ).toBe(true);
  });
});
