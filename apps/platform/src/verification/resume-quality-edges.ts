/** Final-document edge cases, deliberately separate from the three gallery samples. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {chineseResumeSample,resumeRichText,resumeTemplateLayout,resumeContentForTemplate,resumeContentManifest,resumePaginationScript,resumeContentAuditScript,studioV2Html,RESUME_SAMPLE_PHOTO} from '@aijob/contracts';
import {studioV3FontCss} from '../resume-documents/studio-fonts.js';
import {inspectResumePdf,type ResumePageAudit} from '../resume-documents/pdf-integrity.js';
const root=resolve(import.meta.dirname,'../../../..'),out=resolve(root,'docs/evidence/resume-studio-quality-2026-09-10/edges');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PDF_BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe'}),results=[];
try{for(const test of ['leafish-long-summary','lapis-fields-only','cool-no-photo','gengar-empty-hidden'] as const){
 const template=test.startsWith('leafish')?'rx_leafish':test.startsWith('cool')?'bre_cool':test.startsWith('gengar')?'rx_gengar':'lapis_cn';
 const content=resumeContentForTemplate(chineseResumeSample('short'),template),layout=resumeTemplateLayout(template);
 if(test==='leafish-long-summary')content.sections.find(s=>s.kind==='summary')!.entries[0]!.body=resumeRichText(Array.from({length:95},(_,i)=>`第 ${i+1} 项补充：在课程调研中记录用户遇到的问题，整理访谈依据和后续验证结果，不添加未经提供的业绩。`).join('\n'));
 if(test==='lapis-fields-only')for(const s of content.sections)for(const e of s.entries)e.body=resumeRichText('');
 if(test==='cool-no-photo')layout.photoVisible=false;
 if(test==='gengar-empty-hidden'){content.sections[0]!.hidden=true;content.sections[1]!.entries[0]!.hidden=true;}
 const page=await browser.newPage({viewport:{width:900,height:1250}});await page.route('**/*',r=>r.abort());
 try{const manifest=resumeContentManifest(content),fontCss=await studioV3FontCss(resolve(root,'apps/web/public/fonts'),layout);await page.setContent(studioV2Html('合成边界检查',content,layout,fontCss,{photoDataUrl:RESUME_SAMPLE_PHOTO}));await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images).map(i=>i.decode()));});await page.evaluate(resumePaginationScript({keepEntriesTogether:true,autoColumns:true}));const audit=await page.evaluate<ResumePageAudit>(resumeContentAuditScript(manifest));await page.screenshot({path:resolve(out,test+'.png'),fullPage:true});await page.emulateMedia({media:'print'});const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});await writeFile(resolve(out,test+'.pdf'),pdf);const check=await inspectResumePdf(pdf,manifest,audit);results.push({test,passed:true,...check});}
 catch(e){results.push({test,passed:false,error:String(e)});process.exitCode=1;}finally{await page.close();}
 console.info(JSON.stringify(results.at(-1)));await writeFile(resolve(out,'report.json'),JSON.stringify({at:new Date().toISOString(),synthetic:true,results},null,2));
}}finally{await browser.close();}
