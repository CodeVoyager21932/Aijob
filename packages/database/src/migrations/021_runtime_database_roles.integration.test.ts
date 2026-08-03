import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../index.js";
import { migrateToLatest } from "../migrate.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("runtime PostgreSQL role boundary", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");
  const ids = {
    organization: randomUUID(),
    source: randomUUID(),
    owner: randomUUID(),
    crawlTask: randomUUID(),
    ownerTask: randomUUID(),
  };

  beforeAll(async () => {
    await migrateToLatest(db);
    await db
      .insertInto("source_control.organizations")
      .values({
        id: ids.organization,
        slug: `role-boundary-${ids.organization}`,
        name: "Role Boundary Fixture",
        official_domain: "role-boundary.example.test",
      })
      .execute();
    await db
      .insertInto("source_control.sources")
      .values({
        id: ids.source,
        organization_id: ids.organization,
        source_candidate_id: null,
        source_key: `role-boundary-${ids.source}`,
        source_type: "organization_career_site",
        name: "Role Boundary Source",
        current_policy_version: 1,
      })
      .execute();
    await db
      .insertInto("source_control.source_policy_versions")
      .values({
        source_id: ids.source,
        version: 1,
        policy_status: "pending_review",
        config_registered: true,
        catalog_role: "canonical",
        runtime_scope: "local",
        provenance_level: "organization_owned",
        acquisition_mode: "public_api",
        adapter_key: "role-boundary-fixture",
        adapter_version: "1",
        entrypoints: JSON.stringify(["https://role-boundary.example.test/jobs"]),
        crawl_interval: "24h",
        policy_notes: "Offline role boundary fixture.",
        reviewed_at: null,
      })
      .execute();
    await db
      .insertInto("identity.owners")
      .values({
        id: ids.owner,
        status: "active",
        epoch: 1,
        retention_expires_at: new Date(Date.now() + 60_000),
        last_seen_at: new Date(),
        deleted_at: null,
      })
      .execute();
    await db
      .insertInto("task_queue.tasks")
      .values([
        {
          id: ids.crawlTask,
          task_type: "crawl",
          source_id: ids.source,
          policy_version: 1,
          adapter_version: "1",
          run_mode: "scheduled",
          owner_id: null,
          owner_epoch: null,
          payload: JSON.stringify({}),
          idempotency_key: `role-boundary-crawl-${ids.crawlTask}`,
          status: "queued",
          attempt: 0,
          max_attempts: 3,
          available_at: new Date(),
          backoff_policy: JSON.stringify({ kind: "fixed", seconds: 1 }),
          lease_owner: null,
          lease_until: null,
          heartbeat_at: null,
          last_error_code: null,
          last_error_summary: null,
          completed_at: null,
        },
        {
          id: ids.ownerTask,
          task_type: "match_run",
          source_id: null,
          policy_version: null,
          adapter_version: null,
          run_mode: null,
          owner_id: ids.owner,
          owner_epoch: 1,
          payload: JSON.stringify({ runId: randomUUID() }),
          idempotency_key: `role-boundary-owner-${ids.ownerTask}`,
          status: "queued",
          attempt: 0,
          max_attempts: 3,
          available_at: new Date(),
          backoff_policy: JSON.stringify({ kind: "fixed", seconds: 1 }),
          lease_owner: null,
          lease_until: null,
          heartbeat_at: null,
          last_error_code: null,
          last_error_summary: null,
          completed_at: null,
        },
      ])
      .execute();
  });

  afterAll(async () => {
    await db
      .deleteFrom("task_queue.tasks")
      .where("id", "in", [ids.crawlTask, ids.ownerTask])
      .execute();
    await db.deleteFrom("identity.owners").where("id", "=", ids.owner).execute();
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

  it("creates non-login group roles", async () => {
    const roles = await sql<{ rolname: string; rolcanlogin: boolean }>`
      SELECT rolname, rolcanlogin
      FROM pg_roles
      WHERE rolname IN (
        'aijob_web_api',
        'aijob_collector_worker',
        'aijob_match_worker',
        'aijob_ops_cli',
        'aijob_migrator'
      )
      ORDER BY rolname
    `.execute(db);
    expect(roles.rows).toHaveLength(5);
    expect(roles.rows.every((role) => role.rolcanlogin === false)).toBe(true);
  });

  it("keeps crawl and owner task rows in separate RLS scopes", async () => {
    const collectorTasks = await db.transaction().execute(async (transaction) => {
      await sql`SET LOCAL ROLE aijob_collector_worker`.execute(transaction);
      return transaction.selectFrom("task_queue.tasks").select("id").orderBy("id").execute();
    });
    expect(collectorTasks.map((task) => task.id)).toContain(ids.crawlTask);
    expect(collectorTasks.map((task) => task.id)).not.toContain(ids.ownerTask);

    for (const role of ["aijob_web_api", "aijob_match_worker"] as const) {
      const ownerTasks = await db.transaction().execute(async (transaction) => {
        await sql.raw(`SET LOCAL ROLE ${role}`).execute(transaction);
        return transaction.selectFrom("task_queue.tasks").select("id").orderBy("id").execute();
      });
      expect(ownerTasks.map((task) => task.id)).toContain(ids.ownerTask);
      expect(ownerTasks.map((task) => task.id)).not.toContain(ids.crawlTask);
    }
  });

  it("denies collector access to owners and web or match access to snapshot metadata", async () => {
    await expect(
      db.transaction().execute(async (transaction) => {
        await sql`SET LOCAL ROLE aijob_collector_worker`.execute(transaction);
        await transaction.selectFrom("identity.owners").select("id").execute();
      }),
    ).rejects.toMatchObject({ code: "42501" });

    for (const role of ["aijob_web_api", "aijob_match_worker"] as const) {
      await expect(
        db.transaction().execute(async (transaction) => {
          await sql.raw(`SET LOCAL ROLE ${role}`).execute(transaction);
          await transaction.selectFrom("ingestion.snapshot_objects").select("id").execute();
        }),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});
