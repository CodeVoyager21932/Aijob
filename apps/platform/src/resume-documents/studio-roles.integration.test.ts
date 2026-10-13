import { randomUUID } from "node:crypto";
import { CreateAssistantSessionSchema } from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession } from "../identity/session-repository.js";
import { createAssistantSession, assistantSession } from "../ai/assistant-service.js";
import { createStudioDocument, getStudioDraft, saveStudioDraft } from "./studio-service.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("studio database runtime boundaries", () => {
  const roleUrl = (role: string) => {
    if (!url) return "postgresql://unused";
    const result = new URL(url ?? "postgresql://unused");
    result.searchParams.set("options", `-c role=${role}`);
    return result.toString();
  };
  const db=createDatabase(url ?? "postgresql://unused"), web=createDatabase(roleUrl("aijob_web_api")),
    match=createDatabase(roleUrl("aijob_match_worker")), collector=createDatabase(roleUrl("aijob_collector_worker"));
  beforeAll(()=>migrateToLatest(db),120000);
  afterAll(async()=>{await Promise.all([db.destroy(),web.destroy(),match.destroy(),collector.destroy()]);});
  it("creates and saves with the web role, reads with the match role and denies the collector", async()=>{
    expect((await sql<{current_user:string}>`SELECT current_user`.execute(web)).rows[0]?.current_user).toBe("aijob_web_api");
    const owner=(await createAnonymousSession({db:web})).context;
    const draft=await createStudioDocument(web,owner,{title:"角色权限夹具"},randomUUID());
    const saved=await saveStudioDraft(web,owner,draft.documentId,{expectedRevision:draft.revision,title:draft.title,content:draft.content,layout:draft.layout},randomUUID());
    expect((await getStudioDraft(match,owner,draft.documentId)).revision).toBe(saved.revision);
    const session=await createAssistantSession(web,owner,CreateAssistantSessionSchema.parse({task:"resume_review",context:{documentId:draft.documentId}}),randomUUID(),true);
    expect((await assistantSession(match,owner,session.id)).id).toBe(session.id);
    for(const table of ["resume_document_drafts","resume_originals","experiences","ai_connections","assistant_sessions"]){
      await expect(sql`SELECT 1 FROM ${sql.id("profile",table)} LIMIT 1`.execute(collector)).rejects.toMatchObject({code:"42501"});
    }
  });
});
