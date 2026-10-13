import { randomUUID } from "node:crypto";
import { blankResumeEntry, CreatePlannerItemRequestSchema, resumeRichText } from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlannerItem } from "../planner/service.js";
import { processOwnerDeletion, requestOwnerDeletion } from "../profile/deletion-service.js";
import { enqueueExpiredOwnerDeletions } from "../profile/retention-service.js";
import { createStudioImport, downloadStudioOriginal } from "../resume-documents/studio-import.js";
import {
  assertActiveOwnerEpoch,
  createAnonymousSession,
  findActiveSession,
  getCareerOwner,
  retainOwnerAssetsAfterMaterialSave,
} from "./session-repository.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("persistent guest retention", () => {
  const db = createDatabase(url ?? "postgresql://unused"),
    key = "a".repeat(64);
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  it("retains original files after the finite browser session expires and never pretends to have an account", async () => {
    const now = new Date(),
      old = new Date(now.valueOf() - 40 * 86400000),
      session = await createAnonymousSession({ db }),
      owner = session.context;
    await db
      .updateTable("identity.owner_sessions")
      .set({ created_at: old, expires_at: new Date(old.valueOf() + 30 * 86400000) })
      .where("id", "=", owner.sessionId)
      .execute();
    expect(await findActiveSession({ db, sessionToken: session.sessionToken, now })).toBeNull();
    await expect(
      assertActiveOwnerEpoch(db, owner.ownerId, owner.ownerEpoch, now),
    ).resolves.toBeUndefined();
    const file = Buffer.from("retained original fixture");
    const imported = await createStudioImport(
      db,
      owner,
      { filename: "留存验证.pdf", mediaType: "application/pdf", buffer: file, encryptionKey: key },
      randomUUID(),
    );
    const original = imported.originals[0];
    if (!original) throw new Error("Original missing");
    await enqueueExpiredOwnerDeletions({ db, now });
    expect(await getCareerOwner({ db, ...owner })).toMatchObject({
      retentionMode: "persistent_guest",
      retentionExpiresAt: null,
      accountId: null,
      status: "active",
    });
    expect((await downloadStudioOriginal(db, owner, original.id, key)).buffer).toEqual(file);
    expect(
      await db
        .selectFrom("task_queue.tasks")
        .select("id")
        .where("owner_id", "=", owner.ownerId)
        .where("task_type", "=", "owner_deletion")
        .execute(),
    ).toEqual([]);
  });
  it("upgrades only the active owner of an explicit material save, rolls back together, and refuses expired or deleted owners", async () => {
    const a = await createAnonymousSession({ db, retentionMode: "anonymous_ttl" }),
      b = await createAnonymousSession({ db, retentionMode: "anonymous_ttl" });
    await assertActiveOwnerEpoch(db, a.context.ownerId, 1);
    expect((await getCareerOwner({ db, ...a.context }))?.retentionMode).toBe("anonymous_ttl");
    await expect(
      db.transaction().execute(async (tx) => {
        await retainOwnerAssetsAfterMaterialSave(tx, a.context);
        throw new Error("save failed");
      }),
    ).rejects.toThrow("save failed");
    expect((await getCareerOwner({ db, ...a.context }))?.retentionMode).toBe("anonymous_ttl");
    await db.transaction().execute((tx) => retainOwnerAssetsAfterMaterialSave(tx, a.context));
    expect((await getCareerOwner({ db, ...a.context }))?.retentionMode).toBe("persistent_guest");
    expect((await getCareerOwner({ db, ...b.context }))?.retentionMode).toBe("anonymous_ttl");
    const expired = await createAnonymousSession({
      db,
      retentionMode: "anonymous_ttl",
    });
    await db
      .updateTable("identity.owners")
      .set({ retention_expires_at: new Date(Date.now() - 1000) })
      .where("id", "=", expired.context.ownerId)
      .execute();
    await expect(
      db.transaction().execute((tx) => retainOwnerAssetsAfterMaterialSave(tx, expired.context)),
    ).rejects.toThrow("OWNER_EPOCH_STALE");
    await expect(
      db
        .updateTable("identity.owners")
        .set({ retention_mode: "account_managed" })
        .where("id", "=", a.context.ownerId)
        .execute(),
    ).rejects.toThrow("ACCOUNT_MANAGED_OWNER_REQUIRES_ACTIVE_ACCOUNT");
    await expect(
      db
        .updateTable("identity.owners")
        .set({ retention_expires_at: new Date() })
        .where("id", "=", a.context.ownerId)
        .execute(),
    ).rejects.toThrow("owners_retention_mode_consistent");
  });
  it("still deletes originals, full experiences and linked preparations through the existing deletion worker, and fences late saves", async () => {
    const owner = (await createAnonymousSession({ db })).context,
      experienceId = randomUUID();
    const imported = await createStudioImport(
      db,
      owner,
      {
        filename: "删除验证.pdf",
        mediaType: "application/pdf",
        buffer: Buffer.from("delete fixture"),
        encryptionKey: key,
      },
      randomUUID(),
    );
    const entry = {
      ...blankResumeEntry(randomUUID()),
      title: "完成的项目",
      body: resumeRichText("整理过程并交付报告"),
    };
    await sql`INSERT INTO profile.experiences(id,owner_id,owner_epoch,kind,title,entry,capture_hash) VALUES(${experienceId},${owner.ownerId},${owner.ownerEpoch},'project',${entry.title},${JSON.stringify(entry)}::jsonb,${randomUUID()})`.execute(
      db,
    );
    await createPlannerItem({
      db,
      owner,
      local: true,
      idempotencyKey: randomUUID(),
      request: CreatePlannerItemRequestSchema.parse({
        kind: "preparation",
        title: "整理讲述",
        sourceExperienceIds: [experienceId],
      }),
    });
    const requested = await requestOwnerDeletion({ db, owner }),
      now = new Date(),
      leaseOwner = `persistent-delete-${randomUUID()}`;
    const task = await db
      .updateTable("task_queue.tasks")
      .set({
        status: "running",
        attempt: 1,
        lease_owner: leaseOwner,
        lease_until: new Date(now.valueOf() + 60000),
        heartbeat_at: now,
        fencing_token: 1,
      })
      .where("task_type", "=", "owner_deletion")
      .where("owner_id", "=", owner.ownerId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await processOwnerDeletion({
      db,
      deletionId: requested.deletion.id,
      ownerId: owner.ownerId,
      requestedOwnerEpoch: owner.ownerEpoch,
      lease: {
        taskId: task.id,
        taskType: "owner_deletion",
        ownerId: owner.ownerId,
        ownerEpoch: owner.ownerEpoch,
        leaseOwner,
        fencingToken: 1,
      },
      now,
    });
    expect(
      (
        await sql`SELECT id FROM profile.resume_originals WHERE owner_id=${owner.ownerId}`.execute(
          db,
        )
      ).rows,
    ).toEqual([]);
    expect(
      (await sql`SELECT id FROM profile.experiences WHERE owner_id=${owner.ownerId}`.execute(db))
        .rows,
    ).toEqual([]);
    expect(
      await db
        .selectFrom("application.planner_items")
        .select("id")
        .where("owner_id", "=", owner.ownerId)
        .execute(),
    ).toEqual([]);
    const original = imported.originals[0];
    if (!original) throw new Error("Original missing");
    await expect(downloadStudioOriginal(db, owner, original.id, key)).rejects.toThrow();
    await expect(
      db.transaction().execute((tx) => retainOwnerAssetsAfterMaterialSave(tx, owner)),
    ).rejects.toThrow("OWNER_EPOCH_STALE");
  });
});
