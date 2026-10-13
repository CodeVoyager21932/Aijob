import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const root = resolve(import.meta.dirname, '../../../..');
const out = resolve(root, 'docs/evidence/resume-studio-quality-2026-09-10/font-check'); await mkdir(out, {recursive:true});
const text = '用户 ⼾ 户 见 ⻅ 青芽 ⻘ 数据 课程分析 办公 office fi ﬁ 12.5% Ａ A';
const family = process.argv.includes('--serif') ? 'Serif' : 'Sans';
const css = (await Promise.all(['Regular','Bold'].map(async(weight)=>`@font-face{font-family:Fixture;font-weight:${weight==='Bold'?700:400};src:url(data:font/otf;base64,${(await readFile(resolve(root,`apps/web/public/fonts/AijobV3${family}${weight}.otf`))).toString('base64')})}`))).join('');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const page=await browser.newPage();await page.route('**/*',r=>r.abort());
 await page.setContent(`<html><meta charset="utf-8"><style>${css}@page{size:A4;margin:15mm}body{font-family:Fixture;font-size:12pt;line-height:2}</style><p>${text}</p><p style="font-weight:700">${text}</p></html>`);
 await page.evaluate(()=>document.fonts.ready);const bytes=await page.pdf({format:'A4',preferCSSPageSize:true});await writeFile(resolve(out,family+'.pdf'),bytes);
 const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:false});const doc=await task.promise;let actual='';for(let n=1;n<=doc.numPages;n++) actual+=(await(await doc.getPage(n)).getTextContent({ disableNormalization: true })).items.map(i=>'str'in i?i.str:'').join('');await task.destroy();
 const normalize=(value:string)=>value.normalize('NFC').replace(/\s/g,'');const ok=normalize(actual)===normalize(text+text);
 await writeFile(resolve(out,family+'.json'),JSON.stringify({passed:ok,expected:text+text,actual,source:'synthetic Unicode alias regression'},null,2));console.info(JSON.stringify({family,passed:ok,pages:doc.numPages}));if(!ok)process.exitCode=1;
}finally{await browser.close();}
