/** Complete, synthetic gallery covers. No user content and no external requests. */
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { RESUME_TEMPLATE_PROFILES,RESUME_SAMPLE_PHOTO,resumeGallerySample,resumeTemplateLayout,studioV2Html,resumePaginationScript,resumeContentManifest,resumeContentAuditScript,STUDIO_V3_VERSION } from '@aijob/contracts';
import { studioV3FontCss } from '../resume-documents/studio-fonts.js';
import { inspectResumePdf,type ResumePageAudit } from '../resume-documents/pdf-integrity.js';
import {resumeContentForTemplate} from '@aijob/contracts';
const root=resolve(import.meta.dirname,'../../../..'),out=resolve(root,'docs/evidence/resume-studio-quality-2026-09-10/gallery');
await mkdir(out,{recursive:true});
const ids=process.argv.find(a=>a.startsWith('--templates='))?.slice(12).split(',');
const browser=await chromium.launch({headless:true,executablePath:process.env.PDF_BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe'}),results:unknown[]=[];
try{
 const page=await browser.newPage({viewport:{width:850,height:1180}});await page.route('**/*',r=>r.abort());
 for(const t of RESUME_TEMPLATE_PROFILES.filter(t=>!ids||ids.includes(t.id))){
  try{
   const c=resumeContentForTemplate(resumeGallerySample(),t.id),l=resumeTemplateLayout(t.id),manifest=resumeContentManifest(c);
   await page.setContent(studioV2Html('模板中文样稿',c,l,await studioV3FontCss(resolve(root,'apps/web/public/fonts'),l),{photoDataUrl:RESUME_SAMPLE_PHOTO}));
   await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images).map(i=>i.decode()));});
   const pages=await page.evaluate<{pageCount:number}>(resumePaginationScript());
   if(pages.pageCount!==1)throw new Error(`GALLERY_PAGES:${pages.pageCount}`);
   const audit=await page.evaluate<ResumePageAudit>(resumeContentAuditScript(manifest));
   const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true,tagged:true});
   await inspectResumePdf(pdf,manifest,audit);await writeFile(resolve(out,`${t.id}.pdf`),pdf);
   const cover=await page.locator('.rs-page').screenshot({path:resolve(root,`apps/web/public/resume-templates/${t.id}-${STUDIO_V3_VERSION}.png`)});await writeFile(resolve(out,`${t.id}.png`),cover);
   const result={id:t.id,version:STUDIO_V3_VERSION,passed:true,pageCount:1,fields:manifest.fields.length};results.push(result);console.info(JSON.stringify(result));
  }catch(e){results.push({id:t.id,passed:false,error:String(e)});console.error(`${t.id}: ${String(e)}`);process.exitCode=1;}
  await writeFile(resolve(out,`report-${ids?.join('-')??'all'}.json`),JSON.stringify({at:new Date().toISOString(),complete:results.length===RESUME_TEMPLATE_PROFILES.length,results},null,2));
 }
}finally{await browser.close();await writeFile(resolve(out,`report-${ids?.join('-')??'all'}.json`),JSON.stringify({at:new Date().toISOString(),complete:results.length===RESUME_TEMPLATE_PROFILES.length&&results.every(r=>(r as {passed:boolean}).passed),results},null,2));}
