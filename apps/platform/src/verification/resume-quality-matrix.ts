/** Synthetic only. Uses the production HTML, pagination, font set and final-byte validator. */
import { mkdir, writeFile,readFile,rename,access } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import mammoth from 'mammoth';
import { RESUME_TEMPLATE_PROFILES, RESUME_SAMPLE_PHOTO, chineseResumeSample, resumeTemplateLayout, studioV2Html, resumePaginationScript, resumeContentManifest, resumeContentAuditScript, normalizeResumeOutput } from '@aijob/contracts';
import { studioV3FontCss } from '../resume-documents/studio-fonts.js';
import { inspectResumePdf, type ResumePageAudit } from '../resume-documents/pdf-integrity.js';
import { createStudioDocx } from '../resume-documents/studio-docx.js';
import {resumeContentForTemplate} from '@aijob/contracts';

const root = resolve(import.meta.dirname, '../../../..');
const ids = (process.argv.find(a => a.startsWith('--templates='))?.slice(12) ?? 'lapis_cn,rx_gengar,rendercv_classic').split(',');
const templates = RESUME_TEMPLATE_PROFILES.filter(t => ids.includes('all') || ids.includes(t.id));
if (!templates.length) throw new Error('No registered v3 templates selected');
const out = resolve(root, 'docs/evidence/resume-studio-quality-2026-09-10/matrix'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PDF_BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const reportPath=resolve(out,`report-${ids.join('-')}.json`);
const sourcePaths=['packages/contracts/src/resume-renderer-v3.ts','packages/contracts/src/resume-template-v3-regions.ts','packages/contracts/src/resume-template-profiles.ts','packages/contracts/src/resume-pagination.ts','packages/contracts/src/resume-content-manifest.ts','packages/contracts/src/resume-studio-samples.ts','apps/platform/src/resume-documents/studio-docx.ts','apps/platform/src/resume-documents/studio-fonts.ts','apps/platform/src/resume-documents/pdf-integrity.ts','apps/web/public/fonts/font-set-v3.json'];
sourcePaths.push('packages/contracts/src/resume-template-start.ts');
const signature=createHash('sha256').update((await Promise.all(sourcePaths.map(p=>readFile(resolve(root,p),'utf8')))).join('\n')).digest('hex');
const results: Record<string, unknown>[] = [];
if(process.argv.includes('--resume')){try{const previous=JSON.parse(await readFile(reportPath,'utf8'));if(previous.signature===signature)for(const result of previous.results??[]){if(!result.passed)continue;const id=`${result.template}-${result.sample}`;try{await Promise.all(['pdf','docx','png','manifest.json','audit.json'].map(extension=>access(resolve(out,`${id}.${extension}`))));results.push(result);}catch{}}}catch{}}
async function checkpoint(){await writeFile(reportPath+'.tmp',JSON.stringify({at:new Date().toISOString(),synthetic:true,signature,complete:results.length===templates.length*3&&results.every(r=>r.passed),expected:templates.length*3,results},null,2));await rename(reportPath+'.tmp',reportPath);}
try {
  for (const template of templates) for (const sample of ['short', 'medium', 'long'] as const) {
    if(results.some(r=>r.template===template.id&&r.sample===sample))continue;
    const id = `${template.id}-${sample}`, started = performance.now();
    const page = await browser.newPage({ viewport: { width: 900, height: 1250 } }); await page.route('**/*', r => r.abort());
    try {
      const content = resumeContentForTemplate(chineseResumeSample(sample),template.id), layout = resumeTemplateLayout(template.id), manifest = resumeContentManifest(content);
      await writeFile(resolve(out,`${id}.manifest.json`),JSON.stringify(manifest,null,2));
      const fontCss = await studioV3FontCss(resolve(root, 'apps/web/public/fonts'), layout);
      await page.emulateMedia({ media: 'screen' });
      await page.setContent(studioV2Html('合成简历质量验收', content, layout, fontCss, { photoDataUrl: RESUME_SAMPLE_PHOTO }));
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(image => image.decode())); });
      const options = { keepEntriesTogether: layout.keepEntriesTogether, autoColumns: layout.autoColumns !== false };
      const screen = await page.evaluate<{ pageCount: number }>(resumePaginationScript(options));
      const screenText = await page.locator('.rs-page').allTextContents();
      const audit = await page.evaluate<ResumePageAudit>(resumeContentAuditScript(manifest));
      const geometry = await page.evaluate(() => Array.from(document.querySelectorAll('.rs-page')).map(p => ({
        page: p.getBoundingClientRect().toJSON(),
        blocks: Array.from(p.querySelectorAll('.rs-header,.rs-col,.rs-section')).map(e => ({
          className: e.className, kind: e.getAttribute('data-kind'), rect: e.getBoundingClientRect().toJSON(),
          scrollHeight: e.scrollHeight, clientHeight: e.clientHeight,
        })),
      })));
      await writeFile(resolve(out, `${id}.geometry.json`), JSON.stringify(geometry, null, 2));
      await page.screenshot({ path: resolve(out, `${id}.png`), fullPage: true });
      await writeFile(resolve(out, `${id}.audit.json`), JSON.stringify(audit, null, 2));
      if (audit.failures.length) throw new Error(`PAGINATION:${JSON.stringify(audit.failures)}`);
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(resumePaginationScript(options));
      if (JSON.stringify(screenText) !== JSON.stringify(await page.locator('.rs-page').allTextContents())) throw new Error('PREVIEW_PRINT_BOUNDARIES_DIFFER');
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true });
      await writeFile(resolve(out, `${id}.pdf`), pdf);
      const inspection = await inspectResumePdf(pdf, manifest, await page.evaluate<ResumePageAudit>(resumeContentAuditScript(manifest)));
      if (sample === 'short' && screen.pageCount !== 1) throw new Error('SHORT_SAMPLE_NOT_ONE_PAGE');
      const docx = await createStudioDocx(content, layout, { photoDataUrl: RESUME_SAMPLE_PHOTO });
      await writeFile(resolve(out, `${id}.docx`), docx);
      const wordText = normalizeResumeOutput((await mammoth.extractRawText({ buffer: docx })).value);
      const missing = manifest.fields.filter(f => !wordText.includes(normalizeResumeOutput(f.value))).map(f => f.id);
      if (missing.length) throw new Error(`DOCX_MISSING:${missing.join(',')}`);
      const result = { template: template.id, sample, passed: true, ...inspection, previewPdfBoundaries: true, docxFields: true, elapsedMs: Math.round(performance.now() - started) };
      results.push(result); console.info(JSON.stringify(result));
    } catch (error) {
      const extra = error && typeof error === 'object' && 'failures' in error ? error.failures : undefined;
      const result = { template: template.id, sample, passed: false, error: String(error), failures: extra };
      results.push(result); console.error(JSON.stringify(result));
    } finally {await page.close();await checkpoint();}
  }
} finally {
  await browser.close();
  await checkpoint();
}
if (results.some(r => !r.passed)) process.exitCode = 1;
