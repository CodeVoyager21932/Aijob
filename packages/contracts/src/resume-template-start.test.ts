import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  prepareEmptyResumeForTemplate,
  resumeTemplateStarter,
  resumeHasWrittenEntries,
  resumeContentForTemplate,
} from "./resume-template-start.js";
import { resumeTemplateLayout } from "./resume-modules.js";
import { resumeRichPlain, resumeRichText, ResumeStudioContentSchema } from "./resume-studio.js";
import { studioV2Body } from "./resume-page-renderer.js";
import { resumeGallerySample } from "./resume-studio-samples.js";
describe("template starter and display-only guidance", () => {
  it("applies source column defaults without mutating entries, visibility or experience links", () => {
    const content=resumeGallerySample();content.sections[0]!.hidden=true;
    content.sections[0]!.entries[0]!.experienceId=randomUUID();
    const original=JSON.stringify(content);
    const dual=resumeContentForTemplate(content,'rx_gengar');
    expect(dual.sections.find(s=>s.kind==='skills')!.column).toBe('main');
    expect(dual.sections.find(s=>s.kind==='awards')!.column).toBe('aside');
    expect(dual.sections.map(s=>s.id)).toEqual(content.sections.map(s=>s.id));
    expect(dual.sections[0]!.entries).toBe(content.sections[0]!.entries);
    expect(dual.sections[0]!.hidden).toBe(true);
    expect(resumeContentForTemplate(content,'bre_cool').sections.find(s=>s.kind==='skills')!.column).toBe('aside');
    expect(resumeContentForTemplate(dual,'lapis_cn').sections.every(s=>s.column==='main')).toBe(true);
    expect(JSON.stringify(content)).toBe(original);
  });
  it("starts with usable modules but no invented material or experience", () => {
    const content = resumeTemplateStarter("jp_classic", randomUUID);
    expect(ResumeStudioContentSchema.safeParse(content).success).toBe(true);
    expect(content.sections.map((s) => s.kind)).toEqual([
      "education",
      "internship",
      "project",
      "skills",
    ]);
    expect(resumeHasWrittenEntries(content)).toBe(false);
    for (const s of content.sections)
      for (const e of s.entries) {
        expect(resumeRichPlain(e.body)).toBe("");
        expect(e.experienceId).toBeNull();
      }
    expect(
      new Set(content.sections.flatMap((s) => [s.id, ...s.entries.map((e) => e.id)])).size,
    ).toBe(8);
  });
  it("uses research fields for an academic starter", () => {
    expect(resumeTemplateStarter("jp_academic", randomUUID).sections.map((s) => s.kind)).toEqual([
      "education",
      "research",
      "publications",
      "skills",
    ]);
  });
  it("preserves edited/hidden material, order and associations on template change", () => {
    const content = resumeTemplateStarter("jp_classic", randomUUID);
    const first = content.sections[0]!;
    first.hidden = true;
    first.title = "自定教育标题";
    first.entries[0]!.body = resumeRichText("我实际做过的研究");
    first.entries[0]!.experienceId = randomUUID();
    const before = JSON.stringify(content);
    expect(prepareEmptyResumeForTemplate(content, "jp_academic", randomUUID)).toBe(content);
    expect(JSON.stringify(content)).toBe(before);
  });
  it("fills missing empty modules idempotently without replacing contacts or existing ids", () => {
    const content = resumeTemplateStarter("jp_classic", randomUUID);
    content.basics.name = "陈同学";
    const next = prepareEmptyResumeForTemplate(content, "jp_academic", randomUUID);
    expect(next.sections.slice(0, 4)).toEqual(content.sections);
    expect(next.basics).toEqual(content.basics);
    expect(prepareEmptyResumeForTemplate(next, "jp_academic", randomUUID)).toEqual(next);
  });
  it("keeps v3 preview identical to actual content even when an old caller requests paper guidance", () => {
    const content = resumeTemplateStarter("magic_executive_band", randomUUID),
      before = JSON.stringify(content),
      layout = resumeTemplateLayout("magic_executive_band");
    const editor = studioV2Body(content, layout, { editorGuides: true });
    expect(editor).not.toContain("你的姓名");
    expect(editor).not.toContain("教育经历");
    const output = studioV2Body(content, layout);
    expect(output).not.toContain("你的姓名");
    expect(output).not.toContain("教育经历");
    expect(output).not.toContain("填写学校");
    expect(editor).toBe(output);
    expect(JSON.stringify(content)).toBe(before);
  });
  it("keeps the gallery fixture distinct from new user content", () => {
    expect(
      resumeGallerySample().sections.filter((s) => s.kind === "internship")[0]?.entries,
    ).toHaveLength(1);
    const starter = resumeTemplateStarter("jp_classic", randomUUID);
    expect(JSON.stringify(starter)).not.toContain("林知夏");
  });
});
