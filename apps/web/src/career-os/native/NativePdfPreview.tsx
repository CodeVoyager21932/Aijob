import type { NativeResumeDocument } from "@aijob/resume-core";
import type { NativeItemAnchor } from "@aijob/resume-renderer/browser";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiDownload } from "../../api/client";
import { loadNativeFonts } from "./local-fonts";
import { nativePreviewQueue } from "./preview-queue";
import "./native-pdf-preview.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export function NativePdfPreview({
  document,
  fixedBlob,
  onEditItem,
  authoritative = false,
  sourceAnchors,
  pendingMessage,
  onRetry,
  fillContainer = false,
}: {
  document: NativeResumeDocument;
  fixedBlob?: Blob | undefined;
  onEditItem?: (id: string) => void;
  authoritative?: boolean;
  sourceAnchors?: NativeItemAnchor[] | undefined;
  pendingMessage?: string | undefined;
  onRetry?: (() => void) | undefined;
  fillContainer?: boolean;
}) {
  const editItem = useRef(onEditItem);
  const photoCache = useRef(new Map<string, Promise<string>>());
  const resolvePhoto = useCallback(async (input: NativeResumeDocument) => {
    const next = structuredClone(input);
    if (next.data.picture.hidden) {
      next.data.picture.url = "";
      return next;
    }
    const match = /^aijob-photo:([0-9a-f-]{36})$/i.exec(next.data.picture.url);
    if (!match?.[1]) return next;
    const id = match[1];
    let pending = photoCache.current.get(id);
    if (!pending) {
      pending = apiDownload(`/v1/resume-photos/${id}`)
        .then(
          ({ blob }) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("照片读取失败"));
              reader.readAsDataURL(blob);
            }),
        )
        .catch((error) => {
          photoCache.current.delete(id);
          throw error;
        });
      photoCache.current.set(id, pending);
    }
    next.data.picture.url = await pending;
    return next;
  }, []);
  const layoutAnchors = useRef<NativeItemAnchor[]>([]);
  editItem.current = onEditItem;
  const host = useRef<HTMLDivElement>(null),
    generation = useRef(0);
  const [zoom, setZoom] = useState(() => {
    try {
      const value = localStorage.getItem("aijob:native-preview-zoom");
      return value && ["width", "actual", "page"].includes(value) ? value : "page";
    } catch {
      return "page";
    }
  });
  const [blob, setBlob] = useState<Blob | null>(null),
    [status, setStatus] = useState("正在生成原生纸张…");
  useEffect(() => {
    if (fixedBlob) {
      setBlob(fixedBlob);
      setStatus("正在显示固定版本…");
      return;
    }
    if (authoritative) {
      setStatus("保存后显示当前稿件…");
      return;
    }
    setStatus("正在排版…");
    const current = ++generation.current;
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        void Promise.all([loadNativeFonts(), resolvePhoto(document)])
          .then(async ([fonts, resolvedDocument]) => {
            if (current !== generation.current || controller.signal.aborted) return;
            setStatus("正在排版…");
            const result = await nativePreviewQueue.render(
              resolvedDocument,
              fonts,
              controller.signal,
            );
            if (current !== generation.current || controller.signal.aborted) return;
            layoutAnchors.current = result.anchors ?? [];
            setBlob(result.blob);
            setStatus("正在显示纸张…");
          })
          .catch((error) => {
            if (current === generation.current && !controller.signal.aborted)
              setStatus(String(error));
          }),
      350,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [document, fixedBlob, resolvePhoto, authoritative]);
  useEffect(() => {
    if (!blob) return;
    let active = true;
    const displayedGeneration = generation.current;
    let loading: ReturnType<typeof pdfjs.getDocument> | undefined;
    void (async () => {
      loading = pdfjs.getDocument({
        data: new Uint8Array(await blob.arrayBuffer()),
      });
      const pdf = await loading.promise;
      const anchors = editItem.current
        ? authoritative
          ? (sourceAnchors ?? [])
          : !fixedBlob
            ? layoutAnchors.current
            : []
        : [];
      const fragment = window.document.createDocumentFragment();
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index),
          canvas = window.document.createElement("canvas");
        const viewport = page.getViewport({ scale: 1.7 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.setAttribute("aria-label", `简历第 ${index} 页`);
        canvas.setAttribute("aria-hidden", "true");
        await page.render({ canvas, viewport }).promise;
        const sheet = window.document.createElement("div"),
          surface = window.document.createElement("div"),
          text = window.document.createElement("div");
        sheet.className = "native-pdf-sheet";
        surface.className = "native-pdf-surface";
        text.className = "native-pdf-text";
        text.setAttribute("role", "document");
        text.setAttribute("aria-label", `简历第 ${index} 页文字`);
        surface.style.width = `${viewport.width}px`;
        surface.style.height = `${viewport.height}px`;
        text.style.setProperty("--total-scale-factor", String(viewport.scale));
        surface.append(canvas, text);
        sheet.append(surface);
        const layer = new pdfjs.TextLayer({
          textContentSource: await page.getTextContent(),
          container: text,
          viewport,
        });
        await layer.render();
        for (const anchor of anchors.filter((value) => value.page === index)) {
          const x = anchor.x * viewport.scale,
            y = anchor.y * viewport.scale,
            button = window.document.createElement("button");
          button.type = "button";
          button.className = "native-pdf-edit-anchor";
          button.textContent = "↗";
          button.setAttribute("aria-label", "定位编辑此条经历");
          button.style.left = `${Math.max(0, x - 34)}px`;
          button.style.top = `${y}px`;
          button.onclick = () => editItem.current?.(anchor.id);
          surface.append(button);
        }
        fragment.append(sheet);
      }
      if (active && host.current) {
        host.current.replaceChildren(fragment);
        if (displayedGeneration === generation.current)
          setStatus(
            authoritative
              ? "当前稿预览 · 与下载使用同一文件"
              : fixedBlob
                ? "已导出的固定版本"
                : "纸张已更新",
          );
      }
    })().catch((error) => {
      if (active) setStatus(`纸张显示失败：${String(error)}`);
    });
    return () => {
      active = false;
      void loading?.destroy();
    };
  }, [blob, fixedBlob, authoritative, sourceAnchors]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const resize = () => {
      const padding = getComputedStyle(container);
      const horizontalPadding = parseFloat(padding.paddingLeft) + parseFloat(padding.paddingRight);
      const verticalPadding = parseFloat(padding.paddingTop) + parseFloat(padding.paddingBottom);
      for (const canvas of container.querySelectorAll("canvas")) {
        const surface = canvas.parentElement,
          sheet = surface?.parentElement;
        if (!surface || !sheet) continue;
        const margin = getComputedStyle(sheet);
        const availableWidth = Math.max(80, container.clientWidth - horizontalPadding);
        const availableHeight = Math.max(
          100,
          container.clientHeight -
            verticalPadding -
            parseFloat(margin.marginTop) -
            parseFloat(margin.marginBottom),
        );
        const width =
          zoom === "actual"
            ? ((canvas.width / 1.7) * 4) / 3
            : zoom === "width"
              ? availableWidth
              : Math.min(availableWidth, (availableHeight * canvas.width) / canvas.height);
        sheet.style.width = `${width}px`;
        sheet.style.height = `${(width * canvas.height) / canvas.width}px`;
        surface.style.transform = `scale(${width / canvas.width})`;
      }
    };
    const observer = new ResizeObserver(resize);
    const mutation = new MutationObserver(resize);
    observer.observe(container);
    mutation.observe(container, { childList: true });
    resize();
    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, [zoom]);
  return (
    <section className={`native-paper${fillContainer ? " native-paper-fill" : ""}`}>
      <header>
        <span>简历预览</span>
        <label>
          缩放{" "}
          <select
            aria-label="纸张缩放"
            value={zoom}
            onChange={(event) => {
              setZoom(event.target.value);
              try {
                localStorage.setItem("aijob:native-preview-zoom", event.target.value);
              } catch {
                /* Optional view preference. */
              }
            }}
          >
            <option value="page">整页适配</option>
            <option value="width">适应宽度</option>
            <option value="actual">100%</option>
          </select>
        </label>
        <output aria-live="polite">{pendingMessage || status}</output>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            更新预览
          </button>
        )}
      </header>
      <div ref={host} className="native-pages" />
    </section>
  );
}
