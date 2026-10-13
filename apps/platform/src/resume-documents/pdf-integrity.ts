import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { normalizeResumeOutput, type ResumeContentManifest, type auditResumePageContent } from '@aijob/contracts';

export type ResumePageAudit = ReturnType<typeof auditResumePageContent>;
export class ResumeContentIntegrityError extends Error {
  constructor(readonly stage: 'pagination' | 'pdf', readonly failures: { fieldId: string; reason: string }[]) {
    super(`RESUME_CONTENT_INTEGRITY_FAILED:${stage}`);
  }
}
/** Final bytes are inspected, not the source HTML. Geometry associates fields with text
 * runs, including separate columns and continued paragraphs. No private text in errors. */
export async function inspectResumePdf(buffer: Buffer, manifest: ResumeContentManifest, audit: ResumePageAudit) {
  if (audit.failures.length) throw new ResumeContentIntegrityError('pagination', audit.failures);
  const loading = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    const failures: { fieldId: string; reason: string }[] = [];
    if (pdf.numPages !== audit.pageCount) failures.push({ fieldId: 'document', reason: 'PAGE_COUNT_MISMATCH' });
    const rows: { page: number; text: string; x: number; y: number; width: number; height: number }[] = [];
    const hrefs = new Set<string>();
    const normalLink = (url: string) => { try { return new URL(url).href; } catch { return url; } };
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), viewport = page.getViewport({ scale: 1 });
      const text = await page.getTextContent({ disableNormalization: true });
      for (const item of text.items) if ('str' in item && item.str.trim()) {
        const x = Number(item.transform[4]), baseline = viewport.height - Number(item.transform[5]);
        rows.push({ page: n, text: item.str, x, y: baseline - item.height * .5, width: item.width, height: item.height });
        if (x < -1 || x + item.width > viewport.width + 1 || baseline < -1 || baseline > viewport.height + 1) failures.push({ fieldId: `page.${n}`, reason: 'PDF_TEXT_OUTSIDE_PAGE' });
      }
      for (const a of await page.getAnnotations()) if (a.subtype === 'Link' && (a.url || a.unsafeUrl)) hrefs.add(normalLink(a.url ?? a.unsafeUrl));
    }
    for (const field of manifest.fields) {
      const positions = audit.positions.filter(p => p.fieldId === field.id);
      const selected = rows.filter(row => positions.some(p => p.page === row.page && row.y >= p.y - 2 && row.y <= p.y + p.height + 2 && row.x + row.width > p.x - .5 && row.x < p.x + p.width + .5));
      const text = normalizeResumeOutput(selected.map(r => r.text).join(''));
      if (!text.includes(normalizeResumeOutput(field.value))) failures.push({ fieldId: field.id, reason: 'PDF_FIELD_MISSING' });
    }
    for (const link of manifest.links) if (!hrefs.has(normalLink(link.href))) failures.push({ fieldId: link.fieldId, reason: 'PDF_LINK_MISSING' });
    if (failures.length) throw new ResumeContentIntegrityError('pdf', failures);
    return { pageCount: pdf.numPages, fields: manifest.fields.length, links: manifest.links.length, bytes: buffer.length, contentVerified: true as const };
  } finally { await loading.destroy(); }
}
