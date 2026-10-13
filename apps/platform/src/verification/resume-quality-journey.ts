/** Real editor + production export bytes; fresh synthetic owner, no external sites. */
import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ResumeStudioDraft,ResumeExportArtifact } from '@aijob/contracts';
const root=resolve(import.meta.dirname,'../../../..'),out=resolve(root,'docs/evidence/resume-studio-quality-2026-09-10/browser'),base='http://127.0.0.1:5173';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
try{
 await context.request.get(`${base}/v1/session`);const csrf=(await context.cookies()).find(c=>c.name==='aijob_csrf')?.value??'';
 async function api<T>(method:string,path:string,data?:unknown):Promise<T>{const r=await context.request.fetch(base+path,{method,...(data?{data}:{}),headers:{origin:base,'x-csrf-token':csrf,'idempotency-key':randomUUID()}});assert(r.ok(),`${r.status()} ${await r.text()}`);return r.json() as Promise<T>;}
 const draft=await api<ResumeStudioDraft>('POST','/v1/resume-documents/studio',{title:'工作室质量走查 · 合成稿'}),doc=draft.documentId;
 assert.equal(draft.layout.templateKey,'lapis_cn');
 const page=await context.newPage();page.setDefaultTimeout(45000);const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`${base}/resumes/${doc}`);await page.getByLabel('姓名',{exact:true}).waitFor();
 await page.locator('.sw-preview-pane [data-preview-ready="true"]').waitFor();
 const frame=page.frameLocator('.sw-preview-pane iframe');assert.equal(await frame.locator('.rs-page [data-resume-field]').count(),0);
 await page.getByLabel('姓名',{exact:true}).fill('质量测试同学');await page.getByLabel('邮箱',{exact:true}).fill('quality@example.com');await page.getByLabel('学校',{exact:true}).fill('合成测试大学');
 const project=draft.content.sections.find(s=>s.kind==='project');assert(project?.entries[0]);
 const entry=page.locator(`[data-form-entry="${project.entries[0].id}"]`);
 await entry.locator('input').first().fill('课程数据分析项目');
 const prose='使用 SQL 整理 128 条课程数据，核对 12.5% 的缺失记录。保存与导出保持一致。';
 await entry.locator('[contenteditable="true"]').fill(prose);
 const downloadPromise=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'下载 PDF',exact:true}).click();
 const download=await downloadPromise;await download.saveAs(resolve(out,'immediate-input.pdf'));
 const files=(await api<{items:ResumeExportArtifact[]}>('GET',`/v1/resume-documents/${doc}/exports`)).items;
 assert.equal(files.length,1);assert.equal(files[0]?.state,'ready');const artifact=files[0];assert(artifact);
 const response=await context.request.get(`${base}/v1/resume-exports/${artifact.id}/file`);assert(response.ok());
 const bytes=await response.body();assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);
 assert.deepEqual(bytes,await readFile(resolve(out,'immediate-input.pdf')));
 const loading=getDocument({data:new Uint8Array(bytes),useSystemFonts:false}),pdf=await loading.promise;let text='';
 for(let p=1;p<=pdf.numPages;p++)text+=(await (await pdf.getPage(p)).getTextContent({disableNormalization:true})).items.map(i=>'str'in i?i.str:'').join('');
 await loading.destroy();for(const s of ['合成测试大学','课程数据分析项目','128','12.5%','保存与导出保持一致。'])assert(text.replace(/\s/g,'').includes(s));
 await page.getByRole('button',{name:'版本与导出',exact:true}).click();
 const history=page.getByRole('dialog',{name:'简历版本'});
 await history.getByRole('button',{name:'预览 PDF',exact:true}).click();
 const viewer=page.getByRole('dialog',{name:'已生成的 PDF'});
 await viewer.locator('iframe[src^="blob:"]').waitFor();
 const repeatedDownload=page.waitForEvent('download');await viewer.getByRole('button',{name:'下载这份 PDF',exact:true}).click();
 await(await repeatedDownload).saveAs(resolve(out,'retained-preview.pdf'));assert.deepEqual(bytes,await readFile(resolve(out,'retained-preview.pdf')));
 await page.keyboard.press('Escape');await viewer.waitFor({state:'hidden'});assert(await history.isVisible());
 assert(await history.getByRole('button',{name:'预览 PDF',exact:true}).evaluate(e=>e===document.activeElement));
 await page.keyboard.press('Escape');await history.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'模板',exact:true}).click();const gallery=page.getByRole('dialog',{name:'选择简历模板'}),listing=gallery.getByRole('region',{name:'模板列表'});
 await listing.evaluate(e=>{e.scrollTop=e.scrollHeight;});await gallery.locator('.sw-template-thumb').last().click();await gallery.locator('[data-preview-ready="true"]').waitFor();
 const position=await listing.evaluate(e=>e.scrollTop);assert(position>200);await gallery.getByRole('button',{name:'返回编辑',exact:true}).click();
 await page.getByRole('button',{name:'模板',exact:true}).click();await gallery.locator('[data-preview-ready="true"]').waitFor();assert(Math.abs(await listing.evaluate(e=>e.scrollTop)-position)<5);
 await gallery.getByLabel('搜索模板').fill('Gengar');await gallery.getByRole('button',{name:'使用模板',exact:true}).click();await gallery.waitFor({state:'hidden'});await page.locator('.sw-preview-pane [data-preview-ready="true"]').waitFor();
 const changed=await api<ResumeStudioDraft>('GET',`/v1/resume-documents/${doc}/studio`);assert.equal(changed.layout.templateKey,'rx_gengar');assert(JSON.stringify(changed.content).includes(prose));
 assert(!(await frame.locator('.rs-page').allTextContents()).some(t=>t.includes('待填写')));await page.screenshot({path:resolve(out,'editor-desktop.png')});
 await page.getByRole('button',{name:'撤销修改',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.sw-save-status')?.textContent?.includes('已自动保存'));
 assert.equal((await api<ResumeStudioDraft>('GET',`/v1/resume-documents/${doc}/studio`)).layout.templateKey,'lapis_cn');
 const widths=[360,320,800];
 for(const width of widths){
  await page.setViewportSize({width,height:800});await page.getByRole('button',{name:'模板',exact:true}).click();await gallery.getByLabel('搜索模板').fill('LapisCV');await gallery.locator('.sw-template-thumb').click();await gallery.locator('[data-preview-ready="true"]').waitFor();
  const bounds=await gallery.getByRole('button',{name:'应用这套模板',exact:true}).boundingBox();assert(bounds&&bounds.y>=0&&bounds.y+bounds.height<=800);
  assert(await gallery.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:resolve(out,`gallery-${width}.png`)});
  await gallery.locator('.sw-gallery-detail').getByRole('button',{name:'返回模板列表',exact:true}).click();await page.keyboard.press('Escape');assert(await page.getByRole('button',{name:'模板',exact:true}).evaluate(e=>e===document.activeElement));
 }
 await page.setViewportSize({width:1600,height:1000});await page.reload();await page.getByLabel('姓名',{exact:true}).waitFor();assert.equal(await page.getByLabel('姓名',{exact:true}).inputValue(),'质量测试同学');assert.equal(await page.locator(`[data-form-entry="${project.entries[0].id}"] [contenteditable="true"]`).innerText(),prose);
 assert.deepEqual(errors,[]);const report={passed:true,synthetic:true,defaultLapis:true,paperContainsOnlyInput:true,immediateDownloadComplete:true,artifactBytesStable:true,retainedPdfPreview:true,nestedDialogFocusRestored:true,reopenKeepsInput:true,galleryPositionRestored:true,templateUndo:true,mobileWidths:widths,pageErrors:errors};
 await writeFile(resolve(out,'journey.json'),JSON.stringify(report,null,2));console.info(JSON.stringify(report));
}finally{await browser.close();}
