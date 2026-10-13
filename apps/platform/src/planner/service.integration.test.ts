import { randomUUID } from "node:crypto";
import {
  CreatePlannerItemRequestSchema,
  JobGraphScopeSchema,
  PlannerListQuerySchema,
  UpdatePlannerItemRequestSchema,
} from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createAnonymousSession } from "../identity/session-repository.js";
import { requestOwnerDeletion, processOwnerDeletion } from "../profile/deletion-service.js";
import {
  createPlannerItem,
  updatePlannerItem,
  deletePlannerItem,
  listPlannerItems,
  saveSearch,
  listSavedSearches,
  plannerCalendar,
} from "./service.js";
const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("personal planner in PostgreSQL", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  const owners: string[] = [];
  beforeAll(() => migrateToLatest(db), 60000);
  afterAll(async () => {
    if (owners.length) {
      for (const table of [
        "application.planner_items",
        "application.saved_searches",
        "application.planner_mutation_receipts",
        "task_queue.tasks",
        "identity.owner_sessions",
      ] as const)
        await db.deleteFrom(table).where("owner_id", "in", owners).execute();
      await sql`DELETE FROM decision_feedback_audit.audit_events WHERE subject_id IN (SELECT id::text FROM decision.owner_deletions WHERE owner_id = ANY(${owners}::uuid[]))`.execute(
        db,
      );
      await db.deleteFrom("decision.owner_deletions").where("owner_id", "in", owners).execute();
      await db.deleteFrom("identity.owners").where("id", "in", owners).execute();
    }
    await db.destroy();
  });
  async function context() {
    const session = await createAnonymousSession({ db });
    owners.push(session.context.ownerId);
    return { db, owner: session.context, local: true };
  }
  const request = () =>
    CreatePlannerItemRequestSchema.parse({
      kind: "preparation",
      title: "完成一份数据分析报告",
      dueAt: "2026-09-08T10:00:00+08:00",
    });
  it("serializes retries, enforces owner isolation and optimistic revisions, and never turns a completed preparation into evidence", async () => {
    const a = await context(),
      b = await context(),
      idempotencyKey = randomUUID();
    const input = { ...a, request: request(), idempotencyKey };
    const [first, replay] = await Promise.all([createPlannerItem(input), createPlannerItem(input)]);
    expect(first).toEqual(replay);
    expect(
      (await listPlannerItems({ ...b, query: PlannerListQuerySchema.parse({}) })).items,
    ).toHaveLength(0);
    await expect(
      updatePlannerItem({
        ...b,
        itemId: first.id,
        idempotencyKey: randomUUID(),
        request: UpdatePlannerItemRequestSchema.parse({ ...request(), expectedRevision: 1 }),
      }),
    ).rejects.toMatchObject({ code: "PLANNER_ITEM_NOT_FOUND" });
    const updated = await updatePlannerItem({
      ...a,
      itemId: first.id,
      idempotencyKey: randomUUID(),
      request: UpdatePlannerItemRequestSchema.parse({
        ...request(),
        status: "done",
        artifact: "已完成报告，等待确认是否可作为经历",
        expectedRevision: 1,
      }),
    });
    expect(updated.revision).toBe(2);
    expect(updated.completedAt).not.toBeNull();
    expect(
      (await listPlannerItems({ ...a, query: PlannerListQuerySchema.parse({}) })).items,
    ).toHaveLength(0);
    expect(
      await db
        .selectFrom("profile.resume_evidence_revisions")
        .select("id")
        .where("owner_id", "=", a.owner.ownerId)
        .execute(),
    ).toHaveLength(0);
    await expect(
      updatePlannerItem({
        ...a,
        itemId: first.id,
        idempotencyKey: randomUUID(),
        request: UpdatePlannerItemRequestSchema.parse({ ...request(), expectedRevision: 1 }),
      }),
    ).rejects.toMatchObject({ code: "PLANNER_REVISION_CONFLICT" });
    await deletePlannerItem({
      ...a,
      itemId: first.id,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
    });
    await expect(createPlannerItem(input)).rejects.toMatchObject({ code: "PLANNER_ITEM_DELETED" });
    const receipts = await db
      .selectFrom("application.planner_mutation_receipts")
      .select("result")
      .where("owner_id", "=", a.owner.ownerId)
      .execute();
    expect(JSON.stringify(receipts)).not.toContain("数据分析报告");
  });
  it("deduplicates equivalent saved scopes and rejects missing or foreign references", async () => {
    const a = await context();
    const scope = JobGraphScopeSchema.parse({ cities: ["上海", "北京"] });
    const first = await saveSearch({
      ...a,
      request: { label: "产品方向", scope },
      idempotencyKey: randomUUID(),
    });
    const second = await saveSearch({
      ...a,
      request: { label: "持续关注", scope: { ...scope, cities: ["北京", "上海", "上海"] } },
      idempotencyKey: randomUUID(),
    });
    expect(first.id).toBe(second.id);
    expect((await listSavedSearches(a)).items).toHaveLength(1);
    await expect(
      createPlannerItem({
        ...a,
        request: { ...request(), caseId: randomUUID() },
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "APPLICATION_CASE_NOT_FOUND" });
    await expect(
      createPlannerItem({
        ...a,
        request: { ...request(), evidenceRevisionId: randomUUID(), evidenceIds: ["foreign"] },
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_NOT_FOUND" });
  });
  it("purges planner data through the real owner deletion worker and fences late writes", async () => {
    const a = await context();
    await createPlannerItem({ ...a, request: request(), idempotencyKey: randomUUID() });
    await saveSearch({
      ...a,
      request: { label: "删除夹具", scope: JobGraphScopeSchema.parse({}) },
      idempotencyKey: randomUUID(),
    });
    const requested = await requestOwnerDeletion(a);
    const now = new Date();
    const leaseOwner = `planner-delete-${randomUUID()}`;
    const task = await db
      .updateTable("task_queue.tasks")
      .set({
        status: "running",
        attempt: 1,
        lease_owner: leaseOwner,
        lease_until: new Date(now.getTime() + 60000),
        heartbeat_at: now,
        fencing_token: 1,
      })
      .where("task_type", "=", "owner_deletion")
      .where("owner_id", "=", a.owner.ownerId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await processOwnerDeletion({
      db,
      deletionId: requested.deletion.id,
      ownerId: a.owner.ownerId,
      requestedOwnerEpoch: a.owner.ownerEpoch,
      lease: {
        taskId: task.id,
        taskType: "owner_deletion",
        ownerId: a.owner.ownerId,
        ownerEpoch: a.owner.ownerEpoch,
        leaseOwner,
        fencingToken: 1,
      },
      now,
    });
    for (const table of [
      "application.planner_items",
      "application.saved_searches",
      "application.planner_mutation_receipts",
    ] as const)
      expect(
        await db
          .selectFrom(table)
          .select("owner_id")
          .where("owner_id", "=", a.owner.ownerId)
          .execute(),
      ).toHaveLength(0);
    await expect(
      createPlannerItem({ ...a, request: request(), idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "OWNER_EPOCH_STALE" });
    await expect(
      db
        .insertInto("application.saved_searches")
        .values({
          id: randomUUID(),
          owner_id: a.owner.ownerId,
          owner_epoch: a.owner.ownerEpoch,
          label: "late",
          scope: "{}",
          scope_hash: "0".repeat(64),
        })
        .execute(),
    ).rejects.toThrow("OWNER_EPOCH_STALE");
  });
  it("exports stable calendar identities with UTF-8 folding, UTC deadlines and completed status", async () => {
    const a = await context();
    const item = await createPlannerItem({
      ...a,
      request: {
        ...request(),
        title: "中文安排".repeat(30),
        note: "第一行;第二行,第三行\nBEGIN:VTODO",
      },
      idempotencyKey: randomUUID(),
    });
    const content = plannerCalendar([item]);
    expect(content).toContain("DUE:20260908T020000Z");
    expect(content).toContain(`UID:planner-${item.id}@aijob.local`);
    expect(content).toContain("\\nBEGIN:VTODO");
    expect(content.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(plannerCalendar([item])).toBe(content);
  });
  it("saves and restores complete catalog filters separately from graph filters",async()=>{
    const ctx=await context(),catalogQuery={keyword:"用户研究",companies:["测试企业"],cities:["上海"],availableWeeklyAttendanceDays:3,educationLevels:["硕士"],includeUnknownHardConditions:false,sort:"company_asc"};
    const saved=await saveSearch({...ctx,request:{label:"上海研究实习",scope:JobGraphScopeSchema.parse({}),catalogQuery},idempotencyKey:randomUUID()});
    expect(saved.catalogQuery).toEqual(catalogQuery);
    const listed=await listSavedSearches(ctx);expect(listed.items.find(x=>x.id===saved.id)?.catalogQuery).toEqual(catalogQuery);
    const other=await context();expect((await listSavedSearches(other)).items).toEqual([]);
  });

});
