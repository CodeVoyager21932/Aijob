import { paginateResumeStudio, type ResumeStudioLayout } from "@aijob/contracts";
import { useEffect, useRef, useState } from "react";
export function studioWebFontCss(family: "sans" | "serif", layout?: ResumeStudioLayout) {
  if (layout?.rendererVersion === 'studio-pages-v3') {
    const families = [...new Set([family, layout.typography?.headingFamily ?? family])];
    return families.flatMap(font => [400, 700].flatMap(weight => {
      const label = font === 'serif' ? 'Serif' : 'Sans';
      const filename = `AijobV3${label}${weight === 400 ? 'Regular' : 'Bold'}`;
      return ['', 'Common'].map(part => `@font-face{font-family:AijobV3${label}${part};font-style:normal;font-weight:${weight};src:url(${new URL(`/fonts/${filename}${part}.woff2?v=${layout.fontSetVersion}`, window.location.origin).href}) format('woff2');font-display:block}`);
    })).join('');
  }
  const filename = family === "serif" ? "AijobSerifCJK.woff2" : "AijobCJK.woff2";
  const common = filename.replace(".woff2", "Common.woff2");
  return `@font-face{font-family:AijobPrintCommon;font-style:normal;font-weight:400;src:url(${new URL(`/fonts/${common}`, window.location.origin).href}) format('woff2');font-display:block;}@font-face{font-family:AijobPrint;font-style:normal;font-weight:400;src:url(${new URL(`/fonts/${filename}`, window.location.origin).href}) format('woff2');font-display:block;}.rs-document{font-family:AijobPrintCommon,AijobPrint,${family === "serif" ? "serif" : "sans-serif"}!important}`;
}
export function StudioPagedPreview({
  html,
  onEntrySelect,
  keepEntriesTogether = true,
  autoColumns = true,
  zoom = "page",
  onReady,
  presentation = "document",
}: {
  html: string;
  onEntrySelect?: (id: string) => void;
  keepEntriesTogether?: boolean;
  autoColumns?: boolean;
  zoom?: "fit" | "page" | number;
  onReady?: (pages: number) => void;
  presentation?: "document" | "page";
}) {
  const host = useRef<HTMLDivElement>(null),
    pageScroll = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLIFrameElement>(null),
    revision = useRef(0),
    selectRef = useRef(onEntrySelect),
    readyRef = useRef(onReady);
  selectRef.current = onEntrySelect;
  readyRef.current = onReady;
  const [width, setWidth] = useState(600),
    [availableHeight, setAvailableHeight] = useState(600),
    [pageIndex, setPageIndex] = useState(0),
    [pageCount, setPageCount] = useState(1),
    [pageZoom, setPageZoom] = useState('page'),
    [height, setHeight] = useState(1155),
    [shownHtml, setShownHtml] = useState(html),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    if (html === shownHtml) return;
    const timer = setTimeout(() => {
      revision.current++;
      setError("");
      setLoading(true);
      setPageIndex(0);
      setShownHtml(html);
    }, 180);
    return () => clearTimeout(timer);
  }, [html, shownHtml]);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const scroll = node.closest<HTMLElement>('.sw-paper-scroll');
    const observer = new ResizeObserver(() => {
      setWidth(node.clientWidth);
      // Observe the available workspace, not the scaled paper height, to avoid
      // feedback shrinkage when fitting a complete page.
      const target = scroll ?? node, style = getComputedStyle(target);
      const guidance = scroll?.querySelector<HTMLElement>('.sw-template-guidance')?.offsetHeight ?? 0;
      setAvailableHeight(target.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - guidance - 12);
    });
    observer.observe(node);
    if (scroll) observer.observe(scroll);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (presentation !== "page") return;
    pageScroll.current?.scrollTo(0, 0);
    frame.current?.contentDocument
      ?.querySelectorAll<HTMLElement>(".rs-page")
      .forEach((node, index) => {
        node.hidden = index !== pageIndex;
      });
  }, [pageIndex, presentation]);
  const baseWidth = 826,
    singlePage = presentation === "page",
    frameHeight = singlePage ? 1155 : height,
    scale = singlePage
      ? pageZoom === 'actual' ? 1 : pageZoom === 'width' ? Math.min(1, width/baseWidth) : Math.max(0.05, Math.min(1, width / baseWidth, (availableHeight - 60) / 1155))
      : zoom === "fit"
        ? Math.min(1.15, Math.max(0.15, width / baseWidth))
        : zoom === 'page' ? Math.max(.1, Math.min(1, width / baseWidth, (availableHeight - 20) / 1155))
        : zoom;
  return (
    <div
      ref={host}
      className={`studio-preview-viewport sw-paper-viewport${singlePage ? " sw-single-page" : ""}`}
      data-preview-ready={!loading && html === shownHtml && !error}
    >
      <div className="sw-preview-status" aria-live="polite">
        {error || (loading ? "正在更新排版…" : "")}
      </div>
      <div ref={pageScroll} className={singlePage?'sw-single-page-scroll':undefined} style={singlePage?undefined:{display:'contents'}}>
      <div
        style={{
          height: frameHeight * scale,
          width: baseWidth * scale,
          maxWidth: !singlePage && zoom === "fit" ? "100%" : undefined,
          position: "relative",
          margin: "0 auto",
        }}
      >
        <iframe
          ref={frame}
          title={singlePage ? "简历模板分页预览" : "简历实时排版预览"}
          srcDoc={shownHtml}
          sandbox="allow-same-origin allow-modals"
          onLoad={() => {
            const document = frame.current?.contentDocument,
              current = revision.current;
            if (!document) return;
            void (async () => {
              try {
                await document.fonts.ready;
                await Promise.all(
                  Array.from(document.images).map((img) => img.decode().catch(() => {})),
                );
                if (current !== revision.current || document !== frame.current?.contentDocument)
                  return;
                const result = paginateResumeStudio({
                  root: document.body,
                  keepEntriesTogether,
                  autoColumns,
                });
                setHeight(Math.max(1155, document.body.scrollHeight + 16));
                setPageCount(result.pageCount || 1);
                document.documentElement.style.overflow = "hidden";
                document.body.style.overflow = "hidden";
                if (singlePage)
                  document.querySelectorAll<HTMLElement>(".rs-page").forEach((node, index) => {
                    node.hidden = index !== 0;
                  });
                setLoading(false);
                readyRef.current?.(result.pageCount || 1);
                document.addEventListener("click", (event) => {
                  const target = event.target as Element | null;
                  const entry = target?.closest<HTMLElement>("[data-entry-id]");
                  if (entry?.dataset.entryId) {
                    event.preventDefault();
                    selectRef.current?.(entry.dataset.entryId);
                  }
                });
              } catch {
                if (current === revision.current) {
                  setError("这次排版未完成，请调整长条目或重新选择模板。内容仍然保留。");
                  setLoading(false);
                }
              }
            })();
          }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: baseWidth,
            height: frameHeight,
            border: 0,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        />
      </div>
      </div>
      {singlePage && (
        <nav className="sw-page-navigation" aria-label="模板预览页码">
          <button
            type="button"
            aria-label="上一页预览"
            disabled={loading || pageIndex === 0}
            onClick={() => setPageIndex((i) => i - 1)}
          >
            ←
          </button>
          <span aria-live="polite">
            第 {pageIndex + 1} / {pageCount} 页
          </span>
          <button
            type="button"
            aria-label="下一页预览"
            disabled={loading || pageIndex >= pageCount - 1}
            onClick={() => setPageIndex((i) => i + 1)}
          >
            →
          </button>
          <select aria-label="模板预览缩放" value={pageZoom} onChange={e=>setPageZoom(e.target.value)}><option value="page">整页</option><option value="width">适应宽度</option><option value="actual">100%</option></select>
        </nav>
      )}
    </div>
  );
}
