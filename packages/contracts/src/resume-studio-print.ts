import {
  type ResumeRichNode,
  type ResumeStudioContent,
  ResumeStudioContentSchema,
  type ResumeStudioLayout,
  ResumeStudioLayoutSchema,
  type ResumeStudioSection,
} from "./resume-studio.js";
import { studioV2Html, usesStudioPagesV2 } from './resume-page-renderer.js';

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function resumeRichHtml(n: ResumeRichNode): string {
  if (n.type === "text") {
    let result = escapeHtml(n.text ?? "");
    for (const mark of n.marks ?? []) {
      if (mark.type === "bold") result = `<strong>${result}</strong>`;
      if (mark.type === "italic") result = `<em>${result}</em>`;
      if (mark.type === "underline") result = `<u>${result}</u>`;
      if (
        mark.type === "link" &&
        mark.attrs?.href &&
        /^(https?:\/\/|mailto:|tel:)/i.test(mark.attrs.href)
      )
        result = `<a href="${escapeHtml(mark.attrs.href)}" rel="noopener noreferrer">${result}</a>`;
    }
    return result;
  }
  if (n.type === "hardBreak") return "<br>";
  const body = (n.content ?? []).map(resumeRichHtml).join("");
  if (n.type === "doc") return body;
  const tag = { paragraph: "p", bulletList: "ul", orderedList: "ol", listItem: "li" }[n.type];
  return `<${tag}${n.type === "orderedList" ? ` start="${n.attrs?.start ?? 1}"` : ""}>${body || "<br>"}</${tag}>`;
}

export function resumeStudioUsesTwoColumns(layout: ResumeStudioLayout) {
  return (
    layout.columns === "two" ||
    (layout.columns === "auto" && layout.templateKey === "cn_simple_two_column")
  );
}

export function resumeStudioPrintCss(layout: ResumeStudioLayout) {
  const l = ResumeStudioLayoutSchema.parse(layout);
  const classic = l.templateKey === "cn_classic_single_column";
  const technical = l.templateKey === "cn_compact_technical";
  const research = l.templateKey === "cn_research_multi_page";
  const color = { ink: "#172320", green: "#245d4f", navy: "#213952" }[l.accent];
  return `
@page{size:A4;margin:${l.margin}mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:white}
.studio-paper{width:100%;color:${color};font-family:"AijobPrint",${l.fontFamily === "serif" ? '"Noto Serif CJK SC","SimSun",serif' : '"Microsoft YaHei","Noto Sans CJK SC",sans-serif'};font-size:${l.fontSize}pt;line-height:${l.lineHeight};overflow-wrap:anywhere}
.studio-paper header{margin:0 0 ${l.sectionGap}pt;padding-bottom:10pt;border-bottom:${classic ? "1px solid" : "2px solid"} ${color};text-align:${classic ? "center" : "left"}}
.studio-paper h1{font-size:${technical ? 21 : 26}pt;margin:0 0 5pt;font-weight:700;line-height:1.2}
.studio-paper .headline{font-size:12pt;margin-bottom:5pt}
.studio-paper .contact{font-size:${Math.max(9, l.fontSize - 1)}pt}
.studio-paper .sections--flow{column-count:${resumeStudioUsesTwoColumns(l) ? 2 : "auto"};column-gap:20pt;column-fill:balance}
.studio-paper .sections--assigned{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(0,1fr);column-gap:20pt;align-items:start}
.studio-paper .column{min-width:0}
.studio-paper section{margin:0 0 ${l.sectionGap}pt;break-inside:auto}
.studio-paper h2{font-size:${l.fontSize + 1}pt;border-bottom:${research ? "none" : "1px solid #bec9c4"};margin:0 0 6pt;padding:0 0 4pt;break-after:avoid}
.studio-paper .entry{margin:0 0 ${technical ? 6 : 9}pt;break-inside:${l.keepEntriesTogether ? "avoid" : "auto"}}
.studio-paper .entry-heading{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1pt 10pt;align-items:baseline;break-after:avoid}
.studio-paper h3{font-size:inherit;margin:0;font-weight:600;min-width:0}
.studio-paper .date{font-size:${Math.max(9, l.fontSize - 1)}pt;white-space:nowrap;flex-shrink:0}
.studio-paper .meta{font-size:${Math.max(9, l.fontSize - 1)}pt;color:#41534c;margin:1pt 0 3pt;break-after:avoid}
.studio-paper p{margin:0 0 3pt;white-space:pre-wrap;orphans:2;widows:2}
.studio-paper ul,.studio-paper ol{margin:2pt 0 4pt;padding-left:18pt}
.studio-paper li{margin:0 0 2pt}
.studio-paper a{color:inherit;text-decoration:underline}
.studio-paper .page-break{break-before:page}
.studio-page{background:white;width:210mm;min-height:297mm;padding:${l.margin}mm;margin:0 auto 16px;box-shadow:0 1px 6px #0002}
@media print{.studio-page{width:auto;min-height:0;padding:0;box-shadow:none;margin:0}.studio-paper{width:auto}}
`;
}

function sectionHtml(s: ResumeStudioSection) {
  return `<section data-section-id="${s.id}" data-column="${s.column}" class="studio-section"><h2>${escapeHtml(s.title)}</h2>${s.entries
    .filter((e) => !e.hidden)
    .map(
      (e) =>
        `<div class="entry" data-entry-id="${e.id}"><div class="entry-heading"><h3>${escapeHtml([e.title, e.organization].filter(Boolean).join(" · "))}</h3><span class="date">${escapeHtml([e.startDate, e.endDate].filter(Boolean).join(" — "))}</span></div>${[e.role, e.degree, e.major, e.location].some(Boolean) ? `<div class="meta">${escapeHtml([e.role, e.degree, e.major, e.location].filter(Boolean).join(" · "))}</div>` : ""}${resumeRichHtml(e.body)}</div>`,
    )
    .join("")}</section>`;
}

export function resumeStudioPageGroups(sections: ResumeStudioSection[]) {
  const visible = sections.filter((s) => !s.hidden);
  // Page breaks inside CSS multi-column flows are ignored by Chromium. Sibling flows retain actual page boundaries.
  let currentGroup: ResumeStudioSection[] = [];
  const groups: ResumeStudioSection[][] = [currentGroup];
  const nextPage = () => {
    if (currentGroup.length) {
      currentGroup = [];
      groups.push(currentGroup);
    }
  };
  for (const section of visible) {
    if (section.pageBreakBefore) nextPage();
    let entries: ResumeStudioSection["entries"] = [];
    const append = () => {
      if (entries.length) {
        currentGroup.push({ ...section, pageBreakBefore: false, entries });
        entries = [];
      }
    };
    for (const entry of section.entries.filter((e) => !e.hidden)) {
      if (entry.pageBreakBefore) {
        append();
        nextPage();
      }
      entries.push({ ...entry, pageBreakBefore: false });
    }
    append();
    if (section.entries.filter((entry) => !entry.hidden).length === 0)
      currentGroup.push({ ...section, pageBreakBefore: false, entries: [] });
  }
  return groups;
}

export function resumeStudioPrintBody(content: ResumeStudioContent, layout?: ResumeStudioLayout) {
  const c = ResumeStudioContentSchema.parse(content),
    b = c.basics;
  const contacts = [b.phone, b.email, b.city]
    .filter(Boolean)
    .map(escapeHtml)
    .concat(
      b.links.map(
        (link) => /^(https?:\/\/|mailto:|tel:)/i.test(link.url) ? `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label || link.url)}</a>` : escapeHtml(link.label || link.url),
      ),
    );
  const groups = resumeStudioPageGroups(c.sections);
  const sections = groups
    .map((group, index) => {
      const assigned =
        layout && resumeStudioUsesTwoColumns(layout) && group.some((s) => s.column === "aside");
      const body = assigned
        ? `<div class="sections sections--assigned"><div class="column column--main">${group
            .filter((s) => s.column === "main")
            .map(sectionHtml)
            .join("")}</div><div class="column column--aside">${group
            .filter((s) => s.column === "aside")
            .map(sectionHtml)
            .join("")}</div></div>`
        : `<div class="sections sections--flow">${group.map(sectionHtml).join("")}</div>`;
      return `<div class="print-group${index ? " page-break" : ""}">${body}</div>`;
    })
    .join("");
  return `<article class="studio-paper"><header><h1>${escapeHtml(b.name)}</h1>${b.headline ? `<div class="headline">${escapeHtml(b.headline)}</div>` : ""}<div class="contact">${contacts.join(" · ")}</div></header>${sections}</article>`;
}

/** Runs in the browser after fonts resolve. A record taller than a printable page must be allowed to split. */
export function relaxOversizedStudioEntries(input: { margin: number }) {
  const height = ((297 - input.margin * 2) * 96) / 25.4;
  for (const entry of document.querySelectorAll<HTMLElement>(".studio-paper .entry")) {
    // In fragmented columns a bounding box can span columns; summed fragments retain the real content height.
    const measured = Array.from(entry.getClientRects()).reduce((sum, rect) => sum + rect.height, 0);
    entry.style.breakInside = measured > height ? "auto" : "";
  }
}

export function resumeStudioPrintHtml(
  title: string,
  content: ResumeStudioContent,
  layout: ResumeStudioLayout,
  fontCss = "",
  resources?: { photoDataUrl?: string | undefined },
) {
  if (usesStudioPagesV2(layout)) return studioV2Html(title, content, layout, fontCss, resources);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:;"><title>${escapeHtml(title)}</title><style>${fontCss}${resumeStudioPrintCss(layout)}</style></head><body>${resumeStudioPrintBody(content, layout)}</body></html>`;
}
