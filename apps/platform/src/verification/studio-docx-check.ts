import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import mammoth from 'mammoth';
import { chineseResumeSample, resumeRichPlain, resumeTemplateLayout, RESUME_TEMPLATES, RESUME_SAMPLE_PHOTO } from '@aijob/contracts';
import { createStudioDocx } from '../resume-documents/studio-docx.js';
const out=resolve(import.meta.dirname,'../../../../docs/evidence/direction-studio-upgrade-2026-09-09/templates');
const report=[];
const normalize=(s:string)=>s.replace(/\s/g,'');
for(const template of RESUME_TEMPLATES)for(const sample of ['short','medium','long'] as const){
  const content=chineseResumeSample(sample), buffer=await createStudioDocx(content,resumeTemplateLayout(template.id),{photoDataUrl:RESUME_SAMPLE_PHOTO});
  const text=normalize((await mammoth.extractRawText({buffer})).value);
  for(const needle of [content.basics.name,content.basics.phone,content.basics.email,...content.sections.flatMap(s=>s.entries.flatMap(e=>[e.title,e.organization,e.role,resumeRichPlain(e.body),...Object.values(e.details??{})]))].filter(Boolean))if(!text.includes(normalize(needle!)))throw new Error(`${template.id}/${sample}: missing field`);
  await writeFile(resolve(out,`${template.id}-${sample}.docx`),buffer);
  report.push({template:template.id,sample,passed:true,bytes:buffer.length});
}
await writeFile(resolve(out,'docx-report.json'),JSON.stringify({at:new Date().toISOString(),results:report},null,2));
console.info(JSON.stringify({passed:report.length}));
