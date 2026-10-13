/** Same-machine measurements with synthetic personal data and real rendering. */
import assert from 'node:assert/strict';
import {cpus,totalmem,platform,release} from 'node:os';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {chineseResumeSample,resumeTemplateLayout,type ResumeStudioDraft} from '@aijob/contracts';
const root=resolve(import.meta.dirname,'../../../..'),out=resolve(root,'docs/evidence/resume-studio-quality-2026-09-10/performance'),base=process.env.AIJOB_VERIFY_WEB_URL??'http://127.0.0.1:5173';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),context=await browser.newContext({viewport:{width:1600,height:1000}});
const p95=(v:number[])=>v.slice().sort((a,b)=>a-b)[Math.max(0,Math.ceil(v.length*.95)-1)]??null;
try{
 await context.request.get(base+'/v1/session');const csrf=(await context.cookies()).find(c=>c.name==='aijob_csrf')?.value??'';
 async function api(method:string,path:string,data?:unknown){const r=await context.request.fetch(base+path,{method,...(data?{data}:{}),headers:{origin:base,'x-csrf-token':csrf,'idempotency-key':randomUUID()}});if(!r.ok())throw new Error(`${r.status()} ${await r.text()}`);return r.json();}
 async function create(size:'long'|'medium'){let d=await api('POST','/v1/resume-documents/studio',{title:'性能合成稿'}) as ResumeStudioDraft;d=await api('PUT',`/v1/resume-documents/${d.documentId}/studio`,{expectedRevision:d.revision,title:d.title,content:chineseResumeSample(size),layout:resumeTemplateLayout('lapis_cn')});return d;}
 const draft=await create('long'),exports=[await create('medium'),await create('medium')];
 const page=await context.newPage();page.setDefaultTimeout(60000);const first=[];
 for(let i=0;i<3;i++){const at=performance.now();await page.goto(base+`/resumes/${draft.documentId}`);await page.getByLabel('姓名',{exact:true}).waitFor();first.push(performance.now()-at);}
 await page.locator('.sw-preview-pane [data-preview-ready=true]').waitFor();const pageCount=await page.frameLocator('.sw-preview-pane iframe').locator('.rs-page').count();
 const entry=draft.content.sections.find(s=>s.kind==='project')!.entries[0]!;const editor=page.locator(`[data-form-entry="${entry.id}"] [contenteditable=true]`);
 const saveTimings:number[]=[],saveFailures:number[]=[];page.on('response',response=>{if(response.request().method()==='PUT'&&response.url().endsWith('/studio')){const t=response.request().timing();if(t.responseStart>=0)saveTimings.push(t.responseStart-t.requestStart);if(!response.ok())saveFailures.push(response.status());}});
 async function inputRun(label:string){await editor.click();await page.keyboard.press('Control+End');await page.evaluate(()=>{const win=window as typeof window&{inputFrames:number[];inputObserver?:AbortController};win.inputObserver?.abort();win.inputObserver=new AbortController();win.inputFrames=[];document.addEventListener('input',()=>{const t=performance.now();requestAnimationFrame(()=>win.inputFrames.push(performance.now()-t));},{signal:win.inputObserver.signal});});for(const c of 'abcdefghijklmnopqrstuvwx0123456789ABCD')await page.keyboard.insertText(c);await page.waitForFunction(()=>document.querySelector('.sw-save-status')?.textContent==='已自动保存');const values=await page.evaluate(()=>(window as typeof window&{inputFrames:number[]}).inputFrames);return {label,count:values.length,p95InputToFrameMs:p95(values),maxMs:Math.max(...values)};}
 const baseline=await inputRun('editor only');
 const templateSwitches=[];
 for(const [query,id] of [['Gengar','rx_gengar'],['LapisCV','lapis_cn'],['学术经典','rendercv_classic']] as const){
  await page.getByRole('button',{name:'模板',exact:true}).click();const gallery=page.getByRole('dialog',{name:'选择简历模板'});await gallery.getByLabel('搜索模板').fill(query);
  const at=performance.now();await gallery.getByRole('button',{name:'使用模板',exact:true}).first().click();await gallery.waitFor({state:'hidden'});
  await page.frameLocator('.sw-preview-pane iframe').locator(`.rs-document[data-template="${id}"] .rs-page`).first().waitFor();await page.locator('.sw-preview-pane [data-preview-ready=true]').waitFor();
  templateSwitches.push({template:id,milliseconds:performance.now()-at});await page.waitForFunction(()=>document.querySelector('.sw-save-status')?.textContent==='已自动保存');
 }
 const jobs=exports.map(async d=>{const pair=await api('POST',`/v1/resume-documents/${d.documentId}/checkpoint`,{expectedRevision:d.revision});const t=performance.now();try{await api('POST',`/v1/resume-documents/${d.documentId}/exports`,{format:'pdf',...pair});return {passed:true,elapsedMs:performance.now()-t};}catch(e){return {passed:false,elapsedMs:performance.now()-t,error:String(e)};}});
 const concurrent=await inputRun('two PDF exports concurrently');const exportResults=await Promise.all(jobs);
 let d=await api('GET',`/v1/resume-documents/${draft.documentId}/studio`) as ResumeStudioDraft;const saves=[];
 for(let i=0;i<20;i++){const t=performance.now();d=await api('PUT',`/v1/resume-documents/${d.documentId}/studio`,{expectedRevision:d.revision,title:d.title,content:{...d.content,basics:{...d.content.basics,headline:`性能采样 ${i}`}},layout:d.layout});saves.push(performance.now()-t);}
 const report={at:new Date().toISOString(),hardware:{cpu:cpus()[0]?.model,logicalCpus:cpus().length,ramGiB:Math.round(totalmem()/1024**3),os:platform()+' '+release()},browser:browser.version(),mode:'local Vite development / real web API / shared machine',dataset:{pages:pageCount,sections:draft.content.sections.length,entries:draft.content.sections.reduce((n,s)=>n+s.entries.length,0)},firstUsefulMs:first,baseline,concurrent,saveApi:{samples:20,p95Ms:p95(saves)},browserSaveRequestMs:saveTimings,saveFailures,exportResults,limits:'Input-to-animation-frame is measured, not a fabricated INP. Other verification processes may share CPU. No live collector or AI supplier calls.'};
 const completeReport={...report,templateSwitches};completeReport.mode=base.endsWith(':5180')?'optimized Web build (--mode test, existing local access policy) / real development web API / shared machine':report.mode;await writeFile(resolve(out,base.endsWith(':5180')?'studio-built-web.json':'studio.json'),JSON.stringify(completeReport,null,2));console.info(JSON.stringify(completeReport));assert(!saveFailures.length);assert(exportResults.every(r=>r.passed));
}finally{await browser.close();}

