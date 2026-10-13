import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractNativeResumeBlocks } from "../../apps/platform/src/resume/native-extraction.js";
import { importNativeChineseBlocks, nativeTextBlocks } from "../../packages/resume-core/dist/index.js";

const dir=resolve(import.meta.dirname,"../../.data/resume-native-k2-20260912/independent-corpus");
const manifest=JSON.parse(await readFile(resolve(dir,"manifest.json"),"utf8")) as {id:number;file:string;kind:string;split:string;expected:Record<string,string[]>}[];
const rows=[];
for(const fixture of manifest){
  const buffer=await readFile(resolve(dir,fixture.file));
  try{
    const blocks=process.argv.includes("--reuse-blocks") ? JSON.parse(await readFile(resolve(dir,`parsed-${fixture.id}.json`),"utf8")).blocks : fixture.kind==="txt"?nativeTextBlocks(buffer.toString("utf8")):(await extractNativeResumeBlocks({kind:fixture.kind.startsWith("pdf")?"pdf":"docx",buffer,timeoutMs:30000})).blocks;
    const parsed=importNativeChineseBlocks(blocks,`independent-${fixture.id}`);
    const categories=Object.fromEntries(Object.entries(fixture.expected).map(([category,names])=>{
      const items=category==="research"?parsed.document.data.customSections.filter(s=>s.aijobKind==="research").flatMap(s=>s.items):parsed.document.data.sections[category]?.items??[];
      const used=new Set<number>();
      let tp=0;
      for(const name of names){
        // Match the title/organization field, never a mention buried inside fallback prose.
        const index=items.findIndex((item,i)=>!used.has(i) && ["school","company","name","organization"].some(key=>typeof item[key]==="string" && item[key].includes(name)));
        if(index>=0){used.add(index);tp++;}
      }
      return [category,{expected:names.length,actual:items.length,tp,fp:items.length-tp,fn:names.length-tp}];
    }));
    const mapped=new Set(parsed.mappings.map(m=>m.blockId));
    const row={id:fixture.id,kind:fixture.kind,split:fixture.split,quality:parsed.quality,categories,unmapped:blocks.filter(b=>!mapped.has(b.id)).length};
    rows.push(row);
    await writeFile(resolve(dir,`parsed-${fixture.id}.json`),JSON.stringify({blocks,parsed,row},null,2));
    console.log(JSON.stringify(row));
  }catch(error){rows.push({id:fixture.id,kind:fixture.kind,split:fixture.split,error:error instanceof Error?error.message:"failed"});}
}
const metrics=[];
for(const split of ["development","holdout"])for(const category of ["education","experience","projects","research","volunteer"]){
  const values=rows.filter(r=>r.split===split && "categories" in r).map(r=>r.categories?.[category]).filter(Boolean);
  const sum=(key:string)=>values.reduce((n,v)=>n+(v?.[key]??0),0);
  const tp=sum("tp"),fp=sum("fp"),fn=sum("fn");
  metrics.push({split,category,tp,fp,fn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null});
}
await writeFile(resolve(dir,"evaluation.json"),JSON.stringify({scope:"Section-entry boundary/name classification only; not complete field accuracy or real-world validation",rows,metrics,failedInputs:rows.filter(r=>"error" in r).length},null,2));
console.log(JSON.stringify({metrics,failedInputs:rows.filter(r=>"error" in r).length}));
