import { nativeOutputFixture } from "./fixtures.mts";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyNativeTemplate, nativeTemplateCatalog, parseNativeResumeDocument, newNativeItem } from "../../packages/resume-core/dist/index.js";
import { renderNativePdfIsolated } from "../../packages/resume-renderer/dist/isolated.mjs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require=createRequire(new URL("../../apps/platform/package.json",import.meta.url));
const {getDocument}=await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
const {extractRawText}=require("mammoth");
import { createNativeDocx } from "../../apps/platform/src/resume-documents/native-docx.ts";
import { nativeOutputText, nativeOutputLinks, normalizeNativeLink } from "../../apps/platform/src/resume-documents/native-output-content.ts";
const root=resolve(import.meta.dirname,"../..");
const args=process.argv.slice(2);
const outputArg=args.indexOf("--out");
const templateArg=args.indexOf("--templates");
const selectedTemplates=templateArg>=0 ? new Set(args[templateArg+1]?.split(",")) : null;
if(selectedTemplates && [...selectedTemplates].some(id=>!nativeTemplateCatalog.some(template=>template.id===id))) throw new Error("Unknown template selection; use a quoted comma-separated list.");
const dir=resolve(root,outputArg>=0 ? args[outputArg+1] : ".data/resume-native-k1-20260912/matrix");await mkdir(dir,{recursive:true});
const source=nativeOutputFixture();
const results=[];
const normalize=(text:string)=>text.normalize("NFKC").replace(/\s/g,"");
for(const template of nativeTemplateCatalog.filter(item=>!selectedTemplates||selectedTemplates.has(item.id)))for(const length of ["short","medium","long"]){
  const doc=applyNativeTemplate(source,template.id);
  doc.data.basics.customFields.push({id:"matrix-portfolio",icon:"",text:"作品与研究报告",link:"https://example.com/portfolio"});
  for(const skill of doc.data.sections.skills.items)skill.description="<p>技能补充：校验 24 个查询与 12% 的抽样记录。</p>";
  if(length === "short") {for(const id of ["publications","skills","certifications","awards"] as const)doc.data.sections[id].items=[];doc.data.customSections=[];doc.data.sections.projects.items=doc.data.sections.projects.items.slice(0,1);}
  if(length==="medium"){
    doc.data.summary.content="<p>关注人机协作与用户研究，使用实际资料记录方法和结论。</p>";
    doc.data.sections.languages.items.push({...newNativeItem("languages","matrix-language"),language:"英语",fluency:"CET-6 520 分",description:"<p>能够阅读研究文献。</p>"});
    doc.data.sections.volunteer.items.push({...newNativeItem("volunteer","matrix-volunteer"),organization:"示例志愿服务队",location:"南京",period:"2025.07",description:"<p>整理 32 份报名资料并完成现场登记。</p>"});
    doc.data.sections.profiles.items.push({...newNativeItem("profiles","matrix-profile"),network:"作品主页",username:"林同学的研究记录",website:{url:"https://example.com/research",label:"研究资料",inlineLink:false}});
    doc.data.sections.interests.items.push({...newNativeItem("interests","matrix-interest"),name:"科学传播",keywords:["校园讲座","科普写作"]});
    doc.data.sections.references.items.push({...newNativeItem("references","matrix-reference"),name:"示例指导老师",position:"项目指导",phone:"010-00000000",description:"<p>联系前请先征得老师同意。</p>"});
    const school=doc.data.sections.education.items[0];if(school)doc.data.sections.education.items.push({...school,id:"education-2",school:"第二所示例学校",period:"2027.09–2030.06"});
    const experience=doc.data.sections.experience.items[0];if(experience)for(let i=2;i<=3;i++)doc.data.sections.experience.items.push({...experience,id:`experience-${i}`,company:`示例企业${i}`});
  }
  if(length==="long"){
    const project=doc.data.sections.projects.items[0];if(project)project.description=Array.from({length:70},(_,i)=>`<p>研究记录${i+1}号：整理中文材料，完成 18 次访谈与 2 轮实验，保留完整论证过程及研究报告。</p>`).join("");
  }
  const name=`${template.id}-${length}`;const start=performance.now();
  const expected=nativeOutputText(doc).map(normalize);
  const pdfBytes=await renderNativePdfIsolated(doc,resolve(root,"apps/web/public/fonts"));
  const task=getDocument({data:new Uint8Array(pdfBytes)});const pdf=await task.promise;let pdfText="";
  const links=new Set<string>();
  for(let n=1;n<=pdf.numPages;n++){
    const page=await pdf.getPage(n);
    pdfText+=(await page.getTextContent()).items.map(item=>"str" in item?item.str:"").join("");
    for(const annotation of await page.getAnnotations())if(annotation.url)links.add(normalizeNativeLink(annotation.url));
  }
  const docx=await createNativeDocx(doc);const docxText=(await extractRawText({buffer:docx})).value;
  const missingPdf=expected.filter(text=>!normalize(pdfText).includes(text));const missingDocx=expected.filter(text=>!normalize(docxText).includes(text));
  const missingLinks=nativeOutputLinks(doc).filter(url=>!links.has(normalizeNativeLink(url)));
  const row={template:template.id,length,pages:pdf.numPages,expectedFields:expected.length,missingPdf:missingPdf.length,missingDocx:missingDocx.length,missingLinks:missingLinks.length,elapsedMs:performance.now()-start,docxVisual:"pending"};
  results.push(row);await writeFile(resolve(dir,`${name}.pdf`),pdfBytes);await writeFile(resolve(dir,`${name}.docx`),docx);await writeFile(resolve(dir,`${name}.json`),JSON.stringify(doc));await task.destroy();
  console.log(JSON.stringify(row));
  if(missingPdf.length||missingDocx.length||missingLinks.length)throw new Error(`Native output missing fields or links: ${name}`);
}
await writeFile(resolve(dir,"results.json"),JSON.stringify(results,null,2));
