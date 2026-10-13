import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import { assertIsolatedTestDatabaseUrl, createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession } from "../identity/session-repository.js";
import { runOneOwnerTask } from "./owner-task-worker.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
if (url) assertIsolatedTestDatabaseUrl(url);
(url ? describe : describe.skip)("independent owner task claims", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());

  it("claims another ready task while the first claim is blocked inside its update", async () => {
    const { context: owner } = await createAnonymousSession({ db });
    const firstId = randomUUID();
    const secondId = randomUUID();
    const suffix = firstId.replaceAll("-", "");
    const trigger = `test_claim_${suffix}`;
    const lockKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    let first: Promise<boolean> | undefined;
    try {
      for (const [index, id] of [firstId, secondId].entries()) {
        await sql`INSERT INTO task_queue.tasks
          (id,task_type,owner_id,owner_epoch,payload,idempotency_key,status,attempt,max_attempts,available_at,backoff_policy)
          VALUES(${id},'match_run',${owner.ownerId},${owner.ownerEpoch},${JSON.stringify({ runId: randomUUID() })}::jsonb,
            ${`claim-test:${id}`},'queued',0,3,now()-(${10 - index}*interval '1 second'),'{}'::jsonb)`.execute(
          db,
        );
      }
      // Hold only the first row's queued -> running update, after its claim SELECT.
      // If SELECT locks every candidate, SKIP LOCKED incorrectly finds no second task.
      await sql
        .raw(`CREATE FUNCTION task_queue.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.id='${firstId}'::uuid AND OLD.status='queued' AND NEW.status='running' THEN
          PERFORM pg_advisory_xact_lock(${lockKey}); END IF; RETURN NEW; END $$;
        CREATE TRIGGER ${trigger} BEFORE UPDATE ON task_queue.tasks
        FOR EACH ROW EXECUTE FUNCTION task_queue.${trigger}();`)
        .execute(db);
      const run = () =>
        runOneOwnerTask({
          db,
          config: {} as AppConfig,
          ownerIds: [owner.ownerId],
          taskTypes: ["match_run"],
        });
      expect(
        await runOneOwnerTask({
          db,
          config: {} as AppConfig,
          ownerIds: [owner.ownerId],
          taskTypes: ["match_run"],
          signal: AbortSignal.abort(),
        }),
      ).toBe(false);
      expect(
        (
          await db
            .selectFrom("task_queue.tasks")
            .select("attempt")
            .where("id", "in", [firstId, secondId])
            .execute()
        ).map((row) => row.attempt),
      ).toEqual([0, 0]);
      await db.transaction().execute(async (gate) => {
        await sql`SELECT pg_advisory_xact_lock(${lockKey})`.execute(gate);
        first = run();
        const deadline = Date.now() + 5000;
        let waiting = false;
        while (Date.now() < deadline) {
          const row = (
            await sql<{ waiting: boolean }>`SELECT EXISTS(
            SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted
              AND classid=0 AND objid=${lockKey}::oid) AS waiting`.execute(db)
          ).rows[0];
          if (row?.waiting) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true);
        expect(await run()).toBe(true);
        const second = await db
          .selectFrom("task_queue.tasks")
          .select("attempt")
          .where("id", "=", secondId)
          .executeTakeFirstOrThrow();
        expect(second.attempt).toBe(1);
      });
    } finally {
      await first;
      await sql
        .raw(`DROP TRIGGER IF EXISTS ${trigger} ON task_queue.tasks;
        DROP FUNCTION IF EXISTS task_queue.${trigger}();`)
        .execute(db);
      await db.deleteFrom("task_queue.tasks").where("id", "in", [firstId, secondId]).execute();
      await db
        .deleteFrom("identity.owner_sessions")
        .where("owner_id", "=", owner.ownerId)
        .execute();
      await db.deleteFrom("identity.owners").where("id", "=", owner.ownerId).execute();
    }
  }, 15000);
});
