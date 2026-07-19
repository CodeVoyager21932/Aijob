import { randomUUID } from "node:crypto";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession, type OwnerContext } from "../identity/session-repository.js";
import { requestOwnerDeletion } from "../profile/deletion-service.js";
import { markOfficialLinkOpened, putJobDecision } from "./service.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("job decision owner fencing", () => {
  let db: Kysely<Database>;
  const ownerIds: string[] = [];
  const jobIds: string[] = [];

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
  });

  afterAll(async () => {
    if (ownerIds.length > 0) {
      await db.deleteFrom("decision.job_decisions").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("task_queue.tasks").where("owner_id", "in", ownerIds).execute();
      const deletions = await db
        .selectFrom("decision.owner_deletions")
        .select("id")
        .where("owner_id", "in", ownerIds)
        .execute();
      if (deletions.length > 0) {
        await db
          .deleteFrom("decision_feedback_audit.audit_events")
          .where(
            "subject_id",
            "in",
            deletions.map((item) => item.id),
          )
          .execute();
      }
      await db.deleteFrom("decision.owner_deletions").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owner_sessions").where("owner_id", "in", ownerIds).execute();
      await db.deleteFrom("identity.owners").where("id", "in", ownerIds).execute();
    }
    if (jobIds.length > 0) {
      await db.deleteFrom("catalog.published_jobs").where("id", "in", jobIds).execute();
    }
    await db.destroy();
  });

  async function fixture(): Promise<{ owner: OwnerContext; publishedJobId: string }> {
    const session = await createAnonymousSession({ db });
    const publishedJobId = randomUUID();
    ownerIds.push(session.context.ownerId);
    jobIds.push(publishedJobId);
    await db
      .insertInto("catalog.published_jobs")
      .values({ id: publishedJobId, current_version_id: null })
      .execute();
    return { owner: session.context, publishedJobId };
  }

  it("rejects a late decision write after deletion revokes the owner epoch", async () => {
    const { owner, publishedJobId } = await fixture();
    await requestOwnerDeletion({ db, owner });

    await expect(
      putJobDecision(db, owner, publishedJobId, {
        expectedRevision: 0,
        status: "saved",
        reason: null,
      }),
    ).rejects.toMatchObject({ code: "OWNER_EPOCH_STALE" });

    const decisions = await db
      .selectFrom("decision.job_decisions")
      .select("owner_id")
      .where("owner_id", "=", owner.ownerId)
      .execute();
    expect(decisions).toHaveLength(0);
  });

  it("rejects a late official-link update after deletion revokes the owner epoch", async () => {
    const { owner, publishedJobId } = await fixture();
    await putJobDecision(db, owner, publishedJobId, {
      expectedRevision: 0,
      status: "saved",
      reason: null,
    });
    await requestOwnerDeletion({ db, owner });

    await expect(markOfficialLinkOpened(db, owner, publishedJobId)).rejects.toMatchObject({
      code: "OWNER_EPOCH_STALE",
    });
    const decision = await db
      .selectFrom("decision.job_decisions")
      .select("official_link_opened_at")
      .where("owner_id", "=", owner.ownerId)
      .where("published_job_id", "=", publishedJobId)
      .executeTakeFirstOrThrow();
    expect(decision.official_link_opened_at).toBeNull();
  });

  it("waits for a concurrent owner revocation and then rejects the stale write", async () => {
    const { owner, publishedJobId } = await fixture();
    let releaseRevocation!: () => void;
    let reportOwnerLocked!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    const ownerLocked = new Promise<void>((resolve) => {
      reportOwnerLocked = resolve;
    });

    const revocation = db.transaction().execute(async (transaction) => {
      await transaction
        .selectFrom("identity.owners")
        .select("id")
        .where("id", "=", owner.ownerId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("identity.owners")
        .set({ status: "deletion_pending", epoch: owner.ownerEpoch + 1 })
        .where("id", "=", owner.ownerId)
        .executeTakeFirstOrThrow();
      reportOwnerLocked();
      await release;
    });

    await ownerLocked;
    const staleWrite = putJobDecision(db, owner, publishedJobId, {
      expectedRevision: 0,
      status: "saved",
      reason: null,
    });
    const settlement = staleWrite.then(
      () => "fulfilled" as const,
      () => "rejected" as const,
    );
    const whileOwnerLocked = await Promise.race([
      settlement,
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);
    expect(whileOwnerLocked).toBe("pending");
    releaseRevocation();
    await revocation;

    await expect(staleWrite).rejects.toMatchObject({ code: "OWNER_EPOCH_STALE" });
    const decisions = await db
      .selectFrom("decision.job_decisions")
      .select("owner_id")
      .where("owner_id", "=", owner.ownerId)
      .execute();
    expect(decisions).toHaveLength(0);
  });
});
