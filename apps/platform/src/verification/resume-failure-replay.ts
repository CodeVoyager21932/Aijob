/** Local read-only diagnosis: never writes to a user document. Private output stays in .data. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createDatabase } from '@aijob/database';
import { resumeRichPlain, ResumeStudioContentSchema, ResumeStudioLayoutSchema, studioV2Html, resumePaginationScript } from '@aijob/contracts';
import { chromium } from 'playwright-core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { loadPlatformConfig } from '../config/platform-config.js';

const revisionId=process.env.AIJOB_DIAGNOSE_CONTENT_REVISION;
if (!revisionId) throw new Error('Set AIJOB_DIAGNOSE_CONTENT_REVISION to the specific owned failure revision.');
const config=loadPlatformConfig(), db=createDatabase(config.databaseUrl), root=resolve(import.meta.dirname,'../../../..');
const out=resolve(root,'.data/resume-quality-20260910/failure-replay');
await mkdir(out,{recursive:true});
try {
  const row=await db.selectFrom('profile.resume_document_revisions').selectAll().where('id','=',revisionId).executeTakeFirstOrThrow();
  const layoutRow=await db.selectFrom('profile.resume_layout_revisions').selectAll().where('document_id','=',row.document_id!).where('result_document_revision','=',row.result_document_revision!).executeTakeFirstOrThrow();
  const content=ResumeStudioContentSchema.parse(row.studio_content), layout=ResumeStudioLayoutSchema.parse(layoutRow.studio_layout);
  const font=await readFile(resolve(root,'apps/web/public/fonts/AijobCJK.otf'));
  const css=`@font-face{font-family:AijobPrint;font-weight:400;src:url(data:font/otf;base64,${font.toString('base64')})}`;
  const browser=await chromium.launch({headless:true,executablePath:config.pdfRuntime?.executablePath??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const page=await browser.newPage(); await page.route('**/*',r=>r.abort());
    await page.emulateMedia({media:'print'});
    await page.setContent(studioV2Html('私有故障复现',content,layout,css));
    await page.evaluate(()=>document.fonts.ready); const pagination=await page.evaluate(resumePaginationScript());
    const pdf=await page.pdf({format:'A4',preferCSSPageSize:true,printBackground:true});
    await writeFile(resolve(out,'replayed.pdf'),pdf);
    const task=getDocument({data:new Uint8Array(pdf),useSystemFonts:false});const parsed=await task.promise;
    let text=''; for(let i=1;i<=parsed.numPages;i++)text+=(await(await parsed.getPage(i)).getTextContent()).items.map(x=>'str'in x?x.str:'').join('');
    const report={at:new Date().toISOString(),revisionId,documentId:row.document_id,checkpointAt:row.created_at,template:layout.templateKey,sectionCount:content.sections.length,bodyCharacters:content.sections.reduce((n,s)=>n+s.entries.reduce((m,e)=>m+resumeRichPlain(e.body).length,0),0),nonemptyEntryFields:content.sections.flatMap(s=>s.entries.flatMap(e=>Object.entries(e).filter(([k,v])=>['title','organization','role','degree','major','location','startDate','endDate'].includes(k)&&Boolean(v)).map(([k])=>k))),pdfPageCount:parsed.numPages,onlyNameAndPage:text.replace(/\s/g,'')===(content.basics.name+'1'),pagination,sha256:createHash('sha256').update(pdf).digest('hex')};
    await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)); console.info(JSON.stringify({...report,revisionId:'private',documentId:'private'}));await task.destroy();
  } finally {await browser.close();}
} finally {await db.destroy();}
