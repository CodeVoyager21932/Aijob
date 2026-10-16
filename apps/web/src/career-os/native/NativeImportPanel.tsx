import {
  hasNativeResumeContent,
  type NativeImportBlock,
  type NativeImportResult,
  type NativeResumeDocument,
  parseNativeResumeDocument,
} from "@aijob/resume-core";
import { useEffect, useRef, useState } from "react";
import { apiDownload, apiRequest, createIdempotencyKey } from "../../api/client";
import { FileDropzone } from "../ui/FileDropzone";
import { NativeImportCorrection } from "./NativeImportCorrection";

interface ImportRecord {
  originalId: string;
  filename: string;
  status: string;
  failureCode: string | null;
  parsed: null | {
    schemaVersion: string;
    blocks: NativeImportBlock[];
    warnings: string[];
    result: NativeImportResult;
  };
}
export function NativeImportPanel({
  documentId,
  revision,
  currentDocument,
  close,
  apply,
  applyCorrection,
  openDraft,
  initialOriginalId,
}: {
  documentId: string;
  revision: number;
  currentDocument: NativeResumeDocument;
  close: () => void;
  apply: (document: NativeResumeDocument, savedRevision?: number) => void;
  applyCorrection: (document: NativeResumeDocument) => void;
  openDraft: (documentId: string) => void;
  initialOriginalId?: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    alive = useRef(true),
    poll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);
  const [pastedText, setPastedText] = useState("");
  const [replaceCurrent, setReplaceCurrent] = useState(false);
  const hasContent = hasNativeResumeContent(currentDocument);
  const useNewDraft = hasContent && !replaceCurrent;
  const [originals, setOriginals] = useState<{ id: string; filename: string; status: string }[]>(
      [],
    ),
    [selected, setSelected] = useState<ImportRecord | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const root = `/v2/resume-documents/${documentId}/native/imports`;
  async function targetDraft(title: string) {
    return useNewDraft
      ? apiRequest<{
          documentId: string;
          revision: number;
          title: string;
          document: NativeResumeDocument;
        }>("/v2/resume-documents/native", {
          method: "POST",
          body: { title: title.slice(0, 200) || "导入的简历" },
          idempotencyKey: createIdempotencyKey(),
        })
      : { documentId, revision, title: "", document: currentDocument };
  }
  const inspectRef = useRef(inspect);
  inspectRef.current = inspect;
  useEffect(() => {
    alive.current = true;
    const focus = window.document.activeElement;
    dialog.current?.showModal();
    void apiRequest<typeof originals>(root)
      .then((value) => {
        if (alive.current) {
          setOriginals(value);
          if (initialOriginalId) {
            setBusy(true);
            void inspectRef.current(initialOriginalId, true);
          }
        }
      })
      .catch(() => {
        if (alive.current) setError("导入记录读取失败，请重新打开。");
      });
    return () => {
      alive.current = false;
      sequence.current++;
      if (poll.current) clearTimeout(poll.current);
      if (focus instanceof HTMLElement) focus.focus();
    };
  }, [root, initialOriginalId]);
  async function inspect(
    id: string,
    followUpload = false,
    request = ++sequence.current,
    targetDocumentId = documentId,
  ) {
    try {
      const value = await apiRequest<ImportRecord>(
        `/v2/resume-documents/${targetDocumentId}/native/imports/${id}`,
      );
      if (!alive.current || sequence.current !== request) return;
      setSelected(value);
      if (value.status === "queued") {
        poll.current = setTimeout(
          () => void inspect(id, followUpload, request, targetDocumentId),
          1500,
        );
        return;
      }
      setBusy(false);
      if (value.status === "failed") {
        setError("这份文件暂时无法解析。原件仍可下载，可以更换文件后重试。");
        return;
      }
      if (value.status === "succeeded" && followUpload) {
        if (targetDocumentId !== documentId) {
          openDraft(targetDocumentId);
          return;
        }
        const saved = await apiRequest<{ document: NativeResumeDocument; revision: number }>(
          `/v2/resume-documents/${documentId}/native`,
        );
        if (alive.current && sequence.current === request) {
          apply(parseNativeResumeDocument(saved.document), saved.revision);
          close();
        }
      }
    } catch (e) {
      if (alive.current) {
        setBusy(false);
        setError(e instanceof Error ? e.message : "读取失败，请重试。");
      }
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 5 * 1024 * 1024 || !/\.(pdf|docx)$/i.test(file.name))
        throw new Error("请选择不超过 5 MB 的 PDF 或 DOCX。");
      const target = await targetDraft(file.name.replace(/\.(pdf|docx)$/i, ""));
      const form = new FormData();
      form.append("file", file);
      const value = await apiRequest<{ originalId: string }>(
        `/v2/resume-documents/${target.documentId}/native/imports?expectedRevision=${target.revision}`,
        { method: "POST", body: form, idempotencyKey: createIdempotencyKey() },
      );
      if (alive.current) {
        if (target.documentId !== documentId) {
          await inspect(value.originalId, true, ++sequence.current, target.documentId);
          return;
        }
        setOriginals(await apiRequest<typeof originals>(root));
        await inspect(value.originalId, true);
      }
    } catch (e) {
      if (alive.current) {
        setBusy(false);
        setError(e instanceof Error ? e.message : "上传未完成。");
      }
    }
  }
  async function importText() {
    setBusy(true);
    setError("");
    try {
      const target = await targetDraft("文本导入的简历");
      const value = await apiRequest<{ originalId: string }>(
        `/v2/resume-documents/${target.documentId}/native/imports/text`,
        {
          method: "POST",
          body: { text: pastedText, expectedRevision: target.revision },
          idempotencyKey: createIdempotencyKey(),
        },
      );
      if (alive.current) {
        if (target.documentId !== documentId) {
          await inspect(value.originalId, true, ++sequence.current, target.documentId);
          return;
        }
        setOriginals(await apiRequest<typeof originals>(root));
        await inspect(value.originalId, true);
      }
    } catch (failure) {
      if (alive.current) {
        setBusy(false);
        setError(failure instanceof Error ? failure.message : "整理未完成，粘贴内容仍保留。");
      }
    }
  }
  async function adoptSelected() {
    if (!selected?.parsed) return;
    setBusy(true);
    setError("");
    try {
      const target = await targetDraft(selected.filename.replace(/\.[^.]+$/, ""));
      const parsed = parseNativeResumeDocument(selected.parsed.result.document);
      parsed.sourceBindings ??= selected.parsed.result.mappings.map((mapping) => ({
        originalId: selected.originalId,
        ...mapping,
      }));
      if (target.documentId === documentId) {
        apply(parsed);
        close();
        return;
      }
      parsed.data.metadata = structuredClone(target.document.data.metadata);
      if (target.document.presentation)
        parsed.presentation = structuredClone(target.document.presentation);
      const sectionIds = new Set(
        parsed.data.metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]),
      );
      for (const section of parsed.data.customSections)
        if (!sectionIds.has(section.id))
          parsed.data.metadata.layout.pages[0]?.main.push(section.id);
      await apiRequest(`/v2/resume-documents/${target.documentId}/native`, {
        method: "PUT",
        body: { expectedRevision: target.revision, title: target.title, document: parsed },
        idempotencyKey: createIdempotencyKey(),
      });
      if (alive.current) {
        setBusy(false);
        openDraft(target.documentId);
      }
    } catch (failure) {
      if (alive.current) {
        setBusy(false);
        setError(failure instanceof Error ? failure.message : "采用未完成，当前稿仍保留。");
      }
    }
  }
  async function download(id: string) {
    try {
      const file = await apiDownload(`/v1/resume-originals/${id}`);
      if (!alive.current) return;
      const url = URL.createObjectURL(file.blob),
        link = window.document.createElement("a");
      link.href = url;
      link.download = file.fileName ?? "简历原件";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError("下载未完成，请重试。");
    }
  }
  async function remove(id: string) {
    try {
      await apiRequest(`/v1/resume-originals/${id}`, { method: "DELETE" });
      if (!alive.current) return;
      if (selected?.originalId === id) {
        sequence.current++;
        if (poll.current) clearTimeout(poll.current);
        setSelected(null);
        setBusy(false);
      }
      setOriginals((items) => items.filter((item) => item.id !== id));
    } catch {
      if (alive.current) setError("原件删除未完成，请重试。");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="native-template-dialog native-import-dialog"
      aria-labelledby="native-import-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <h2 id="native-import-title">导入简历</h2>
          <p>识别教育、经历和技能后直接编辑；原件可随时找回。</p>
        </div>
        <button type="button" onClick={close}>
          返回编辑
        </button>
      </header>
      {hasContent && (
        <label>
          导入到
          <select
            value={replaceCurrent ? "current" : "new"}
            disabled={busy}
            onChange={(event) => setReplaceCurrent(event.target.value === "current")}
          >
            <option value="new">新稿（保留当前稿）</option>
            <option value="current">当前稿（采用时替换正文，可撤销）</option>
          </select>
        </label>
      )}
      <div className="native-import-content">
        <FileDropzone disabled={busy} onError={setError} onFile={(file) => void upload(file)} />
        <details className="native-paste-import">
          <summary>粘贴已有简历文本</summary>
          <label>
            简历文本
            <textarea
              rows={8}
              maxLength={100000}
              value={pastedText}
              onChange={(event) => setPastedText(event.target.value)}
              disabled={busy}
              placeholder="保留标题和换行，如教育经历、项目经历。"
            />
          </label>
          <button
            type="button"
            disabled={busy || !pastedText.trim()}
            onClick={() => void importText()}
          >
            整理文本并开始编辑
          </button>
        </details>
        {busy && <output>正在整理文件，可以关闭后继续编辑，进度保留在导入记录中。</output>}
        {error && <p role="alert">{error}</p>}
        {originals.length > 0 && (
          <div className="native-import-columns">
            <nav aria-label="导入记录">
              {originals.map((item) => (
                <div key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (poll.current) clearTimeout(poll.current);
                      void inspect(item.id);
                    }}
                    aria-pressed={selected?.originalId === item.id}
                  >
                    {item.filename}
                  </button>
                  <button type="button" onClick={() => void download(item.id)}>
                    下载原件
                  </button>
                  <button type="button" onClick={() => void remove(item.id)}>
                    删除原件
                  </button>
                </div>
              ))}
            </nav>
            <section className="native-import-source">
              {selected?.parsed?.schemaVersion === "native-import-v1" ? (
                <>
                  <h3>文件中的内容</h3>
                  <p>
                    {selected.parsed.result.quality === "structured"
                      ? "已按模块整理。"
                      : selected.parsed.result.quality === "unstructured"
                        ? "未能可靠识别经历模块，可读取的文字已放在待整理内容。可以在编辑区继续写，也可按需调整个别条目。"
                        : "已保留原文；部分条目边界或补充信息仍需要调整，可在编辑区直接修改。"}
                  </p>
                  {selected.parsed.result.quality === "unstructured" &&
                    selected.parsed.blocks.some((block) => block.source.kind === "pdf") &&
                    !selected.parsed.blocks.some((block) =>
                      /[\p{Script=Han}]/u.test(block.text),
                    ) && (
                      <p>
                        如果原 PDF
                        有中文，这份文件的可复制文字层可能未提供中文映射，自动整理无法还原遗漏的字。建议上传原始
                        DOCX，或粘贴可复制的简历文字。
                      </p>
                    )}
                  <button type="button" disabled={busy} onClick={() => void adoptSelected()}>
                    {useNewDraft ? "用识别内容创建新稿" : "将识别内容放入当前稿 · 可撤销"}
                  </button>
                  <p>
                    {useNewDraft
                      ? "新稿使用系统模板，当前稿和原件均保留。"
                      : "采用会替换当前稿的正文，保留当前模板。"}
                  </p>
                  <NativeImportCorrection
                    key={selected.originalId}
                    currentDocument={currentDocument}
                    originalId={selected.originalId}
                    blocks={selected.parsed.blocks}
                    apply={applyCorrection}
                  />
                </>
              ) : (
                <p>
                  {selected?.status === "queued"
                    ? "正在解析…"
                    : "选择一份原件查看，或上传新的文件。"}
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </dialog>
  );
}
