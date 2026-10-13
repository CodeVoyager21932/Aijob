import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import { createStudioDocx } from '../resume-documents/studio-docx.js';
import { chineseResumeSample, resumePaginationScript, RESUME_TEMPLATES, RESUME_SAMPLE_PHOTO, resumeTemplateLayout, studioV2Html } from '@aijob/contracts';

const root = resolve(import.meta.dirname, '../../../..');
const ids = (process.argv.find((a) => a.startsWith('--templates='))?.split('=')[1] ?? 'jp_classic').split(',');
const selected = ids.includes('all') ? RESUME_TEMPLATES : RESUME_TEMPLATES.filter((t) => ids.includes(t.id));
const out = resolve(root, 'docs/evidence/direction-studio-upgrade-2026-09-09/templates');
await mkdir(out, { recursive: true });
const fonts = new Map<string, string>();
for (const family of ['sans', 'serif']) {
  const file = family === 'serif' ? 'AijobSerifCJK.otf' : 'AijobCJK.otf';
  fonts.set(family, `@font-face{font-family:AijobPrint;font-weight:400;src:url(data:font/otf;base64,${(await readFile(resolve(root, 'apps/web/public/fonts', file))).toString('base64')})}`);
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.PDF_BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const report: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1250 } });
  await page.route('**/*', (r) => r.abort());
  for (const t of selected) {
    for (const sample of ['short', 'medium', 'long'] as const) {
      try {
      const content = chineseResumeSample(sample), layout = resumeTemplateLayout(t.id as Parameters<typeof resumeTemplateLayout>[0]);
      const started = performance.now();
      await page.emulateMedia({ media: 'screen' });
      const resources={photoDataUrl:RESUME_SAMPLE_PHOTO};
      await page.setContent(studioV2Html('合成模板验收', content, layout, fonts.get(layout.fontFamily),resources), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const pagination = await page.evaluate<{ pageCount: number }>(resumePaginationScript({ keepEntriesTogether: layout.keepEntriesTogether }));
      const screenText = await page.locator('.rs-page').allTextContents();
      const textIntegrity = await page.evaluate(() => {
        return Array.from(document.querySelectorAll<HTMLElement>('.rs-source .rs-entry')).every((source)=>{
          const id=source.dataset.entryId, original=source.querySelector('.rs-entry-content')?.textContent??'';
          const copies=Array.from(document.querySelectorAll(`.rs-page [data-entry-id="${id}"] .rs-entry-content`)).map((e)=>e.textContent??'').join('');
          return original.replace(/\s/g,'')===copies.replace(/\s/g,'');
        });
      });
      if (!textIntegrity) throw new Error(`${t.id}/${sample}: a paginated entry lost or duplicated body text`);
      const screenshotPath = resolve(out, `${t.id}-${sample}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      if (sample === 'medium') {
        await mkdir(resolve(root, 'apps/web/public/resume-templates'), { recursive: true });
        await page.locator('.rs-page').first().screenshot({ path: resolve(root, 'apps/web/public/resume-templates', `${t.id}.png`) });
      }
      await page.emulateMedia({ media: 'print' });
      const printPagination = await page.evaluate<{ pageCount: number }>(resumePaginationScript({ keepEntriesTogether: layout.keepEntriesTogether }));
      const printText = await page.locator('.rs-page').allTextContents();
      if (JSON.stringify(screenText) !== JSON.stringify(printText)) throw new Error(`${t.id}/${sample}: screen/print page boundary mismatch`);
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true });
      await writeFile(resolve(out, `${t.id}-${sample}.pdf`), pdf);
      // The review HTML references the same repository font asset; PDF and PNG are standalone.
      const reviewHtml=(await page.content()).replace(fonts.get(layout.fontFamily)!, `@font-face{font-family:AijobPrint;font-weight:400;src:url(../../../../apps/web/public/fonts/${layout.fontFamily==='serif'?'AijobSerifCJK':'AijobCJK'}.woff2)}`);
      await writeFile(resolve(out, `${t.id}-${sample}.html`), reviewHtml);
      const loading = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }); const parsed = await loading.promise;
      let text = '';
      for (let n = 1; n <= parsed.numPages; n++) { const data = await (await parsed.getPage(n)).getTextContent(); text += data.items.map((i) => 'str' in i ? i.str : '').join(''); }
      const normalize = (s: string) => s.replace(/\s/g, '');
      for (const needle of [content.basics.name, content.basics.email, content.basics.phone]) if (!normalize(text).includes(normalize(needle))) throw new Error(`${t.id}/${sample}: PDF missing ${needle}`);
      for (const section of content.sections) for (const entry of section.entries) if (entry.title && !normalize(text).includes(normalize(entry.title))) throw new Error(`${t.id}/${sample}: PDF entry text missing`);
      if (parsed.numPages !== pagination.pageCount || parsed.numPages !== printPagination.pageCount) throw new Error(`${t.id}/${sample}: PDF page count mismatch ${parsed.numPages}/${pagination.pageCount}`);
      const links = await (await parsed.getPage(1)).getAnnotations();
      if (!links.some((l) => l.subtype === 'Link')) throw new Error(`${t.id}/${sample}: PDF links missing`);
      const docx=await createStudioDocx(content,layout,resources);
      await writeFile(resolve(out,`${t.id}-${sample}.docx`),docx);
      const wordText=(await mammoth.extractRawText({buffer:docx})).value;
      for(const needle of [content.basics.name,content.basics.email,...content.sections.flatMap((s)=>s.entries.flatMap((e)=>[e.title,...Object.values(e.details??{})]))].filter(Boolean)) if(!normalize(wordText).includes(normalize(needle!))) throw new Error(`${t.id}/${sample}: DOCX missing a field`);
      const row = { template: t.id, sample, passed: true, pageCount: parsed.numPages, elapsedMs: Math.round(performance.now() - started), bytes: pdf.length, copiedChinese: true, previewPdfBoundaries: true, completeEntryBodies:true, docxFields:true, docxBytes:docx.length, links: true };
      report.push(row); console.log(JSON.stringify(row)); await loading.destroy();
      } catch(error) { const row={template:t.id,sample,passed:false,error:String(error)};report.push(row);console.error(JSON.stringify(row)); }
    }
  }
} finally {
  await browser.close();
  await writeFile(resolve(out, `report-${ids.join('-')}.json`), JSON.stringify({ at: new Date().toISOString(), synthetic: true, results: report }, null, 2));
}
if(report.some((r)=>(r as {passed:boolean}).passed===false))process.exitCode=1;
