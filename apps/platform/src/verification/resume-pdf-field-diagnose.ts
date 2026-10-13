/** Synthetic matrix diagnostics only: this path cannot target private files. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chineseResumeSample, resumeContentManifest, normalizeResumeOutput } from '@aijob/contracts';
import type { ResumePageAudit } from '../resume-documents/pdf-integrity.js';
const root=resolve(import.meta.dirname,'../../../../docs/evidence/resume-studio-quality-2026-09-10/matrix');
const file='lapis_cn-short', audit=JSON.parse(await readFile(resolve(root,file+'.audit.json'),'utf8')) as ResumePageAudit;
const manifest=resumeContentManifest(chineseResumeSample('short'));
const task=getDocument({data:new Uint8Array(await readFile(resolve(root,file+'.pdf'))),useSystemFonts:false});const pdf=await task.promise;
const rows:{page:number;text:string;x:number;y:number;width:number;height:number}[]=[];
for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),v=page.getViewport({scale:1});for(const item of (await page.getTextContent({ disableNormalization: true })).items)if('str'in item)rows.push({page:n,text:item.str,x:item.transform[4],y:v.height-item.transform[5]-item.height*.5,width:item.width,height:item.height});}
for(const field of manifest.fields){const positions=audit.positions.filter(p=>p.fieldId===field.id),selected=rows.filter(row=>positions.some(p=>p.page===row.page&&row.y>=p.y-2&&row.y<=p.y+p.height+2&&row.x+row.width>p.x-.5&&row.x<p.x+p.width+.5));const actual=normalizeResumeOutput(selected.map(r=>r.text).join(''));if(!actual.includes(normalizeResumeOutput(field.value)))console.info(JSON.stringify({field:field.id,expected:field.value,actual,positions,selected}));}
await task.destroy();
