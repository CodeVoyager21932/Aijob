/** Rebuild the inspectable source/adapter ledger from the actual registry. */
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {RESUME_TEMPLATE_PROFILES,STUDIO_V3_VERSION} from '@aijob/contracts';
const root=resolve(import.meta.dirname,'../../../..'),out=resolve(root,'docs/evidence/resume-studio-quality-2026-09-10');
const original=JSON.parse(await readFile(resolve(out,'upstream/template-source-files.json'),'utf8')) as {id:string;source:string;commit:string;license:string;sha256:string;local:string}[];
const added=JSON.parse(await readFile(resolve(out,'upstream/new-sources.json'),'utf8')) as {repository:string;commit:string;path:string;source:string;sha256:string;local:string}[];
const notes:Record<string,string>={
 lapis_cn:'居中身份、蓝色细线标题、日期右对齐；照片从原版正文浮动改为页眉独立区域，避免长教育字段被遮挡。',
 rx_gengar:'左栏身份深底与浅底延伸、主栏摘要分区；保留可编辑摘要标题。',rendercv_classic:'居中大姓名、标题后延伸线、日期和地点右侧；中文页边距和模块间距适配。',
 jp_classic:'居中页眉与分隔线、组织和日期同行；紧凑联系信息。',jp_ats:'左对齐身份、单栏细线、朴素条目层级。',jp_euro:'身份强调色、照片描边、页眉与模块横线。',
 magic_cn_formal_photo:'姓名与求职方向居中、右侧证件照、教育三列字段。',magic_clean_minimal:'左侧40px圆形照片、居中身份、项目和技能网格；姓名采用12pt中文层级，不错误采用DSL XXL。',magic_executive_band:'浅色圆角页眉、左侧小圆照、连续职业时间轴；姓名采用12pt中文层级。',magic_compact_cn_photo:'紧凑页眉、居中身份、右证件照和密集模块。',magic_product_ops_focus:'联系信息标签双列、产品项目主次层级与行动内容。',
 rx_onyx:'极简左对齐页眉、正文前横线、常规模块与日期层级。',rx_scizor:'页顶强调线、姓名短底线、单栏分节。',rx_lapras:'独立标题色块与条目分区，保留主次栏组织。',rx_meowth:'分组页眉与模块间隔、清晰的条目标题/日期关系。',rx_kakuna:'简洁单栏、粗体标题、紧凑条目与充足页眉间隔。',
 jp_engineer:'技术简历页眉、项目标签和密集技能表达；不加入熟练度评分。',jp_swiss:'左侧页眉照片与身份、下方独立联系横线、方形列表符号。',jp_modern_minimal:'圆形照片、最小装饰、模块上方细线。',
 rx_azurill:'身份与模块分别分配区域，左侧辅助材料与右侧核心经历。',rx_bronzor:'左右栏及区域标题差异，日期和条目在栏内排列。',rx_chikorita:'照片位于主栏左侧，深色辅助栏首屏避让，主栏身份和经历。',rx_ditto:'顶部身份横带、照片独立锚点与双栏内容。',rx_glalie:'侧栏居中身份与照片、联系信息框、主栏内容。',rx_rhyhorn:'研究长稿双栏、头像与标题空间、模块横线。',
 jp_academic:'学术姓名/方向、模块字距、细线与日期；论文模块完整续排。',jp_scientist:'编号模块、研究方向与摘要斜体、成果与正文层级。',
 jp_modern:'渐变深色页眉、照片描边、明亮方向文字。',jp_berlin:'黑色页眉与几何装饰、黄色身份强调。',jp_designer:'大照片与身份并列、底部粗线、模块字距。',jp_blocks:'块状模块标题与结构化条目，内容仍为可选择文字。',jp_ribbon:'色带页眉、底边层次与模块飘带。',
 rx_ditgar:'深色侧栏身份、联系信息与辅助模块，主栏工作内容。',rx_leafish:'整宽摘要先于联系横带、后接双栏；超长摘要可以跨页再进入双栏。',rx_pikachu:'主栏色块身份、侧栏照片与辅助内容。',billryan_cn:'中文专业单栏、黑色细线、组织/角色与右侧日期，保留补充字段。',rendercv_engineering:'工程单栏、紧凑组织/角色/日期与模块层级，项目链接可复制。',
 bre_cool:'双色页眉、深色侧栏、圆照跨边界；首屏正文避让照片，不加入技能评分。',bre_creative:'橙色三角页眉、照片与身份空间、左侧简介和主栏内容。',bre_oblique:'斜切页眉、右侧身份与照片、文末联系区域，长内容自然续排。',
};
const extraPaths:Record<string,string>={lapis_cn:'styles/classic/vscode.css',billryan_cn:'resume.cls',rendercv_classic:'src/rendercv/schema/models/design/classic_theme.py',rendercv_engineering:'src/rendercv/schema/models/design/other_themes/engineeringresumes.yaml',bre_cool:'src/resumes/cool.vue',bre_creative:'src/resumes/creative.vue',bre_oblique:'src/resumes/oblique.vue'};
const specimens=JSON.parse(await readFile(resolve(out,'upstream/specimens/manifest.json'),'utf8')) as {id:string;file:string}[];
const rows=RESUME_TEMPLATE_PROFILES.map(p=>{
 const old=original.find(x=>x.id===p.id),extra=added.find(x=>x.path===extraPaths[p.id]);if(!old&&!extra)throw Error('SOURCE_MISSING:'+p.id);if(!notes[p.id])throw Error('ADAPTATION_MISSING:'+p.id);
 const source=old??{...extra!,license:p.id.startsWith('bre_')?'MIT declared in package.json; no LICENSE file at pinned commit':'MIT'};
 let reference=specimens.find(x=>x.id===p.id)?.file;reference=reference?'upstream/specimens/'+reference:undefined;
 if(p.id.startsWith('jp_')||p.id.startsWith('magic_'))reference=`upstream/component-renders/${p.id}.png`;
 if(p.id==='lapis_cn')reference='upstream/specimens/lapis-426571037-38f43bdc-47df-4401-9e3d-0a02da4d034d.png';
 if(p.id==='billryan_cn')reference='upstream/specimens/billryan-chinese.png';
 if(p.id.startsWith('rendercv_'))reference=`upstream/specimens/${p.id==='rendercv_classic'?'rendercv-classic':'rendercv-engineering'}.png`;
 return {id:p.id,name:p.name,version:STUDIO_V3_VERSION,source:source.source,commit:source.commit,license:source.license,sourceSha256:source.sha256,sourceFile:'upstream/'+source.local,reference,adaptation:notes[p.id],structure:{header:p.header,section:p.section,entry:p.entry,columns:p.columns},defaults:p.defaults,gallery:`gallery/${p.id}.png`,matrix:['short','medium','long'].map(s=>`matrix/${p.id}-${s}`)};
});
for(const row of rows){await readFile(resolve(out,row.reference!));await readFile(resolve(out,row.sourceFile));await writeFile(resolve(out,row.gallery),await readFile(resolve(root,`apps/web/public/resume-templates/${row.id}-${STUDIO_V3_VERSION}.png`)));}
const ledger={at:new Date().toISOString(),version:STUDIO_V3_VERSION,count:rows.length,sharedAdaptation:'HTML/Chromium implementation, fixed Noto SC font faces, pt/mm units and shared fragmentation. No upstream user data, skill ratings or remote assets. DOCX is an editable semantic adaptation, not a pixel-identical copy.',referenceLimit:'JobPilot/Magic references execute pinned unmodified template components with mapped gallery input and Chinese fallback; not a pristine hosted upstream app. Other references are upstream public sample images, so compare structure rather than different sample text.',templates:rows};
await writeFile(resolve(out,'template-catalog.json'),JSON.stringify(ledger,null,2));
const esc=(s:string|undefined)=>{if(s===undefined)throw Error('CATALOG_TEXT_MISSING');return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');};
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Aijob 40 套版式对照</title><style>body{font:16px/1.6 system-ui;margin:0;background:#f3f5f4;color:#19342d}header,main{max-width:1280px;margin:auto;padding:24px}article{background:white;padding:24px;margin-bottom:28px;border:1px solid #d6dfda;border-radius:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}img{max-width:100%;max-height:850px;object-fit:contain;vertical-align:top}figure{margin:0;background:#eef1ef;padding:12px}figcaption{margin-bottom:10px}a{color:#205c49}input{padding:12px;width:min(500px,90%)}small{color:#53665d}nav{display:flex;gap:16px;flex-wrap:wrap}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><header><h1>40 套版式：原参考与 Aijob 实际输出</h1><p>完整中文样稿只用于展示。此页面展示真实渲染结果；具体长短材料的 PDF 与 DOCX 均可打开检查。</p><p>JobPilot / Magic：固定源码组件以同一份样稿映射后渲染；其他项目：上游公开样张，内容不同。中文字体、分页、可编辑字段等适配说明逐套列出，不宣称像素复制。</p><input id="search" aria-label="搜索模板" placeholder="按名称、来源或版式搜索"></header><main>${rows.map(r=>`<article data-search="${esc(r.id+' '+r.name+' '+r.adaptation)}"><h2>${esc(r.name)}</h2><p>${esc(r.adaptation)}</p><small><a href="${esc(r.source)}">固定源码 ${r.commit.slice(0,10)}</a> · ${esc(r.license)} · ${r.version}</small><div class="pair"><figure><figcaption>原参考结构</figcaption><img loading="lazy" src="${r.reference}" alt="${esc(r.name)}原参考"></figure><figure><figcaption>Aijob 中文样稿 · 真实 A4 渲染</figcaption><img loading="lazy" src="${r.gallery}" alt="${esc(r.name)}中文适配"></figure></div><nav>${r.matrix.map((s,i)=>`<span>${['短稿','中稿','长稿'][i]}：<a href="${s}.pdf">PDF</a> / <a href="${s}.docx">DOCX</a></span>`).join('')}</nav></article>`).join('')}</main><script>document.querySelector('#search').addEventListener('input',event=>{const q=event.target.value.toLowerCase();for(const article of document.querySelectorAll('article'))article.hidden=!article.dataset.search.toLowerCase().includes(q)});</script></html>`;
await writeFile(resolve(out,'template-comparison.html'),html);
await writeFile(resolve(out,'template-catalog.sha256'),createHash('sha256').update(JSON.stringify(ledger)).digest('hex')+'\n');
console.info(JSON.stringify({templates:rows.length,referenceFilesVerified:true,output:out}));
