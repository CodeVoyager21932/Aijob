import { randomUUID } from "node:crypto";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession } from "../identity/session-repository.js";
import { type OwnerTaskLease, withOwnerTaskLease } from "./owner-task-lease.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("owner task lease fencing", () => {
  let db: Kysely<Database>;
  let ownerId: string | undefined;
  const taskId = randomUUID();
  const committedAuditId = randomUUID();
  const staleAuditId = randomUUID();
  const recoveredAuditId = randomUUID();

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
  });

  afterAll(async () => {
    await db
      .deleteFrom("decision_feedback_audit.audit_events")
      .where("id", "in", [committedAuditId, staleAuditId, recoveredAuditId])
      .execute();
    await db.deleteFrom("task_queue.tasks").where("id", "=", taskId).execute();
    if (ownerId) {
      await db.deleteFrom("identity.owner_sessions").where("owner_id", "=", ownerId).execute();
      await db.deleteFrom("identity.owners").where("id", "=", ownerId).execute();
    }
    await db.destroy();
  });

  it("serializes takeover and rolls back every stale business write", async () => {
    const session = await createAnonymousSession({ db });
    ownerId = session.context.ownerId;
    const firstWorker = "lease-test-worker-a";
    const secondWorker = "lease-test-worker-b";
    const leaseUntil = new Date(Date.now() + 60_000);
    await db
      .insertInto("task_queue.tasks")
      .values({
        id: taskId,
        task_type: "match_run",
        owner_id: session.context.ownerId,
        owner_epoch: session.context.ownerEpoch,
        payload: JSON.stringify({ runId: randomUUID() }),
        idempotency_key: `lease-test:${taskId}`,
        status: "running",
        attempt: 1,
        max_attempts: 3,
        available_at: new Date(),
        backoff_policy: JSON.stringify({ kind: "fixed", seconds: 1 }),
        lease_owner: firstWorker,
        lease_until: leaseUntil,
        heartbeat_at: new Date(),
        fencing_token: 1,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();

    const firstLease: OwnerTaskLease = {
      taskId,
      taskType: "match_run",
      ownerId: session.context.ownerId,
      ownerEpoch: session.context.ownerEpoch,
      leaseOwner: firstWorker,
      fencingToken: 1,
    };
    let signalStarted!: () => void;
    let releaseCommit!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });

    const firstCommit = withOwnerTaskLease(db, firstLease, async (transaction) => {
      await transaction
        .insertInto("decision_feedback_audit.audit_events")
        .values({
          id: committedAuditId,
          event_type: "lease_test_committed",
          actor_type: "system",
          subject_type: "task",
          subject_id: taskId,
          metadata: JSON.stringify({ contentIncluded: false }),
        })
        .execute();
      signalStarted();
      await release;
    });
    await started;

    let takeoverSettled = false;
    const takeover = db
      .updateTable("task_queue.tasks")
      .set({
        lease_owner: secondWorker,
        lease_until: new Date(Date.now() + 60_000),
        heartbeat_at: new Date(),
        fencing_token: 2,
      })
      .where("id", "=", taskId)
      .returning("fencing_token")
      .executeTakeFirstOrThrow()
      .then((row) => {
        takeoverSettled = true;
        return row;
      });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(takeoverSettled).toBe(false);

    releaseCommit();
    await firstCommit;
    const takenOver = await takeover;
    expect(takeoverSettled).toBe(true);

    let staleCallbackInvoked = false;
    await expect(
      withOwnerTaskLease(db, firstLease, async (transaction) => {
        staleCallbackInvoked = true;
        await transaction
          .insertInto("decision_feedback_audit.audit_events")
          .values({
            id: staleAuditId,
            event_type: "lease_test_stale",
            actor_type: "system",
            subject_type: "task",
            subject_id: taskId,
            metadata: JSON.stringify({ contentIncluded: false }),
          })
          .execute();
      }),
    ).rejects.toThrow("OWNER_TASK_LEASE_LOST");
    expect(staleCallbackInvoked).toBe(false);
    expect(
      await db
        .selectFrom("decision_feedback_audit.audit_events")
        .select("id")
        .where("id", "=", staleAuditId)
        .executeTakeFirst(),
    ).toBeUndefined();

    await withOwnerTaskLease(
      db,
      {
        ...firstLease,
        leaseOwner: secondWorker,
        fencingToken: Number(takenOver.fencing_token),
      },
      async (transaction) => {
        await transaction
          .insertInto("decision_feedback_audit.audit_events")
          .values({
            id: recoveredAuditId,
            event_type: "lease_test_recovered",
            actor_type: "system",
            subject_type: "task",
            subject_id: taskId,
            metadata: JSON.stringify({ contentIncluded: false }),
          })
          .execute();
      },
    );
    expect(
      await db
        .selectFrom("decision_feedback_audit.audit_events")
        .select("id")
        .where("id", "in", [committedAuditId, recoveredAuditId])
        .execute(),
    ).toHaveLength(2);
  });
});
