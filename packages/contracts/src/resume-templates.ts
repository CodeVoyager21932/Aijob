/** Current gallery; immutable v2 definitions remain in resume-templates-legacy.ts. */
import { LEGACY_RESUME_TEMPLATES, LEGACY_RESUME_TEMPLATE_BY_ID, LEGACY_RESUME_TEMPLATE_GROUPS } from './resume-templates-legacy.js';
import { RESUME_TEMPLATE_PROFILES, STUDIO_V3_VERSION } from './resume-template-profiles.js';
export const RESUME_TEMPLATE_VERSION = STUDIO_V3_VERSION;
export const RESUME_RENDERER_VERSION = 'studio-pages-v3';
export type ResumeTemplateDefinition = Omit<(typeof LEGACY_RESUME_TEMPLATES)[number], 'upstream'> & { upstream: string };
const upgraded = new Map(RESUME_TEMPLATE_PROFILES.map(p => [p.id, {
  id:p.id, name:p.name, group:p.group, upstream:p.upstream, sourceKey:p.sourceKey,
  columns:p.columns, header:p.header, section:p.section, entry:p.entry, font:p.defaults.fontFamily,
  version:STUDIO_V3_VERSION, rendererVersion:RESUME_RENDERER_VERSION,
}]));
export const RESUME_TEMPLATES: readonly ResumeTemplateDefinition[] = [
 ...LEGACY_RESUME_TEMPLATES.map(t => upgraded.get(t.id) ?? t),
 ...Array.from(upgraded.values()).filter(t => !LEGACY_RESUME_TEMPLATE_BY_ID.has(t.id)),
];
export const RESUME_TEMPLATE_BY_ID = new Map(RESUME_TEMPLATES.map(t => [t.id,t]));
export const RESUME_TEMPLATE_GROUPS = LEGACY_RESUME_TEMPLATE_GROUPS;
export function supportedResumeTemplate(id: string, version?: string, renderer?: string) {
  if (renderer === 'studio-pages-v3') {
    const value = upgraded.get(id);
    return value?.version === version ? value : undefined;
  }
  const legacy = LEGACY_RESUME_TEMPLATE_BY_ID.get(id);
  return legacy && version === legacy.version && renderer === legacy.rendererVersion ? legacy : undefined;
}
