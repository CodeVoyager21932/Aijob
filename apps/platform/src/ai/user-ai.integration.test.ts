import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,it,expect } from "vitest";
import { createDatabase,migrateToLatest } from "@aijob/database";
import { loadAppConfig } from "@aijob/config";
import { sql } from "kysely";
import { z } from "zod";
import { createAnonymousSession } from "../identity/session-repository.js";
import { loadUserAiConnection,saveUserAiSettings,userAiSettings,userAiAvailability,userBudgetProvider } from "./user-ai-service.js";
import { userProviderFetch } from "./user-provider-fetch.js";
const url=process.env.AIJOB_TEST_DATABASE_URL;
(url?describe:describe.skip)("owner supplied API connections",()=>{
 const db=createDatabase(url??"postgresql://unused"),config=loadAppConfig({rootDirectory:process.cwd(),overrideEnvironment:{APP_ENV:"test",DATABASE_URL:url??"postgresql://unused",RESUME_ENCRYPTION_KEY:"a".repeat(64),ENABLE_AI:"false"}});
 const context=async()=>(await createAnonymousSession({db})).context;
 const settings=(key="fixture-secret")=>({expectedRevision:0,baseUrl:"https://fixture.example/v1",model:"test-model",apiKey:key,dailyCalls:2,dailyTokens:100000});
 beforeAll(()=>migrateToLatest(db),60000);afterAll(()=>db.destroy());
 it("keeps credentials encrypted and owner isolated, preserves keys on edits, and never uses an operator model",async()=>{
  const owner=await context(),other=await context();const response=await saveUserAiSettings(db,owner,config,settings());
  expect(JSON.stringify(response)).not.toContain("fixture-secret");expect((await userAiSettings(db,other)).settings).toBeNull();expect((await userAiAvailability(db,other)).enabled).toBe(false);
  const encrypted=(await sql<{ciphertext:Buffer}>`SELECT ciphertext FROM profile.ai_connections WHERE owner_id=${owner.ownerId}`.execute(db)).rows[0]!;expect(encrypted.ciphertext.toString()).not.toContain("fixture-secret");
  const {apiKey:_key,...changed}=settings();await saveUserAiSettings(db,owner,config,{...changed,expectedRevision:1,model:"another-model"});
  expect((await loadUserAiConnection(db,owner,config)).apiKey).toBe("fixture-secret");
  await expect(saveUserAiSettings(db,owner,config,{...changed,expectedRevision:1})).rejects.toMatchObject({code:"AI_SETTINGS_CONFLICT"});
  await expect(loadUserAiConnection(db,owner,config,1,response.settings!.connectionId)).rejects.toMatchObject({code:"AI_CONNECTION_CHANGED"});
 });
 it("counts failures per owner, supports prompt JSON mode and does not charge another owner's budget",async()=>{
  const owner=await context(),other=await context();await saveUserAiSettings(db,owner,config,{...settings(),jsonMode:"prompt"});await saveUserAiSettings(db,other,config,settings("other-secret"));
  const connection=await loadUserAiConnection(db,owner,config),payload={systemInstruction:'返回 JSON',untrustedPayload:{text:"连接测试"},schema:z.object({ok:z.boolean()})};
  let body:Record<string,unknown>={};
  await userBudgetProvider({db,owner,connection,purpose:"connection_test",fetchImpl:async(_u,init)=>{body=JSON.parse(String(init?.body));return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}));}}).completeStructured(payload);
  expect(body.response_format).toBeUndefined();
  await expect(userBudgetProvider({db,owner,connection,purpose:"connection_test",fetchImpl:async()=>new Response('',{status:429})}).completeStructured(payload)).rejects.toThrow();
  const usage=(await userAiSettings(db,owner)).usage;expect(usage).toMatchObject({calls:2,completed:1,failed:1,running:0});
  expect((await userAiSettings(db,other)).usage.calls).toBe(0);
  await expect(userBudgetProvider({db,owner,connection,purpose:"connection_test",fetchImpl:async()=>{throw new Error("must not call");}}).completeStructured(payload)).rejects.toMatchObject({code:"AI_BUDGET_EXHAUSTED"});
 });
 it("invalidates queued configuration identity even after deleting and recreating revision one",async()=>{
  const owner=await context();const first=(await saveUserAiSettings(db,owner,config,settings())).settings!;
  await sql`DELETE FROM profile.ai_connections WHERE owner_id=${owner.ownerId}`.execute(db);
  const second=(await saveUserAiSettings(db,owner,config,settings("replacement-key"))).settings!;
  expect(second.revision).toBe(first.revision);expect(second.connectionId).not.toBe(first.connectionId);
  await expect(loadUserAiConnection(db,owner,config,first.revision,first.connectionId)).rejects.toMatchObject({code:"AI_CONNECTION_CHANGED"});
 });
 it("blocks private and malformed endpoints before a request can leave the worker",async()=>{
  for(const endpoint of ['http://127.0.0.1/v1/chat/completions','https://127.0.0.1/v1/chat/completions','https://169.254.169.254/v1/chat/completions','https://[::1]/v1/chat/completions','https://example.test:9443/v1/chat/completions'])await expect(userProviderFetch(endpoint,{method:'POST',body:'{}'})).rejects.toThrow();
 });
});
