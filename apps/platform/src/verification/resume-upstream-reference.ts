/** Render the pinned upstream components, in an isolated browser, for honest layout comparison. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {RESUME_TEMPLATE_PROFILES,resumeGallerySample,resumeRichPlain,RESUME_SAMPLE_PHOTO,resumeTemplateLayout} from '@aijob/contracts';
import {studioV3FontCss} from '../resume-documents/studio-fonts.js';
const root=resolve(import.meta.dirname,'../../../..'),runtime=resolve(root,'.data/resume-quality-20260910/upstream-runtime'),out=resolve(root,'docs/evidence/resume-studio-quality-2026-09-10/upstream/component-renders');await mkdir(out,{recursive:true});
const sample=resumeGallerySample(),b=sample.basics;
const kinds:Record<string,string>={internship:'work_experience',project:'projects',awards:'certifications'};
const jp={language:'zh',themeConfig:{avatarStyle:'oneInch'},sections:[{id:'personal',type:'personal_info',visible:true,content:{fullName:b.name,jobTitle:b.headline,phone:b.phone,email:b.email,location:b.city,avatar:RESUME_SAMPLE_PHOTO}},...sample.sections.map(s=>({id:s.id,type:kinds[s.kind]??s.kind,title:s.title,visible:true,content:s.kind==='skills'?{categories:s.entries.map(e=>({id:e.id,name:e.title,skills:[resumeRichPlain(e.body)]}))}:{items:s.entries.map(e=>({id:e.id,name:e.title||e.organization,title:e.title,company:e.organization,school:e.organization,position:e.role,role:e.role,degree:e.degree,field:e.major,startDate:e.startDate,endDate:e.endDate,description:resumeRichPlain(e.body),highlights:[],date:e.endDate,issuer:e.details?.issuer,language:e.title,level:e.details?.proficiency,technologies:[]}))}}))]};
const magicKinds:Record<string,string>={internship:'experience',project:'projects',awards:'awards'};
const magic={info:{fullName:b.name,headline:b.headline,phoneNumber:b.phone,email:b.email,address:b.city,avatar:RESUME_SAMPLE_PHOTO,photo:RESUME_SAMPLE_PHOTO,website:''},sections:Object.fromEntries(sample.sections.map(s=>[magicKinds[s.kind]??s.kind,s.entries.map(e=>({id:e.id,visible:true,name:e.title||e.organization,title:e.title,company:e.organization,school:e.organization,project:e.title,position:e.role,role:e.role,degree:e.degree,major:e.major,date:[e.startDate,e.endDate].filter(Boolean).join(' — '),summary:resumeRichPlain(e.body),description:resumeRichPlain(e.body),skill:e.title,award:e.title,language:e.title,level:e.details?.proficiency,certificate:e.title}))])),sectionOrder:sample.sections.map(s=>({key:magicKinds[s.kind]??s.kind,label:s.title,visible:true}))};
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),results:unknown[]=[];
try{
 const page=await browser.newPage({viewport:{width:840,height:1250}});await page.route('**/*',r=>r.abort());const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 const css=await readFile(resolve(runtime,'built.css'),'utf8'),bundle=await readFile(resolve(runtime,'bundle.js'),'utf8');
 const font=await studioV3FontCss(resolve(root,'apps/web/public/fonts'),resumeTemplateLayout('lapis_cn'));
 await page.setContent(`<html><head><style>${css}\n${font}\nbody{margin:0;background:#eee;font-family:AijobV3Sans, sans-serif}#root{width:210mm;margin:0 auto}</style></head><body><div id="root"></div></body></html>`);await page.addScriptTag({content:bundle});
 for(const t of RESUME_TEMPLATE_PROFILES.filter(t=>['jobpilot','magic'].includes(t.upstream))){
  try{await page.evaluate(({id,data})=>(window as unknown as {renderReference:(id:string,data:unknown)=>void}).renderReference(id,data),{id:t.id,data:t.id==='jp_modern_minimal'?{...jp,personalInfo:jp.sections[0]!.content}:t.upstream==='jobpilot'?jp:magic});
   await page.waitForFunction(()=>document.querySelector('#root')?.textContent?.includes('林知夏'));await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{})));await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));});
   if(errors.length)throw new Error(errors.splice(0).join('\n'));
   const text=await page.locator('#root').innerText();if(!text.includes('校园学习空间'))throw new Error('REFERENCE_PROJECT_NOT_BOUND');
   await page.locator('#root').screenshot({path:resolve(out,t.id+'.png')});await writeFile(resolve(out,t.id+'.html'),await page.locator('#root').innerHTML());results.push({id:t.id,passed:true,source:'unmodified pinned upstream components',fixture:'Aijob synthetic gallery content mapped to upstream fields',environment:'isolated HTML browser; upstream Tailwind classes; installed Chinese fallback; JobPilot 20px external page padding; no platform code used'});
  }catch(e){results.push({id:t.id,passed:false,error:String(e)});console.error(t.id,String(e));}
 }
 await writeFile(resolve(out,'report.json'),JSON.stringify({results},null,2));console.info(JSON.stringify(results));if(results.some(r=>!(r as {passed:boolean}).passed))process.exitCode=1;
}finally{await browser.close();}
