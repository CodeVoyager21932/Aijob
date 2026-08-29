import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession } from "../identity/session-repository.js";
import {
  failOwnerTask,
  finishOwnerTask,
  renewOwnerTaskLease,
  runOneOwnerTask,
} from "./owner-task-worker.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("owner task worker lease transitions", () => {
  let db: Kysely<Database>;
  let ownerId: string;
  let ownerEpoch: number;
  const taskIds: string[] = [];
  // `runOneOwnerTask` claims across the whole queue by design, so assertions about "nothing was
  // claimable" only hold when no other suite left a claimable task in the shared test database.
  // Park foreign tasks for the duration of this suite and restore them afterwards.
  const parkedTasks: { id: string; availableAt: Date; leaseUntil: Date | null }[] = [];
  const parkedUntil = new Date("2999-01-01T00:00:00.000Z");

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
    const session = await createAnonymousSession({ db });
    ownerId = session.context.ownerId;
    ownerEpoch = session.context.ownerEpoch;
    const foreignTasks = await db
      .selectFrom("task_queue.tasks")
      .select(["id", "available_at", "lease_until"])
      .where("owner_id", "<>", ownerId)
      .execute();
    for (const task of foreignTasks) {
      parkedTasks.push({
        id: task.id,
        availableAt: task.available_at,
        leaseUntil: task.lease_until,
      });
    }
    if (parkedTasks.length > 0) {
      await db
        .updateTable("task_queue.tasks")
        .set({ available_at: parkedUntil, lease_until: parkedUntil })
        .where(
          "id",
          "in",
          parkedTasks.map((task) => task.id),
        )
        .execute();
    }
  });

  afterAll(async () => {
    for (const task of parkedTasks) {
      await db
        .updateTable("task_queue.tasks")
        .set({ available_at: task.availableAt, lease_until: task.leaseUntil })
        .where("id", "=", task.id)
        .execute();
    }
    await db.deleteFrom("task_queue.tasks").where("id", "in", taskIds).execute();
    await db.deleteFrom("identity.owner_sessions").where("owner_id", "=", ownerId).execute();
    await db.deleteFrom("identity.owners").where("id", "=", ownerId).execute();
    await db.destroy();
  });

  async function insertExpiredTask(attempt: number, maxAttempts: number) {
    const id = randomUUID();
    taskIds.push(id);
    await db
      .insertInto("task_queue.tasks")
      .values({
        id,
        task_type: "match_run",
        owner_id: ownerId,
        owner_epoch: ownerEpoch,
        payload: JSON.stringify({ runId: randomUUID() }),
        idempotency_key: `owner-worker-test:${id}`,
        status: "running",
        attempt,
        max_attempts: maxAttempts,
        available_at: new Date(Date.now() - 120_000),
        backoff_policy: JSON.stringify({ kind: "fixed", seconds: 1 }),
        lease_owner: "stale-worker",
        lease_until: new Date(Date.now() - 60_000),
        heartbeat_at: new Date(Date.now() - 120_000),
        fencing_token: 1,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();
    return db
      .selectFrom("task_queue.tasks")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  }

  it("marks an expired final attempt dead instead of claiming attempt max plus one", async () => {
    const task = await insertExpiredTask(3, 3);
    await expect(
      runOneOwnerTask({
        db,
        config: {} as AppConfig,
        workerId: "replacement-worker",
        now: new Date(),
      }),
    ).resolves.toBe(false);
    await expect(
      db
        .selectFrom("task_queue.tasks")
        .select(["status", "attempt", "last_error_code"])
        .where("id", "=", task.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      status: "dead",
      attempt: 3,
      last_error_code: "OWNER_TASK_ATTEMPTS_EXHAUSTED",
    });
  });

  it("does not let an expired lease renew, finish or requeue", async () => {
    const renewTask = await insertExpiredTask(1, 3);
    const finishTask = await insertExpiredTask(1, 3);
    const failTask = await insertExpiredTask(1, 3);
    const now = new Date();
    await expect(renewOwnerTaskLease(db, renewTask, "stale-worker", now)).rejects.toThrow(
      "OWNER_TASK_LEASE_LOST",
    );
    await expect(finishOwnerTask(db, finishTask, "stale-worker", now)).rejects.toThrow(
      "OWNER_TASK_LEASE_LOST",
    );
    await expect(
      failOwnerTask(db, failTask, "stale-worker", new Error("FAILED"), now),
    ).rejects.toThrow("OWNER_TASK_LEASE_LOST");
  });
});
