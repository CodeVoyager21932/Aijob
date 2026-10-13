import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { chineseResumeSample, resumeTemplateLayout, studioV2Html, resumePaginationScript } from '@aijob/contracts';
const base=process.env.AIJOB_WEB_URL??'http://127.0.0.1:5173';
const out=resolve(import.meta.dirname,'../../../../docs/evidence/direction-studio-upgrade-2026-09-09/browser');
const browser=await chromium.launch({headless:true,executablePath:process.env.PDF_BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const report=[];
try{
  const page=await browser.newPage();await page.goto(base);
  await page.route('**/*',r=>new URL(r.request().url()).origin===base&&new URL(r.request().url()).pathname.startsWith('/fonts/')?r.continue():r.abort());
  for(const template of ['jp_classic','rx_azurill'])for(const sample of ['short','medium','long'] as const){
    const content=chineseResumeSample(sample),layout=resumeTemplateLayout(template),file=layout.fontFamily==='serif'?'AijobSerifCJK':'AijobCJK';
    const full=`@font-face{font-family:AijobPrint;font-weight:400;src:url(${base}/fonts/${file}.woff2)}`;
    const common=`@font-face{font-family:AijobPrintCommon;font-weight:400;src:url(${base}/fonts/${file}Common.woff2)}${full}.rs-document{font-family:AijobPrintCommon,AijobPrint!important}`;
    const measurements=[];
    for(const css of [full,common]){
      await page.setContent(studioV2Html('字体度量合成验收',content,layout,css));await page.evaluate(()=>document.fonts.ready);
      await page.evaluate(resumePaginationScript({keepEntriesTogether:true}));
      measurements.push(await page.evaluate(()=>Array.from(document.querySelectorAll<HTMLElement>('.rs-page')).map(page=>({text:page.textContent,positions:Array.from(page.querySelectorAll<HTMLElement>('.rs-entry')).map(e=>({id:e.dataset.entryId,top:e.getBoundingClientRect().top-page.getBoundingClientRect().top,left:e.getBoundingClientRect().left-page.getBoundingClientRect().left}))}))));
    }
    const a=measurements[0]!,b=measurements[1]!;
    const same=a.length===b.length&&a.every((page,i)=>page.text===b[i]!.text&&page.positions.length===b[i]!.positions.length&&page.positions.every((entry,j)=>entry.id===b[i]!.positions[j]!.id&&Math.abs(entry.top-b[i]!.positions[j]!.top)<1&&Math.abs(entry.left-b[i]!.positions[j]!.left)<1));
    report.push({template,sample,pages:a.length,samePageTextAndPositions:same});
    if(!same)throw new Error(`${template}/${sample}: web common font changed layout`);
    if(sample==='short'){
      content.basics.name='林喆';
      await page.setContent(studioV2Html('生僻字回退',content,layout,common));await page.evaluate(()=>document.fonts.ready);
      const faces=await page.evaluate(()=>Array.from(document.fonts).map(f=>({family:f.family,status:f.status})));
      if(!faces.some(f=>f.family==='AijobPrint'&&f.status==='loaded'))throw new Error(`${template}: full-font fallback not loaded for 喆`);
      report.push({template,rareCharacter:'喆',completeFontFallback:true});
    }
  }
}finally{await browser.close();await mkdir(out,{recursive:true});await writeFile(resolve(out,'font-metrics.json'),JSON.stringify({at:new Date().toISOString(),results:report},null,2));}
console.info(JSON.stringify({passed:report.length}));
