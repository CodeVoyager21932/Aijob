import { ResumeStudioContentSchema, ResumeStudioLayoutSchema, type ResumeStudioContent, type ResumeStudioLayout, type ResumeStudioEntry } from './resume-studio.js';
import { resumeRichHtml } from './resume-studio-print.js';
import { RESUME_PROFILE_BY_ID, STUDIO_V3_VERSION, STUDIO_V3_FONT_SET, type ResumeTemplateProfile } from './resume-template-profiles.js';
import { resumeEntryDetails } from './resume-modules.js';
import { hasRenderableResumeEntry } from './resume-content-manifest.js';
import { resumeTemplateRegionCss } from './resume-template-v3-regions.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const field = (id: string, value: string, className = '') => value.trim() ? `<span class="${className}" data-resume-field="${esc(id)}">${esc(value)}</span>` : '';
const join = (values: string[], separator = ' · ') => values.filter(Boolean).join(separator);
const validLink = (href: string) => /^(https?:\/\/|mailto:|tel:)/i.test(href);
function resolve(raw: ResumeStudioLayout) {
  const layout = ResumeStudioLayoutSchema.parse(raw), profile = RESUME_PROFILE_BY_ID.get(layout.templateKey);
  if (!profile || layout.templateVersion !== STUDIO_V3_VERSION || layout.fontSetVersion !== STUDIO_V3_FONT_SET || !layout.typography || !layout.regions) throw new Error('RESUME_V3_DEFINITION_UNSUPPORTED');
  return { layout, profile, typography: layout.typography, regions: layout.regions, two: layout.columns === 'two' || layout.columns === 'auto' && profile.columns !== 'single' };
}

export function studioV3Css(raw: ResumeStudioLayout) {
  const { layout: l, profile: p, typography: t, regions: r, two } = resolve(raw);
  const left = p.columns !== 'right', ratio = l.columnRatio ?? .32;
  const color = l.colorHex ?? { ink: '#272b30', green: '#246451', navy: '#285575' }[l.accent];
  return `@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#e9ece9}body{overflow-x:hidden}
.rs-document{--accent:${color};--text:#30363d;--muted:#58616b;--tint:color-mix(in srgb,var(--accent) 12%,white);--body:${l.fontSize}pt;--entry-gap:${l.entryGap ?? 6}pt;--paragraph-gap:${l.paragraphGap ?? 2}pt;--section-gap:${l.sectionGap}pt;font-family:AijobV3${l.fontFamily === 'serif' ? 'Serif' : 'Sans'}Common,AijobV3${l.fontFamily === 'serif' ? 'Serif' : 'Sans'},AijobPrint,${l.fontFamily};font-size:var(--body);line-height:${l.lineHeight};color:var(--text);overflow-wrap:anywhere;font-synthesis:style}
.rs-page{width:210mm;height:297mm;padding:${r.marginYmm}mm ${l.margin}mm;background:white;margin:16px auto;position:relative;box-shadow:0 2px 8px #0002;break-after:page;overflow:hidden}.rs-page:last-child{break-after:auto}.rs-page-inner{height:100%;position:relative}.rs-page-number{position:absolute;bottom:4mm;right:${l.margin}mm;font-size:8pt;color:#666}.rs-document[data-page-count="1"] .rs-page-number{display:none}
.rs-source{width:210mm;padding:${r.marginYmm}mm ${l.margin}mm;background:white;margin:auto}.rs-source[hidden]{display:none}.rs-columns{display:${two ? 'grid' : 'block'};grid-template-columns:${left ? `${ratio * 100}% minmax(0,1fr)` : `minmax(0,1fr) ${ratio * 100}%`};gap:${r.gapMm}mm;align-items:start}.rs-col{min-width:0;position:relative;display:flow-root}.rs-col--aside{order:${left ? 0 : 1};padding:0 ${r.sidebarPaddingMm}mm}.rs-col--main{order:${left ? 1 : 0}}
.rs-header{position:relative;display:flex;align-items:center;gap:6mm;margin:0 0 var(--section-gap);padding:0;min-width:0}.rs-identity{flex:1;min-width:0}.rs-name{font-family:AijobV3${t.headingFamily === 'serif' ? 'Serif' : 'Sans'}Common,AijobV3${t.headingFamily === 'serif' ? 'Serif' : 'Sans'},AijobPrint,${t.headingFamily};font-size:${t.namePt}pt;line-height:1.5;font-weight:700;margin:0 0 3pt;color:var(--text)}.rs-headline{font-size:${t.contactPt}pt;margin:0 0 3pt}.rs-contacts{display:flex;gap:2pt 10pt;flex-wrap:wrap;font-size:${t.contactPt}pt;line-height:1.65}.rs-contact{min-width:0;overflow-wrap:anywhere}.rs-photo{width:24mm;height:30mm;object-fit:cover;flex:none;order:2}
.rs-section{margin:0 0 var(--section-gap);min-width:0;display:flow-root}.rs-section-heading{font-family:AijobV3${t.headingFamily === 'serif' ? 'Serif' : 'Sans'}Common,AijobV3${t.headingFamily === 'serif' ? 'Serif' : 'Sans'},AijobPrint,${t.headingFamily};font-size:${t.headingPt}pt;line-height:1.3;color:var(--accent);font-weight:700;margin:0 0 6pt;padding:0 0 3pt;min-width:0;break-after:avoid}.rs-section-body{min-width:0;display:flow-root}.rs-entry{margin:0 0 var(--entry-gap);min-width:0;display:flow-root}.rs-entry:last-child{margin-bottom:0}.rs-entry-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1pt 10pt;align-items:baseline;margin:0 0 2pt;break-after:avoid;min-width:0}.rs-entry-title{font-size:${t.entryPt}pt;line-height:${l.lineHeight};font-weight:700;margin:0;min-width:0}.rs-entry-date{font-size:${t.datePt}pt;text-align:right;max-width:45mm;line-height:1.6}.rs-entry-meta{font-size:var(--body);min-width:0;grid-column:1/-1}.rs-entry-location{display:block;font-size:${t.datePt}pt}.rs-entry-content{min-width:0}.rs-entry-content p{margin:0 0 var(--paragraph-gap);white-space:pre-wrap;orphans:2;widows:2}.rs-entry-content ul,.rs-entry-content ol{margin:0 0 var(--paragraph-gap);padding-left:4.5mm}.rs-entry-content li{margin:0;white-space:pre-wrap}.rs-entry-content li p{margin:0}.rs-detail{white-space:pre-wrap}.rs-detail-label{font-weight:700}.rs-document a{color:inherit;text-decoration:none}.rs-continuation{font-size:8pt;margin-left:4pt;color:var(--muted);font-weight:400}.rs-col--aside .rs-entry-head{display:block}.rs-col--aside .rs-entry-date{text-align:left;margin-top:2pt}
[data-header=center] .rs-header{text-align:center}[data-header=center] .rs-contacts{justify-content:center}[data-header=center] .rs-header:has(.rs-photo){padding-right:29mm;padding-left:29mm;min-height:30mm}[data-header=center] .rs-photo{position:absolute;right:0;top:0}
[data-header=photo-left] .rs-photo,[data-header=adaptive-photo] .rs-photo{order:0}[data-header=adaptive-photo] .rs-header:not(:has(.rs-photo)){text-align:center}[data-header=adaptive-photo] .rs-header:not(:has(.rs-photo)) .rs-contacts{justify-content:center}
[data-header=classic-group] .rs-header{display:block}[data-header=classic-group] .rs-header-top{display:flex;justify-content:center;align-items:center;gap:4mm}[data-header=classic-group] .rs-photo{order:0;width:17mm;height:22mm}[data-header=classic-group] .rs-identity{flex:0 1 auto}[data-header=classic-group] .rs-header>.rs-contacts{justify-content:center;margin-top:3mm}
[data-header=stacked-center] .rs-header{display:flex;flex-direction:column;gap:3mm;text-align:center}[data-header=stacked-center] .rs-photo{order:0;width:20mm;height:25mm}[data-header=stacked-center] .rs-identity{flex:auto}[data-header=stacked-center] .rs-contacts{justify-content:center}
[data-section=rule] .rs-section-heading{border-bottom:.6pt solid var(--accent)}[data-section=partial-line] .rs-section-heading{display:flex;align-items:center;gap:6pt}[data-section=partial-line] .rs-section-heading::after{content:'';flex:1;height:.5pt;background:var(--accent)}
[data-section=overline] .rs-section-heading{border-top:1pt solid var(--accent);padding-top:4pt;color:var(--text)}[data-section=center-rule] .rs-section-heading{text-align:center;border-bottom:.8pt solid var(--accent);padding-bottom:4pt}[data-section=square-rule] .rs-section-heading{display:flex;align-items:center;gap:6pt;border-bottom:.5pt solid #d4d4d8;padding-bottom:5pt;color:var(--text)}[data-section=square-rule] .rs-section-heading::before{content:'';width:7pt;height:7pt;background:var(--accent);flex:none}
[data-entry=role-inline] .rs-entry-secondary{font-weight:400}[data-entry=inline-three] .rs-entry-head{grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto}[data-entry=inline-three] .rs-entry-title{grid-column:1;grid-row:1}[data-entry=inline-three] .rs-entry-meta{grid-column:2;grid-row:1;text-align:center}[data-entry=inline-three] .rs-entry-date{grid-column:3;grid-row:1}
[data-entry=date-gutter] .rs-entry{display:grid;grid-template-columns:32mm minmax(0,1fr);gap:0 4mm}[data-entry=date-gutter] .rs-entry-head{display:contents}[data-entry=date-gutter] .rs-entry-date{grid-column:1;grid-row:1/4;text-align:left;max-width:none}[data-entry=date-gutter] .rs-entry-title,[data-entry=date-gutter] .rs-entry-meta,[data-entry=date-gutter] .rs-entry-content{grid-column:2}[data-entry=date-gutter] .rs-entry-title{grid-row:1}[data-entry=date-gutter] .rs-entry-meta{grid-row:2;color:var(--accent)}[data-entry=date-gutter] .rs-entry-content{grid-row:3}
[data-template=jp_classic] .rs-header{border-bottom:1.5pt solid #27272a;padding-bottom:3mm;margin-bottom:5mm;text-align:center}[data-template=jp_classic] .rs-headline{font-size:13.5pt}[data-template=jp_classic] .rs-section-heading{color:var(--text);border-color:#d4d4d8;letter-spacing:.4pt}[data-template=jp_classic] .rs-photo,[data-template=jp_swiss] .rs-photo{width:17mm;height:17mm}
[data-template=jp_ats] .rs-header{border-bottom:.75pt solid #111;padding-bottom:3mm}[data-template=jp_ats] .rs-photo{width:17mm;height:22mm}[data-template=jp_ats] .rs-section-heading{padding-bottom:1.5pt;margin-bottom:4.5pt}
[data-template=jp_swiss] .rs-header-top{justify-content:flex-start;align-items:flex-start}[data-template=jp_swiss] .rs-header>.rs-contacts{border-top:.75pt solid #18181b;padding-top:3mm;justify-content:flex-start}[data-template=jp_swiss] .rs-header{margin-bottom:6mm}[data-template=jp_swiss] .rs-headline{letter-spacing:1pt}[data-template=jp_swiss] .rs-section-heading{letter-spacing:1pt}[data-template=jp_swiss] .rs-entry-content ul{list-style-type:square}[data-template=jp_swiss] .rs-entry-content li::marker{color:var(--accent)}
[data-template=rx_onyx] .rs-header{border-bottom:.8pt solid var(--accent);padding-bottom:5mm}[data-template=rx_onyx] .rs-section-heading{color:var(--text);margin-bottom:4pt}[data-template=rx_onyx] .rs-name{margin-bottom:2pt}
[data-template=rx_scizor] .rs-page{border-top:3mm solid var(--accent)}[data-template=rx_scizor] .rs-name{display:inline-block;border-bottom:2pt solid #a8abad;max-width:100%;padding-bottom:1pt;margin-bottom:4pt}[data-template=rx_scizor] .rs-headline{margin-bottom:3mm}[data-template=rx_scizor] .rs-header{padding-bottom:3mm}
[data-template=rx_meowth] .rs-section-heading{padding-bottom:5pt;margin-bottom:7pt}[data-template=rx_meowth] .rs-headline{color:var(--accent)}
[data-template=rx_kakuna] .rs-section-heading{color:var(--text);font-weight:700}[data-template=rx_kakuna] .rs-header{margin-bottom:6mm}
[data-template=lapis_cn] .rs-name{margin-bottom:1pt}[data-template=lapis_cn] .rs-section-heading{border-bottom:.5pt solid color-mix(in srgb,var(--accent) 40%,white);padding:1mm 0;line-height:1;margin-bottom:1.9mm}[data-template=lapis_cn] .rs-entry-head{margin-bottom:0}[data-template=lapis_cn] .rs-entry-meta{grid-column:1;grid-row:2}[data-template=lapis_cn] .rs-entry-date{grid-column:2;grid-row:1;color:var(--accent)}[data-template=lapis_cn] .rs-photo{width:28mm;height:32mm}
[data-template=rx_gengar][data-two=true] .rs-page::before{content:'';position:absolute;inset:0 auto 0 0;width:calc(${l.margin}mm + (210mm - ${l.margin * 2 + r.gapMm}mm) * ${ratio});background:var(--tint)}
[data-template=rx_gengar][data-two=true] .rs-col--aside .rs-header{display:block;background:var(--accent);color:white;padding:6mm ${r.sidebarPaddingMm}mm;margin:${-r.marginYmm}mm ${-r.sidebarPaddingMm}mm 7mm;min-width:0}[data-template=rx_gengar] .rs-col--aside .rs-name{color:white}[data-template=rx_gengar] .rs-col--aside .rs-photo{display:block;margin:0 0 5mm;width:25mm;height:31mm}[data-template=rx_gengar] .rs-col--aside .rs-contacts{display:grid;gap:4pt}[data-template=rx_gengar] .rs-col--aside .rs-headline{margin-bottom:6pt}[data-template=rx_gengar] .rs-section[data-kind=summary]{padding:5mm;background:var(--tint)}[data-template=rx_gengar] .rs-section[data-kind=summary] .rs-section-heading{border:0;font-size:var(--body)}[data-template=rx_gengar] .rs-section[data-kind=summary] .rs-entry-head:empty{display:none}
[data-template=rendercv_classic] .rs-name{color:var(--accent);margin-bottom:4mm}[data-template=rendercv_classic] .rs-headline{margin-bottom:4mm}[data-template=rendercv_classic] .rs-header{margin-bottom:4mm}[data-template=rendercv_classic] .rs-entry-head{grid-template-columns:minmax(0,1fr) 41.5mm;gap:1pt 2mm}[data-template=rendercv_classic] .rs-entry-meta{grid-column:1;grid-row:2}[data-template=rendercv_classic] .rs-entry-date{grid-column:2;grid-row:1/3}[data-template=rendercv_classic] .rs-entry-content{padding-left:2mm;padding-right:2mm}[data-template=rendercv_classic] .rs-col--aside .rs-entry-head{display:block}
.rs-document .rs-inline-entry .rs-entry-head,.rs-document .rs-inline-entry .rs-entry-content{display:inline;padding:0}.rs-inline-entry .rs-entry-title{display:inline;font-size:var(--body)}.rs-inline-entry .rs-entry-title::after{content:'：'}.rs-document .rs-inline-entry .rs-entry-date,.rs-inline-entry .rs-entry-meta{display:inline;margin:0 3pt}.rs-inline-entry .rs-entry-content>p{display:inline}.rs-inline-entry .rs-detail::after{content:'； '}.rs-inline-entry .rs-entry-content>p[data-resume-field$=".body"]~p[data-resume-field$=".body"]{display:block}
${resumeTemplateRegionCss}
.rs-document{--aside-ratio:${ratio};--aside-percent:${ratio*100}%;--aside-width:calc((210mm - ${l.margin*2+r.gapMm}mm) * ${ratio});--page-margin-x:${l.margin}mm;--page-margin-y:${r.marginYmm}mm}
.rs-columns{grid-template-columns:${left?`minmax(0,${ratio}fr) minmax(0,${1-ratio}fr)`:`minmax(0,${1-ratio}fr) minmax(0,${ratio}fr)`}}
[data-template=rx_glalie][data-two=true] .rs-page::before{content:'';position:absolute;inset:0 auto 0 0;width:calc(var(--page-margin-x) + var(--aside-width));background:var(--tint)}
[data-template=rx_ditto] .rs-header-band{grid-template-columns:var(--aside-percent) minmax(0,1fr)}[data-template=rx_ditto] .rs-header-contact-offset{padding-left:calc(var(--aside-percent) + 4mm)}
@media print{html,body{background:white}.rs-page{margin:0;box-shadow:none}.rs-source{margin:0}}
`;
}

function entryHtml(e: ResumeStudioEntry, p: ResumeTemplateProfile, kind: string, textEntry = false) {
  const dateLocation=p.entry==='date-location';
  const f = (key: 'title'|'organization'|'role'|'location'|'startDate'|'endDate'|'degree'|'major') => field(`entry.${e.id}.${key}`, e[key]);
  let title = join([f('organization'), f('title')]);
  let meta = join([f('role'), f('degree'), f('major'), dateLocation ? '' : f('location')]);
  if(p.entry==='role-inline'||p.entry==='date-gutter'||p.entry==='role-stack'){
    type Key='title'|'organization'|'role'|'location'|'degree'|'major';
    const primary:Key[]=kind==='education'?['degree','major','title']:['internship','work'].includes(kind)?['role','title']:['title'];
    if(!primary.some(key=>e[key].trim()))primary.push('organization');
    const remaining=(['organization','role','degree','major','location'] as Key[]).filter(key=>!primary.includes(key));
    title=join(primary.map(f));meta=join(remaining.map(f));
    if(p.entry==='role-inline'){title=join([title,meta?`<span class="rs-entry-secondary">${meta}</span>`:'']);meta='';}
  }
  const dates = join([f('startDate'), f('endDate')], ' – ');
  let date = `${dateLocation && e.location ? `<span class="rs-entry-location">${f('location')}</span>` : ''}${dates}`;
  let extra='';
  if(p.entry==='dual-meta'){
    meta=join([f('major'),f('location')]);const side=join([f('role'),f('degree')]);
    date+=side?`<span class="rs-entry-side">${side}</span>`:'';
  }
  if(p.entry==='education-grid'&&kind==='education'){
    meta=join([f('degree'),f('major'),f('role')]);extra=e.location?`<div class="rs-education-location">${f('location')}</div>`:'';
  }
  const details = resumeEntryDetails(e).map(d => `<p class="rs-detail"><span class="rs-detail-label">${esc(d.label)}：</span>${d.key === 'url' && validLink(d.value) ? `<a data-resume-field="entry.${e.id}.details.${d.key}" href="${esc(d.value)}">${esc(d.value)}</a>` : field(`entry.${e.id}.details.${d.key}`, d.value)}</p>`).join('');
  const body = (e.body.content ?? []).map(node => {
    const html = resumeRichHtml({ type: 'doc', content: [node] });
    return html.replace(/^<(p|ul|ol)([ >])/, `<$1 data-resume-field="entry.${e.id}.body"$2`);
  }).join('');
  return `<div class="rs-entry${textEntry ? ' rs-inline-entry' : ''}" data-entry-id="${e.id}" data-break="${e.pageBreakBefore}"><div class="rs-entry-head">${title ? `<h3 class="rs-entry-title">${title}</h3>` : ''}${date ? `<div class="rs-entry-date">${date}</div>` : ''}${meta ? `<div class="rs-entry-meta">${meta}</div>` : ''}${extra}</div><div class="rs-entry-content">${details}${body}</div></div>`;
}
export function studioV3Body(raw: ResumeStudioContent, rawLayout: ResumeStudioLayout, resources?: { photoDataUrl?: string | undefined }) {
  const c = ResumeStudioContentSchema.parse(raw), { layout: l, profile: p, two } = resolve(rawLayout), b = c.basics;
  const photo = l.photoVisible !== false && resources?.photoDataUrl && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(resources.photoDataUrl) ? `<img class="rs-photo" src="${resources.photoDataUrl}" alt="">` : '';
  const contacts = [
    b.phone ? `<a href="tel:${esc(b.phone)}">${field('basics.phone', b.phone)}</a>` : '',
    b.email ? `<a href="mailto:${esc(b.email)}">${field('basics.email', b.email)}</a>` : '', field('basics.city', b.city),
    ...b.links.map((link, i) => validLink(link.url) ? `<a data-resume-field="basics.link.${i}" href="${esc(link.url)}">${esc(link.label || link.url)}</a>` : join([field(`basics.link.${i}`, link.label || link.url), link.label ? field(`basics.link.${i}.url`, link.url) : ''], ' ')),
  ].filter(Boolean);
  const contactHtml=contacts.length?`<div class="rs-contacts">${contacts.map(contact => `<span class="rs-contact" data-label="${contact.includes('basics.phone')?'电话':contact.includes('basics.email')?'邮箱':contact.includes('basics.city')?'城市':'链接'}">${contact}</span>`).join('')}</div>`:'';
  const identity=`${b.name ? `<h1 class="rs-name">${field('basics.name', b.name)}</h1>` : ''}${b.headline ? `<p class="rs-headline">${field('basics.headline', b.headline)}</p>` : ''}`;
  const separatePhoto=two && (p.id==='rx_pikachu'||p.header==='cool-band');
  const headerPhoto=separatePhoto?'':photo;
  const headerContacts=['cool-band','oblique','intro-band'].includes(p.header)?'':contactHtml;
  const header = [b.name, b.headline, ...contacts, photo].some(Boolean) ? `<header class="rs-header" data-entry-id="basics">${p.header==='classic-group'?`<div class="rs-header-top">${headerPhoto}<div class="rs-identity">${identity}</div></div>${headerContacts}`:p.header==='offset-band'?`<div class="rs-header-band"><div class="rs-photo-anchor">${headerPhoto}</div><div class="rs-identity">${identity}</div></div><div class="rs-header-contact-offset">${headerContacts}</div>`:p.header==='split-band'?`${headerPhoto}<div class="rs-identity">${identity}</div>${headerContacts}`:p.header==='intro-band'?`<div class="rs-intro-top">${headerPhoto}<div class="rs-identity">${identity}</div></div>${headerContacts}`:`${headerPhoto}<div class="rs-identity">${identity}${headerContacts}</div>`}</header>` : '';
  // Skills / certificates are text entries in the source systems, not employment
  // records. Preserve every populated field while avoiding empty record scaffolding.
  const inlineKinds=['skills','languages','certificates','awards'];
  const sections = c.sections.filter(s => !s.hidden && s.entries.some(e => !e.hidden && hasRenderableResumeEntry(e))).map((s,index) => `<section class="rs-section" data-section-id="${s.id}" data-kind="${s.kind}" data-column="${s.column}" data-region="${p.header==='intro-band'&&s.kind==='summary'?'full':'body'}" data-break="${s.pageBreakBefore}" data-section-number="${index+1}"><h2 class="rs-section-heading" data-number="${index+1}">${field(`section.${s.id}`, s.title)}</h2><div class="rs-section-body">${s.entries.filter(e => !e.hidden && hasRenderableResumeEntry(e)).map(e => entryHtml(e,p,s.kind,inlineKinds.includes(s.kind))).join('')}</div></section>`).join('');
  const asideIntro=separatePhoto ? `<div class="rs-aside-intro">${photo}${p.header==='cool-band'?contactHtml:''}</div>`:two&&p.id==='rx_chikorita'&&photo?'<div class="rs-aside-intro rs-photo-spacer" aria-hidden="true"></div>':'';
  // Leafish's source places the summary before the contact band. Keep both in
  // the splittable full-width flow instead of trapping long summaries in a header.
  const contactBand=p.header==='intro-band'&&contactHtml?`<section class="rs-section rs-contact-band" data-region="full" data-kind="contacts"><div class="rs-section-heading"></div><div class="rs-section-body"><div class="rs-entry"><div class="rs-entry-head"></div><div class="rs-entry-content">${contactHtml}</div></div></div></section>`:'';
  const footer=p.header==='oblique'&&contactHtml?`<section class="rs-section rs-contact-footer" data-kind="contacts"><h2 class="rs-section-heading">联系方式</h2><div class="rs-section-body"><div class="rs-entry"><div class="rs-entry-head"></div><div class="rs-entry-content">${contactHtml}</div></div></div></section>`:'';
  return `<article class="rs-document" data-renderer="studio-pages-v3" data-template="${p.id}" data-header="${p.header}" data-section="${p.section}" data-entry="${p.entry}" data-two="${two}" data-sidebar-header="${two && p.header === 'sidebar'}" data-main-header="${two && p.header === 'main-title'}"><div class="rs-source">${header}${asideIntro}${sections}${contactBand}${footer}</div></article>`;
}
