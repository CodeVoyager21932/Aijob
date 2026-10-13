/** Aijob HTML adapters. Upstream structures and notices: THIRD_PARTY_RESUME_TEMPLATES.md. */
import { RESUME_TEMPLATE_BY_ID, RESUME_RENDERER_VERSION } from "./resume-templates.js";
import { LEGACY_RESUME_TEMPLATE_BY_ID } from './resume-templates-legacy.js';
import { studioV3Css, studioV3Body } from './resume-renderer-v3.js';
import { resumeEntryDetails, resumeEntryHasContent } from "./resume-modules.js";
import { RESUME_WRITING_HINTS } from './resume-template-start.js';
import { resumeRichHtml } from "./resume-studio-print.js";
import {
  ResumeStudioContentSchema,
  ResumeStudioLayoutSchema,
  type ResumeStudioContent,
  type ResumeStudioLayout,
  type ResumeStudioEntry,
  type ResumeStudioSection,
} from "./resume-studio.js";
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
export function usesStudioPagesV2(layout: ResumeStudioLayout) {
  return (
    layout.rendererVersion === RESUME_RENDERER_VERSION ||
    RESUME_TEMPLATE_BY_ID.has(layout.templateKey)
  );
}
export function studioV2Template(layout: ResumeStudioLayout) {
  const registry = layout.rendererVersion === 'studio-pages-v3' ? RESUME_TEMPLATE_BY_ID : LEGACY_RESUME_TEMPLATE_BY_ID;
  return (
    registry.get(layout.templateKey) ??
    registry.get(
      (
        {
          cn_clear_single_column: "rx_onyx",
          cn_classic_single_column: "jp_classic",
          cn_compact_technical: "magic_compact_cn_photo",
          cn_simple_two_column: "rx_azurill",
          cn_research_multi_page: "jp_academic",
        } as Record<string, string>
      )[layout.templateKey] ?? "jp_classic",
    )!
  );
}
export function studioV2Columns(layout: ResumeStudioLayout) {
  return (
    layout.columns === "two" ||
    (layout.columns === "auto" && studioV2Template(layout).columns !== "single" && layout.templateKey !== 'rx_bronzor')
  );
}
export function studioV2Css(raw: ResumeStudioLayout) {
  if (raw.rendererVersion === 'studio-pages-v3') return studioV3Css(raw);
  const l = ResumeStudioLayoutSchema.parse(raw),
    t = studioV2Template(l),
    two = studioV2Columns(l);
  const ratio = l.columnRatio ?? 0.31,
    left = t.columns !== "right";
  const color = { ink: "#27332f", green: "#246451", navy: "#294f72" }[l.accent];
  return `@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#e8ebe5}body{overflow-x:hidden}
.rs-document{--accent:${color};--muted:#5d6864;--line:#c6cec8;--shade:#f1f4f0;--font:${l.fontSize}pt;--line-height:${l.lineHeight};--section-gap:${l.sectionGap}pt;--paragraph-gap:${l.paragraphGap ?? 3}pt;--entry-gap:${l.entryGap ?? 8}pt;font-family:AijobPrint,${l.fontFamily === "serif" ? '"Noto Serif CJK SC",serif' : '"Noto Sans CJK SC",sans-serif'};font-size:var(--font);line-height:var(--line-height);color:#25312b;overflow-wrap:anywhere;font-synthesis:weight style}
.rs-page{width:210mm;height:297mm;padding:${l.margin}mm;margin:16px auto;background:white;position:relative;box-shadow:0 2px 8px #0002;break-after:page;overflow:hidden}.rs-page:last-child{break-after:auto}.rs-page-inner{height:100%;position:relative}.rs-page-number{position:absolute;bottom:5mm;right:${l.margin}mm;color:#899189;font-size:8pt}.rs-columns{display:${two ? "grid" : "block"};grid-template-columns:${left ? `${ratio * 100}% minmax(0,1fr)` : `minmax(0,1fr) ${ratio * 100}%`};gap:6mm;align-items:start}.rs-col{min-width:0;display:flow-root;position:relative}.rs-col--aside{order:${left ? 0 : 1}}.rs-col--main{order:${left ? 1 : 0}}
.rs-source{width:210mm;padding:${l.margin}mm;background:white;margin:auto}.rs-source[hidden]{display:none}.rs-header{position:relative;margin-bottom:var(--section-gap);padding-bottom:10pt;border-bottom:1.5pt solid var(--accent);display:flex;gap:15pt;align-items:center}.rs-identity{flex:1;min-width:0}.rs-name{font-size:26pt;line-height:1.25;letter-spacing:1pt;margin:0 0 5pt;font-weight:700;color:var(--accent)}.rs-headline{margin:0 0 7pt;font-size:11pt;line-height:1.5}.rs-contacts{display:flex;gap:3pt 12pt;flex-wrap:wrap;font-size:9pt;line-height:1.7;color:var(--muted)}.rs-contact{display:inline;overflow-wrap:anywhere}.rs-photo{width:21mm;height:28mm;object-fit:cover;flex:none;order:2;border-radius:2px}
.rs-section{margin:0 0 var(--section-gap);display:flow-root;min-width:0}.rs-section-heading{font-size:calc(var(--font) + 1pt);line-height:1.45;font-weight:700;margin:0 0 6pt;padding:0 0 4pt;border-bottom:.7pt solid var(--line);color:var(--accent);break-after:avoid;min-width:0}.rs-section-body{min-width:0;display:flow-root}.rs-entry{margin:0 0 var(--entry-gap);display:flow-root;min-width:0}.rs-entry:last-child{margin-bottom:0}.rs-entry-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2pt 10pt;align-items:baseline;margin:0 0 4pt;break-after:avoid}.rs-entry-title{font-size:inherit;font-weight:700;line-height:1.55;margin:0;min-width:0}.rs-entry-date{font-size:9pt;line-height:1.6;white-space:nowrap;color:var(--muted)}.rs-entry-meta{grid-column:1/-1;color:var(--muted);font-size:calc(var(--font) - .5pt);line-height:1.5}.rs-entry-content{min-width:0}.rs-entry-content p{margin:0 0 var(--paragraph-gap);white-space:pre-wrap;orphans:2;widows:2}.rs-entry-content ul,.rs-entry-content ol{margin:0 0 var(--paragraph-gap);padding-left:17pt}.rs-entry-content li{margin:0 0 2pt}.rs-detail{font-size:calc(var(--font) - .3pt)}.rs-detail-label{font-weight:600}.rs-document a{color:inherit;text-decoration:underline;text-underline-offset:2px}.rs-continuation{font-weight:400;font-size:9pt;color:var(--muted);margin-left:6pt}.rs-col--aside .rs-entry-head{grid-template-columns:minmax(0,1fr)}.rs-col--aside .rs-entry-date{white-space:normal}.rs-col--aside .rs-name{font-size:23pt}
[data-header=center] .rs-header,[data-header=center-photo] .rs-header{justify-content:center;text-align:center}[data-header=center] .rs-contacts,[data-header=center-photo] .rs-contacts{justify-content:center}[data-header=center-photo] .rs-photo{position:absolute;right:0;top:0}[data-header=center-photo] .rs-header:has(.rs-photo){padding-right:26mm;min-height:29mm}
[data-template=jp_classic] .rs-section-heading{margin-bottom:4pt;padding-bottom:3pt}[data-template=jp_classic] .rs-header{padding-bottom:8pt}
[data-header=plain] .rs-header{border:0;padding-bottom:5pt}[data-header=plain] .rs-name{font-size:24pt;letter-spacing:0}
[data-header=identity] .rs-contacts{display:grid;grid-template-columns:1fr 1fr;gap:2pt 14pt}[data-header=identity] .rs-header{border:0}
[data-header=split] .rs-contacts{border-top:1pt solid var(--line);padding-top:6pt}[data-header=split] .rs-header{border:0}
[data-header=band] .rs-header,[data-header=steel] .rs-header,[data-header=ribbon] .rs-header{background:var(--accent);color:white;padding:16pt 18pt;border:0}[data-header=band] .rs-name,[data-header=steel] .rs-name,[data-header=ribbon] .rs-name{color:white}[data-header=band] .rs-contacts,[data-header=steel] .rs-contacts,[data-header=ribbon] .rs-contacts{color:#f3f5f3}[data-header=steel] .rs-header{border-left:6pt solid #799f9b}
[data-header=grid] .rs-contacts{border-top:1pt solid var(--accent);padding-top:9pt;margin-top:12pt;gap:3pt 20pt}[data-header=grid] .rs-header{border:0}
[data-header=editorial] .rs-name{font-size:35pt;letter-spacing:-1pt}[data-header=editorial] .rs-header{border-bottom:3pt solid var(--accent);padding-bottom:17pt}
[data-header=geometric] .rs-header{background:#202923;color:white;padding:20pt;border-right:18pt solid #dbb552}[data-header=geometric] .rs-name,[data-header=geometric] .rs-contacts{color:white}[data-header=geometric] .rs-headline{border-left:4pt solid #c87564;padding-left:9pt}
[data-header=ribbon] .rs-header{border-radius:0 0 10pt 0;box-shadow:inset 0 -4pt 0 #0002}
[data-section=plain] .rs-section-heading{border:0;margin-bottom:5pt;padding:0}[data-section=double-rule] .rs-section-heading{border-bottom:2.5pt double var(--accent);padding-bottom:4pt}
[data-section=thick-rule] .rs-section-heading{border-bottom:2pt solid var(--accent);padding-bottom:5pt}
[data-section=highlight] .rs-section-heading{background:var(--shade);border:0;padding:4pt 7pt}
[data-section=accent] .rs-section-heading{border-left:3pt solid var(--accent);padding-left:7pt;border-bottom:0;background:var(--shade);padding-top:2pt}
[data-section=square] .rs-section-heading::before{content:'';display:inline-block;width:7pt;height:7pt;margin-right:8pt;background:var(--accent)}
[data-section=bracket] .rs-section-heading{border:0;font-size:var(--font);letter-spacing:.5pt}[data-section=bracket] .rs-section-heading::before{content:'[ ';color:#638c86}[data-section=bracket] .rs-section-heading::after{content:' ]';color:#638c86}
[data-section=numbered] .rs-section-heading::before{content:attr(data-number) '. ';color:var(--accent)}
[data-section=side] .rs-section{display:grid;grid-template-columns:24% minmax(0,1fr);gap:12pt;border-top:.8pt solid var(--line);padding-top:8pt}[data-section=side] .rs-section-heading{border:0;font-size:var(--font)}
[data-section=timeline] .rs-entry{padding-left:12pt;border-left:1pt solid var(--line);position:relative}[data-section=timeline] .rs-entry::before{content:'';position:absolute;left:-3pt;top:4pt;width:5pt;height:5pt;border-radius:50%;background:var(--accent)}
[data-section=boxed] .rs-entry{padding:9pt;border:1pt solid var(--line);border-radius:4pt}[data-section=boxed] .rs-section-heading{border:0}
[data-section=ribbon] .rs-section-heading{background:var(--accent);color:white;border:0;display:inline-block;padding:4pt 12pt 4pt 8pt;border-radius:0 8pt 8pt 0}
[data-entry=stack] .rs-entry-head,[data-entry=below] .rs-entry-head{grid-template-columns:1fr}[data-entry=below] .rs-entry-date{order:3}
[data-entry=inline] .rs-entry-meta{grid-column:1;grid-row:1;margin-top:0;padding-top:0}[data-entry=inline] .rs-entry-head:has(.rs-entry-meta) .rs-entry-title{padding-right:0}[data-entry=inline] .rs-entry-meta{grid-row:2}
[data-entry=date-column] .rs-entry{display:grid;grid-template-columns:27% minmax(0,1fr);column-gap:12pt}[data-entry=date-column] .rs-entry-head{display:contents}[data-entry=date-column] .rs-entry-date{grid-row:1/4;grid-column:1;white-space:normal}[data-entry=date-column] .rs-entry-title,[data-entry=date-column] .rs-entry-meta,[data-entry=date-column] .rs-entry-content{grid-column:2}
[data-entry=bordered] .rs-entry{border-left:3pt solid #d3b66b;padding-left:12pt}
[data-template=jp_ats] .rs-header{text-align:center;justify-content:center}[data-template=jp_ats] .rs-contacts{justify-content:center}[data-template=jp_ats] .rs-section-heading{font-weight:800}[data-template=jp_ats] .rs-entry-head{display:grid;grid-template-columns:1fr auto}
[data-template=rx_scizor] .rs-name{position:relative;padding-bottom:8pt}[data-template=rx_scizor] .rs-name::after{content:'';position:absolute;left:0;bottom:0;width:72%;height:2pt;background:var(--accent)}[data-template=rx_scizor] .rs-contacts{border:0}
[data-template=rx_lapras] .rs-header{border:1pt solid var(--line);border-radius:6pt;padding:13pt}[data-template=rx_lapras] .rs-section{border:1pt solid var(--line);border-radius:5pt;padding:10pt;display:block}[data-template=rx_lapras] .rs-section-heading{background:white;display:table;margin-top:-19pt;padding:0 5pt;border:0}[data-template=rx_lapras] .rs-section{margin-top:10pt}
[data-template=rx_meowth] .rs-header{text-align:left;justify-content:flex-start;border:0}[data-template=rx_meowth] .rs-contacts{justify-content:flex-start}[data-template=rx_meowth] .rs-entry-head:has(.rs-entry-meta){grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;align-items:start}[data-template=rx_meowth] .rs-entry-meta{grid-row:1;grid-column:2;margin:0;font-style:italic}[data-template=rx_meowth] .rs-entry-head:has(.rs-entry-meta) .rs-entry-date{grid-column:3;grid-row:1}
[data-template=rx_kakuna] .rs-header{display:flex;text-align:center;border:0}[data-template=rx_kakuna] .rs-contacts{justify-content:center;border:0}[data-template=rx_kakuna] .rs-section-heading{text-align:center;background:transparent;border-bottom:1pt solid var(--accent)}
[data-template=rx_rhyhorn] .rs-header{border:1pt solid var(--accent);padding:12pt}[data-template=rx_rhyhorn] .rs-contacts{display:flex;border-top:1pt solid var(--line);padding-top:8pt}[data-template=rx_rhyhorn] .rs-section{display:block;border:0;padding-top:0}[data-template=rx_rhyhorn] .rs-section-heading{border-bottom:1pt solid var(--accent)}
[data-template=magic_executive_band] .rs-entry-date{padding:1pt 6pt;background:var(--shade);border-radius:3pt;justify-self:start}
[data-template=magic_compact_cn_photo] .rs-entry-head,[data-template=magic_product_ops_focus] .rs-entry-head{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto}[data-template=magic_compact_cn_photo] .rs-entry-meta,[data-template=magic_product_ops_focus] .rs-entry-meta{grid-column:2;grid-row:1}[data-template=magic_compact_cn_photo] .rs-entry-date,[data-template=magic_product_ops_focus] .rs-entry-date{grid-column:3}
[data-template=magic_clean_minimal] .rs-header{padding-bottom:14pt}[data-template=magic_clean_minimal] .rs-entry-title{font-weight:600}[data-template=magic_clean_minimal] .rs-section-heading{font-size:calc(var(--font) + 2pt);margin-bottom:9pt}
[data-template=jp_modern_minimal] .rs-section[data-kind=project] .rs-entry{background:#f5f7fa;border:1pt solid #e0e7ed;border-radius:5pt;padding:8pt}[data-template=jp_modern_minimal] .rs-section[data-kind=project] .rs-entry::before{display:none}
[data-template=jp_blocks] .rs-section-heading{background:var(--shade);padding:6pt;border-radius:3pt}[data-template=jp_designer] .rs-entry{background:#f5f5f3;border-radius:5pt;padding:10pt}[data-template=jp_designer] .rs-section{display:block;border:0}[data-template=jp_designer] .rs-section-heading{border-left:4pt solid var(--accent);padding-left:8pt}
[data-template=rx_azurill] .rs-header{text-align:center;display:block;border:0}[data-template=rx_azurill] .rs-contacts{justify-content:center}[data-template=rx_azurill] .rs-col--aside{border-right:1pt solid var(--line);padding-right:10pt}
[data-template=rx_bronzor] .rs-header{justify-content:center;text-align:center;border:0}[data-template=rx_bronzor] .rs-contacts{justify-content:center}[data-template=rx_bronzor] .rs-section{display:grid;grid-template-columns:${Math.round(ratio * 100)}% minmax(0,1fr);gap:12pt;border-top:1pt solid var(--accent);padding-top:8pt}[data-template=rx_bronzor] .rs-section-heading{background:transparent;font-size:var(--font);border:0}
[data-template=rx_chikorita] .rs-col--aside{background:var(--accent);color:white;padding:12pt}[data-template=rx_chikorita] .rs-col--aside h2{background:transparent;border-left-color:white;border-bottom:1pt solid #ffffff66}[data-template=rx_chikorita] .rs-col--aside h2,[data-template=rx_chikorita] .rs-col--aside .rs-entry-meta,[data-template=rx_chikorita] .rs-col--aside .rs-entry-date{color:white}
[data-template=rx_ditto] .rs-header{background:var(--accent);padding:15pt;border-bottom:5pt solid #aebdad;color:white}[data-template=rx_ditto] .rs-name,[data-template=rx_ditto] .rs-contacts{color:white}[data-template=rx_ditto] .rs-col--aside{border-right:1pt dashed var(--line);padding-right:12pt}
[data-template=rx_glalie] .rs-col--aside{background:var(--shade);padding:14pt}[data-template=rx_glalie] .rs-header{background:transparent;text-align:center;color:inherit;border-bottom:3pt solid var(--accent)}[data-template=rx_glalie] .rs-name{color:var(--accent)}[data-template=rx_glalie] .rs-contacts{color:var(--muted);justify-content:center}
[data-template=rx_gengar] .rs-col--aside{background:#e9efed;padding:12pt}[data-template=rx_gengar] .rs-header{display:block;text-align:center;background:var(--accent);color:white;padding:15pt 10pt;border:0}[data-template=rx_gengar] .rs-name,[data-template=rx_gengar] .rs-contacts{color:white}[data-template=rx_gengar] .rs-contacts{display:grid;text-align:left;font-size:8.5pt}[data-template=rx_gengar] .rs-photo{display:block;margin:0 auto 10pt}
[data-template=magic_cn_formal_photo] .rs-section-heading{display:flex;align-items:center;gap:6pt;border-bottom:1pt solid var(--line);font-size:calc(var(--font) + 2pt)}[data-template=magic_cn_formal_photo] .rs-section-heading::before{content:'';width:10pt;height:10pt;border:1pt solid currentColor;border-radius:2pt;flex:none}[data-template=magic_cn_formal_photo] .rs-entry-head{grid-template-columns:minmax(0,1fr) minmax(0,40%)}[data-template=magic_cn_formal_photo] .rs-entry-role{grid-row:2;grid-column:2;text-align:right}[data-template=magic_cn_formal_photo] .rs-entry-meta{grid-row:2;grid-column:1}[data-template=magic_cn_formal_photo] .rs-section[data-kind=skills] .rs-entry{display:grid;grid-template-columns:27% minmax(0,1fr);gap:10pt}
[data-template=jp_academic] .rs-header{border-bottom:2pt solid var(--accent)}[data-template=jp_academic] .rs-headline{font-style:italic}[data-template=jp_academic] .rs-section-heading{font-size:calc(var(--font) - 1pt);letter-spacing:2pt;border-bottom:.5pt solid var(--line)}[data-template=jp_academic] .rs-entry-head:has(.rs-entry-meta){grid-template-columns:minmax(0,1fr) auto}[data-template=jp_academic] .rs-entry-title{font-weight:400}[data-template=jp_academic] .rs-entry-meta{font-weight:700;grid-column:1;grid-row:1}[data-template=jp_academic] .rs-entry-head:has(.rs-entry-meta) .rs-entry-title{grid-column:1;grid-row:2}[data-template=jp_academic] .rs-entry-date{grid-column:2;grid-row:1}
.rs-guide{color:#718879;cursor:pointer}.rs-guide .rs-entry-content{border:1px dashed #cbd6c8;border-radius:4px;padding:8pt;font-size:10pt}.rs-guide .rs-section-heading::after{content:' · 待填写';font-weight:400;font-size:9pt;color:#718879}
@media print{html,body{background:white}.rs-page{margin:0;box-shadow:none}.rs-source{margin:0}.rs-page-number{color:#666}.rs-guide{display:none!important}}
`;
}
function entryHtml(entry: ResumeStudioEntry, kind: ResumeStudioSection["kind"], templateId: string) {
  const education = kind === "education";
  const title = education
    ? [entry.organization, entry.title].filter(Boolean).join(" · ")
    : [entry.title, entry.organization].filter(Boolean).join(" · ");
  const sideRole = templateId === 'magic_cn_formal_photo';
  const meta = [sideRole ? '' : entry.role, entry.degree, entry.major, entry.location].filter(Boolean).join(" · ");
  const date = [entry.startDate, entry.endDate].filter(Boolean).join(" — ");
  return `<div class="rs-entry" data-entry-id="${entry.id}" data-break="${entry.pageBreakBefore}"><div class="rs-entry-head">${title ? `<h3 class="rs-entry-title">${esc(title)}</h3>` : ""}${date ? `<div class="rs-entry-date">${esc(date)}</div>` : ""}${meta ? `<div class="rs-entry-meta">${esc(meta)}</div>` : ""}${sideRole && entry.role ? `<div class="rs-entry-role">${esc(entry.role)}</div>` : ''}</div><div class="rs-entry-content">${resumeEntryDetails(
    entry,
  )
    .map(
      (d) =>
        `<p class="rs-detail"><span class="rs-detail-label">${esc(d.label)}：</span>${d.key === "url" && /^(https?:\/\/|mailto:|tel:)/i.test(d.value) ? `<a href="${esc(d.value)}">${esc(d.value)}</a>` : esc(d.value)}</p>`,
    )
    .join("")}${resumeRichHtml(entry.body)}</div></div>`;
}
export function studioV2Body(
  rawContent: ResumeStudioContent,
  rawLayout: ResumeStudioLayout,
  resources?: { photoDataUrl?: string | undefined; editorGuides?: boolean },
) {
  if (rawLayout.rendererVersion === 'studio-pages-v3') return studioV3Body(rawContent, rawLayout, resources);
  const c = ResumeStudioContentSchema.parse(rawContent),
    l = ResumeStudioLayoutSchema.parse(rawLayout),
    t = studioV2Template(l),
    b = c.basics;
  const photo =
    resources?.photoDataUrl &&
    /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(resources.photoDataUrl) &&
    l.photoVisible !== false
      ? `<img class="rs-photo" alt="" src="${resources.photoDataUrl}">`
      : "";
  const contacts = [
    b.phone ? `<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>` : "",
    b.email ? `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : "",
    esc(b.city),
    ...b.links.filter((link) => link.label || link.url).map((link) => /^(https?:\/\/|mailto:|tel:)/i.test(link.url) ? `<a href="${esc(link.url)}">${esc(link.label || link.url)}</a>` : esc(link.label || link.url)),
  ].filter(Boolean);
  return `<article class="rs-document" data-renderer="studio-pages-v2" data-template="${t.id}" data-header="${t.header}" data-section="${t.section}" data-entry="${t.entry}" data-two="${studioV2Columns(l)}" data-sidebar-header="${t.id === "rx_gengar" && studioV2Columns(l)}"><div class="rs-source"><header class="rs-header" data-entry-id="basics">${photo}<div class="rs-identity"><h1 class="rs-name">${esc(b.name) || (resources?.editorGuides ? '<span class="rs-guide">你的姓名</span>' : '')}</h1>${b.headline ? `<p class="rs-headline">${esc(b.headline)}</p>` : resources?.editorGuides ? '<p class="rs-headline rs-guide">求职方向 · 电话 · 邮箱</p>' : ""}<div class="rs-contacts">${contacts.map((contact) => `<span class="rs-contact">${contact}</span>`).join("")}</div></header>${c.sections
    .filter((s) => !s.hidden && (resources?.editorGuides || s.entries.some((e) => !e.hidden && resumeEntryHasContent(e))))
    .map(
      (s, index) => {
        const guide = resources?.editorGuides && !s.entries.some(e=>!e.hidden&&resumeEntryHasContent(e));
        return `<section class="rs-section${guide?' rs-guide':''}" data-section-id="${s.id}" data-kind="${s.kind}" data-column="${s.column}" data-break="${s.pageBreakBefore}"><h2 class="rs-section-heading" data-number="${index + 1}">${esc(s.title)}</h2><div class="rs-section-body">${guide ? `<div class="rs-entry" data-entry-id="${s.entries.find(e=>!e.hidden)?.id ?? s.id}"><div class="rs-entry-head"></div><div class="rs-entry-content"><p>${esc(RESUME_WRITING_HINTS[s.kind])}</p></div></div>` : s.entries
          .filter((e) => !e.hidden && resumeEntryHasContent(e))
          .map((e) => entryHtml(e, s.kind, t.id))
          .join("")}</div></section>`;
      },
    )
    .join("")}</div></article>`;
}
export function studioV2Html(
  title: string,
  content: ResumeStudioContent,
  layout: ResumeStudioLayout,
  fontCss = "",
  resources?: { photoDataUrl?: string | undefined; editorGuides?: boolean },
) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'self' data:; img-src data:;"><title>${esc(title)}</title><style>${fontCss}${studioV2Css(layout)}</style></head><body>${studioV2Body(content, layout, resources)}</body></html>`;
}
