import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { RESUME_TEMPLATES, RESUME_TEMPLATE_GROUPS, RESUME_TEMPLATE_VERSION, RESUME_RENDERER_VERSION } from '@aijob/contracts';
const root=resolve(import.meta.dirname,'../../../..');
const out=resolve(root,'docs/evidence/direction-studio-upgrade-2026-09-09');
const old=JSON.parse(await readFile(resolve(out,'templates/report-all.json'),'utf8'));
const classic=JSON.parse(await readFile(resolve(out,'templates/report-jp_classic.json'),'utf8'));
const docx=JSON.parse(await readFile(resolve(out,'templates/docx-report.json'),'utf8'));
const office=JSON.parse(await readFile(resolve(out,'templates/office-readback.json'),'utf8'));
const sources=JSON.parse(await readFile(resolve(out,'template-sources.json'),'utf8'));
const rows=[];
await mkdir(resolve(out,'thumbnails'),{recursive:true});
for(const t of RESUME_TEMPLATES){
  await copyFile(resolve(root,'apps/web/public/resume-templates',`${t.id}.png`),resolve(out,'thumbnails',`${t.id}.png`));
  const fixtures=[];
  for(const sample of ['short','medium','long']){
    const preview=(t.id==='jp_classic'?classic:old).results.find((r:{template:string;sample:string})=>r.template===t.id&&r.sample===sample);
    const word=docx.results.find((r:{template:string;sample:string})=>r.template===t.id&&r.sample===sample);
    const officeRow=office.checks.find((r:{template:string;sample:string})=>r.template===t.id&&r.sample===sample);
    if(!preview?.passed||!word?.passed||!officeRow?.passed)throw new Error(`${t.id}/${sample} output not verified`);
    const files=[];
    for(const extension of ['html','png','pdf','docx']){
      const path=`templates/${t.id}-${sample}.${extension}`,buffer=await readFile(resolve(out,path));
      files.push({path,bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')});
    }
    fixtures.push({sample,previewPdfPages:preview.pageCount,officePages:officeRow.pages,previewPdfBoundaries:true,pdfChineseAndLinks:true,docxEditableFields:true,officeTextReadback:true,files});
  }
  rows.push({...t,source:sources.templates.find((s:{id:string})=>s.id===t.id),fixtures});
}
await writeFile(resolve(out,'delivery-manifest.json'),JSON.stringify({at:new Date().toISOString(),templateVersion:RESUME_TEMPLATE_VERSION,rendererVersion:RESUME_RENDERER_VERSION,templateCount:rows.length,professional:rows.filter(t=>t.group!=='creative').length,creative:rows.filter(t=>t.group==='creative').length,fixtureCount:rows.length*3,templates:rows},null,2));
const lines=['# 模板目录与逐套输出记录','','30 套结构适配；同一套配色不重复计数。三份材料为合成中文样稿，未写入用户资料。缩略图来自中等长度样稿的实际首页。','','| 模板 | 用途 | 结构差异 | PDF 页数：短/中/长 | DOCX 实际页数：短/中/长 | 参考 |','|---|---|---|---|---|---|'];
for(const t of rows)lines.push(`| [${t.name}](templates/${t.id}-medium.pdf) | ${RESUME_TEMPLATE_GROUPS[t.group]} | 页眉 ${t.header}；标题 ${t.section}；条目 ${t.entry}；栏位 ${t.columns}，并有模板专属结构样式 | ${t.fixtures.map(f=>f.previewPdfPages).join(' / ')} | ${t.fixtures.map(f=>f.officePages).join(' / ')} | [${t.upstream} / ${t.sourceKey}](${t.source.source}) |`);
lines.push('','HTML/Chromium PDF 共用排版，逐页文本边界一致。DOCX 使用可编辑段落/表格，WPS Office 实际打开与导出后读回；不宣称与 PDF 或所有办公软件逐像素一致。','', '固定源码、SHA-256、许可证见 template-sources.json 与项目根 THIRD_PARTY_RESUME_TEMPLATES.md。完整输出文件校验和见 delivery-manifest.json。');
await writeFile(resolve(out,'template-catalog.md'),lines.join('\n'));
const escapeHtml=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const cards=rows.map(t=>`<article data-name="${escapeHtml(`${t.name} ${t.sourceKey} ${RESUME_TEMPLATE_GROUPS[t.group]}`)}"><a class="paper" href="templates/${t.id}-medium.pdf"><img loading="lazy" src="thumbnails/${t.id}.png" alt="${escapeHtml(t.name)} 中文样稿实际预览"></a><h2>${escapeHtml(t.name)}</h2><p>${escapeHtml(RESUME_TEMPLATE_GROUPS[t.group])} · ${escapeHtml(t.upstream)} ${escapeHtml(t.sourceKey)}</p><div class="samples">${t.fixtures.map(f=>`<div><b>${({short:'短材料',medium:'多经历',long:'科研长稿'})[f.sample as 'short'|'medium'|'long']}</b><a href="templates/${t.id}-${f.sample}.pdf">PDF · ${f.previewPdfPages} 页</a><a href="templates/${t.id}-${f.sample}.docx">DOCX</a><a href="templates/word/${t.id}-${f.sample}.pdf">WPS 实际分页 · ${f.officePages} 页</a></div>`).join('')}</div><a href="${escapeHtml(t.source.source)}">固定源码与出处</a></article>`).join('');
await writeFile(resolve(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aijob · 30 套模板验收图库</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f5ef;color:#193c34;font:16px/1.6 system-ui,sans-serif}main{max-width:1440px;margin:auto;padding:32px}h1{font-size:32px;margin:0}header p{max-width:950px}a{color:#245d4f}input{width:min(520px,100%);padding:12px;border:1px solid #a5b4a4;border-radius:8px;margin:12px 0 24px;font:inherit}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:20px}article{background:white;border:1px solid #dce2d6;border-radius:12px;padding:18px;min-width:0}article[hidden]{display:none}.paper{height:300px;display:block;background:#f1f2f0;text-align:center;overflow:hidden;border:1px solid #e0e4dc}.paper img{height:100%;max-width:100%;object-fit:contain}h2{font-size:20px;margin:14px 0 2px}article p{font-size:14px;margin:0 0 12px;color:#5e6e64}.samples>div{padding:8px 0;border-top:1px solid #edf0e8}.samples b{display:block}.samples a{display:inline-block;margin-right:12px;font-size:14px}footer{padding:32px 0}@media(max-width:500px){main{padding:16px}h1{font-size:25px}}</style><main><header><p>AIJOB / 本地候选交付证据</p><h1>30 套模板，查看真实中文输出</h1><p>24 套专业版式、6 套适度创意版式。下方均为三份合成材料，未写入用户经历。点击纸张查看中等样稿 PDF；每套提供短、多经历和科研长稿。DOCX 使用可编辑布局，WPS 页数可与网页/PDF 不同。</p><p><a href="README.md">完整验收与未通过项</a> · <a href="delivery-manifest.json">来源、版本与文件散列</a> · <a href="performance.md">性能记录</a></p><label for="search">查找模板名称或用途</label><br><input id="search" placeholder="例如：科研、Classic、双栏" type="search"><span id="count" aria-live="polite">30 套</span></header><section class="grid">${cards}</section><footer>HTML/PDF 与 DOCX/WPS 分别验证。本页是交付证据图库，正式编辑入口位于 Aijob 的“我的简历”。</footer></main><script>document.getElementById('search').addEventListener('input',e=>{const q=e.target.value.trim().toLocaleLowerCase();let n=0;document.querySelectorAll('article').forEach(a=>{a.hidden=!a.dataset.name.toLocaleLowerCase().includes(q);if(!a.hidden)n++});document.getElementById('count').textContent=n+' 套'})</script></html>`);
console.info(JSON.stringify({templates:rows.length,fixtures:rows.length*3}));
