import { randomUUID } from 'node:crypto';
import { chineseResumeSample, resumeTemplateLayout, type ResumeStudioDraft } from '@aijob/contracts';
import { createDatabase, migrateToLatest } from '@aijob/database';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAnonymousSession } from '../identity/session-repository.js';
import { beginOwnerDeletion } from '../profile/deletion-service.js';
import { deleteResumeDocument } from '../career-assets/deletion-service.js';
import { createStudioDocument, saveStudioDraft, checkpointStudioDraft } from './studio-service.js';
import { createResumeExport, downloadResumeExport, deleteResumeExport, listResumeExports, type ExportArtifactInput } from './export-artifacts.js';

const url=process.env.AIJOB_TEST_DATABASE_URL;
(url?describe:describe.skip)('retained export artifacts / PostgreSQL',()=>{
  const db=createDatabase(url??'postgresql://unused');
  beforeAll(()=>migrateToLatest(db),120000); afterAll(()=>db.destroy());
  async function fixture(){
    const owner=(await createAnonymousSession({db})).context;
    let draft=await createStudioDocument(db,owner,{title:'合成导出测试'},randomUUID());
    draft=await saveStudioDraft(db,owner,draft.documentId,{expectedRevision:draft.revision,title:draft.title,content:chineseResumeSample('short'),layout:resumeTemplateLayout('lapis_cn')},randomUUID());
    const pair=await checkpointStudioDraft(db,owner,draft.documentId,draft.revision);
    const input:ExportArtifactInput={db,owner,documentId:draft.documentId,request:{format:'docx',...pair},idempotencyKey:randomUUID(),encryptionKey:'b'.repeat(64)};
    return {input,draft};
  }
  it('generates once, encrypts bytes, reuses paired versions and rejects cross-owner access',async()=>{
    const {input,draft}=await fixture();
    const file=await createResumeExport(input); // real DOCX pipeline, all manifest fields/links checked
    expect(file.state).toBe('ready'); expect(file.pageCount).toBeNull();
    const data=await downloadResumeExport(db,input.owner,file.id,input.encryptionKey);
    expect(data.buffer.subarray(0,2).toString()).toBe('PK');
    let called=0;
    const repeated=await createResumeExport({...input,idempotencyKey:randomUUID()},async()=>{called++;throw new Error('must use retained bytes');});
    expect(repeated.id).toBe(file.id);expect(called).toBe(0);
    expect((await downloadResumeExport(db,input.owner,file.id,input.encryptionKey)).buffer.equals(data.buffer)).toBe(true);
    const other=(await createAnonymousSession({db})).context;
    await expect(downloadResumeExport(db,other,file.id,input.encryptionKey)).rejects.toMatchObject({statusCode:404});
    await expect(createResumeExport({...input,request:{...input.request,format:'pdf'}})).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_REUSED'});
    await saveStudioDraft(db,input.owner,draft.documentId,{expectedRevision:draft.revision,title:draft.title,content:{...draft.content,basics:{...draft.content.basics,name:'修改后的合成姓名'}},layout:draft.layout},randomUUID());
    expect((await downloadResumeExport(db,input.owner,file.id,input.encryptionKey)).sha256).toBe(file.sha256);
    const stored=(await sql<{ciphertext:Buffer}>`SELECT ciphertext FROM profile.resume_export_artifacts WHERE id=${file.id}`.execute(db)).rows[0];
    expect(stored?.ciphertext.equals(data.buffer)).toBe(false);
    await deleteResumeExport(db,input.owner,file.id);
    await expect(createResumeExport(input)).rejects.toMatchObject({code:'RESUME_EXPORT_DELETED'});
    await expect(downloadResumeExport(db,input.owner,file.id,input.encryptionKey)).rejects.toMatchObject({statusCode:404});
    expect((await listResumeExports(db,input.owner,input.documentId)).items).toHaveLength(0);
  });
  it('rejects mismatched revisions and a layout from another document',async()=>{
    const {input,draft}=await fixture();
    const next=await saveStudioDraft(db,input.owner,draft.documentId,{expectedRevision:draft.revision,title:draft.title,content:draft.content,layout:resumeTemplateLayout('rx_gengar')},randomUUID());
    const pair=await checkpointStudioDraft(db,input.owner,next.documentId,next.revision);
    await expect(createResumeExport({...input,request:{...input.request,layoutRevisionId:pair.layoutRevisionId}})).rejects.toMatchObject({code:'RESUME_VERSION_PAIR_MISMATCH'});
    const other=await fixture();
    await expect(createResumeExport({...input,request:{...input.request,layoutRevisionId:other.input.request.layoutRevisionId}})).rejects.toMatchObject({code:'RESUME_DOCUMENT_EXPORT_POINTER_INVALID'});
  });
  it('fences late output after document deletion',async()=>{
    const {input}=await fixture();
    let release:(v:{buffer:Buffer;pageCount:null})=>void=()=>{};
    let started:()=>void=()=>{};const began=new Promise<void>(r=>{started=r;});
    const pending=createResumeExport(input,async()=>{started();return new Promise(r=>{release=r;});});
    await began;
    const doc=await db.selectFrom('profile.resume_documents').select('revision').where('id','=',input.documentId).executeTakeFirstOrThrow();
    await deleteResumeDocument({db,owner:input.owner,documentId:input.documentId,request:{expectedRevision:Number(doc.revision)}});
    release({buffer:Buffer.from('synthetic delayed result'),pageCount:null});
    await expect(pending).rejects.toMatchObject({code:'RESUME_DOCUMENT_DELETED'});
    const count=(await sql<{n:string}>`SELECT count(*) AS n FROM profile.resume_export_artifacts WHERE document_id=${input.documentId}`.execute(db)).rows[0];
    expect(Number(count?.n)).toBe(0);
  });
  it('keeps a failed attempt retryable, and suppresses concurrent duplicate generation',async()=>{
    const {input}=await fixture();
    await expect(createResumeExport(input,async()=>{throw new Error('synthetic timeout');})).rejects.toMatchObject({code:'RESUME_EXPORT_FAILED'});
    expect((await listResumeExports(db,input.owner,input.documentId)).items[0]?.state).toBe('failed');
    let release:(v:{buffer:Buffer;pageCount:null})=>void=()=>{},started:()=>void=()=>{};
    const began=new Promise<void>(r=>{started=r;});
    const pending=createResumeExport(input,async()=>{started();return new Promise(r=>{release=r;});});
    await began;
    const concurrent=await createResumeExport(input,async()=>{throw new Error('duplicate renderer must not run');});
    expect(concurrent.state).toBe('generating');
    release({buffer:Buffer.from('synthetic storage/concurrency fixture'),pageCount:null});
    expect((await pending).state).toBe('ready');
  });
  it('does not reuse deleted artifacts and grants no export access to collector',async()=>{
    const {input}=await fixture();const first=await createResumeExport(input);await deleteResumeExport(db,input.owner,first.id);
    const second=await createResumeExport({...input,idempotencyKey:randomUUID()});expect(second.id).not.toBe(first.id);
    const row=(await sql<{collector:boolean;match_write:boolean;web:boolean}>`SELECT has_table_privilege('aijob_collector_worker','profile.resume_export_artifacts','SELECT') AS collector,has_table_privilege('aijob_match_worker','profile.resume_export_artifacts','INSERT') AS match_write,has_table_privilege('aijob_web_api','profile.resume_export_artifacts','INSERT') AS web`.execute(db)).rows[0];
    expect(row).toEqual({collector:false,match_write:false,web:true});
  });
  it('does not let an expired renderer replace a retry which acquired a newer lease',async()=>{
    const {input}=await fixture();
    let release:(v:{buffer:Buffer;pageCount:null})=>void=()=>{},started:()=>void=()=>{};
    const began=new Promise<void>(r=>{started=r;});
    const pending=createResumeExport(input,async()=>{started();return new Promise(r=>{release=r;});});
    await began;
    await sql`UPDATE profile.resume_export_artifacts SET lease_expires_at=now()-interval '1 second' WHERE document_id=${input.documentId} AND state='generating'`.execute(db);
    const replacement=await createResumeExport(input);
    const current=await downloadResumeExport(db,input.owner,replacement.id,input.encryptionKey);
    release({buffer:Buffer.from('stale rendering fixture'),pageCount:null});
    await expect(pending).rejects.toMatchObject({code:'RESUME_EXPORT_SUPERSEDED'});
    expect((await downloadResumeExport(db,input.owner,replacement.id,input.encryptionKey)).buffer.equals(current.buffer)).toBe(true);
  });
  it('prevents late output and reads after the owner has requested deletion',async()=>{
    const {input}=await fixture();
    let release:(v:{buffer:Buffer;pageCount:null})=>void=()=>{},started:()=>void=()=>{};
    const began=new Promise<void>(r=>{started=r;});
    const pending=createResumeExport(input,async()=>{started();return new Promise(r=>{release=r;});});
    await began;
    await db.transaction().execute(tx=>beginOwnerDeletion(tx,{ownerId:input.owner.ownerId,ownerEpoch:input.owner.ownerEpoch,trigger:'owner_request',now:new Date()}));
    release({buffer:Buffer.from('retired owner fixture'),pageCount:null});
    await expect(pending).rejects.toThrow();
    await expect(listResumeExports(db,input.owner,input.documentId)).rejects.toThrow();
    const row=(await sql<{n:string}>`SELECT count(*) AS n FROM profile.resume_export_artifacts WHERE document_id=${input.documentId} AND ciphertext IS NOT NULL`.execute(db)).rows[0];
    expect(Number(row?.n)).toBe(0);
  });
});
