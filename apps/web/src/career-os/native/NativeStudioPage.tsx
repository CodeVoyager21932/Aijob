import {
  applyNativeTemplate,
  hasNativeResumeContent,
  changeNativeItems,
  type NativeResumeDocument,
  parseNativeResumeDocument,
} from "@aijob/resume-core";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { NativeItemAnchor } from "@aijob/resume-renderer/browser";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getResumeDocument } from "../../api/career-os";
import {
  apiDownload,
  apiRequest,
  createIdempotencyKey,
  currentWorkspaceOwnerKey,
  subscribeToSessionBoundary,
  ProductApiError,
} from "../../api/client";
import { NativeAdditionalSections } from "./NativeAdditionalSections";
import { NativeAssistant } from "./NativeAssistant";
import { NativeContactLinks } from "./NativeContactLinks";
import { NativeEntry } from "./NativeEntry";
import { NativeEntryExtras } from "./NativeEntryExtras";
import { NativeExperienceRoles } from "./NativeExperienceRoles";
import { NativeExportPreview } from "./NativeExportPreview";
import { NativeImportPanel } from "./NativeImportPanel";
import { NativeLayoutPanel } from "./NativeLayoutPanel";
import { NativeLegacyUpgrade } from "./NativeLegacyUpgrade";
import { NativeMaterials } from "./NativeMaterials";
import { NativePdfPreview } from "./NativePdfPreview";
import { NativeRecoveryContent } from "./NativeRecoveryContent";
import { NativePhotoEditor } from "./NativePhotoEditor";
import { NativeSplit } from "./NativeSplit";
import { NativeTemplateGallery } from "./NativeTemplateGallery";
import { NativeText } from "./NativeText";
import { NativeVersionHistory } from "./NativeVersionHistory";
import { downloadCurrentPreview } from "./preview-download";
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
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作未完成，输入仍保留。";
const LegacyEditor = lazy(() =>
  import("../studio/ResumeStudioEditor").then((module) => ({ default: module.ResumeStudioEditor })),
);

export function NativeStudioPage() {
  const { documentId } = useParams(),
    navigate = useNavigate();
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
  if (draft && recovery)
    return (
      <section className="native-start">
        <h1>找到了上次未同步的草稿</h1>
        <p>
          {recovery.baseRevision === draft.revision
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
              ...draft,
              document: recovery.document,
              title: recovery.title ?? draft.title,
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
              const key = nativeRecoveryKey(currentWorkspaceOwnerKey(), draft.documentId);
              if (key) localStorage.removeItem(key);
            } catch {}
            setRecovery(null);
          }}
        >
          使用服务器版本
        </button>
        <div style={{ height: "65vh" }}>
          <NativeRecoveryContent document={inspectLocal ? recovery.document : draft.document} />
        </div>
      </section>
    );
  if (draft) return <NativeEditor key={draft.documentId} initial={draft} />;
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
  const formRef = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const [moreTools, setMoreTools] = useState(false);
  const navigate = useNavigate();
  const [title, setTitle] = useState(initial.title);
  const currentTitle = useRef(initial.title);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [importsOpen, setImportsOpen] = useState(() => params.get("tool") === "import");
  useEffect(() => {
    if (params.get("tool") !== "import") return;
    const next = new URLSearchParams(params);
    next.delete("tool");
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
  const recoveryKey = useRef(nativeRecoveryKey(currentWorkspaceOwnerKey(), initial.documentId));
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
  useEffect(() => {
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
        const saved = await apiRequest<Draft>(`/v2/resume-documents/${initial.documentId}/native`, {
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
            `/v2/resume-documents/${initial.documentId}/native/checkpoint`,
            { method: "POST", body: { expectedRevision: revision.current } },
          );
          const fingerprint = JSON.stringify(pair);
          if (copyRequest.current?.fingerprint !== fingerprint)
            copyRequest.current = { fingerprint, key: createIdempotencyKey() };
          const copied = await apiRequest<Draft>(
            `/v2/resume-documents/${initial.documentId}/native/copies`,
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
        void apiRequest(`/v2/resume-documents/${initial.documentId}/native/checkpoint`, {
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
        `/v2/resume-documents/${initial.documentId}/native/preview`,
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
  async function downloadArtifact(id: string) {
    const file = await apiDownload(`/v2/resume-exports/${id}/file`);
    if (!alive.current) return;
    const url = URL.createObjectURL(file.blob),
      link = window.document.createElement("a");
    link.href = url;
    link.download = file.fileName ?? "Aijob-简历.pdf";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function exportSaved(savedRevision: number, format: "pdf" | "docx") {
    try {
      if (format === "pdf") {
        const targetGeneration = savedGeneration.current;
        const result = await downloadCurrentPreview(
          (force) => ensurePreview(savedRevision, targetGeneration, force),
          downloadArtifact,
        );
        if (!alive.current) return;
        setLastExport({ id: result.artifact.id, revision: savedRevision, format });
        return;
      }
      const pair = await apiRequest<{ contentRevisionId: string; layoutRevisionId: string }>(
        `/v2/resume-documents/${initial.documentId}/native/checkpoint`,
        { method: "POST", body: { expectedRevision: savedRevision } },
      );
      const artifact = await apiRequest<{ id: string; state: string }>(
        `/v2/resume-documents/${initial.documentId}/native/exports`,
        {
          method: "POST",
          body: { ...pair, format },
          idempotencyKey: createIdempotencyKey(),
        },
      );
      if (!alive.current) return;
      if (artifact.state !== "ready") throw new Error("文件仍在生成，请稍后重试；草稿已保存。");
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
  const data = document.data;
  function add(kind: "education" | "experience") {
    edit(`add:${crypto.randomUUID()}`, (draft) => {
      const shared = {
        id: crypto.randomUUID(),
        hidden: false,
        period: "",
        location: "",
        website: { url: "", label: "", inlineLink: false },
        description: "",
      };
      if (kind === "education")
        draft.data.sections.education.items.push({
          ...shared,
          school: "",
          degree: "",
          area: "",
          grade: "",
        });
      else
        draft.data.sections.experience.items.push({
          ...shared,
          company: "",
          position: "",
          roles: [],
        });
    });
  }
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
        documentId={initial.documentId}
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
          documentId={initial.documentId}
          document={document}
          edit={edit}
          close={() => setMaterialsOpen(false)}
        />
      )}
      {historyOpen && (
        <NativeVersionHistory
          documentId={initial.documentId}
          close={() => setHistoryOpen(false)}
          restore={(value) =>
            edit(`restore:${crypto.randomUUID()}`, (draft) => Object.assign(draft, value))
          }
        />
      )}
      {importsOpen && (
        <NativeImportPanel
          documentId={initial.documentId}
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
          close={() => setImportsOpen(false)}
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
          close={() => setTemplatesOpen(false)}
          apply={(id) =>
            edit(`template:${crypto.randomUUID()}`, (draft) => {
              Object.assign(draft, applyNativeTemplate(draft, id));
            })
          }
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
          <button type="button" onClick={() => setTemplatesOpen(true)}>
            更换模板
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
            disabled={exporting || !hasNativeResumeContent(document)}
            onClick={() => {
              setExporting(true);
              exportFormat.current = "pdf";
              exportAfterSave.current = true;
              void flush();
            }}
          >
            {exporting ? "正在生成…" : "下载 PDF"}
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
                disabled={exporting || !hasNativeResumeContent(document)}
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
          <button type="button" onClick={() => void flush()}>
            重试保存
          </button>
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
      <NativeSplit>
        <div className="native-form" ref={formRef}>
          <div className="native-form-nav">
            <label>
              定位模块
              <select
                aria-label="定位模块"
                value=""
                onChange={(event) => {
                  const heading = [
                    ...(formRef.current?.querySelectorAll<HTMLHeadingElement>("h2") ?? []),
                  ].find((item) => item.textContent === event.target.value);
                  if (heading) {
                    heading.tabIndex = -1;
                    heading.focus({ preventScroll: true });
                    heading.scrollIntoView({ block: "start" });
                  }
                }}
              >
                <option value="">选择要编辑的内容</option>
                {[
                  ...new Set([
                    "个人信息",
                    "教育经历",
                    "实习与工作经历",
                    "个人简介",
                    "科研经历",
                    ...Object.entries(data.sections)
                      .filter(([key]) => key !== "education" && key !== "experience")
                      .map(([, section]) => section.title),
                    ...data.customSections.map((section) => section.title),
                  ]),
                ]
                  .filter(Boolean)
                  .map((title) => (
                    <option key={title} value={title}>
                      {title}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {layoutOpen && (
            <NativeLayoutPanel document={document} edit={edit} close={() => setLayoutOpen(false)} />
          )}
          <section>
            <header>
              <h2>个人信息</h2>
            </header>
            <NativePhotoEditor document={document} edit={edit} />
            <div className="native-fields">
              {(
                [
                  ["name", "姓名"],
                  ["headline", "求职方向"],
                  ["email", "邮箱"],
                  ["phone", "电话"],
                  ["location", "所在城市"],
                ] as const
              ).map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  value={data.basics[key]}
                  change={(value) =>
                    edit(`basics:${key}`, (draft) => {
                      draft.data.basics[key] = value;
                    })
                  }
                />
              ))}
            </div>
          </section>
          <NativeContactLinks document={document} edit={edit} />
          <section>
            <header>
              <h2>教育经历</h2>
              <button type="button" onClick={() => add("education")}>
                添加教育
              </button>
            </header>
            {data.sections.education.items.map((item, index) => (
              <NativeEntry
                key={item.id}
                id={item.id}
                title={item.school || "填写学校与专业"}
                subtitle={[item.degree, item.area, item.period].filter(Boolean).join(" · ")}
                hidden={item.hidden}
                initiallyOpen={index === 0 || !item.school}
              >
                <div className="native-fields">
                  {(
                    [
                      ["school", "学校"],
                      ["degree", "学历"],
                      ["area", "专业"],
                      ["period", "就读时间"],
                      ["location", "城市"],
                      ["grade", "成绩（选填）"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field
                      key={key}
                      label={label}
                      value={item[key]}
                      change={(value) =>
                        edit(`${item.id}:${key}`, (draft) => {
                          const target = draft.data.sections.education.items.find(
                            (candidate) => candidate.id === item.id,
                          );
                          if (target) target[key] = value;
                        })
                      }
                    />
                  ))}
                </div>
                <NativeEntryExtras document={document} id={item.id} edit={edit} />
                <NativeText
                  label="教育补充说明"
                  value={item.description}
                  change={(value) =>
                    edit(`${item.id}:description`, (draft) => {
                      const target = draft.data.sections.education.items.find(
                        (candidate) => candidate.id === item.id,
                      );
                      if (target) target.description = value;
                    })
                  }
                />
                <fieldset className="native-item-actions" aria-label="教育条目操作">
                  {(
                    [
                      ["up", "上移"],
                      ["down", "下移"],
                      ["duplicate", "复制"],
                      ["visibility", item.hidden ? "恢复显示" : "隐藏"],
                      ["delete", "删除"],
                    ] as const
                  ).map(([action, label]) => (
                    <button
                      key={action}
                      type="button"
                      disabled={
                        action === "up"
                          ? index === 0
                          : action === "down"
                            ? index === data.sections.education.items.length - 1
                            : false
                      }
                      onClick={() =>
                        edit(`${action}:${item.id}`, (draft) =>
                          changeNativeItems(
                            draft.data.sections.education.items,
                            item.id,
                            action,
                            crypto.randomUUID(),
                          ),
                        )
                      }
                    >
                      {label}
                    </button>
                  ))}
                </fieldset>
              </NativeEntry>
            ))}
          </section>
          <section>
            <header>
              <h2>实习与工作经历</h2>
              <button type="button" onClick={() => add("experience")}>
                添加实习
              </button>
            </header>
            {data.sections.experience.items.map((item, index) => (
              <NativeEntry
                key={item.id}
                id={item.id}
                title={item.company || "填写一段实习"}
                subtitle={[item.position, item.period].filter(Boolean).join(" · ")}
                hidden={item.hidden}
                initiallyOpen={index === 0 || !item.company}
              >
                <div className="native-fields">
                  {(
                    [
                      ["company", "企业／组织"],
                      ["position", "职位"],
                      ["period", "起止时间"],
                      ["location", "城市"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field
                      key={key}
                      label={label}
                      value={item[key]}
                      change={(value) =>
                        edit(`${item.id}:${key}`, (draft) => {
                          const target = draft.data.sections.experience.items.find(
                            (candidate) => candidate.id === item.id,
                          );
                          if (target) target[key] = value;
                        })
                      }
                    />
                  ))}
                </div>
                <NativeEntryExtras document={document} id={item.id} edit={edit} />
                <NativeText
                  label="工作内容与成果"
                  value={item.description}
                  change={(value) =>
                    edit(`${item.id}:description`, (draft) => {
                      const target = draft.data.sections.experience.items.find(
                        (candidate) => candidate.id === item.id,
                      );
                      if (target) target.description = value;
                    })
                  }
                />
                <NativeExperienceRoles
                  roles={item.roles}
                  change={(key, update) =>
                    edit(`roles:${item.id}:${key}`, (draft) => {
                      const target = draft.data.sections.experience.items.find(
                        (entry) => entry.id === item.id,
                      );
                      if (target) update(target.roles);
                    })
                  }
                  text={(label, value, change) => (
                    <NativeText label={label} value={value} change={change} />
                  )}
                />
                <fieldset className="native-item-actions" aria-label="实习条目操作">
                  {(
                    [
                      ["up", "上移"],
                      ["down", "下移"],
                      ["duplicate", "复制"],
                      ["visibility", item.hidden ? "恢复显示" : "隐藏"],
                      ["delete", "删除"],
                    ] as const
                  ).map(([action, label]) => (
                    <button
                      key={action}
                      type="button"
                      disabled={
                        action === "up"
                          ? index === 0
                          : action === "down"
                            ? index === data.sections.experience.items.length - 1
                            : false
                      }
                      onClick={() =>
                        edit(`${action}:${item.id}`, (draft) =>
                          changeNativeItems(
                            draft.data.sections.experience.items,
                            item.id,
                            action,
                            crypto.randomUUID(),
                          ),
                        )
                      }
                    >
                      {label}
                    </button>
                  ))}
                </fieldset>
              </NativeEntry>
            ))}
          </section>
          <NativeAdditionalSections
            document={document}
            edit={edit}
            text={(label, value, change) => (
              <NativeText label={label} value={value} change={change} />
            )}
          />
        </div>
        {!hasNativeResumeContent(document) ? (
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
              setTab("edit");
              requestAnimationFrame(() => {
                const item = window.document.querySelector<HTMLDetailsElement>(
                  `[data-native-item="${CSS.escape(id)}"]`,
                );
                if (item) {
                  item.open = true;
                  item.scrollIntoView({ block: "center" });
                  item
                    .querySelector<HTMLElement>("input,[contenteditable=true]")
                    ?.focus({ preventScroll: true });
                }
              });
            }}
          />
        )}
      </NativeSplit>
    </section>
  );
}
function Field({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => change(event.target.value)} />
    </label>
  );
}
