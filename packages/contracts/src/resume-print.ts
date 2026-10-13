import type {
  ResumeTemplateKey,
  ResumeLayoutSettings,
  ResumeSemanticContent,
} from "./resume-documents.js";
import { resumeStudioPrintHtml } from "./resume-studio-print.js";
import type { ResumeStudioContent, ResumeStudioLayout } from "./resume-studio.js";
export interface ResumePrintInput {
  studio?: {content:ResumeStudioContent;layout:ResumeStudioLayout;resources?:{photoDataUrl?:string | undefined} | undefined}|undefined;
  title: string;
  content: ResumeSemanticContent;
  templateKey: ResumeTemplateKey;
  sectionOrder: string[];
  settings: ResumeLayoutSettings;
}
/** Called after print styles and fonts are active, in either browser runtime. */
export function relaxOversizedResumeSections(input: { compact: boolean }) {
  const pageHeight = ((297 - (input.compact ? 24 : 36)) * 96) / 25.4;
  for (const section of document.querySelectorAll<HTMLElement>(
    ".career-resume-print-document section",
  )) {
    section.style.breakInside = section.getBoundingClientRect().height > pageHeight ? "auto" : "";
  }
}
export function resumePrintCss(templateKey: ResumeTemplateKey, settings: ResumeLayoutSettings) {
  const compact =
    templateKey === "cn_compact_technical" || settings.pageBreakPolicy === "compact_to_fit";
  const size = { compact: 9.5, standard: compact ? 9.5 : 10.5, large: 12 }[settings.fontSizeToken];
  const line = { tight: 1.35, standard: compact ? 1.42 : 1.55, relaxed: 1.8 }[
    settings.lineSpacingToken
  ];
  const gap = { tight: 3, standard: compact ? 3.5 : 5, relaxed: 7 }[settings.sectionSpacingToken];
  const color = { black: "#111111", charcoal: "#1d2939", navy: "#18334f" }[settings.colorToken];
  return `@media print {
    @page {size:A4;margin:${compact ? "12mm 14mm" : "18mm"};}
    html,body{margin:0!important;padding:0!important;background:white!important;}
    body>*{display:none!important;}
    body>.career-resume-print-document{display:block!important;box-sizing:border-box;width:auto;min-height:0;padding:0;background:white;color:${color};font-family:"AijobPrint","Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:${size}pt;line-height:${line};}
    .career-resume-print-document h1{margin:0 0 ${compact ? 5 : 8}mm;font-size:${compact ? 16 : 18}pt;text-align:center;}
    .career-resume-print-document section{break-inside:${settings.pageBreakPolicy === "keep_sections" ? "avoid" : "auto"};margin-top:${gap}mm;}
    .career-resume-print-document h2{break-after:avoid;padding-bottom:1.5mm;margin:0 0 ${compact ? 1.5 : 2.5}mm;border-bottom:.35mm solid ${color};font-size:${compact ? 11.5 : 13}pt;}
    .career-resume-print-document p{margin:0 0 ${compact ? 1.5 : 2.5}mm;white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3;}
  }`;
}
const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
export function resumePrintHtml(input: ResumePrintInput, fontCss = "") {
  if(input.studio) return resumeStudioPrintHtml(input.title,input.studio.content,input.studio.layout,fontCss,input.studio.resources);
  const byId = new Map(input.content.sections.map((section) => [section.id, section]));
  if (
    input.sectionOrder.length !== byId.size ||
    new Set(input.sectionOrder).size !== byId.size ||
    input.sectionOrder.some((id) => !byId.has(id))
  )
    throw new Error("RESUME_PRINT_LAYOUT_MISMATCH");
  const sections = input.sectionOrder
    .map((id) => byId.get(id))
    .filter((value) => value !== undefined);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:;"><title>${escapeHtml(input.title)}</title><style>${fontCss}${resumePrintCss(input.templateKey, input.settings)}</style></head><body><article class="career-resume-print-document"><h1>${escapeHtml(input.title)}</h1>${sections
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.title)}</h2>${[...section.blocks]
          .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))
          .map((block) => `<p>${escapeHtml(block.text)}</p>`)
          .join("")}</section>`,
    )
    .join("")}</article></body></html>`;
}
