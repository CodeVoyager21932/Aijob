import type { NativeResumeDocument } from "@aijob/resume-core";
import type { NativeItemAnchor } from "@aijob/resume-renderer/browser";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiDownload } from "../../api/client";
import { loadNativeFonts } from "./local-fonts";
import { nativeFieldAnchorLabel, nativeFieldAtPoint } from "./preview-field-targets";
import { nativePreviewQueue } from "./preview-queue";
import {
  isNativeTextTarget,
  type NativeTextSelection,
  nativeTextAtPoint,
  nativeTextSelectionFromRects,
  nativeTextTargets,
} from "./preview-text-targets";
import "./native-pdf-preview.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export function NativePdfPreview({
  document,
  fixedBlob,
  onEditItem,
  onEditText,
  onTextSelectionRejected,
  activeTextTargetId,
  authoritative = false,
  sourceAnchors,
  pendingMessage,
  onRetry,
  fillContainer = false,
  initialZoom,
}: {
  document: NativeResumeDocument;
  fixedBlob?: Blob | undefined;
  onEditItem?: (id: string) => void;
  onEditText?: (selection: NativeTextSelection) => void;
  onTextSelectionRejected?: (message: string) => void;
  activeTextTargetId?: string | undefined;
  authoritative?: boolean;
  sourceAnchors?: NativeItemAnchor[] | undefined;
  pendingMessage?: string | undefined;
  onRetry?: (() => void) | undefined;
  fillContainer?: boolean;
  initialZoom?: "page" | "width" | "actual";
}) {
  const editItem = useRef(onEditItem);
  const editText = useRef(onEditText);
  const rejectSelection = useRef(onTextSelectionRejected);
  const activeText = useRef(activeTextTargetId);
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
  editText.current = onEditText;
  rejectSelection.current = onTextSelectionRejected;
  activeText.current = activeTextTargetId;
  const host = useRef<HTMLDivElement>(null),
    generation = useRef(0);
  const [zoom, setZoom] = useState(() => {
    if (initialZoom) return initialZoom;
    try {
      const value = localStorage.getItem("aijob:native-preview-zoom");
      return value && ["width", "actual", "page"].includes(value) ? value : "width";
    } catch {
      return "width";
    }
  });
  const [blob, setBlob] = useState<Blob | null>(null),
    [status, setStatus] = useState("正在生成预览…");
  const [pageCount, setPageCount] = useState<number | null>(null);
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
    setPageCount(null);
    setStatus("正在显示纸张…");
    let active = true;
    const displayedGeneration = generation.current;
    let loading: ReturnType<typeof pdfjs.getDocument> | undefined;
    void (async () => {
      loading = pdfjs.getDocument({
        data: new Uint8Array(await blob.arrayBuffer()),
      });
      const pdf = await loading.promise;
      const anchors =
        editItem.current || editText.current
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
        const pageAnchors = anchors.filter((value) => value.page === index);
        const textTargets = editText.current ? nativeTextTargets(pageAnchors) : [];
        const fieldOutlines = new Map<string, HTMLDivElement>();
        const targetButtons = new Map<string, HTMLButtonElement>();
        const fieldAtEvent = (event: MouseEvent | PointerEvent) => {
          const rect = surface.getBoundingClientRect();
          const x = ((event.clientX - rect.left) * canvas.width) / rect.width / viewport.scale;
          const y = ((event.clientY - rect.top) * canvas.height) / rect.height / viewport.scale;
          return nativeTextAtPoint(textTargets, x, y) ?? nativeFieldAtPoint(pageAnchors, x, y);
        };
        let pointerStart: { x: number; y: number } | null = null;
        surface.onpointerdown = (event) => {
          pointerStart = { x: event.clientX, y: event.clientY };
        };
        surface.onpointermove = (event) => {
          const buttonTarget =
            event.target instanceof Element
              ? event.target.closest<HTMLElement>(".native-pdf-text-anchor")?.dataset
                  .nativeTextTarget
              : undefined;
          const target =
            (buttonTarget
              ? textTargets.find((value) => value.targetId === buttonTarget)
              : undefined) ?? fieldAtEvent(event);
          for (const [id, outline] of fieldOutlines)
            outline.classList.toggle("is-hovered", id === target?.id);
          for (const [id, button] of targetButtons)
            button.classList.toggle("is-hovered", id === target?.id);
        };
        surface.onpointerleave = () => {
          for (const outline of fieldOutlines.values()) outline.classList.remove("is-hovered");
          for (const button of targetButtons.values()) button.classList.remove("is-hovered");
        };
        surface.onpointerup = () => {
          const selected = window.getSelection();
          if (
            !editText.current ||
            !textTargets.length ||
            !selected ||
            selected.isCollapsed ||
            selected.rangeCount !== 1
          )
            return;
          const range = selected.getRangeAt(0);
          if (!text.contains(range.startContainer) || !text.contains(range.endContainer)) {
            if (text.contains(range.startContainer) || text.contains(range.endContainer))
              rejectSelection.current?.("请一次选择同一个文字块中的内容，跨块选区不会修改排版。");
            return;
          }
          const bounds = surface.getBoundingClientRect();
          const factor = canvas.width / bounds.width / viewport.scale;
          const rectangles = [...range.getClientRects()].map((rect) => ({
            x: (rect.left - bounds.left) * factor,
            y: (rect.top - bounds.top) * factor,
            width: rect.width * factor,
            height: rect.height * factor,
          }));
          const selection = nativeTextSelectionFromRects(
            textTargets,
            selected.toString(),
            rectangles,
          );
          if (selection) editText.current(selection);
          else
            rejectSelection.current?.(
              "无法准确定位这段选区。请先点选一个文字块，再在左侧选字区选取；当前选区未应用任何格式。",
            );
        };
        surface.onclick = (event) => {
          if (
            !pointerStart ||
            Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4 ||
            window.getSelection()?.isCollapsed === false
          )
            return;
          const target = fieldAtEvent(event);
          if (target && isNativeTextTarget(target)) editText.current?.({ target });
          else if (target) editItem.current?.(target.id);
        };
        const actionableAnchors = textTargets.length
          ? textTargets
          : pageAnchors.filter((anchor) => anchor.kind !== "text");
        for (const anchor of actionableAnchors) {
          const x = anchor.x * viewport.scale,
            y = anchor.y * viewport.scale,
            button = window.document.createElement("button");
          button.type = "button";
          button.className = "native-pdf-edit-anchor";
          button.textContent = "↗";
          const label =
            anchor.kind === "text" ? `调整${anchor.label}排版` : nativeFieldAnchorLabel(anchor);
          button.setAttribute("aria-label", label);
          button.title = label;
          button.style.left = `${Math.max(0, x - 34)}px`;
          button.style.top = `${y}px`;
          button.onclick = (event) => {
            event.stopPropagation();
            if (isNativeTextTarget(anchor)) editText.current?.({ target: anchor });
            else editItem.current?.(anchor.id);
          };
          if (anchor.kind === "field" || anchor.kind === "text") {
            const outline = window.document.createElement("div");
            outline.className = "native-pdf-field-outline";
            outline.setAttribute("aria-hidden", "true");
            outline.style.left = `${x}px`;
            outline.style.top = `${y}px`;
            outline.style.width = `${(anchor.width ?? 0) * viewport.scale}px`;
            outline.style.height = `${(anchor.height ?? 0) * viewport.scale}px`;
            fieldOutlines.set(anchor.id, outline);
            surface.append(outline);
            button.classList.add(
              anchor.kind === "text" ? "native-pdf-text-anchor" : "native-pdf-field-anchor",
            );
            if (anchor.kind === "text") {
              outline.dataset.nativeTextTarget = anchor.targetId;
              button.dataset.nativeTextTarget = anchor.targetId;
              outline.classList.toggle("is-active", activeText.current === anchor.targetId);
              button.classList.toggle("is-active", activeText.current === anchor.targetId);
              targetButtons.set(anchor.id, button);
            }
            button.onfocus = () => outline.classList.add("is-hovered");
            button.onblur = () => outline.classList.remove("is-hovered");
          }
          surface.append(button);
        }
        fragment.append(sheet);
      }
      if (active && host.current) {
        host.current.replaceChildren(fragment);
        setPageCount(pdf.numPages);
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
    for (const element of host.current?.querySelectorAll<HTMLElement>(
      "[data-native-text-target]",
    ) ?? [])
      element.classList.toggle(
        "is-active",
        element.dataset.nativeTextTarget === activeTextTargetId,
      );
  }, [activeTextTargetId]);
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
  const displayFailed = status.startsWith("纸张显示失败：");
  const displayMessage = displayFailed
    ? status
    : pageCount === null && (blob || fixedBlob)
      ? "正在显示完整纸张…"
      : pendingMessage || status;
  return (
    <section className={`native-paper${fillContainer ? " native-paper-fill" : ""}`}>
      <header>
        <strong>简历预览{pageCount ? ` · ${pageCount} 页` : ""}</strong>
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
            <option value="actual">100% · 阅读细节</option>
          </select>
        </label>
        <output aria-live="polite">{displayMessage}</output>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            更新预览
          </button>
        )}
      </header>
      <div
        ref={host}
        className="native-pages"
        aria-busy={pageCount === null && !displayFailed}
        data-empty-message={pageCount === null ? displayMessage : undefined}
      />
    </section>
  );
}
