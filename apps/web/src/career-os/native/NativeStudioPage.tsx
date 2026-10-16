import {
  applyNativeTemplate,
  hasVisibleNativeResumeContent,
  type NativeResumeDocument,
  parseNativeResumeDocument,
} from "@aijob/resume-core";
import type { NativeItemAnchor } from "@aijob/resume-renderer/browser";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getResumeDocument } from "../../api/career-os";
import {
  apiDownload,
  apiRequest,
  createIdempotencyKey,
  currentWorkspaceOwnerKey,
  ProductApiError,
  subscribeToSessionBoundary,
} from "../../api/client";
import { NativeAssistant } from "./NativeAssistant";
import { NativeContentEditor } from "./NativeContentEditor";
import { NativeExportPreview } from "./NativeExportPreview";
import { NativeImportPanel } from "./NativeImportPanel";
import { NativeLayoutPanel } from "./NativeLayoutPanel";
import { NativeLegacyUpgrade } from "./NativeLegacyUpgrade";
import { NativeMaterials } from "./NativeMaterials";
import { NativePdfPreview } from "./NativePdfPreview";
import { NativeRecoveryContent } from "./NativeRecoveryContent";
import { NativeSplit } from "./NativeSplit";
import { NativeTemplateGallery } from "./NativeTemplateGallery";
import { NativeTextLayoutPanel } from "./NativeTextLayoutPanel";
import { NativeVersionHistory } from "./NativeVersionHistory";
import { downloadCurrentPreview } from "./preview-download";
import { type NativeTextSelection, nativeTextTargets } from "./preview-text-targets";
import {
  clearNativeRecoveries,
  type NativeRecovery,
  nativeRecoveryKey,
  readNativeRecovery,
} from "./recovery";
import "./native-studio.css";

interface Draft {
  documentId: string;
  caseId?: string | null;
  revision: number;
  title: string;
  document: NativeResumeDocument;
  updatedAt: string;
  recovered?: boolean;
}
interface SavedPreview {
  draftRevision: number;
  requestGeneration: number;
  artifact: { id: string; state: string };
  anchors: NativeItemAnchor[];
  blob: Blob;
  pageCount: number;
  fit?: {
    level: number;
    pageCount: number;
    bodyFontSize: number;
    overflowItemIds: string[];
  } | null;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作未完成，输入仍保留。";
const LegacyEditor = lazy(() =>
  import("../studio/ResumeStudioEditor").then((module) => ({ default: module.ResumeStudioEditor })),
);

export function NativeStudioPage() {
  const { documentId } = useParams();
  // Reset loading, recovery and editor state in the route commit, before passive effects run.
  return <NativeStudioDocumentPage key={documentId ?? "missing"} documentId={documentId} />;
}

function NativeStudioDocumentPage({ documentId }: { documentId: string | undefined }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null),
    [error, setError] = useState(""),
    [legacy, setLegacy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [recovery, setRecovery] = useState<NativeRecovery | null>(null);
  const [inspectLocal, setInspectLocal] = useState(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reloads the same document after a failed request.
  useEffect(() => {
    let active = true;
    setDraft(null);
    setRecovery(null);
    setError("");
    setLegacy(false);
    if (documentId)
      void apiRequest<Draft>(`/v2/resume-documents/${documentId}/native`)
        .then((value) => {
          if (value.documentId !== documentId)
            throw new Error("简历加载结果与当前地址不一致，请重新打开。");
          parseNativeResumeDocument(value.document);
          if (active) {
            try {
              setRecovery(
                readNativeRecovery(
                  localStorage,
                  nativeRecoveryKey(currentWorkspaceOwnerKey(), value.documentId),
                  { baseRevision: value.revision, document: value.document, title: value.title },
                ),
              );
            } catch {
              /* Browser storage may be unavailable. */
            }
            setDraft(value);
          }
        })
        .catch(async (e) => {
          if (!active) return;
          if (e instanceof ProductApiError && e.code === "RESUME_CORE_VERSION_MISMATCH") {
            setLegacy(true);
            return;
          }
          // Older documents can predate the editable draft. Verify ownership before
          // delegating to the legacy reader, which also guards against native data.
          if (e instanceof ProductApiError && e.status === 404) {
            try {
              await getResumeDocument(documentId);
              if (active) setLegacy(true);
              return;
            } catch {
              /* Retain the original not-found result. */
            }
          }
          if (active) setError(message(e));
        });
    return () => {
      active = false;
    };
  }, [documentId, retry]);
  useEffect(
    () =>
      subscribeToSessionBoundary(() => {
        setDraft(null);
        setRecovery(null);
        setLegacy(false);
        try {
          clearNativeRecoveries(localStorage);
        } catch {
          /* Storage may be disabled. */
        }
        navigate("/resumes", { replace: true });
      }),
    [navigate],
  );
  if (legacy && documentId)
    return (
      <>
        <div className="native-legacy-notice">
          <span>这份稿件保留原来的编辑与排版。</span>
          <NativeLegacyUpgrade documentId={documentId} />
        </div>
        <Suspense fallback={<output>正在打开简历…</output>}>
          <LegacyEditor documentId={documentId} />
        </Suspense>
      </>
    );
  const routeDraft = draft?.documentId === documentId ? draft : null;
  if (routeDraft && recovery)
    return (
      <section className="native-start">
        <h1>找到了上次未同步的草稿</h1>
        <p>
          {recovery.baseRevision === routeDraft.revision
            ? "可以从中断的位置继续编辑。"
            : "服务器版本也有更新，请查看两份内容后选择；恢复本机草稿后会保存为新的修订。"}
        </p>
        <button type="button" onClick={() => setInspectLocal(true)} aria-pressed={inspectLocal}>
          查看本机草稿
        </button>
        <button type="button" onClick={() => setInspectLocal(false)} aria-pressed={!inspectLocal}>
          查看服务器版本
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft({
              ...routeDraft,
              document: recovery.document,
              title: recovery.title ?? routeDraft.title,
              recovered: true,
            });
            setRecovery(null);
          }}
        >
          恢复本机草稿并继续
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              const key = nativeRecoveryKey(currentWorkspaceOwnerKey(), routeDraft.documentId);
              if (key) localStorage.removeItem(key);
            } catch {}
            setRecovery(null);
          }}
        >
          使用服务器版本
        </button>
        <div style={{ height: "65vh" }}>
          <NativeRecoveryContent
            document={inspectLocal ? recovery.document : routeDraft.document}
          />
        </div>
      </section>
    );
  if (routeDraft) return <NativeEditor key={routeDraft.documentId} initial={routeDraft} />;
  return (
    <section className="native-start">
      <h1>{error ? "暂时无法打开这份简历" : "正在打开简历…"}</h1>
      {error && <p role="alert">{error}</p>}
      {error && (
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          重新打开
        </button>
      )}
      <Link to="/resumes">返回我的简历</Link>
    </section>
  );
}

function NativeEditor({ initial }: { initial: Draft }) {
  const sessionDocumentId = useRef(initial.documentId).current;
  const formRef = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const [moreTools, setMoreTools] = useState(false);
  const navigate = useNavigate();
  const [title, setTitle] = useState(initial.title);
  const currentTitle = useRef(initial.title);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [textLayoutOpen, setTextLayoutOpen] = useState(false);
  const [textSelection, setTextSelection] = useState<NativeTextSelection | null>(null);
  const [textSelectionNotice, setTextSelectionNotice] = useState("");
  const [focusItem, setFocusItem] = useState<{ id: string; request: number } | null>(null);
  const [importsOpen, setImportsOpen] = useState(() => params.get("tool") === "import");
  const [initialOriginalId, setInitialOriginalId] = useState(() => params.get("originalId"));
  useEffect(() => {
    if (params.get("tool") !== "import") return;
    const next = new URLSearchParams(params);
    next.delete("tool");
    next.delete("originalId");
    setParams(next, { replace: true });
  }, [params, setParams]);
  const [importNotice, setImportNotice] = useState("");
  const importAfterSave = useRef(false);
  const materialAfterSave = useRef(false);
  const assistantAfterSave = useRef(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const checkpointAfterSave = useRef(false);
  const copyAfterSave = useRef(false);
  const copyRequest = useRef<{ fingerprint: string; key: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const leaveTarget = useRef("/resumes");
  const leaveAfterSave = useRef(false);
  const exportAfterSave = useRef(false);
  const exportFormat = useRef<"pdf" | "docx">("pdf");
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<{
    id: string;
    revision: number;
    format: "pdf" | "docx";
  } | null>(null);
  const [exportPreview, setExportPreview] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<SavedPreview | null>(null);
  const previewRef = useRef<SavedPreview | null>(null);
  const previewRequest = useRef<{
    revision: number;
    generation: number;
    promise: Promise<SavedPreview>;
  } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewRetry, setPreviewRetry] = useState(0);
  const saveWaiters = useRef<Array<() => void>>([]);
  const [document, setDocument] = useState(initial.document),
    [status, setStatus] = useState(initial.recovered ? "已恢复，等待保存" : "已保存"),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"edit" | "preview">("edit");
  const current = useRef(initial.document),
    revision = useRef(initial.revision),
    generation = useRef(initial.recovered ? 1 : 0),
    savedGeneration = useRef(0),
    running = useRef(false),
    alive = useRef(true);
  const recoveryKey = useRef(nativeRecoveryKey(currentWorkspaceOwnerKey(), sessionDocumentId));
  const persistRecovery = useCallback(() => {
    if (!alive.current || !recoveryKey.current) return;
    try {
      if (savedGeneration.current === generation.current)
        localStorage.removeItem(recoveryKey.current);
      else
        localStorage.setItem(
          recoveryKey.current,
          JSON.stringify({
            baseRevision: revision.current,
            document: current.current,
            title: currentTitle.current,
          }),
        );
    } catch {
      /* Saving to the server remains available when browser storage is full. */
    }
  }, []);
  const history = useRef<{ document: NativeResumeDocument; title: string }[]>([]),
    future = useRef<{ document: NativeResumeDocument; title: string }[]>([]),
    lastAction = useRef({ key: "", time: 0 });
  const retry = useRef<{
    generation: number;
    expectedRevision: number;
    document: NativeResumeDocument;
    title: string;
    key: string;
  } | null>(null);
  useLayoutEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeToSessionBoundary(() => {
      alive.current = false;
      try {
        clearNativeRecoveries(localStorage);
      } catch {}
    });
    return () => {
      persistRecovery();
      alive.current = false;
      unsubscribe();
    };
  }, [persistRecovery]);
  function edit(key: string, change: (draft: NativeResumeDocument) => void) {
    if (!alive.current) return;
    const next = structuredClone(current.current);
    change(next);
    if (/^(add|duplicate|insert):/.test(key)) {
      const ids = (value: NativeResumeDocument) =>
        [...Object.values(value.data.sections), ...value.data.customSections].flatMap((section) =>
          section.items.map((item) => item.id),
        );
      const before = new Set(ids(current.current));
      const created = ids(next).find((id) => !before.has(id));
      if (created)
        requestAnimationFrame(() => {
          const entry = window.document.querySelector<HTMLDetailsElement>(
            `[data-native-item="${CSS.escape(created)}"]`,
          );
          if (entry) entry.open = true;
        });
    }
    if (lastAction.current.key !== key || Date.now() - lastAction.current.time > 750) {
      history.current.push({ document: current.current, title: currentTitle.current });
      if (history.current.length > 50) history.current.shift();
    }
    lastAction.current = { key, time: Date.now() };
    future.current = [];
    current.current = next;
    generation.current++;
    persistRecovery();
    setDocument(next);
    setStatus("尚未保存");
  }
  function travel(undo: boolean) {
    if (!alive.current) return;
    const from = undo ? history.current : future.current,
      to = undo ? future.current : history.current;
    const next = from.pop();
    if (!next) return;
    to.push({ document: current.current, title: currentTitle.current });
    current.current = next.document;
    currentTitle.current = next.title;
    setTitle(next.title);
    generation.current++;
    persistRecovery();
    lastAction.current = { key: "", time: 0 };
    setDocument(next.document);
    setStatus("尚未保存");
  }
  async function flush() {
    if (!alive.current) return;
    if (running.current) {
      await new Promise<void>((resolve) => saveWaiters.current.push(resolve));
      return;
    }
    running.current = true;
    setError("");
    try {
      while (alive.current && (savedGeneration.current < generation.current || retry.current)) {
        const job = retry.current ?? {
          generation: generation.current,
          expectedRevision: revision.current,
          document: structuredClone(current.current),
          title: currentTitle.current,
          key: createIdempotencyKey(),
        };
        retry.current = job;
        setStatus("正在保存…");
        const saved = await apiRequest<Draft>(`/v2/resume-documents/${sessionDocumentId}/native`, {
          method: "PUT",
          body: {
            expectedRevision: job.expectedRevision,
            title: job.title,
            document: job.document,
          },
          idempotencyKey: job.key,
        });
        if (!alive.current) return;
        revision.current = saved.revision;
        savedGeneration.current = job.generation;
        retry.current = null;
        persistRecovery();
      }
      if (alive.current) setStatus("已保存");
    } catch (e) {
      importAfterSave.current = false;
      checkpointAfterSave.current = false;
      copyAfterSave.current = false;
      leaveAfterSave.current = false;
      exportAfterSave.current = false;
      setExporting(false);
      assistantAfterSave.current = false;
      materialAfterSave.current = false;
      if (alive.current) {
        setStatus("保存未完成");
        setError(message(e));
      }
    } finally {
      running.current = false;
      for (const resolve of saveWaiters.current.splice(0)) resolve();
      if (
        alive.current &&
        assistantAfterSave.current &&
        !retry.current &&
        savedGeneration.current === generation.current
      ) {
        assistantAfterSave.current = false;
        setAssistantOpen(true);
      }
      if (
        alive.current &&
        materialAfterSave.current &&
        !retry.current &&
        savedGeneration.current === generation.current
      ) {
        materialAfterSave.current = false;
        setMaterialsOpen(true);
      }
      if (
        alive.current &&
        importAfterSave.current &&
        !retry.current &&
        savedGeneration.current === generation.current
      ) {
        importAfterSave.current = false;
        setImportsOpen(true);
      }
      if (
        alive.current &&
        copyAfterSave.current &&
        !retry.current &&
        savedGeneration.current === generation.current
      ) {
        copyAfterSave.current = false;
        void (async () => {
          const pair = await apiRequest<{ contentRevisionId: string; layoutRevisionId: string }>(
            `/v2/resume-documents/${sessionDocumentId}/native/checkpoint`,
            { method: "POST", body: { expectedRevision: revision.current } },
          );
          const fingerprint = JSON.stringify(pair);
          if (copyRequest.current?.fingerprint !== fingerprint)
            copyRequest.current = { fingerprint, key: createIdempotencyKey() };
          const copied = await apiRequest<Draft>(
            `/v2/resume-documents/${sessionDocumentId}/native/copies`,
            {
              method: "POST",
              body: { ...pair, title: `${currentTitle.current} · 方向稿`.slice(0, 200) },
              idempotencyKey: copyRequest.current.key,
            },
          );
          if (alive.current) {
            copyRequest.current = null;
            setCopiedId(copied.documentId);
          }
        })().catch((e) => {
          if (alive.current) setError(message(e));
        });
      }
      if (
        alive.current &&
        checkpointAfterSave.current &&
        !retry.current &&
        savedGeneration.current === generation.current
      ) {
        checkpointAfterSave.current = false;
        void apiRequest(`/v2/resume-documents/${sessionDocumentId}/native/checkpoint`, {
          method: "POST",
          body: { expectedRevision: revision.current },
        })
          .then(() => {
            if (alive.current) setHistoryOpen(true);
          })
          .catch((e) => {
            if (alive.current) setError(message(e));
          });
      }
      if (
        alive.current &&
        exportAfterSave.current &&
        !retry.current &&
        savedGeneration.current === generation.current
      ) {
        exportAfterSave.current = false;
        void exportSaved(revision.current, exportFormat.current);
      }
      if (
        alive.current &&
        leaveAfterSave.current &&
        !retry.current &&
        savedGeneration.current === generation.current
      ) {
        leaveAfterSave.current = false;
        navigate(leaveTarget.current);
      }
    }
  }
  const flushRef = useRef(flush);
  async function ensurePreview(targetRevision: number, targetGeneration: number, force = false) {
    const cached = previewRef.current;
    if (cached?.draftRevision === targetRevision && cached.requestGeneration === targetGeneration) {
      if (!force) return cached;
      previewRef.current = null;
    }
    const pending = previewRequest.current;
    if (pending?.revision === targetRevision && pending.generation === targetGeneration)
      return pending.promise;
    const promise = (async () => {
      const result = await apiRequest<Omit<SavedPreview, "blob">>(
        `/v2/resume-documents/${sessionDocumentId}/native/preview`,
        {
          method: "POST",
          body: { expectedDraftRevision: targetRevision, requestGeneration: targetGeneration },
          idempotencyKey: createIdempotencyKey(),
        },
      );
      if (result.artifact.state !== "ready") throw new Error("这份预览仍在生成，请稍后更新预览。");
      const { blob } = await apiDownload(
        `/v2/resume-exports/${result.artifact.id}/file?preview=true`,
      );
      const next = { ...result, blob };
      if (
        alive.current &&
        generation.current === result.requestGeneration &&
        revision.current === result.draftRevision &&
        savedGeneration.current === generation.current
      ) {
        previewRef.current = next;
        setPreview(next);
        setPreviewError("");
      }
      return next;
    })();
    previewRequest.current = { revision: targetRevision, generation: targetGeneration, promise };
    try {
      return await promise;
    } finally {
      if (previewRequest.current?.promise === promise) previewRequest.current = null;
    }
  }
  const ensurePreviewRef = useRef(ensurePreview);
  ensurePreviewRef.current = ensurePreview;
  async function downloadArtifact(id: string, currentFileName?: string) {
    const expectedGeneration = generation.current;
    const file = await apiDownload(`/v2/resume-exports/${id}/file`);
    if (!alive.current) return;
    if (generation.current !== expectedGeneration) throw new Error("内容已更新，请下载当前稿。");
    const url = URL.createObjectURL(file.blob),
      link = window.document.createElement("a");
    link.href = url;
    link.download = currentFileName ?? file.fileName ?? "Aijob-简历.pdf";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function exportSaved(savedRevision: number, format: "pdf" | "docx") {
    const targetGeneration = savedGeneration.current;
    try {
      if (format === "pdf") {
        const result = await downloadCurrentPreview(
          async (force) => {
            const result = await ensurePreview(savedRevision, targetGeneration, force);
            if (generation.current !== targetGeneration)
              throw new Error("内容刚刚有更新，请等保存完成后下载当前稿。");
            if (result.pageCount !== 1)
              throw new Error(
                "当前排版超出一页。请调整位置、间距或撤销本次格式修改，恢复单页后再下载。内容已保留。",
              );
            return result;
          },
          downloadArtifact,
          currentTitle.current,
        );
        if (!alive.current) return;
        setLastExport({ id: result.artifact.id, revision: savedRevision, format });
        return;
      }
      const pair = await apiRequest<{ contentRevisionId: string; layoutRevisionId: string }>(
        `/v2/resume-documents/${sessionDocumentId}/native/checkpoint`,
        { method: "POST", body: { expectedRevision: savedRevision } },
      );
      const artifact = await apiRequest<{ id: string; state: string }>(
        `/v2/resume-documents/${sessionDocumentId}/native/exports`,
        {
          method: "POST",
          body: { ...pair, format },
          idempotencyKey: createIdempotencyKey(),
        },
      );
      if (!alive.current) return;
      if (artifact.state !== "ready") throw new Error("文件仍在生成，请稍后重试；草稿已保存。");
      if (generation.current !== targetGeneration) throw new Error("内容已更新，请下载当前稿。");
      setLastExport({ id: artifact.id, revision: savedRevision, format });
      await downloadArtifact(artifact.id);
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (alive.current) setExporting(false);
    }
  }
  flushRef.current = flush;
  useEffect(() => {
    const timer = setTimeout(() => {
      if (current.current === document) void flushRef.current();
    }, 700);
    return () => clearTimeout(timer);
  }, [document]);
  // One server artifact supplies both the paper and download. No local PDF render is used here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft values and retry counter intentionally debounce the latest refs.
  useEffect(() => {
    let active = true;
    setPreviewError("");
    const requestGeneration = generation.current;
    const timer = setTimeout(() => {
      void (async () => {
        await flushRef.current();
        if (
          !active ||
          !alive.current ||
          retry.current ||
          savedGeneration.current !== generation.current ||
          requestGeneration !== generation.current
        )
          return;
        try {
          await ensurePreviewRef.current(revision.current, requestGeneration);
        } catch (failure) {
          if (active && requestGeneration === generation.current) setPreviewError(message(failure));
        }
      })();
    }, 900);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [document, title, previewRetry]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (savedGeneration.current < generation.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Delegates undo shortcuts from descendant inputs; the section itself is not a focus target.
    <section
      className="native-studio"
      data-tab={tab}
      onKeyDown={(event) => {
        if (
          event.nativeEvent.isComposing ||
          !(event.ctrlKey || event.metaKey) ||
          (event.target instanceof Element && event.target.closest("dialog, .native-link-editor"))
        )
          return;
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          travel(!event.shiftKey);
        } else if (event.key.toLowerCase() === "y") {
          event.preventDefault();
          travel(false);
        }
      }}
    >
      <NativeAssistant
        open={assistantOpen}
        documentId={sessionDocumentId}
        caseId={initial.caseId}
        revision={revision.current}
        document={document}
        close={() => setAssistantOpen(false)}
        adopted={(savedRevision, value, original) => {
          if (current.current !== original || running.current || retry.current) {
            setError(
              "建议已保存在服务器版本中；你在等待时继续编辑了，当前输入已保留。请通过版本对照后恢复或另存方向稿。",
            );
            return;
          }
          revision.current = savedRevision;
          edit(`assistant:${crypto.randomUUID()}`, (draft) => Object.assign(draft, value));
        }}
      />
      {materialsOpen && (
        <NativeMaterials
          documentId={sessionDocumentId}
          document={document}
          edit={edit}
          close={() => setMaterialsOpen(false)}
        />
      )}
      {historyOpen && (
        <NativeVersionHistory
          documentId={sessionDocumentId}
          close={() => setHistoryOpen(false)}
          restore={(value) =>
            edit(`restore:${crypto.randomUUID()}`, (draft) => Object.assign(draft, value))
          }
        />
      )}
      {importsOpen && (
        <NativeImportPanel
          documentId={sessionDocumentId}
          initialOriginalId={initialOriginalId}
          currentDocument={document}
          applyCorrection={(value) =>
            edit(`correction:${crypto.randomUUID()}`, (draft) => Object.assign(draft, value))
          }
          openDraft={(documentId) => {
            leaveTarget.current = `/resumes/${documentId}?tool=import`;
            leaveAfterSave.current = true;
            void flush();
          }}
          revision={revision.current}
          close={() => {
            setImportsOpen(false);
            setInitialOriginalId(null);
          }}
          apply={(value, savedRevision) => {
            if (savedRevision !== undefined) revision.current = savedRevision;
            edit(`import:${crypto.randomUUID()}`, (draft) => {
              const next = structuredClone(value);
              next.data.metadata = structuredClone(draft.data.metadata);
              if (!next.data.picture.url) next.data.picture = structuredClone(draft.data.picture);
              if (draft.presentation) next.presentation = structuredClone(draft.presentation);
              const ids = new Set(
                next.data.metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]),
              );
              for (const section of next.data.customSections)
                if (!ids.has(section.id)) next.data.metadata.layout.pages[0]?.main.push(section.id);
              Object.assign(draft, next);
            });
            setImportNotice(
              "已放入识别内容。请直接修改不准确的条目；导入与原件中保留完整来源，可撤销本次替换。",
            );
          }}
        />
      )}
      {exportPreview && (
        <NativeExportPreview
          blob={exportPreview}
          document={document}
          close={() => setExportPreview(null)}
        />
      )}
      {templatesOpen && (
        <NativeTemplateGallery
          document={document}
          documentId={sessionDocumentId}
          revision={revision.current}
          close={() => setTemplatesOpen(false)}
          apply={(id) => {
            setTextSelection(null);
            setTextSelectionNotice("");
            edit(`template:${crypto.randomUUID()}`, (draft) => {
              Object.assign(draft, applyNativeTemplate(draft, id));
            });
          }}
        />
      )}
      <header className="native-toolbar">
        <div className="native-document-heading">
          <button
            className="native-back"
            type="button"
            aria-label={initial.caseId ? "返回岗位与投递" : "返回简历列表"}
            title={initial.caseId ? "返回岗位与投递" : "返回简历列表"}
            onClick={() => {
              leaveTarget.current = initial.caseId
                ? `/applications/${initial.caseId}/application`
                : "/resumes";
              leaveAfterSave.current = true;
              void flush();
            }}
          >
            ←
          </button>
          <div>
            <input
              className="native-document-title"
              aria-label="稿件名称"
              value={title}
              maxLength={200}
              onChange={(event) => {
                if (!alive.current) return;
                edit("document-title", () => {});
                currentTitle.current = event.target.value;
                setTitle(event.target.value);
                persistRecovery();
              }}
            />
            <output aria-live="polite">{status === "已保存" ? "✓ 已自动保存" : status}</output>
          </div>
        </div>
        <div className="native-toolbar-actions">
          <div className="native-history-arrows">
            <button
              type="button"
              disabled={!history.current.length}
              onClick={() => travel(true)}
              aria-label="撤销"
              title="撤销（Ctrl+Z）"
            >
              ↶
            </button>
            <button
              type="button"
              disabled={!future.current.length}
              onClick={() => travel(false)}
              aria-label="重做"
              title="重做（Ctrl+Shift+Z）"
            >
              ↷
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              importAfterSave.current = true;
              void flush();
            }}
          >
            导入简历
          </button>
          <button
            type="button"
            onClick={() => {
              void flush().then(() => {
                if (!retry.current && savedGeneration.current === generation.current)
                  setTemplatesOpen(true);
              });
            }}
          >
            模板
          </button>
          <button
            type="button"
            aria-pressed={layoutOpen}
            onClick={() => {
              setLayoutOpen(!layoutOpen);
              setTextLayoutOpen(false);
            }}
          >
            排版
          </button>
          <button
            type="button"
            aria-pressed={textLayoutOpen}
            onClick={() => {
              setTextLayoutOpen(!textLayoutOpen);
              setLayoutOpen(false);
              setTab("edit");
            }}
          >
            局部调整
          </button>
          <button
            type="button"
            onClick={() => {
              assistantAfterSave.current = true;
              void flush();
            }}
          >
            简历助手
          </button>
          <button
            className="native-primary-action"
            type="button"
            disabled={exporting || !hasVisibleNativeResumeContent(document)}
            onClick={() => {
              setExporting(true);
              exportFormat.current = "pdf";
              exportAfterSave.current = true;
              void flush();
            }}
          >
            {exporting ? "正在准备…" : "下载单页 PDF"}
          </button>
          <details
            className="native-overflow"
            open={moreTools}
            onToggle={(event) => setMoreTools(event.currentTarget.open)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setMoreTools(false);
              }
            }}
            onBlur={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
                setMoreTools(false);
            }}
          >
            <summary aria-label="更多简历操作" title="更多操作">
              •••
            </summary>
            <div className="native-overflow-panel">
              <span>内容与版式</span>
              <button
                type="button"
                onClick={() => {
                  setMoreTools(false);
                  materialAfterSave.current = true;
                  void flush();
                }}
              >
                从经历与材料中选取
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoreTools(false);
                  setLayoutOpen((value) => !value);
                }}
              >
                调整排版与模块
              </button>
              <button
                type="button"
                onClick={() => {
                  importAfterSave.current = true;
                  void flush();
                }}
              >
                查看原件与导入纠错
              </button>
              <span>版本管理</span>
              <button
                type="button"
                onClick={() => {
                  setMoreTools(false);
                  checkpointAfterSave.current = true;
                  void flush();
                }}
              >
                保存版本
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoreTools(false);
                  setHistoryOpen(true);
                }}
              >
                历史版本
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoreTools(false);
                  copyAfterSave.current = true;
                  void flush();
                }}
              >
                复制方向稿
              </button>
              {copiedId && (
                <button
                  type="button"
                  onClick={() => {
                    leaveTarget.current = `/resumes/native/${copiedId}`;
                    leaveAfterSave.current = true;
                    void flush();
                  }}
                >
                  打开已复制的方向稿
                </button>
              )}
              <span>其他格式</span>
              <button
                type="button"
                disabled={exporting || !hasVisibleNativeResumeContent(document)}
                onClick={() => {
                  setMoreTools(false);
                  setExporting(true);
                  exportFormat.current = "docx";
                  exportAfterSave.current = true;
                  void flush();
                }}
              >
                下载 DOCX
              </button>
              {lastExport?.format === "pdf" && (
                <button
                  type="button"
                  onClick={() =>
                    void apiDownload(`/v2/resume-exports/${lastExport.id}/file`)
                      .then((file) => {
                        if (alive.current) setExportPreview(file.blob);
                      })
                      .catch((e) => setError(message(e)))
                  }
                >
                  查看上次下载稿
                </button>
              )}
            </div>
          </details>
        </div>
      </header>
      {importNotice && (
        <output className="native-import-notice">
          {importNotice}
          <button type="button" onClick={() => setImportNotice("")}>
            收起
          </button>
        </output>
      )}
      {error && (
        <div role="alert" className="native-error">
          {error}
          {status === "保存未完成" ? (
            <button type="button" onClick={() => void flush()}>
              重试保存
            </button>
          ) : (
            <button type="button" onClick={() => setError("")}>
              知道了
            </button>
          )}
        </div>
      )}
      <nav className="native-tabs" aria-label="编辑或预览">
        <button type="button" aria-pressed={tab === "edit"} onClick={() => setTab("edit")}>
          编辑
        </button>
        <button type="button" aria-pressed={tab === "preview"} onClick={() => setTab("preview")}>
          预览
        </button>
      </nav>
      {hasVisibleNativeResumeContent(document) && (
        <output
          className="native-page-status"
          data-overflow={preview?.requestGeneration === generation.current && preview.pageCount > 1}
        >
          {preview?.requestGeneration !== generation.current ? (
            <span>{previewError || "正在更新单页预览…"}</span>
          ) : preview.pageCount === 1 ? (
            <span>
              当前排版：1 页 A4
              {preview.fit && preview.fit.level > 0
                ? ` · 已自动收紧排版，正文 ${preview.fit.bodyFontSize} pt`
                : ""}{" "}
              · 预览与 PDF 下载一致
            </span>
          ) : (
            <>
              <span>
                当前 {preview.pageCount} 页 · 请调整位置、间距或撤销本次格式修改；内容已保留
              </span>
              <button
                type="button"
                onClick={() => {
                  const id = preview.fit?.overflowItemIds[0];
                  if (id) setFocusItem({ id, request: Date.now() });
                  setTab("edit");
                }}
              >
                定位超页内容
              </button>
            </>
          )}
        </output>
      )}
      <NativeSplit>
        <div className="native-editor-pane" ref={formRef}>
          {layoutOpen && (
            <NativeLayoutPanel document={document} edit={edit} close={() => setLayoutOpen(false)} />
          )}
          {textLayoutOpen ? (
            <NativeTextLayoutPanel
              document={document}
              targets={nativeTextTargets(preview?.anchors ?? [])}
              selection={textSelection}
              edit={edit}
              select={(selection) => {
                setTextSelection(selection);
                setTextSelectionNotice("");
              }}
              selectionNotice={textSelectionNotice}
              close={() => setTextLayoutOpen(false)}
            />
          ) : (
            <NativeContentEditor document={document} edit={edit} focusItem={focusItem} />
          )}
        </div>
        {!hasVisibleNativeResumeContent(document) ? (
          <section className="native-empty-preview" aria-label="开始准备简历">
            <div className="native-empty-preview__paper" aria-hidden="true">
              <span />
              <i />
              <i />
              <b />
              <i />
              <i />
              <b />
              <i />
              <i />
            </div>
            <div className="native-empty-preview__content">
              <p>从你的经历开始</p>
              <h2>你的简历会出现在这里</h2>
              <p>
                导入已有内容，或选取保存过的经历。
                <br />
                填写后，这里会显示与下载一致的实际简历。
              </p>
              <button
                type="button"
                onClick={() => {
                  importAfterSave.current = true;
                  void flush();
                }}
              >
                导入已有简历
              </button>
              <button
                type="button"
                onClick={() => {
                  materialAfterSave.current = true;
                  void flush();
                }}
              >
                从经历与材料开始
              </button>
              <button
                className="native-empty-preview__text-action"
                type="button"
                onClick={() => {
                  setTab("edit");
                  requestAnimationFrame(() => {
                    const field = formRef.current?.querySelector<HTMLInputElement>(
                      'input:not([type="file"]):not([type="hidden"])',
                    );
                    field?.focus();
                    field?.scrollIntoView({ block: "center" });
                  });
                }}
              >
                直接在左侧填写 →
              </button>
              <small>PDF、DOCX、纯文本 · 原件保留 · 模板可随时更换</small>
            </div>
          </section>
        ) : (
          <NativePdfPreview
            document={document}
            authoritative
            fixedBlob={preview?.blob}
            sourceAnchors={
              preview?.requestGeneration === generation.current ? preview.anchors : undefined
            }
            pendingMessage={
              previewError ||
              (preview?.requestGeneration !== generation.current
                ? status === "保存未完成"
                  ? "保存未完成，保留上次预览"
                  : "正在更新，当前显示上次成功预览"
                : undefined)
            }
            onRetry={
              previewError
                ? () => {
                    previewRef.current = null;
                    setPreviewRetry((value) => value + 1);
                  }
                : undefined
            }
            onEditItem={(id) => {
              setTextLayoutOpen(false);
              setTab("edit");
              setFocusItem({ id, request: Date.now() });
            }}
            onEditText={(selection) => {
              setTextSelection(selection);
              setTextSelectionNotice("");
              setTextLayoutOpen(true);
              setLayoutOpen(false);
              setTab("edit");
            }}
            onTextSelectionRejected={(notice) => {
              setTextSelection(null);
              setTextSelectionNotice(notice);
              setTextLayoutOpen(true);
              setLayoutOpen(false);
              setTab("edit");
            }}
            activeTextTargetId={textLayoutOpen ? textSelection?.target.targetId : undefined}
          />
        )}
      </NativeSplit>
    </section>
  );
}
