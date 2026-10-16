import { expect, it } from "vitest";
import { createNativeResumeDocument, newNativeItem, singlePageLayout } from "./index.js";
import { applyNativeTemplate } from "./templates.js";

it.each([
  "studio-campus-cn",
  "studio-banner-cn",
  "studio-index-cn",
  "studio-sidebar-cn",
  "studio-layered-cn",
  "studio-cards-cn",
] as const)("never shrinks configured type when fitting %s to one page", (template) => {
  const document = applyNativeTemplate(createNativeResumeDocument(), template);
  document.data.metadata.typography.body.fontSize = 12;
  document.data.metadata.typography.heading.fontSize = 15;
  for (const level of [0, 1, 2]) {
    const fitted = singlePageLayout(document, level);
    expect(fitted.data.metadata.typography.body.fontSize).toBe(12);
    expect(fitted.data.metadata.typography.heading.fontSize).toBe(15);
  }
});

it.each([1, 2])(
  "fits output at level %s without changing source text, order, visibility, IDs or provenance",
  (level) => {
    const document = createNativeResumeDocument();
    const item = newNativeItem("projects", "stable-entry");
    item.name = "完整项目";
    item.description = "<p>保留手动写下的内容与数字 18。</p>";
    document.data.sections.projects.items.push(item);
    document.data.sections.projects.startOnNewPage = true;
    document.data.metadata.layout.pages = [
      { fullWidth: true, main: ["education"], sidebar: [] },
      { fullWidth: true, main: ["projects", "summary"], sidebar: ["skills"] },
    ];
    const before = structuredClone(document);
    const fitted = singlePageLayout(document, level);
    expect(document).toEqual(before);
    expect(fitted.data.sections.projects.items).toEqual(document.data.sections.projects.items);
    expect(fitted.sourceBindings).toEqual(document.sourceBindings);
    expect(fitted.data.metadata.layout.pages).toEqual([
      { fullWidth: true, main: ["education", "projects", "summary"], sidebar: ["skills"] },
    ]);
    expect(fitted.data.sections.projects.startOnNewPage).toBe(false);
    expect(fitted.data.metadata.typography.body.fontSize).toBeGreaterThanOrEqual(9.5);
  },
);
