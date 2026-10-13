/** Native Chromium zoom/IME composition, paste semantics and real save recovery. Synthetic owner only. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {chineseResumeSample,resumeTemplateLayout,type ResumeStudioDraft} from '@aijob/contracts';
const root=resolve(import.meta.dirname,'../../../..'),out=resolve(root,'docs/evidence/resume-studio-quality-2026-09-10/browser'),base='http://127.0.0.1:5173';
await mkdir(out,{recursive:true});
const context=await chromium.launchPersistentContext(resolve(root,`.data/resume-quality-20260910/input-${randomUUID()}`),{headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',viewport:{width:1600,height:1000}});
const page=context.pages()[0]!;page.setDefaultTimeout(45000);
try{
 await context.request.get(base+'/v1/session');const csrf=(await context.cookies()).find(c=>c.name==='aijob_csrf')?.value??'';
 async function api<T>(method:string,path:string,data?:unknown):Promise<T>{const r=await context.request.fetch(base+path,{method,...(data?{data}:{}),headers:{origin:base,'x-csrf-token':csrf,'idempotency-key':randomUUID()}});assert(r.ok(),`${r.status()} ${await r.text()}`);return r.json() as Promise<T>;}
 let d=await api<ResumeStudioDraft>('POST','/v1/resume-documents/studio',{title:'输入与恢复 · 合成稿'});
 d=await api<ResumeStudioDraft>('PUT',`/v1/resume-documents/${d.documentId}/studio`,{expectedRevision:d.revision,title:d.title,content:chineseResumeSample('long'),layout:resumeTemplateLayout('lapis_cn')});
 const path=`/v1/resume-documents/${d.documentId}/studio`;
 await page.goto(base+`/resumes/${d.documentId}`);await page.getByLabel('姓名',{exact:true}).waitFor();
 const project=d.content.sections.find(s=>s.kind==='project')!.entries[0]!;
 const editor=page.locator(`[data-form-entry="${project.id}"] [contenteditable=true]`);await editor.click();await page.keyboard.press('Control+End');
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:'正在组合中文',selectionStart:6,selectionEnd:6});
 assert((await editor.innerText()).includes('正在组合中文'));
 await cdp.send('Input.insertText',{text:'中文输入完成'});assert((await editor.innerText()).includes('中文输入完成'));
 assert(!(await editor.innerText()).includes('正在组合中文'));
 await editor.evaluate(e=>{const transfer=new DataTransfer();transfer.setData('text/html',"<p STYLE='font-size:48pt;font-family:fantasy;margin:80px'><span style='font-weight:700;font-style:italic;text-decoration:underline'>粘贴保留重点</span> <a href='https://example.com/source' style='font-size:72px'>原始链接</a></p>");e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));});
 assert(await editor.locator('strong em u').count()>0);assert.equal(await editor.locator('[style*="font-size"],[style*="font-family"]').count(),0);assert.equal(await editor.locator('a[href="https://example.com/source"]').count(),1);
 await page.waitForFunction(()=>document.querySelector('.sw-save-status')?.textContent==='已自动保存');
 // An acknowledged failure must leave recoverable local input through reload.
 await page.route('**'+path,route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/problem+json',body:JSON.stringify({title:'测试暂时离线',detail:'合成网络故障',status:503})}):route.continue());
 await page.getByLabel('姓名',{exact:true}).fill('离线仍保留同学');await page.getByRole('button',{name:'重试保存',exact:true}).waitFor();
 await page.reload();await page.getByLabel('姓名',{exact:true}).waitFor();assert.equal(await page.getByLabel('姓名',{exact:true}).inputValue(),'离线仍保留同学');
 await page.unroute('**'+path);await page.getByRole('button',{name:'重试保存',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.sw-save-status')?.textContent==='已自动保存');
 assert.equal((await api<ResumeStudioDraft>('GET',path)).content.basics.name,'离线仍保留同学');
 // Independent writer changes the same revision while the first tab remains open.
 const remote=await api<ResumeStudioDraft>('GET',path);remote.content.basics.name='另一窗口的输入';await api('PUT',path,{expectedRevision:remote.revision,title:remote.title,content:remote.content,layout:remote.layout});
 await page.getByLabel('姓名',{exact:true}).fill('本窗口继续编辑');await page.getByRole('button',{name:'比较并处理修改',exact:true}).click();
 const conflict=page.getByRole('dialog',{name:'比较未同步修改'});assert((await conflict.innerText()).includes('另一窗口的输入'));await conflict.getByRole('button',{name:'保留当前输入并保存',exact:true}).click();await conflict.waitFor({state:'hidden'});assert.equal((await api<ResumeStudioDraft>('GET',path)).content.basics.name,'本窗口继续编辑');
 // This is Chrome's own appearance setting, not CSS zoom or pinch emulation.
 const settings=await context.newPage();await settings.goto('chrome://settings/appearance');await settings.locator('#zoomLevel').selectOption({label:'200%'});await settings.close();await page.reload();await page.getByLabel('姓名',{exact:true}).waitFor();
 const zoom=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio,visualScale:visualViewport?.scale}));assert(zoom.width<=810&&zoom.dpr>=1.99,JSON.stringify(zoom));
 assert(await page.getByRole('button',{name:'编辑内容',exact:true}).isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.getByLabel('姓名',{exact:true}).fill('原生双倍缩放仍可编辑');await page.getByRole('button',{name:'模板',exact:true}).click();const gallery=page.getByRole('dialog',{name:'选择简历模板'});assert(await gallery.isVisible());await page.screenshot({path:resolve(out,'native-zoom-200.png')});await page.keyboard.press('Escape');
 // A reduced visual viewport models keyboard occlusion; no physical phone claim.
 await page.setViewportSize({width:720,height:640});await page.getByLabel('姓名',{exact:true}).click();const bounds=await page.getByLabel('姓名',{exact:true}).boundingBox();assert(bounds&&bounds.y>=0&&bounds.y+bounds.height<320);await page.screenshot({path:resolve(out,'keyboard-viewport.png')});
 const report={passed:true,synthetic:true,compositionViaChromeInput:true,pasteSemanticsAndTypography:true,offlineReloadRecovery:true,revisionConflictKeepsInput:true,nativeZoom200:zoom,keyboardOcclusion:'reduced viewport; physical phone not exercised'};
 await writeFile(resolve(out,'input-recovery.json'),JSON.stringify(report,null,2));console.info(JSON.stringify(report));
}catch(e){await page.screenshot({path:resolve(out,'input-failure.png')});await writeFile(resolve(out,'input-failure.txt'),String(e)+'\n'+await page.locator('body').innerText());throw e;}finally{await context.close();}
