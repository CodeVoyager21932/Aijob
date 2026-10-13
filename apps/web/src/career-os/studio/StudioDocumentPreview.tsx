import { useEffect, useMemo, useState } from 'react';
import { studioV2Html, resumeStudioPrintHtml, usesStudioPagesV2, type ResumeStudioContent, type ResumeStudioLayout } from '@aijob/contracts';
import { StudioPagedPreview, studioWebFontCss } from './StudioPagedPreview';

/** Formatting is derived work. Keep serialization and Zod traversal off the input render. */
export function StudioDocumentPreview({ content, layout, title, photo, zoom, onEntrySelect, onReady }: {
  content: ResumeStudioContent; layout: ResumeStudioLayout; title: string; photo?: string | undefined;
  zoom: 'fit'|'page'|number; onEntrySelect: (id: string) => void; onReady: (pages: number) => void;
}) {
  const [renderContent, setRenderContent] = useState(content);
  useEffect(() => {
    if (content === renderContent) return;
    const timer = setTimeout(() => setRenderContent(content), 120);
    return () => clearTimeout(timer);
  }, [content, renderContent]);
  const html = useMemo(() => {
    try {
      const font = studioWebFontCss(layout.fontFamily, layout);
      return usesStudioPagesV2(layout)
        ? studioV2Html(title, renderContent, layout, font, { photoDataUrl:photo })
        : resumeStudioPrintHtml(title, renderContent, layout, font);
    } catch { return ''; }
  }, [renderContent, layout, title, photo]);
  return html ? <div style={{display:'contents'}} data-content-ready={content === renderContent}><StudioPagedPreview html={html} zoom={zoom} onEntrySelect={onEntrySelect} onReady={onReady} keepEntriesTogether={layout.keepEntriesTogether} autoColumns={layout.autoColumns ?? true} /></div> : <p role="alert">这次预览未能生成，内容仍然保留。可以继续编辑或重新选择模板。</p>;
}
