import type { NativeResumeDocument } from "./index.js";

export const singlePageLevels = [0, 1, 2] as const;
/** Output-only layout. Text, item IDs, visibility and provenance are never edited. */
export function singlePageLayout(input: NativeResumeDocument, level: number): NativeResumeDocument {
  const document = structuredClone(input);
  const m = document.data.metadata;
  const first = m.layout.pages[0];
  if (first)
    m.layout.pages = [
      {
        ...first,
        main: [...new Set(m.layout.pages.flatMap((page) => page.main))],
        sidebar: [...new Set(m.layout.pages.flatMap((page) => page.sidebar))],
      },
    ];
  m.page.format = "a4";
  for (const section of [
    document.data.summary,
    ...Object.values(document.data.sections),
    ...document.data.customSections,
  ])
    section.startOnNewPage = false;
  m.typography.body.fontSize = Math.max(9.5, m.typography.body.fontSize);
  if (level > 0) {
    const compact = level === 2;
    const campus = [
      "studio-campus-cn",
      "studio-banner-cn",
      "studio-index-cn",
      "studio-sidebar-cn",
      "studio-layered-cn",
      "studio-cards-cn",
    ].includes(document.presentation?.id ?? "");
    if (!campus)
      m.typography.body.fontSize = Math.max(
        9.5,
        Math.min(m.typography.body.fontSize, compact ? 9.5 : 10),
      );
    m.typography.body.lineHeight = Math.min(
      m.typography.body.lineHeight,
      compact ? 1.22 : campus ? 1.26 : 1.32,
    );
    if (!campus)
      m.typography.heading.fontSize = Math.min(m.typography.heading.fontSize, compact ? 11 : 11.5);
    // The six Chinese layouts reclaim spacing, never reduce the user's type size.
    m.page.marginX = Math.max(24, Math.min(m.page.marginX, campus ? 24 : compact ? 26 : 32));
    m.page.marginY = Math.max(24, Math.min(m.page.marginY, campus || compact ? 24 : 30));
    m.page.sectionGap = Math.min(m.page.sectionGap ?? 14, campus ? 4 : compact ? 5 : 8);
    m.page.gapY = Math.min(m.page.gapY, campus || compact ? 3 : 5);
  }
  return document;
}
