import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { cpus, totalmem, platform, release } from 'node:os';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { assertIsolatedTestDatabaseUrl, createDatabase, migrateToLatest } from '@aijob/database';
import { chineseResumeSample, resumeTemplateLayout, JOB_SEMANTICS_V2, type ResumePrintInput } from '@aijob/contracts';
import { sql } from 'kysely';
import { buildApp } from '../app.js';
import { createAnonymousSession } from '../identity/session-repository.js';
import { createStudioDocument, saveStudioDraft } from '../resume-documents/studio-service.js';
import { materializeLocalCatalog } from '../catalog/materialize.js';
import { interpretJobV2 } from '../catalog/job-semantics-v2.js';
import { renderResumePdf } from '../resume-documents/pdf-service.js';
import { parseResumeBuffer } from '../resume/parse.js';
import { seedBenchmarkCatalog } from './fixtures.js';

const url=process.env.AIJOB_BENCH_DATABASE_URL;
if(!url) throw new Error('An explicit isolated AIJOB_BENCH_DATABASE_URL is required.');
assertIsolatedTestDatabaseUrl(url);
if(!decodeURIComponent(new URL(url).pathname).includes('benchmark_test')) throw new Error('Dedicated benchmark_test database required.');
const count=Number(process.env.AIJOB_BENCH_JOBS??10000), concurrency=Number(process.env.AIJOB_BENCH_CONCURRENCY??50);
if(![10000,100000].includes(count)||![50,100].includes(concurrency)) throw new Error('Unsupported benchmark scale.');
const db=createDatabase(url), workerDb=createDatabase(url), root=resolve(import.meta.dirname,'../../../..');
const output=resolve(root,`docs/evidence/direction-studio-upgrade-2026-09-09/performance-${count}-${concurrency}.json`);
type Sample={operation:string;ms:number;status:number;error?:string};
const phases:unknown[]=[];
function summary(samples:Sample[]){
  return Object.fromEntries([...new Set(samples.map(s=>s.operation))].map(operation=>{
    const all=samples.filter(s=>s.operation===operation), durations=all.map(s=>s.ms).sort((a,b)=>a-b);
    return [operation,{requests:all.length,errors:all.filter(s=>s.status>=400).length,p50:durations[Math.floor(durations.length*.5)],p95:durations[Math.min(durations.length-1,Math.ceil(durations.length*.95)-1)],max:durations.at(-1)}];
  }));
}
let app:ReturnType<typeof buildApp>|undefined;
try {
  await migrateToLatest(db);
  console.info(`Seeding ${count} isolated synthetic jobs`);
  const fixture=await seedBenchmarkCatalog(db,count,process.env.AIJOB_BENCH_REUSE_FIXTURE==='1');
  // Fixture construction uses the real interpreter for each distinct sentence set. IDs are
  // rewritten per official version before the real normalized-projection trigger runs.
  const variants=(await sql<{title:string;requirements:string;responsibilities:string}>`SELECT DISTINCT title,requirements,responsibilities FROM catalog.published_job_versions`.execute(db)).rows;
  for(const variant of variants){
    const sourceId=randomUUID(), parsed=interpretJobV2({...variant,jobVersionId:sourceId});
    await db.transaction().execute(async tx=>{
      await sql`SET LOCAL statement_timeout='300s'`.execute(tx);
      await sql`INSERT INTO catalog.job_semantic_indexes(job_version_id,extraction_version,source_hash,primary_family,families,subrole,domains,education_levels,atoms)
        SELECT v.id,${JOB_SEMANTICS_V2},md5(v.id::text)||md5(v.id::text),${parsed.role.primaryFamily},${parsed.role.families}::text[],${parsed.role.subrole},${parsed.role.domains}::text[],${parsed.educationLevels}::text[],replace(${JSON.stringify(parsed.atoms)},${sourceId},v.id::text)::jsonb
        FROM catalog.published_job_versions v WHERE v.title=${variant.title} AND v.requirements=${variant.requirements} AND v.responsibilities=${variant.responsibilities}
        ON CONFLICT(job_version_id,extraction_version) DO NOTHING`.execute(tx);
    });
    console.info(`Indexed fixture variant: ${variant.title}`);
  }
  await sql`ANALYZE`.execute(db);
  const address='http://localhost:3000';
  const config={appEnv:'test' as const,databaseUrl:url,snapshotDirectory:'.data/benchmark-snapshots',host:'127.0.0.1',port:3000,probeRequestIntervalMs:750,ownerTaskInteractiveConcurrency:8,logLevel:'silent' as const,enableInternalPreview:false,enableSourceProbe:false,enableLocalMvp:false,resumeEncryptionKey:'0'.repeat(64),resumeMaxBytes:5242880,ai:{enabled:false,requestTimeoutMs:30000},identity:{acceptedOrigins:[address],alphaInviteCodeHashes:[]},workspaceRoot:root};
  app=buildApp({config,db});
  await app.ready();
  const sessions=[];
  for(let n=0;n<concurrency;n++){
    const session=await createAnonymousSession({db});
    let draft=await createStudioDocument(db,session.context,{title:`离线性能样稿 ${n}`},randomUUID());
    draft=await saveStudioDraft(db,session.context,draft.documentId,{expectedRevision:draft.revision,title:draft.title,content:chineseResumeSample('medium'),layout:resumeTemplateLayout('jp_classic')},randomUUID());
    sessions.push({session,draft});
  }
  const scope=encodeURIComponent(JSON.stringify({jobFamily:'product'}));
  const paths=['/v1/jobs?limit=20','/v1/jobs?limit=20&jobFamilies=engineering','/v1/jobs?limit=20&keyword=SQL',`/v2/job-graph?scope=${scope}`,'/v2/job-graph/directions',`/v2/job-graph/evidence?scope=${scope}&key=tool%3Asql&limit=20`];
  const cold:Sample[]=[];
  for(const path of ['/v1/job-graph',`/v1/job-graph?scope=${scope}`,...paths]){
    const at=performance.now(),res=await app.inject({method:'GET',url:path});
    cold.push({operation:path,ms:performance.now()-at,status:res.statusCode,...(res.statusCode>=400?{error:res.body.slice(0,500)}:{})});
    if(path.includes('/evidence')&&res.statusCode===200&&res.json().items.length===0)throw new Error('Evidence benchmark must measure non-empty result pages.');
  }
  console.info(JSON.stringify({cold}));
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify({state:'running',fixture,cold},null,2));
  const snapshot:ResumePrintInput={title:'性能合成材料',content:{schemaVersion:'resume-content-v1',sections:[]},templateKey:'cn_classic_single_column',sectionOrder:[],settings:{schemaVersion:'resume-layout-settings-v1',fontSizeToken:'standard',lineSpacingToken:'standard',sectionSpacingToken:'standard',colorToken:'charcoal',pageBreakPolicy:'keep_sections'},studio:{content:chineseResumeSample('medium'),layout:resumeTemplateLayout('jp_classic')}};
  for(const phase of ['v1-baseline','hot','mixed']){
    const samples:Sample[]=[],start=performance.now(),cpu=process.cpuUsage(),lag=monitorEventLoopDelay({resolution:20});
    lag.enable();let peakRss=process.memoryUsage().rss;
    const sampler=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss)},100);
    async function measured(operation:string,fn:()=>Promise<unknown>){const at=performance.now();try{await fn();samples.push({operation,ms:performance.now()-at,status:200})}catch(error){samples.push({operation,ms:performance.now()-at,status:500,error:String(error)})}}
    const background=phase==='mixed'?Promise.all([
      measured('collector_materialize',()=>materializeLocalCatalog(workerDb,{sourceId:fixture.base.sourceId})),
      measured('pdf_export_and_parse',async()=>{const pdf=await renderResumePdf({db:workerDb,snapshot,runtime:{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',fontPath:resolve(root,'apps/web/public/fonts/AijobCJK.otf'),serifFontPath:resolve(root,'apps/web/public/fonts/AijobSerifCJK.otf'),concurrency:2,timeoutMs:60000}});await parseResumeBuffer({kind:'pdf',buffer:pdf});}),
    ]):Promise.resolve();
    await Promise.all(sessions.map(async(state,user)=>{
      for(let n=0;n<12;n++){
        const saving=phase==='mixed'&&n%6===5,writing=phase==='mixed'&&n%6===4;
        let path=paths[(user+n)%paths.length]!;
        if(phase==='v1-baseline')path=(user+n)%2===0?paths[(user+n)%3]!: `/v1/job-graph?scope=${scope}`;
        const operation=saving?'studio_save':writing?'case_write':path.includes('/directions')?'directions':path.includes('/evidence')?'evidence':path.includes('job-graph')?'graph':'catalog';
        const headers:Record<string,string>={host:'localhost:3000',cookie:`aijob_session=${state.session.sessionToken}; aijob_csrf=${state.session.csrfToken}`};
        if(saving||writing)Object.assign(headers,{origin:address,'x-csrf-token':state.session.csrfToken,'idempotency-key':randomUUID()});
        const at=performance.now();
        try{
          const res=await app!.inject({method:saving?'PUT':writing?'POST':'GET',url:saving?`/v1/resume-documents/${state.draft.documentId}/studio`:writing?'/v1/application-cases':path,headers,...(saving?{payload:{expectedRevision:state.draft.revision,title:`离线样稿 ${user}-${n}`,content:state.draft.content,layout:state.draft.layout}}:writing?{payload:{jobContext:{kind:'private_input',title:`合成申请 ${user}-${n}`,companyName:'离线企业',contentText:'岗位职责：使用 SQL 编写报告。岗位要求：本科或硕士在读。',source:{kind:'unspecified'}}}}:{})});
          samples.push({operation,ms:performance.now()-at,status:res.statusCode,...(res.statusCode>=400?{error:res.body.slice(0,500)}:{})});
          if(saving&&res.statusCode<400)state.draft=res.json();
        }catch(error){samples.push({operation,ms:performance.now()-at,status:599,error:String(error)})}
      }
    }));
    await background;clearInterval(sampler);lag.disable();
    const used=process.cpuUsage(cpu);
    phases.push({phase,plannedRequests:concurrency*12,wallMs:performance.now()-start,summary:summary(samples),peakRssBytes:peakRss,cpuMs:(used.user+used.system)/1000,eventLoopP95Ms:lag.percentile(95)/1e6,samples});
    console.info(JSON.stringify({phase,summary:summary(samples)}));
  }
  const database=(await sql`SELECT pg_database_size(current_database())::text AS bytes,version() AS version`.execute(db)).rows[0];
  const queue=(await sql`SELECT status,count(*)::int,max(EXTRACT(EPOCH FROM(now()-available_at))) FILTER(WHERE status='queued') AS oldest_wait_seconds FROM task_queue.tasks GROUP BY status`.execute(db)).rows;
  await writeFile(output,JSON.stringify({state:'complete',at:new Date().toISOString(),environment:{os:platform(),release:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,memoryBytes:totalmem(),node:process.version,database},fixture:{...fixture,v2IndexedShare:1},concurrency,cold,phases,queue,limitations:['Fastify.inject executes actual routes/CSRF/SQL without a listening port. Network/proxy latency is excluded.','Six synthetic JD variants, current versions only; no full history-depth or real recruitment traffic.','Background materialization, PDF export and parser are real local operations. No paid AI or network collection.','Queue is a snapshot; sustained AI queue latency remains unverified without a user API.']},null,2));
}catch(error){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({state:'failed',count,concurrency,error:String(error),phases},null,2));throw error;}
finally{await app?.close();await db.destroy();await workerDb.destroy();}
