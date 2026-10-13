import { describe, expect, it } from 'vitest';
import { blankResumeEntry, blankResumeStudioContent, resumeRichText } from './resume-studio.js';
import { hasRenderableResumeEntry, resumeContentManifest } from './resume-content-manifest.js';
import { resumeTemplateLayout } from './resume-modules.js';
import { studioV2Html } from './resume-page-renderer.js';
import { supportedResumeTemplate } from './resume-templates.js';
import { resumeTemplateStarter } from './resume-template-start.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
describe('resume content integrity contract', () => {
  it('includes a date-only or location-only entry, without inventing a title or body', () => {
    const content = blankResumeStudioContent();
    content.sections = [{ id: id(1), kind: 'custom', title: '自定义记录', hidden: false, pageBreakBefore: false, column: 'main', entries: [{ ...blankResumeEntry(id(2)), startDate: '2025.07', location: '深圳' }] }];
    expect(hasRenderableResumeEntry(content.sections[0]!.entries[0]!)).toBe(true);
    const values = resumeContentManifest(content).fields.map(f => f.value);
    expect(values).toEqual(['自定义记录', '深圳', '2025.07']);
    const html = studioV2Html('日期记录', content, resumeTemplateLayout('lapis_cn'));
    expect(html).toContain('2025.07'); expect(html).toContain('深圳'); expect(html).not.toContain('待填写');
  });
  it('tracks whole narratives, supplemental fields and linked destinations independently of slots', () => {
    const content = blankResumeStudioContent(), entry = { ...blankResumeEntry(id(2)), title: '多语言项目', details: { methods: '访谈 + A/B 验证', results: '处理 35 份记录；保留 12.5% 的差异样本', url: 'https://example.test/work' }, body: resumeRichText('第一段：我整理了中文原始记录。\n第二段：复核 16 条分歧，没有编写业务增长。') };
    content.sections = [{ id: id(1), kind: 'project', title: '项目经历', hidden: false, pageBreakBefore: false, column: 'main', entries: [entry, { ...blankResumeEntry(id(3)), title: '隐藏内容', hidden: true }] }];
    const manifest = resumeContentManifest(content);
    expect(manifest.fields.find(f => f.id === `entry.${id(2)}.body`)?.value).toBe('第一段：我整理了中文原始记录。\n第二段：复核 16 条分歧，没有编写业务增长。');
    expect(manifest.fields.map(f => f.value)).not.toContain('隐藏内容');
    expect(manifest.links).toEqual([{ fieldId: `entry.${id(2)}.details.url`, href: 'https://example.test/work' }]);
  });
  it('reproduces the empty-checkpoint failure without paper guidance masquerading as content', () => {
    let n = 0; const content = resumeTemplateStarter('rx_gengar', () => id(++n)); content.basics.name = '合成测试姓名';
    const manifest = resumeContentManifest(content);
    expect(manifest.hasExperienceText).toBe(false); expect(manifest.fields.map(f => f.value)).toEqual(['合成测试姓名']);
    const html = studioV2Html('空稿', content, resumeTemplateLayout('rx_gengar'), '', { editorGuides: true });
    expect(html).not.toContain('待填写'); expect(html).not.toContain('教育经历'); expect(html).toContain('合成测试姓名');
  });
  it('resolves a pinned historical Gengar independently of the upgraded template', () => {
    expect(supportedResumeTemplate('rx_gengar', '2026-09-09.1', 'studio-pages-v2')?.name).toBe('深色侧栏');
    expect(supportedResumeTemplate('rx_gengar', '2026-09-10.1', 'studio-pages-v3')?.name).toBe('Gengar · 侧栏与摘要');
    expect(supportedResumeTemplate('lapis_cn', '2026-09-09.1', 'studio-pages-v2')).toBeUndefined();
    expect(supportedResumeTemplate('rx_gengar', '2099.invalid', 'studio-pages-v3')).toBeUndefined();
  });
});
