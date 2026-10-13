import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { JobSearchQuerySchema } from "@aijob/contracts";
import { createAnonymousSession } from "../identity/session-repository.js";
import { provisionBenchmarkJob } from "../performance/fixtures.js";
import { listBookmarks, putBookmark } from "./bookmarks.js";
import { createCatalogRepository } from "./repository.js";
import { reconcilePublication } from "./publication-reconciliation.js";
const url=process.env.AIJOB_TEST_DATABASE_URL;
(url?describe:describe.skip)("bookmarks independent of applications",()=>{
 const db=createDatabase(url??"postgresql://unused");
 beforeAll(()=>migrateToLatest(db),120000);afterAll(()=>db.destroy());
 it("isolates owners, replays concurrent saves and never creates a Case or a planner item",async()=>{
  const {context:owner}=await createAnonymousSession({db}),{context:other}=await createAnonymousSession({db});
  const fixture=await provisionBenchmarkJob(db,`bookmark-${randomUUID()}`),key=randomUUID();
  const both=await Promise.all([1,2].map(()=>putBookmark(db,owner,fixture.publishedJobId,{saved:true,expectedRevision:0},key,false)));
  expect(both[0]).toEqual(both[1]);expect((await listBookmarks(db,other)).items).toEqual([]);
  expect(await db.selectFrom("application.application_cases").select("id").where("owner_id","=",owner.ownerId).execute()).toHaveLength(0);
  expect(await db.selectFrom("application.planner_items").select("id").where("owner_id","=",owner.ownerId).execute()).toHaveLength(0);
  await expect(putBookmark(db,owner,fixture.publishedJobId,{saved:false,expectedRevision:0},randomUUID(),false)).rejects.toMatchObject({code:"BOOKMARK_CHANGED"});
  const removed=await putBookmark(db,owner,fixture.publishedJobId,{saved:false,expectedRevision:1},randomUUID(),false);expect(removed.saved).toBe(false);
 });
 it("binds catalog pagination to the saved set and does not show withdrawn sources",async()=>{
  const a=await provisionBenchmarkJob(db,`bookmark-a-${randomUUID()}`),b=await provisionBenchmarkJob(db,`bookmark-b-${randomUUID()}`);
  const repo=createCatalogRepository({db,enableLocalMvp:false}),query=JobSearchQuerySchema.parse({jobIds:[a.publishedJobId,b.publishedJobId],sort:"company_asc",limit:1});
  const first=await repo.search(query);expect(first.items).toHaveLength(1);expect(first.nextCursor).toBeTruthy();
  const next=await repo.search({...query,cursor:first.nextCursor??undefined});expect(next.items).toHaveLength(1);expect(first.items[0]?.id).not.toBe(next.items[0]?.id);
  expect((await repo.search({...query,jobIds:[]})).items).toEqual([]);
  await db.updateTable("source_control.source_policy_versions").set({policy_status:"pending_review"}).where("source_id","=",a.sourceId).execute();
  await reconcilePublication({db,publishedJobIds:[a.publishedJobId]});
  const after=await repo.search({...query,limit:20});expect(after.items.map(v=>v.id)).not.toContain(a.publishedJobId);
 });
});
