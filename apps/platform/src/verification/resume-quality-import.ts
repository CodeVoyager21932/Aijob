/** File upload → isolated parser → editable document → retained original → complete PDF. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const root=resolve(import.meta.dirname,'../../../..'),out=resolve(root,'docs/evidence/resume-studio-quality-2026-09-10/browser'),base='http://127.0.0.1:5173';
await mkdir(out,{recursive:true});
const source=resolve(root,'docs/evidence/resume-studio-quality-2026-09-10/matrix/lapis_cn-short.pdf');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
let inspectedPage: import('playwright-core').Page | undefined;
const failures: unknown[]=[];
try{
 const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(90000);
 inspectedPage=page;page.on('response',async response=>{if(response.status()>=400){const failure={url:response.url(),status:response.status(),body:await response.text().catch(()=>'<unavailable>')};failures.push(failure);console.error(JSON.stringify(failure));}});
 await page.goto(base+'/resumes/import');await page.locator('input[type=file]').setInputFiles(source);
 await page.getByRole('button',{name:'导入并开始编辑',exact:true}).click();await page.waitForURL(/\/resumes\/[0-9a-f-]+$/);
 await page.waitForFunction(()=>Array.from(document.querySelectorAll<HTMLInputElement>('input')).some(input=>input.value==='lin.zhixia@example.com'),{},{timeout:120000});
 assert.equal(await page.getByLabel('邮箱',{exact:true}).inputValue(),'lin.zhixia@example.com');
 assert.equal(await page.getByLabel('电话',{exact:true}).inputValue(),'13800000000');
 const text=await page.locator('.sw-editor-form').count()?await page.locator('.sw-editor-form').innerText():await page.locator('main').innerText();assert(!text.includes('逐项确认'));
 await page.getByRole('button',{name:'导入原件',exact:true}).click();const originals=page.getByRole('dialog',{name:'导入记录与原件'});
 const originalDownload=page.waitForEvent('download');await originals.getByRole('button',{name:'下载原件',exact:true}).click();await(await originalDownload).saveAs(resolve(out,'import-original.pdf'));
 assert.deepEqual(await readFile(source),await readFile(resolve(out,'import-original.pdf')));await page.keyboard.press('Escape');
 await page.getByLabel('姓名',{exact:true}).fill('导入后编辑同学');
 const generated=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'下载 PDF',exact:true}).click();await(await generated).saveAs(resolve(out,'import-edited.pdf'));
 const loading=getDocument({data:new Uint8Array(await readFile(resolve(out,'import-edited.pdf'))),useSystemFonts:false}),pdf=await loading.promise;let output='';
 for(let n=1;n<=pdf.numPages;n++)output+=(await(await pdf.getPage(n)).getTextContent({disableNormalization:true})).items.map(i=>'str'in i?i.str:'').join('');await loading.destroy();
 for(const phrase of ['导入后编辑同学','lin.zhixia@example.com','13800000000','校园学习空间','8次同学访谈'])assert(output.replace(/\s/g,'').includes(phrase));
 await page.reload();await page.getByLabel('姓名',{exact:true}).waitFor();assert.equal(await page.getByLabel('姓名',{exact:true}).inputValue(),'导入后编辑同学');
 await page.screenshot({path:resolve(out,'import-editor.png')});const report={passed:true,synthetic:true,realPdfImport:true,parserCompleted:true,contactsRetained:true,originalBytesUnchanged:true,immediateEditExportComplete:true,reopenPreservesEdits:true};await writeFile(resolve(out,'import.json'),JSON.stringify(report,null,2));console.info(JSON.stringify(report));
}catch(error){if(inspectedPage){await inspectedPage.screenshot({path:resolve(out,'import-failure.png')});failures.push({error:String(error),screen:await inspectedPage.locator('body').innerText()});await writeFile(resolve(out,'import-failure.json'),JSON.stringify(failures,null,2));}throw error;}finally{await browser.close();}
