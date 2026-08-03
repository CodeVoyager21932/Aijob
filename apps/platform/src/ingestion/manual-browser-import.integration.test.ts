import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, type Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSourceConfig } from "../sources/source-config.js";
import { registerSourceConfig } from "../sources/source-registry.js";
import { importManualBrowserSnapshot } from "./manual-browser-import.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const sourceKey = "bytedance-manual-test";

describeWithDatabase("manual browser snapshot import", () => {
  let db: Kysely<Database>;
  let workspaceRoot: string;
  let snapshotFile: string;
  let sourceConfigDirectory: string;

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
        const catalogRows = await db
          .selectFrom("catalog.published_job_version_revision_links as link")
          .innerJoin(
            "catalog.published_job_versions as version",
            "version.id",
            "link.published_job_version_id",
          )
          .select(["version.id as versionId", "version.published_job_id as jobId"])
          .where("link.source_job_revision_id", "in", revisionIds)
          .execute();
        const versionIds = [...new Set(catalogRows.map(({ versionId }) => versionId))];
        const jobIds = [...new Set(catalogRows.map(({ jobId }) => jobId))];
        if (versionIds.length > 0) {
          await db
            .updateTable("catalog.published_job_versions")
            .set({ active_requirement_set_id: null })
            .where("id", "in", versionIds)
            .execute();
          await db
            .deleteFrom("catalog.job_requirement_sets")
            .where("published_job_version_id", "in", versionIds)
            .execute();
        }
        if (jobIds.length > 0) {
          await db
            .updateTable("catalog.published_jobs")
            .set({ current_version_id: null })
            .where("id", "in", jobIds)
            .execute();
          await db
            .deleteFrom("catalog.published_job_versions")
            .where("published_job_id", "in", jobIds)
            .execute();
          await db.deleteFrom("catalog.published_jobs").where("id", "in", jobIds).execute();
        }
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
    sourceConfigDirectory = join(workspaceRoot, "source-configs");
    await mkdir(sourceConfigDirectory, { recursive: true });
    const configFixture = JSON.parse(
      await readFile(
        new URL("../../../../fixtures/source-configs/bytedance-manual-test.json", import.meta.url),
        "utf8",
      ),
    ) as { runtimeScope?: string; policy: { crawlInterval: { enabled: boolean } } };
    configFixture.runtimeScope = "local";
    configFixture.policy.crawlInterval.enabled = true;
    await writeFile(
      join(sourceConfigDirectory, `${sourceKey}.json`),
      `${JSON.stringify(configFixture, null, 2)}\n`,
      "utf8",
    );
  });

  afterAll(async () => {
    await cleanup();
    await db.destroy();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("refreshes runtime state, activity projection and catalog without fake revisions", async () => {
    const registered = await registerSourceConfig(
      db,
      await loadSourceConfig(sourceKey, sourceConfigDirectory),
    );
    await db
      .updateTable("source_control.source_runtime_states")
      .set({
        freshness_state: "due",
        manual_snapshot_required: true,
        manual_snapshot_due_at: new Date("2026-07-31T00:00:00.000Z"),
      })
      .where("source_id", "=", registered.sourceId)
      .execute();

    const first = await importManualBrowserSnapshot({
      db,
      appEnv: "test",
      enableLocalMvp: true,
      workspaceRoot,
      snapshotDirectory: join(workspaceRoot, ".data", "job-snapshots"),
      sourceKey,
      sourceConfigDirectory,
      filePath: snapshotFile,
    });
    expect(first).toMatchObject({
      reused: false,
      discoveredCount: 2,
      normalizedCount: 2,
      createdRevisionCount: 2,
    });

    const records = await db
      .selectFrom("ingestion.source_job_records")
      .select("id")
      .where("source_id", "=", registered.sourceId)
      .execute();
    await db
      .updateTable("ingestion.source_job_activity_states")
      .set({
        absence_state: "uncertain",
        consecutive_complete_absences: 1,
        last_absent_run_id: first.runId,
        last_absent_at: new Date("2026-07-31T00:00:00.000Z"),
        closed_reason: null,
      })
      .where(
        "source_job_record_id",
        "in",
        records.map(({ id }) => id),
      )
      .execute();
    await db
      .updateTable("source_control.source_runtime_states")
      .set({
        freshness_state: "due",
        manual_snapshot_required: true,
        manual_snapshot_due_at: new Date("2026-08-01T00:00:00.000Z"),
      })
      .where("source_id", "=", registered.sourceId)
      .execute();

    const refreshedSnapshotFile = join(
      workspaceRoot,
      ".data",
      "browser-imports",
      "bytedance.refreshed.synthetic.json",
    );
    const refreshedDocument = JSON.parse(await readFile(snapshotFile, "utf8")) as {
      capturedAt: string;
    };
    refreshedDocument.capturedAt = "2026-08-01T01:00:00+08:00";
    await writeFile(refreshedSnapshotFile, JSON.stringify(refreshedDocument), "utf8");

    const refreshed = await importManualBrowserSnapshot({
      db,
      appEnv: "test",
      enableLocalMvp: true,
      workspaceRoot,
      snapshotDirectory: join(workspaceRoot, ".data", "job-snapshots"),
      sourceKey,
      sourceConfigDirectory,
      filePath: refreshedSnapshotFile,
    });
    expect(refreshed).toMatchObject({
      reused: false,
      normalizedCount: 2,
      createdRevisionCount: 0,
    });
    const replayed = await importManualBrowserSnapshot({
      db,
      appEnv: "test",
      enableLocalMvp: true,
      workspaceRoot,
      snapshotDirectory: join(workspaceRoot, ".data", "job-snapshots"),
      sourceKey,
      sourceConfigDirectory,
      filePath: refreshedSnapshotFile,
    });
    expect(replayed).toMatchObject({
      reused: true,
      taskId: refreshed.taskId,
      runId: refreshed.runId,
      normalizedCount: 2,
      createdRevisionCount: 0,
    });

    const run = await db
      .selectFrom("ingestion.crawl_runs")
      .select([
        "run_mode",
        "request_count",
        "discovered_count",
        "normalized_count",
        "completion",
      ])
      .where("id", "=", first.runId)
      .executeTakeFirstOrThrow();
    expect(run).toEqual({
      run_mode: "manual",
      request_count: 0,
      discovered_count: 2,
      normalized_count: 2,
      completion: "partial",
    });
    const task = await db
      .selectFrom("task_queue.tasks")
      .select("run_mode")
      .where("id", "=", first.taskId)
      .executeTakeFirstOrThrow();
    expect(task.run_mode).toBe("manual");
    const revisions = await db
      .selectFrom("ingestion.source_job_revisions as revision")
      .innerJoin(
        "ingestion.source_job_records as record",
        "record.id",
        "revision.source_job_record_id",
      )
      .select(["revision.import_mode", "revision.recruitment_type"])
      .where("record.source_id", "=", registered.sourceId)
      .execute();
    expect(revisions).toHaveLength(2);
    expect(revisions.every((revision) => revision.import_mode === "manual")).toBe(true);
    const runtime = await db
      .selectFrom("source_control.source_runtime_states")
      .select([
        "freshness_state",
        "manual_snapshot_required",
        "manual_snapshot_due_at",
        "last_successful_run_at",
        "next_due_at",
      ])
      .where("source_id", "=", registered.sourceId)
      .executeTakeFirstOrThrow();
    expect(runtime).toMatchObject({
      freshness_state: "fresh",
      manual_snapshot_required: false,
      manual_snapshot_due_at: null,
    });
    expect(runtime.last_successful_run_at).not.toBeNull();
    expect(runtime.next_due_at).not.toBeNull();

    const activity = await db
      .selectFrom("ingestion.source_job_activity_states")
      .select(["absence_state", "consecutive_complete_absences", "last_seen_run_id"])
      .where(
        "source_job_record_id",
        "in",
        records.map(({ id }) => id),
      )
      .execute();
    expect(activity).toHaveLength(2);
    expect(
      activity.every(
        (row) =>
          row.absence_state === "active" &&
          row.consecutive_complete_absences === 0 &&
          row.last_seen_run_id === refreshed.runId,
      ),
    ).toBe(true);

    const materialized = await db
      .selectFrom("catalog.published_job_version_revision_links as link")
      .innerJoin(
        "ingestion.source_job_revisions as revision",
        "revision.id",
        "link.source_job_revision_id",
      )
      .innerJoin(
        "ingestion.source_job_records as record",
        "record.id",
        "revision.source_job_record_id",
      )
      .select("link.published_job_version_id")
      .distinct()
      .where("record.source_id", "=", registered.sourceId)
      .execute();
    expect(materialized).toHaveLength(2);
    expect(
      revisions.every((revision) => JSON.stringify(revision.recruitment_type).includes("实习")),
    ).toBe(true);
  });

  it("keeps the snapshot reminder due until catalog materialization succeeds", async () => {
    await cleanup();
    const registered = await registerSourceConfig(
      db,
      await loadSourceConfig(sourceKey, sourceConfigDirectory),
    );
    const reminderDueAt = new Date("2026-08-02T00:00:00.000Z");
    await db
      .updateTable("source_control.source_runtime_states")
      .set({
        freshness_state: "due",
        manual_snapshot_required: true,
        manual_snapshot_due_at: reminderDueAt,
      })
      .where("source_id", "=", registered.sourceId)
      .execute();

    await expect(
      importManualBrowserSnapshot({
        db,
        appEnv: "test",
        enableLocalMvp: true,
        workspaceRoot,
        snapshotDirectory: join(workspaceRoot, ".data", "job-snapshots"),
        sourceKey,
        sourceConfigDirectory,
        filePath: snapshotFile,
        materializeCatalog: async () => {
          const pending = await db
            .selectFrom("source_control.source_runtime_states")
            .select(["freshness_state", "manual_snapshot_required", "manual_snapshot_due_at"])
            .where("source_id", "=", registered.sourceId)
            .executeTakeFirstOrThrow();
          expect(pending).toEqual({
            freshness_state: "due",
            manual_snapshot_required: true,
            manual_snapshot_due_at: reminderDueAt,
          });
          throw new Error("TEST_CATALOG_MATERIALIZATION_FAILURE");
        },
      }),
    ).rejects.toThrow("TEST_CATALOG_MATERIALIZATION_FAILURE");

    const afterFailure = await db
      .selectFrom("source_control.source_runtime_states")
      .select([
        "freshness_state",
        "manual_snapshot_required",
        "manual_snapshot_due_at",
        "last_error_code",
      ])
      .where("source_id", "=", registered.sourceId)
      .executeTakeFirstOrThrow();
    expect(afterFailure).toEqual({
      freshness_state: "due",
      manual_snapshot_required: true,
      manual_snapshot_due_at: reminderDueAt,
      last_error_code: "CATALOG_MATERIALIZATION_FAILED",
    });

    const recovered = await importManualBrowserSnapshot({
      db,
      appEnv: "test",
      enableLocalMvp: true,
      workspaceRoot,
      snapshotDirectory: join(workspaceRoot, ".data", "job-snapshots"),
      sourceKey,
      sourceConfigDirectory,
      filePath: snapshotFile,
    });
    expect(recovered).toMatchObject({ reused: true, createdRevisionCount: 0 });
    const revisionCount = await db
      .selectFrom("ingestion.source_job_revisions as revision")
      .innerJoin(
        "ingestion.source_job_records as record",
        "record.id",
        "revision.source_job_record_id",
      )
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("record.source_id", "=", registered.sourceId)
      .executeTakeFirstOrThrow();
    expect(Number(revisionCount.count)).toBe(2);
    expect(
      await db
        .selectFrom("source_control.source_runtime_states")
        .select([
          "freshness_state",
          "manual_snapshot_required",
          "manual_snapshot_due_at",
          "last_error_code",
          "next_due_at",
        ])
        .where("source_id", "=", registered.sourceId)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({
      freshness_state: "fresh",
      manual_snapshot_required: false,
      manual_snapshot_due_at: null,
      last_error_code: null,
    });
  });
});
