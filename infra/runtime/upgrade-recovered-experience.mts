import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createDatabase,migrateToLatest} from '../../packages/database/src/index.ts';
import {loadPlatformConfig,databaseUrlForRuntime} from '../../apps/platform/src/config/platform-config.ts';
import {buildApp} from '../../apps/platform/src/app.ts';
const require=createRequire(new URL('../../packages/database/package.json',import.meta.url)),{sql}=require('kysely');
const root=resolve(import.meta.dirname,'../..'),container='aijob-recovered-postgres',cloneName='aijob_experience_upgrade_clone_20260908';
const backup=resolve(root,'../Aijob-backups/20260908-experience-upgrade');
const cfg=loadPlatformConfig({rootDirectory:root}),url=databaseUrlForRuntime(cfg,'migrator'),parsed=new URL(url);
if(parsed.hostname!=='127.0.0.1'||parsed.port!=='55439'||parsed.pathname!=='/aijob'||cfg.appEnv!=='local')throw Error('RECOVERED_DATABASE_IDENTITY_MISMATCH');
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const run=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
const user=decodeURIComponent(parsed.username);
if(!user||!/^[a-z_][a-z0-9_]*$/i.test(user))throw Error('CONTAINER_DATABASE_USER_MISSING');
const query=(db:string,q:string)=>run(['exec',container,'psql','-X','-v','ON_ERROR_STOP=1','-U',user,'-d',db,'-Atc',q]).trim();
const quote=(v:string)=>'"'+v.replaceAll('"','""')+'"';
const beforeEnv=hash(await readFile(resolve(root,'.env')));
const db=createDatabase(url);let clone:ReturnType<typeof createDatabase>|undefined;
const smoke=async(database:ReturnType<typeof createDatabase>)=>{
 const config={...cfg,enableSourceProbe:false,enableInternalPreview:false,enableLocalMvp:true,logLevel:'silent' as const,ai:{...cfg.ai,enabled:false}};
 const app=buildApp({config,db:database});
 try{
  const health=await app.inject({url:'/health/ready'}),jobs=await app.inject({url:'/v1/jobs?limit=100'}),graph=await app.inject({url:'/v1/job-graph'});
  if([health,jobs,graph].some(r=>r.statusCode!==200))throw Error('LOCAL_SMOKE_FAILED');
  const body=jobs.json();
  const publicApp=buildApp({config:{...config,enableLocalMvp:false},db:database});
  try{
   const publicJobs=await publicApp.inject({url:'/v1/jobs?limit=20'});
   if(publicJobs.statusCode!==200||publicJobs.json().items.length!==0)throw Error('PUBLIC_DIRECTORY_UNEXPECTEDLY_OPEN');
  }finally{await publicApp.close();}
  return {health:200,catalog:200,graph:200,visibleJobs:body.totalKnown+body.totalUnknown,firstPage:body.items.length,publicJobs:0};
 }finally{await app.close();}
};
try{
 const latest=query('aijob','SELECT name FROM kysely_migration ORDER BY name DESC LIMIT 1');
 if(latest!=='053_personal_ai_budget')throw Error('EXPECTED_RECOVERED_SCHEMA_053');
 if(query('postgres',`SELECT count(*) FROM pg_database WHERE datname='${cloneName}'`)!=='0')throw Error('CLONE_MUST_NOT_EXIST');
 await mkdir(backup,{recursive:false});
 execFileSync('icacls',[backup,'/inheritance:r','/grant:r',`${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`,'SYSTEM:(OI)(CI)F'],{stdio:'pipe',windowsHide:true});
 for(const path of ['.env','apps/web/.env','.data/resume-encryption.key','.data/identity-master.key']){
  try{await access(resolve(root,path));}catch{continue;}
  await copyFile(resolve(root,path),resolve(backup,path.replaceAll('/','__')));
 }
 const tableRows=JSON.parse(query('aijob',`SELECT json_agg(t) FROM (SELECT table_schema,table_name,array_agg(column_name ORDER BY ordinal_position) AS columns FROM information_schema.columns WHERE table_schema IN ('source_control','ingestion','catalog','identity','profile','application','matching','task_queue') GROUP BY table_schema,table_name ORDER BY table_schema,table_name) t`)) as Array<{table_schema:string;table_name:string;columns:string[]}>;
 // Include base tables only; views are current projections and may evolve across migrations.
 const baseTables=new Set(query('aijob',"SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')").split('\n'));
 const tables=tableRows.filter(t=>baseTables.has(t.table_schema+'.'+t.table_name));
 const fingerprint=(database:string,t:typeof tables[number])=>query(database,`SELECT count(*)::text||':'||md5(COALESCE(string_agg(h,'' ORDER BY h),'')) FROM (SELECT md5(row_to_json(r)::text) h FROM (SELECT ${t.columns.map(quote).join(',')} FROM ${quote(t.table_schema)}.${quote(t.table_name)}) r) hashes`);
 const baseline=tables.map(t=>({...t,fingerprint:fingerprint('aijob',t)}));
 await writeFile(resolve(backup,'before-row-fingerprints.json'),JSON.stringify(baseline,null,2));
 const dump=`/tmp/aijob-before-studio-${randomUUID()}.dump`;
 run(['exec',container,'pg_dump','-U',user,'-Fc','-f',dump,'aijob']);
 run(['cp',`${container}:${dump}`,resolve(backup,'before-061.dump')]);
 const dumpHash=hash(await readFile(resolve(backup,'before-061.dump')));
 query('postgres',`CREATE DATABASE ${quote(cloneName)}`);
 run(['exec',container,'pg_restore','-U',user,'--exit-on-error','-d',cloneName,dump]);
 for(const t of baseline)if(fingerprint(cloneName,t)!==t.fingerprint)throw Error(`CLONE_RESTORE_MISMATCH:${t.table_schema}.${t.table_name}`);
 const cloneUrl=new URL(url);cloneUrl.pathname='/'+cloneName;clone=createDatabase(cloneUrl.toString());
 await migrateToLatest(clone);
 for(const t of baseline)if(fingerprint(cloneName,t)!==t.fingerprint)throw Error(`CLONE_UPGRADE_CHANGED_OLD_FIELDS:${t.table_schema}.${t.table_name}`);
 const cloneSmoke=await smoke(clone);await clone.destroy();clone=undefined;
 // Recheck the original after the entire clone rehearsal, before changing its schema.
 for(const t of baseline)if(fingerprint('aijob',t)!==t.fingerprint)throw Error('ORIGINAL_CHANGED_DURING_REHEARSAL');
 const peers=(await sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()`.execute(db)).rows[0];
 if(peers.count!==0)throw Error('OTHER_BUSINESS_CONNECTIONS_ACTIVE');
 await migrateToLatest(db);
 const preservation=baseline.map(t=>{
  if(fingerprint('aijob',t)!==t.fingerprint)throw Error(`BUSINESS_UPGRADE_CHANGED_OLD_FIELDS:${t.table_schema}.${t.table_name}`);
  return {table:t.table_schema+'.'+t.table_name,rows:Number(t.fingerprint.split(':')[0]),oldFieldsUnchanged:true};
 });
 const businessSmoke=await smoke(db);
 if(hash(await readFile(resolve(root,'.env')))!==beforeEnv)throw Error('ENV_CHANGED');
 const afterDump=`/tmp/aijob-after-studio-${randomUUID()}.dump`;
 run(['exec',container,'pg_dump','-U',user,'-Fc','-f',afterDump,'aijob']);run(['cp',`${container}:${afterDump}`,resolve(backup,'after-061.dump')]);
 const report={verifiedAt:new Date().toISOString(),from:latest,to:'061_assistant_case_lifecycle',backupDirectory:backup,beforeDumpSha256:dumpHash,afterDumpSha256:hash(await readFile(resolve(backup,'after-061.dump'))),cloneDatabase:cloneName,cloneRestoredBeforeMigration:true,cloneOldFieldsPreserved:true,preservation,cloneSmoke,businessSmoke,envUnchanged:true,realSourceRequests:0,paidAiCalls:0,existingOwnersBulkConverted:false,oldDirectoriesChanged:false};
 await writeFile(resolve(root,'docs/evidence/experience-upgrade-2026-09-07/business-upgrade.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({schema:report.to,preservedTables:preservation.length,backupDirectory:backup,cloneSmoke,businessSmoke}));
}finally{await clone?.destroy();await db.destroy();}
