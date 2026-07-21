import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedCompanyEmail } from "../catalog/application-methods.js";
import { importManualBrowserSnapshot } from "./manual-browser-import.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const sourceKey = "official-account-test";

describeWithDatabase("official account zero-network manual import", () => {
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
    const recordIds = records.map(({ id }) => id);
    if (recordIds.length > 0) {
      const revisions = await db
        .selectFrom("ingestion.source_job_revisions")
        .select("id")
        .where("source_job_record_id", "in", recordIds)
        .execute();
      const revisionIds = revisions.map(({ id }) => id);
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
    const taskIds = tasks.map(({ id }) => id);
    if (taskIds.length > 0) {
      const runs = await db
        .selectFrom("ingestion.crawl_runs")
        .select("id")
        .where("task_id", "in", taskIds)
        .execute();
      const runIds = runs.map(({ id }) => id);
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
    await migrateToLatest(db);
    await cleanup();
    workspaceRoot = await mkdtemp(join(tmpdir(), "aijob-official-account-"));
    const importRoot = join(workspaceRoot, ".data", "browser-imports");
    await mkdir(importRoot, { recursive: true });
    snapshotFile = join(importRoot, "official-account.synthetic.json");
    const fixture = await readFile(
      new URL(
        "../../../../fixtures/ingestion/official-account-manual.synthetic.json",
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

  it("imports only the local snapshot and preserves URL or company-email application methods", async () => {
    const sourceConfigDirectory = fileURLToPath(
      new URL("../../../../fixtures/source-configs/", import.meta.url),
    );
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
    const replayed = await importManualBrowserSnapshot({
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
    expect(replayed).toMatchObject({ reused: true, runId: first.runId, createdRevisionCount: 0 });

    const source = await db
      .selectFrom("source_control.sources as source")
      .innerJoin(
        "source_control.organizations as organization",
        "organization.id",
        "source.organization_id",
      )
      .innerJoin("source_control.source_policy_versions as policy", (join) =>
        join
          .onRef("policy.source_id", "=", "source.id")
          .onRef("policy.version", "=", "source.current_policy_version"),
      )
      .select([
        "source.id",
        "source.source_type",
        "organization.official_domain",
        "organization.scale_band",
        "policy.provenance_level",
      ])
      .where("source.source_key", "=", sourceKey)
      .executeTakeFirstOrThrow();
    expect(source).toMatchObject({
      source_type: "organization_official_account",
      scale_band: "medium",
      provenance_level: "official_account_link",
    });

    const run = await db
      .selectFrom("ingestion.crawl_runs")
      .select(["request_count", "completion"])
      .where("id", "=", first.runId)
      .executeTakeFirstOrThrow();
    expect(run).toEqual({ request_count: 0, completion: "partial" });

    const revisions = await db
      .selectFrom("ingestion.source_job_revisions as revision")
      .innerJoin(
        "ingestion.source_job_records as record",
        "record.id",
        "revision.source_job_record_id",
      )
      .select([
        "record.source_job_id",
        "revision.apply_url",
        "revision.structured_fields",
        "revision.import_mode",
      ])
      .where("record.source_id", "=", source.id)
      .orderBy("record.source_job_id")
      .execute();
    expect(revisions).toHaveLength(2);
    expect(revisions.every(({ import_mode }) => import_mode === "manual")).toBe(true);
    const [emailRevision, urlRevision] = revisions;
    if (!emailRevision || !urlRevision) throw new Error("official account fixture rows missing");
    expect(emailRevision.apply_url).toBeNull();
    expect(
      approvedCompanyEmail(emailRevision.structured_fields, source.official_domain),
    ).toMatchObject({ type: "company_email", email: "intern@example.com" });
    expect(urlRevision.apply_url).toBe("https://example.com/careers/data-intern");
  });
});
