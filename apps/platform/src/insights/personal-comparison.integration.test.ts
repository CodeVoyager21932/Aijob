import { randomUUID } from "node:crypto";
import {
  blankResumeEntry,
  CreatePlannerItemRequestSchema,
  PlannerListQuerySchema,
  resumeRichText,
  UpdatePlannerItemRequestSchema,
} from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession, type OwnerScope } from "../identity/session-repository.js";
import { createPlannerItem, listPlannerItems, updatePlannerItem } from "../planner/service.js";
import { comparePersonalGraphItem } from "./personal-comparison.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("whole experiences in personal graph and preparation", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  const context = async () => ({
    db,
    owner: (await createAnonymousSession({ db })).context,
    local: true,
  });
  async function experience(
    owner: OwnerScope,
    text = "使用 SQL 分析课程调查结果，整理访谈并提交报告。",
  ) {
    const id = randomUUID(),
      entry = {
        ...blankResumeEntry(randomUUID()),
        title: "课程调研",
        role: "研究成员",
        body: resumeRichText(text),
      };
    await sql`INSERT INTO profile.experiences(id,owner_id,owner_epoch,kind,title,entry,capture_hash) VALUES(${id},${owner.ownerId},${owner.ownerEpoch},'project',${entry.title},${JSON.stringify(entry)}::jsonb,${randomUUID()})`.execute(
      db,
    );
    return { id, entry };
  }
  const item = { key: "tool:sql", label: "SQL", kind: "tool" as const };
  it("uses current complete experience directly, isolates accounts, and links it to a preparation task", async () => {
    const a = await context(),
      b = await context(),
      source = await experience(a.owner);
    const result = await comparePersonalGraphItem({ ...a, item });
    expect(result.evidenceRevisionId).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      experienceId: source.id,
      experienceRevision: 1,
      statement: "使用 SQL 分析课程调查结果，整理访谈并提交报告。",
    });
    expect((await comparePersonalGraphItem({ ...b, item })).candidates).toEqual([]);
    const request = CreatePlannerItemRequestSchema.parse({
      kind: "preparation",
      title: "解释研究过程",
      sourceExperienceIds: [source.id, source.id],
    });
    const preparation = await createPlannerItem({ ...a, request, idempotencyKey: randomUUID() });
    expect(preparation.sourceExperienceIds).toEqual([source.id]);
    expect(preparation.evidenceRevisionId).toBeNull();
    await expect(
      createPlannerItem({ ...b, request, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "EXPERIENCE_NOT_FOUND" });
    await expect(
      db.transaction().execute(async (tx) => {
        await sql`SET LOCAL ROLE aijob_web_api`.execute(tx);
        await sql`INSERT INTO application.planner_items(id,owner_id,owner_epoch,kind,title,source_experience_ids) VALUES(${randomUUID()},${b.owner.ownerId},${b.owner.ownerEpoch},'preparation','foreign',${JSON.stringify([source.id])}::jsonb)`.execute(
          tx,
        );
      }),
    ).rejects.toThrow("EXPERIENCE_NOT_FOUND");
  });
  it("deleting an experience detaches links, preserves finished work, and prevents stale requests from restoring it", async () => {
    const a = await context(),
      source = await experience(a.owner),
      other = await experience(a.owner, "整理需求文档");
    const request = CreatePlannerItemRequestSchema.parse({
      kind: "preparation",
      title: "已完成研究讲述",
      status: "done",
      artifact: "我自己完成的讲述稿，删除经历后仍需保存。",
      sourceExperienceIds: [source.id, other.id],
    });
    const input = { ...a, request, idempotencyKey: randomUUID() },
      preparation = await createPlannerItem(input);
    await db.transaction().execute(async (tx) => {
      await sql`SET LOCAL ROLE aijob_web_api`.execute(tx);
      await sql`DELETE FROM profile.experiences WHERE id=${source.id} AND owner_id=${a.owner.ownerId}`.execute(
        tx,
      );
    });
    const after = (
      await listPlannerItems({ ...a, query: PlannerListQuerySchema.parse({ status: "all" }) })
    ).items.find((value) => value.id === preparation.id);
    expect(after).toBeDefined();
    if (!after) throw new Error("Preparation should be retained after deleting an experience");
    expect(after.sourceExperienceIds).toEqual([other.id]);
    expect(after.revision).toBe(2);
    expect(after.status).toBe("done");
    expect(after.artifact).toBe(request.artifact);
    expect((await createPlannerItem(input)).sourceExperienceIds).toEqual([other.id]);
    await expect(
      updatePlannerItem({
        ...a,
        itemId: preparation.id,
        idempotencyKey: randomUUID(),
        request: UpdatePlannerItemRequestSchema.parse({ ...request, expectedRevision: 1 }),
      }),
    ).rejects.toMatchObject({ code: "PLANNER_REVISION_CONFLICT" });
    await expect(
      createPlannerItem({ ...a, request, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "EXPERIENCE_NOT_FOUND" });
    expect((await comparePersonalGraphItem({ ...a, item })).candidates).toEqual([]);
  });
});
