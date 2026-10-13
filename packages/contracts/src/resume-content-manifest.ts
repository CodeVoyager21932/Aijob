import { ResumeStudioContentSchema, resumeRichPlain, type ResumeStudioContent, type ResumeStudioEntry, type ResumeRichNode } from './resume-studio.js';

export type ResumeManifestField = { id: string; value: string; repeatable: boolean; entryId: string | null };
export type ResumeManifestLink = { fieldId: string; href: string };
export type ResumeContentManifest = { version: 'resume-content-manifest-v1'; fields: ResumeManifestField[]; links: ResumeManifestLink[]; hasExperienceText: boolean };
export const normalizeResumeOutput = (text: string) => text.normalize('NFC').replace(/\s|\u200b|\u00ad/g, '');
export function hasRenderableResumeEntry(entry: ResumeStudioEntry) {
  return [entry.title, entry.organization, entry.role, entry.location, entry.startDate, entry.endDate,
    entry.degree, entry.major, resumeRichPlain(entry.body), ...Object.values(entry.details ?? {})].some(v => Boolean(v?.trim()));
}
/** This inventory is independent of template fields/slots. A template cannot lower the
 * expected content by omitting its own binding. Hidden content is intentionally excluded. */
export function resumeContentManifest(raw: ResumeStudioContent): ResumeContentManifest {
  const content = ResumeStudioContentSchema.parse(raw), fields: ResumeManifestField[] = [], links: ResumeManifestLink[] = [];
  const add = (id: string, value: string, entryId: string | null = null, repeatable = true) => {
    if (value.trim()) fields.push({ id, value, entryId, repeatable });
  };
  for (const key of ['name', 'headline', 'phone', 'email', 'city'] as const) add(`basics.${key}`, content.basics[key]);
  content.basics.links.forEach((link, index) => {
    add(`basics.link.${index}`, link.label || link.url);
    if (/^(https?:\/\/|mailto:|tel:)/i.test(link.url)) links.push({ fieldId: `basics.link.${index}`, href: link.url });
    else if (link.label && link.url) add(`basics.link.${index}.url`, link.url);
  });
  for (const section of content.sections.filter(s => !s.hidden)) {
    const entries = section.entries.filter(e => !e.hidden && hasRenderableResumeEntry(e));
    if (!entries.length) continue;
    add(`section.${section.id}`, section.title);
    for (const e of entries) {
      for (const key of ['title', 'organization', 'role', 'location', 'startDate', 'endDate', 'degree', 'major'] as const) add(`entry.${e.id}.${key}`, e[key], e.id);
      for (const [key, value] of Object.entries(e.details ?? {})) {
        if (value) add(`entry.${e.id}.details.${key}`, value, e.id, false);
        if (key === 'url' && value && /^(https?:\/\/|mailto:|tel:)/i.test(value)) links.push({ fieldId: `entry.${e.id}.details.url`, href: value });
      }
      add(`entry.${e.id}.body`, resumeRichPlain(e.body), e.id, false);
      const walk = (node: ResumeRichNode) => {
        for (const mark of node.marks ?? []) if (mark.type === 'link' && mark.attrs?.href) links.push({ fieldId: `entry.${e.id}.body`, href: mark.attrs.href });
        for (const child of node.content ?? []) walk(child);
      };
      walk(e.body);
    }
  }
  return { version: 'resume-content-manifest-v1', fields, links, hasExperienceText: fields.some(f => f.entryId !== null && !f.id.endsWith('Date')) };
}

/** Executed inside the isolated preview/PDF document after pagination. Reports identifiers
 * and rectangles, not private text. Repeated headings on continuations are permitted. */
export function auditResumePageContent(manifest: ResumeContentManifest) {
  const normalize = (text: string) => text.normalize('NFC').replace(/\s|\u200b|\u00ad/g, '');
  const pages = Array.from(document.querySelectorAll<HTMLElement>('.rs-page'));
  const failures: { fieldId: string; reason: string }[] = [];
  const positions: { fieldId: string; page: number; x: number; y: number; width: number; height: number }[] = [];
  const nodes = pages.flatMap(page => Array.from(page.querySelectorAll<HTMLElement>('[data-resume-field]')));
  const expectedIds=new Set(manifest.fields.map(field=>field.id));
  for(const node of nodes)if(node.textContent?.trim()&&!expectedIds.has(node.dataset.resumeField??''))failures.push({fieldId:node.dataset.resumeField??'unknown',reason:'UNEXPECTED_FIELD'});
  for (const field of manifest.fields) {
    const matching = nodes.filter(n => n.dataset.resumeField === field.id);
    const texts = matching.map(n => normalize(n.textContent ?? ''));
    const actual = field.repeatable ? texts[0] ?? '' : texts.join('');
    if (actual !== normalize(field.value) || field.repeatable && texts.some(v => v !== actual)) failures.push({ fieldId: field.id, reason: 'CONTENT_MISMATCH' });
    for (const node of matching) {
      const page = node.closest<HTMLElement>('.rs-page');
      if (!page) { failures.push({ fieldId: field.id, reason: 'PAGE_MISSING' }); continue; }
      const box = page.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects());
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) failures.push({ fieldId: field.id, reason: 'INVISIBLE' });
      for(let ancestor=node.parentElement;ancestor&&ancestor!==page;ancestor=ancestor.parentElement){
        const ancestorStyle=getComputedStyle(ancestor);
        if(ancestorStyle.visibility==='hidden'||ancestorStyle.display==='none'||Number(ancestorStyle.opacity)===0)failures.push({fieldId:field.id,reason:'INVISIBLE_ANCESTOR'});
        if(['hidden','clip'].includes(ancestorStyle.overflowX)||['hidden','clip'].includes(ancestorStyle.overflowY)){
          const clip=ancestor.getBoundingClientRect();
          if(rects.some(rect=>rect.width>0&&rect.height>0&&(['hidden','clip'].includes(ancestorStyle.overflowX)&&(rect.left<clip.left-1||rect.right>clip.right+1)||['hidden','clip'].includes(ancestorStyle.overflowY)&&(rect.top<clip.top-1||rect.bottom>clip.bottom+1))))failures.push({fieldId:field.id,reason:'CLIPPED_BY_ANCESTOR'});
        }
      }
      for (const rect of rects) {
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1) failures.push({ fieldId: field.id, reason: 'OUTSIDE_PAGE' });
        positions.push({ fieldId: field.id, page: Number(page.dataset.page), x: (rect.x - box.x) * .75, y: (rect.y - box.y) * .75, width: rect.width * .75, height: rect.height * .75 });
      }
    }
  }
  for(const page of pages)for(const photo of page.querySelectorAll<HTMLImageElement>('.rs-photo')){
    const box=page.getBoundingClientRect(),rect=photo.getBoundingClientRect();
    if(!photo.complete||!photo.naturalWidth||rect.width===0||rect.height===0||rect.left<box.left-1||rect.right>box.right+1||rect.top<box.top-1||rect.bottom>box.bottom+1)failures.push({fieldId:'basics.photo',reason:'PHOTO_NOT_VISIBLE'});
    for(const field of page.querySelectorAll<HTMLElement>('[data-resume-field]')){
      const range=document.createRange();range.selectNodeContents(field);
      if(Array.from(range.getClientRects()).some(text=>text.width>0&&text.height>0&&Math.min(text.right,rect.right)-Math.max(text.left,rect.left)>1&&Math.min(text.bottom,rect.bottom)-Math.max(text.top,rect.top)>1))failures.push({fieldId:field.dataset.resumeField??'unknown',reason:'PHOTO_OVERLAPS_TEXT'});
    }
  }
  for (const link of manifest.links) {
    const found = nodes.filter(n => n.dataset.resumeField === link.fieldId).some(n => [n, ...Array.from(n.querySelectorAll('a'))].some(a => a.getAttribute('href') === link.href));
    if (!found) failures.push({ fieldId: link.fieldId, reason: 'LINK_MISSING' });
  }
  return { pageCount: pages.length, fieldCount: manifest.fields.length, failures, positions };
}
export function resumeContentAuditScript(manifest: ResumeContentManifest) {
  return `(() => { const __name = target => target; return (${auditResumePageContent.toString()})(${JSON.stringify(manifest)}); })()`;
}
