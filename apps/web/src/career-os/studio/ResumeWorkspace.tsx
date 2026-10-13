import {
  blankResumeEntry,
  RESUME_MODULE_NAMES,
  RESUME_TEMPLATE_BY_ID,
  resumeTemplateLayout,
  resumeHasWrittenEntries,
  type ResumeSectionKind,
  type ResumeStudioDraft,
  type ResumeStudioEntry,
  type ResumeExportArtifact,
  resumeContentManifest,
  resumeContentForTemplate,
} from "@aijob/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createIdempotencyKey, subscribeToSessionBoundary } from "../../api/client";
import {
  applyParsedOriginal,
  checkpointStudio,
  createStudio,
  deleteStudioOriginal,
  downloadStudioFile,
  getExperiences,
  getStudioHistory,
  getStudio,
  saveStudio,
  photoDataUrl,
  putExperience,
  studioOriginals,
  uploadPhoto,
  type StudioHistory,
  readyResumeExport,
  listResumeExports,
  deleteResumeExport,
} from "../../api/resume-studio";
import { ModalSurface } from "../components/ModalSurface";
import { StudioModuleForms, type StudioEdit, type EntryEdit } from "./StudioModuleForms";
import { StudioDocumentPreview } from "./StudioDocumentPreview";
import { StudioInlineAssistant } from "./StudioInlineAssistant";
import { StudioTemplateGallery } from "./StudioTemplateGallery";
import { StudioConflictDialog } from './StudioConflictDialog';
import { StudioExportViewer } from './StudioExportViewer';
import { StudioNumberControl } from './StudioNumberControl';
import { useStudioDraft } from "./use-studio-draft";
import "./studio.css";
import "./workspace.css";
import "./template-gallery.css";
type View = { tab: "edit" | "preview"; scroll: number; split: number };
const views = new Map<string, View>();
subscribeToSessionBoundary(() => views.clear());
export function ResumeWorkspace({ documentId }: { documentId: string }) {
  return <Workspace key={documentId} documentId={documentId} />;
}
function Workspace({ documentId }: { documentId: string }) {
  const studio = useStudioDraft(documentId),
    d = studio.draft,
    navigate = useNavigate(),
    latest = useRef(studio);
  latest.current = studio;
  const [panel, setPanel] = useState<
      "templates" | "layout" | "modules" | "history" | "originals" | "materials" | null
    >(null),
    [tab, setTab] = useState<"edit" | "preview">(views.get(documentId)?.tab ?? "edit"),
    [split, setSplit] = useState(views.get(documentId)?.split ?? 42),
    [zoom, setZoom] = useState<"fit" | "page" | number>("page"),
    [pages, setPages] = useState(0),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [kind, setKind] = useState<ResumeSectionKind>("project"),
    [materialSection, setMaterialSection] = useState<string | null>(null),
    [history, setHistory] = useState<StudioHistory>([]),
    [remote, setRemote] = useState<ResumeStudioDraft | null>(null),
    [assistant, setAssistant] = useState<{ entryId: string | null; intent: string } | null>(null),
    [assistantHidden, setAssistantHidden] = useState(false),
    [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [emptyExport,setEmptyExport]=useState<'pdf'|'docx'|null>(null),[exportView,setExportView]=useState<ResumeExportArtifact|null>(null),[lastExport,setLastExport]=useState<ResumeExportArtifact|null>(null);
  const exports=useQuery({queryKey:['career-os','resume-exports',documentId],queryFn:()=>listResumeExports(documentId),enabled:panel==='history',refetchInterval:q=>q.state.data?.items.some(a=>a.state==='generating')?1500:false});
  const host = useRef<HTMLDivElement>(null),
    form = useRef<HTMLDivElement>(null),
    panelReturn = useRef<HTMLElement | null>(null),
    recoveryCopy = useRef<{ fingerprint: string; createKey: string; saveKey: string } | null>(null),
    importAttempts = useRef(new Map<string, string>());
  const originals = useQuery({
    queryKey: ["career-os", "studio-originals", documentId],
    queryFn: () => studioOriginals(documentId),
    refetchInterval: (q) => (q.state.data?.items.some((o) => o.status === "queued") ? 1500 : false),
  });
  const experiences = useQuery({
    queryKey: ["career-os", "experiences"],
    queryFn: getExperiences,
    enabled: panel === "materials",
  });
  const photo = useQuery({
    queryKey: ["career-os", "resume-photo", d?.content.basics.photoId],
    queryFn: () => photoDataUrl(d!.content.basics.photoId!),
    enabled: !!d?.content.basics.photoId,
    retry: false,
  });
  const edit = useCallback<StudioEdit>(
    (fn, group) =>
      latest.current.change(
        (value) => {
          fn(value);
          return value;
        },
        true,
        group,
      ),
    [],
  );
  const editEntry = useCallback<EntryEdit>(
    (id, fn, group) =>
      latest.current.changeImmutable(
        (draft) => ({
          ...draft,
          content: {
            ...draft.content,
            sections: draft.content.sections.map((s) =>
              s.entries.some((e) => e.id === id)
                ? {
                    ...s,
                    entries: s.entries.map((entry) => {
                      if (entry.id !== id) return entry;
                      const next = structuredClone(entry);
                      fn(next);
                      return next;
                    }),
                  }
                : s,
            ),
          },
        }),
        group,
      ),
    [],
  );
  const undo = useCallback(() => latest.current.undo(), []),
    redo = useCallback(() => latest.current.redo(), []);
  const editBasic = useCallback((key: 'name'|'headline'|'phone'|'email'|'city', value: string) => {
    latest.current.changeImmutable(draft => ({...draft, content:{...draft.content, basics:{...draft.content.basics,[key]:value}}}), `basics:${key}`);
  }, []);
  const ready=!!d;
  useEffect(() => {
    if(!ready)return;
    const app = host.current?.closest(".career-os");
    app?.classList.add("has-resume-workspace");
    return () => app?.classList.remove("has-resume-workspace");
  }, [ready]);
  useEffect(() => {
    if (!ready || !form.current) return;
    form.current.scrollTop = views.get(documentId)?.scroll ?? 0;
  }, [ready, documentId]);
  useEffect(() => {
    if(!ready)return;
    const node = form.current;
    const save = () => views.set(documentId, { tab, split, scroll: node?.scrollTop ?? 0 });
    node?.addEventListener("scroll", save, { passive: true });
    save();
    return () => node?.removeEventListener("scroll", save);
  }, [tab, split, ready, documentId]);
  const previousImport = useRef("");
  useEffect(() => {
    const signature = JSON.stringify(originals.data?.items.map((o) => [o.id, o.status]));
    if (
      previousImport.current &&
      signature !== previousImport.current &&
      originals.data?.items.some((o) => o.status === "succeeded")
    )
      void latest.current.refresh();
    previousImport.current = signature;
  }, [originals.data]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作暂时没有完成，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function saved() {
    const result = await latest.current.flush();
    if (!result) throw new Error("当前输入仍在，请先处理保存问题。");
    return result;
  }
  async function exportFile(extension: "pdf" | "docx") {
    await run(async () => {
      const current = await saved(),
        pair = await checkpointStudio(documentId, current.revision);
      setNotice('正在生成并核对文件内容，可以继续编辑。');
      const artifact=await readyResumeExport(documentId,{format:extension,...pair});
      await downloadStudioFile(`/v1/resume-exports/${artifact.id}/file`,artifact.fileName);
      setLastExport(artifact);setNotice(`已下载 ${extension.toUpperCase()}，文件已保存在导出记录中。`);
      await exports.refetch();
    });
  }
  function requestExport(extension:'pdf'|'docx') {
    if(!resumeContentManifest(latest.current.draft!.content).fields.some(f=>f.id.startsWith('entry.'))){setEmptyExport(extension);return;}
    void exportFile(extension);
  }
  function openPanel(value: typeof panel) {
    panelReturn.current = document.activeElement as HTMLElement;
    setPanel(value);
  }
  function locate(id: string) {
    setTab("edit");
    setPanel(null);
    requestAnimationFrame(() => {
      const sectionId = latest.current.draft?.content.sections.find((s)=>s.entries.some((e)=>e.id===id))?.id ?? id;
      form.current?.querySelector<HTMLElement>(`[data-form-section="${sectionId}"]`)?.dispatchEvent(new CustomEvent('studio-expand'));
      requestAnimationFrame(() => {
      const node = form.current?.querySelector<HTMLElement>(
        `[data-form-entry="${id}"], [data-form-section="${id}"]`,
      );
      if (!node) return;
      node.dispatchEvent(new CustomEvent("studio-expand", { bubbles: true }));
      requestAnimationFrame(() => {
        node.scrollIntoView({ block: "start", behavior: "smooth" });
        node
          .querySelector<HTMLElement>("input,textarea,[contenteditable=true]")
          ?.focus({ preventScroll: true });
      });
      });
    });
  }
  async function copyUnsyncedDraft() {
    const current = latest.current.draft!;
    const fingerprint = JSON.stringify([current.title, current.content, current.layout]);
    if (recoveryCopy.current?.fingerprint !== fingerprint) recoveryCopy.current = { fingerprint, createKey: createIdempotencyKey(), saveKey: createIdempotencyKey() };
    const keys = recoveryCopy.current;
    const next = await createStudio({ title: `${current.title} · 恢复的方向稿` }, keys.createKey);
    await saveStudio(next.documentId, { expectedRevision: next.revision, title: next.title, content: current.content, layout: current.layout }, keys.saveKey);
    recoveryCopy.current = null;
    navigate(`/resumes/${next.documentId}`);
  }
  function addModule() {
    const id = crypto.randomUUID();
    edit((draft) => {
      draft.content.schemaVersion = "resume-studio-v2";
      draft.content.sections.push({
        id,
        title: RESUME_MODULE_NAMES[kind],
        kind,
        column: "main",
        hidden: false,
        pageBreakBefore: false,
        entries: [blankResumeEntry(crypto.randomUUID())],
      });
    });
    setPanel(null);
    setTimeout(() => locate(id), 0);
  }
  function openAssistant(
    entryId: string | null,
    intent = "请审阅整份简历的选材、顺序、贡献和重复内容，给出具体可采用的修改。",
  ) {
    setAssistant({ entryId, intent });
    setAssistantHidden(false);
  }
  async function updateExperience(entry: ResumeStudioEntry) {
    await run(async () => {
      await saved();
      const records = await getExperiences(),
        original = records.items.find((e) => e.id === entry.experienceId);
      if (!original) throw new Error("原经历已删除，可以在经历与材料中重新建立。");
      await putExperience(original.id, original.revision, entry);
      setNotice("经历原稿已更新，其他方向稿保留各自的表达。");
    });
  }
  async function openHistory() {
    await run(async () => {
      const current = await saved();
      await checkpointStudio(documentId, current.revision);
      setHistory((await getStudioHistory(documentId)).items);
      openPanel("history");
    });
  }
  if (!d)
    return (
      <div className="sw-loading">
        {studio.error || "正在打开简历…"}
        {studio.error && (
          <button type="button" onClick={() => window.location.reload()}>
            重试
          </button>
        )}
      </div>
    );
  const template = RESUME_TEMPLATE_BY_ID.get(d.layout.templateKey);
  return (
    <div
      className={`resume-studio resume-workspace is-${tab}`}
      ref={host}
      style={{ "--sw-split": `${split}%` } as CSSProperties}
    >
      <header className="sw-toolbar">
        <Link className="sw-back" to="/resumes" aria-label="返回我的简历">
          ←
        </Link>
        <input
          aria-label="简历名称"
          className="sw-document-title"
          value={d.title}
          maxLength={200}
          onChange={(e) =>
            edit((draft) => {
              draft.title = e.target.value;
            }, "title")
          }
        />
        <output className={`sw-save-status is-${studio.status}`}>
          {
            {
              loading: "正在载入",
              saved: "已自动保存",
              editing: "待保存",
              saving: "正在保存",
              error: "尚未保存",
            }[studio.status]
          }
        </output>
        <div className="sw-toolbar-history">
          <button type="button" aria-label="撤销修改" disabled={!studio.canUndo} onClick={undo}>
            ↶
          </button>
          <button type="button" aria-label="重做修改" disabled={!studio.canRedo} onClick={redo}>
            ↷
          </button>
        </div>
        <div className="sw-toolbar-actions">
          <button type="button" onClick={() => openPanel("templates")}>
            模板
          </button>
          <button type="button" onClick={() => openPanel(panel === "layout" ? null : "layout")}>
            排版
          </button>
          <button type="button" onClick={() => void openHistory()}>
            版本与导出
          </button>
          <button type="button" disabled={busy} onClick={() => requestExport("docx")}>
            DOCX
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => requestExport("pdf")}
          >
            下载 PDF
          </button>
        </div>
      </header>
      {(notice || studio.error) && (
        <output className="sw-notice">
          {notice || studio.error}
          {lastExport?.format==='pdf' && <button type="button" onClick={()=>setExportView(lastExport)}>查看已生成 PDF</button>}
          {studio.status === "error" && !studio.conflict && (
            <button type="button" onClick={() => void studio.flush()}>
              重试保存
            </button>
          )}
          {studio.conflict && (
            <>
              <button type="button" onClick={() => void run(async()=>{setRemote(await getStudio(documentId));})}>
                比较并处理修改
              </button>
              <button
                type="button"
                onClick={() => void run(copyUnsyncedDraft)}
              >
                当前输入另存方向稿
              </button>
            </>
          )}
        </output>
      )}
      {!!originals.data?.items.some((o) => o.status === "queued") && (
        <p className="sw-notice">
          简历正在解析，完成后会出现在这里。你也可以先编辑；已有输入会保留。
        </p>
      )}
      <div className="sw-mobile-switch sw-tabs">
        <button type="button" aria-pressed={tab === "edit"} onClick={() => setTab("edit")}>
          编辑内容
        </button>
        <button type="button" aria-pressed={tab === "preview"} onClick={() => setTab("preview")}>
          纸张预览{pages ? ` · ${pages} 页` : ""}
        </button>
      </div>
      <div className="sw-layout">
        <div className="sw-edit-pane">
          <div className="sw-edit-tools">
            <button type="button" onClick={() => openPanel("modules")}>
              ☷ 模块管理
            </button>
            <select aria-label="定位简历模块" value="" onChange={(e) => locate(e.target.value)}>
              <option value="">定位到…</option>
              <option value="basics">个人信息</option>
              {d.content.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => openAssistant(null)}>
              整份简历审阅
            </button>
            <button type="button" onClick={() => openPanel("originals")}>
              导入原件
            </button>
          </div>
          <div className="sw-form-scroll" ref={form}>
            <StudioModuleForms
              draft={d}
              edit={edit}
              editBasic={editBasic}
              editEntry={editEntry}
              undo={undo}
              redo={redo}
              assistant={openAssistant}
              materials={(id) => {
                setMaterialSection(id);
                openPanel("materials");
              }}
              updateExperience={(entry) => void updateExperience(entry)}
              photo={
                <div className="sw-photo-field">
                  {photo.data && <img src={photo.data} alt="简历照片" />}
                  <label className="sw-photo-upload">
                    {photo.data ? "更换照片" : "添加照片（可选）"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file)
                          void run(async () => {
                            const uploaded = await uploadPhoto(file);
                            edit((draft) => {
                              draft.content.basics.photoId = uploaded.id;
                              draft.layout.photoVisible = true;
                            });
                          });
                      }}
                    />
                  </label>
                  {d.content.basics.photoId && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={d.layout.photoVisible !== false}
                          onChange={(e) =>
                            edit((draft) => {
                              draft.layout.photoVisible = e.target.checked;
                            })
                          }
                        />
                        显示照片
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          void run(async () => {
                            edit((draft) => {
                              draft.content.basics.photoId = null;
                            });
                            await saved();
                          })
                        }
                      >
                        移除当前照片
                      </button>
                    </>
                  )}
                  {photo.isError && <span>照片已删除或暂时无法读取</span>}
                </div>
              }
            />
            <div className="sw-bottom-add">
              <select
                aria-label="选择添加模块类型"
                value={kind}
                onChange={(e) => setKind(e.target.value as ResumeSectionKind)}
              >
                {Object.entries(RESUME_MODULE_NAMES).map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
              <button type="button" onClick={addModule}>
                ＋ 添加模块
              </button>
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await saved();
                    const next = await createStudio({
                      title: `${d.title} · 方向稿`,
                      copyFromDocumentId: documentId,
                    });
                    navigate(`/resumes/${next.documentId}`);
                  })
                }
              >
                复制为方向稿
              </button>
            </div>
          </div>
        </div>
        <div
          className="sw-divider"
          role="separator"
          aria-label="调整编辑与预览宽度"
          aria-orientation="vertical"
          aria-valuemin={34}
          aria-valuemax={60}
          aria-valuenow={split}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              setSplit((v) => Math.max(34, Math.min(60, v + (e.key === "ArrowLeft" ? -2 : 2))));
            }
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const rect = e.currentTarget.parentElement!.getBoundingClientRect();
            setSplit(Math.max(34, Math.min(60, ((e.clientX - rect.left) / rect.width) * 100)));
          }}
        />
        <div className="sw-preview-pane">
          <div className="sw-preview-tools">
            <span>
              {template?.name ?? "原有版式"}
              {pages ? ` · ${pages} 页` : ""}
            </span>
            <label>
              缩放
              <select
                value={zoom}
                onChange={(e) => setZoom(e.target.value === "fit" || e.target.value === 'page' ? e.target.value : Number(e.target.value))}
              >
                <option value="page">整页适配</option>
                <option value="fit">适应宽度</option>
                <option value="0.75">75%</option>
                <option value="1">100%</option>
                <option value="1.25">125%</option>
              </select>
            </label>
              <button
                type="button"
                onClick={() => {
                  if (!host.current?.querySelector('[data-content-ready="true"] [data-preview-ready="true"]') || photo.isFetching) {
                    setNotice("排版正在更新，完成后即可打印当前内容。");
                    return;
                  }
                  const frame =
                  host.current?.querySelector<HTMLIFrameElement>(".sw-preview-pane iframe");
                frame?.contentWindow?.focus();
                frame?.contentWindow?.print();
              }}
            >
              打印
            </button>
          </div>
          <div className="sw-paper-scroll">
              {!resumeHasWrittenEntries(d.content) && <p className="sw-template-guidance">{template?.name ?? '当前模板'} · 纸张只显示你已填写的内容。请在左侧添加教育和经历。</p>}
              {pages > 1 && <div className="sw-page-advice"><span>当前为 {pages} 页，内容自然续排。</span><button type="button" onClick={()=>openPanel('layout')}>调整排版</button><button type="button" onClick={()=>openAssistant(null,'请指出当前简历重复或可以精简的表达，保留真实贡献和重要细节，不编造内容，也不以一页为硬性要求。')}>检查重复表达</button></div>}
              <StudioDocumentPreview
                content={d.content}
                layout={d.layout}
                title={d.title}
                photo={photo.data}
                zoom={zoom}
                onEntrySelect={locate}
                onReady={setPages}
              />
          </div>
        </div>
      </div>
      {assistant && (
        <aside className={`sw-assistant-dock${assistantHidden ? " is-minimized" : ""}`}>
          <div className="sw-dock-heading">
            <strong>求职助手 · {assistant.entryId ? "当前经历" : "整份简历"}</strong>
            <button type="button" onClick={() => setAssistantHidden(!assistantHidden)}>
              {assistantHidden ? "展开" : "收起"}
            </button>
            <button type="button" onClick={() => setAssistant(null)}>
              结束此面板
            </button>
          </div>
          <div hidden={assistantHidden}>
            <StudioInlineAssistant
              key={`${assistant.entryId}:${assistant.intent}`}
              draft={d}
              entryId={assistant.entryId}
              initialIntent={assistant.intent}
              flush={studio.flush}
              refresh={studio.refresh}
              close={() => setAssistantHidden(true)}
            />
          </div>
        </aside>
      )}
      {remote && <StudioConflictDialog local={d} remote={remote} busy={busy} close={()=>setRemote(null)} keep={()=>void run(async()=>{const result=await studio.resolveWithCurrent(remote.revision);setRemote(null);if(!result)throw new Error('服务器又有修改，当前输入仍在，请重新比较。');})} useServer={()=>void run(async()=>{const result=await studio.acceptServerVersion(remote);setRemote(null);if(!result)throw new Error('服务器又有修改，当前输入仍在，请重新比较。');})} copy={()=>void run(copyUnsyncedDraft)}/>}
      {panel === "templates" && (
        <StudioTemplateGallery
          stateKey={documentId}
          content={d.content}
          current={d.layout.templateKey}
          photo={photo.data}
          close={() => setPanel(null)}
          apply={async (layout) => {
            edit((draft) => {
              draft.layout = layout;
              draft.content.schemaVersion = "resume-studio-v2";
              draft.content = resumeContentForTemplate(draft.content, layout.templateKey);
            });
            await saved();
            setNotice(`已应用「${RESUME_TEMPLATE_BY_ID.get(layout.templateKey)?.name ?? '所选模板'}」；可用撤销恢复原排版。`);
          }}
        />
      )}
      {panel === "layout" && (
        <aside className="sw-layout-dock">
          <header>
            <h2>排版</h2>
            <button type="button" onClick={() => setPanel(null)}>
              收起
            </button>
          </header>
          <p>纸张仍在右侧，修改后自动更新。</p>
          <label>
            字体
            <select
              value={d.layout.fontFamily}
              onChange={(e) =>
                edit((draft) => {
                  draft.layout.fontFamily = e.target.value as "sans" | "serif";
                })
              }
            >
              <option value="sans">清晰黑体</option>
              <option value="serif">经典宋体</option>
            </select>
          </label>
          {(
            [
              ["fontSize", "正文字号", 9, 16, 0.5],
              ["lineHeight", "行距", 1.1, 2, 0.05],
              ["paragraphGap", "段落间距", 0, 16, 1],
              ["entryGap", "条目间距", 0, 24, 1],
              ["sectionGap", "模块间距", 4, 28, 1],
              ["margin", "页边距 mm", 10, 30, 1],
              ["columnRatio", "侧栏比例", 0.22, 0.45, 0.01],
            ] as const
          ).map(([key, label, min, max, step]) => (
            <StudioNumberControl key={key} label={label} value={d.layout[key]??(key==='columnRatio'?.31:3)} min={min} max={max} step={step} onCommit={value=>edit(draft=>{draft.layout[key]=value;},`layout:${key}`)}/>
          ))}
          {d.layout.typography && <details><summary>姓名、标题与联系信息</summary>
            {([['namePt','姓名字号',12,36],['headingPt','模块标题字号',9,20],['entryPt','条目标题字号',9,16],['contactPt','联系信息字号',8,14],['datePt','日期字号',8,14]] as const).map(([key,label,min,max])=><StudioNumberControl key={key} label={`${label} pt`} value={d.layout.typography![key]} min={min} max={max} step={.5} onCommit={n=>edit(draft=>{if(draft.layout.typography)draft.layout.typography[key]=n;},`typography:${key}`)}/>)}
            <label>标题字体<select value={d.layout.typography.headingFamily} onChange={e=>edit(draft=>{if(draft.layout.typography)draft.layout.typography.headingFamily=e.target.value as 'sans'|'serif';})}><option value="sans">黑体</option><option value="serif">宋体</option></select></label>
          </details>}
          {d.layout.regions && <StudioNumberControl label="上下页边距 mm" value={d.layout.regions.marginYmm} min={8} max={30} step={1} onCommit={n=>edit(draft=>{if(draft.layout.regions)draft.layout.regions.marginYmm=n;},'regions:marginYmm')}/>}
          {d.layout.colorHex && <label>模板颜色<input type="color" value={d.layout.colorHex} onChange={e=>edit(draft=>{draft.layout.colorHex=e.target.value;},'layout:color')}/></label>}
          <label>
            颜色
            <select
              value={d.layout.accent}
              onChange={(e) =>
                edit((draft) => {
                  draft.layout.accent = e.target.value as typeof draft.layout.accent;
                  if (draft.layout.rendererVersion === 'studio-pages-v3') draft.layout.colorHex = { ink: '#272b30', green: '#246451', navy: '#285575' }[draft.layout.accent];
                })
              }
            >
              <option value="ink">墨黑</option>
              <option value="green">深绿</option>
              <option value="navy">藏蓝</option>
            </select>
          </label>
          <label>
            分栏
            <select
              value={d.layout.columns}
              onChange={(e) =>
                edit((draft) => {
                  draft.layout.columns = e.target.value as typeof draft.layout.columns;
                })
              }
            >
              <option value="auto">跟随模板</option>
              <option value="one">单栏</option>
              <option value="two">双栏</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={d.layout.autoColumns !== false}
              onChange={(e) =>
                edit((draft) => {
                  draft.layout.autoColumns = e.target.checked;
                })
              }
            />
            自动安排主栏和侧栏
          </label>
          <label>
            <input
              type="checkbox"
              checked={d.layout.keepEntriesTogether}
              onChange={(e) =>
                edit((draft) => {
                  draft.layout.keepEntriesTogether = e.target.checked;
                })
              }
            />
            尽量保持条目完整，超长内容允许续页
          </label>
          {template && (
            <button
              type="button"
              onClick={() =>
                edit((draft) => {
                  draft.layout = resumeTemplateLayout(template.id);
                })
              }
            >
              恢复模板默认排版
            </button>
          )}
        </aside>
      )}
      {panel && ["modules", "history", "originals", "materials"].includes(panel) && (
        <ModalSurface
          ariaLabel={
            {
              modules: "模块管理",
              history: "简历版本",
              originals: "导入记录与原件",
              materials: "取用经历",
            }[panel as "modules"]
          }
          className="sw-tool-modal"
          closeLabel="回到简历"
          onClose={() => setPanel(null)}
        >
          <header>
            <h2>
              {
                {
                  modules: "模块管理",
                  history: "简历版本",
                  originals: "导入记录与原件",
                  materials: "取用经历",
                }[panel as "modules"]
              }
            </h2>
            <button type="button" onClick={() => setPanel(null)}>
              回到简历
            </button>
          </header>
          {panel === "modules" && (
            <>
              <p>调整顺序或隐藏模块，原有内容会保留。</p>
              {d.content.sections.map((s, i) => (
                <div className="sw-module-list-row" key={s.id}>
                  <button type="button" onClick={() => locate(s.id)}>
                    {s.title}
                    {s.hidden ? " · 已隐藏" : ""}
                  </button>
                  <div>
                    <button
                      type="button"
                      disabled={!i}
                      aria-label={`上移${s.title}`}
                      onClick={() =>
                        edit((draft) => {
                          const list = draft.content.sections;
                          [list[i - 1], list[i]] = [list[i]!, list[i - 1]!];
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === d.content.sections.length - 1}
                      aria-label={`下移${s.title}`}
                      onClick={() =>
                        edit((draft) => {
                          const list = draft.content.sections;
                          [list[i + 1], list[i]] = [list[i]!, list[i + 1]!];
                        })
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        edit((draft) => {
                          draft.content.sections[i]!.hidden = !s.hidden;
                        })
                      }
                    >
                      {s.hidden ? "恢复" : "隐藏"}
                    </button>
                  </div>
                </div>
              ))}
              <div className="sw-bottom-add">
                <select value={kind} onChange={(e) => setKind(e.target.value as ResumeSectionKind)}>
                  {Object.entries(RESUME_MODULE_NAMES).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={addModule}>
                  添加模块
                </button>
              </div>
            </>
          )}
          {panel === "history" && (
            <>
              <h3>已生成的文件</h3>
              {exports.isLoading && <p>正在读取导出记录…</p>}
              {exports.data?.items.map(a=><article className="sw-history-record" key={a.id}>
                <div><strong>{a.fileName}</strong><p>{new Date(a.createdAt).toLocaleString('zh-CN')} · {a.state==='ready'?(a.pageCount?`${a.pageCount} 页`:'可编辑 DOCX'):a.state==='generating'?'生成中':'生成未成功'}</p></div>
                {a.state==='ready' && <><button type="button" onClick={()=>void run(()=>downloadStudioFile(`/v1/resume-exports/${a.id}/file`,a.fileName))}>下载</button>{a.format==='pdf'&&<button type="button" onClick={()=>setExportView(a)}>预览 PDF</button>}</>}
                {a.state==='failed'&&<button type="button" onClick={()=>void run(async()=>{await readyResumeExport(documentId,{format:a.format,contentRevisionId:a.contentRevisionId,layoutRevisionId:a.layoutRevisionId});await exports.refetch();})}>重试生成</button>}
                <button type="button" onClick={()=>void run(async()=>{await deleteResumeExport(a.id);if(lastExport?.id===a.id)setLastExport(null);await exports.refetch();})}>删除文件</button>
              </article>)}
              {exports.data?.items.length===0&&<p>还没有导出文件。下载后可以在这里找回。</p>}
              {exports.isError&&<button type="button" onClick={()=>void exports.refetch()}>重新读取导出记录</button>}
              <h3>正文与排版版本</h3>
              {history.map((v) => (
                <article className="sw-history-record" key={v.contentRevisionId}>
                  <div>
                    <strong>版本 {v.version}</strong>
                    <p>
                      {new Date(v.createdAt).toLocaleString("zh-CN")} · {v.content.sections.length}{" "}
                      个模块
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      edit((draft) => {
                        draft.content = structuredClone(v.content);
                        draft.layout = structuredClone(v.layout);
                      });
                      setPanel(null);
                      setNotice("已恢复到当前稿，可以撤销。投递历史保留原版本。");
                    }}
                  >
                    恢复这一版
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void run(() =>
                        downloadStudioFile(
                          `/v1/resume-documents/${documentId}/history/pdf?${new URLSearchParams({ contentRevisionId: v.contentRevisionId, layoutRevisionId: v.layoutRevisionId })}`,
                          `${d.title}.pdf`,
                        ),
                      )
                    }
                  >
                    PDF
                  </button>
                  <button type="button" onClick={() => void run(() => downloadStudioFile(
                    `/v1/resume-documents/${documentId}/history/docx?${new URLSearchParams({ contentRevisionId: v.contentRevisionId, layoutRevisionId: v.layoutRevisionId })}`,
                    `${d.title}.docx`,
                  ))}>DOCX</button>
                </article>
              ))}
            </>
          )}
          {panel === "originals" && (
            <>
              {originals.data?.items.map((o) => (
                <article className="sw-original-record" key={o.id}>
                  <strong>{o.filename}</strong>
                  <p>
                    {
                      {
                        queued: "正在解析",
                        ready: "解析完成，可取用",
                        succeeded: "已解析",
                        failed: "解析暂未成功",
                      }[o.status]
                    }{" "}
                    · {(o.byteSize / 1024).toFixed(0)} KB
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void run(() => downloadStudioFile(`/v1/resume-originals/${o.id}`, o.filename))
                    }
                  >
                    下载原件
                  </button>
                  {o.status === "ready" && (
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          const current = await saved();
                          const key = importAttempts.current.get(o.id) ?? createIdempotencyKey();
                          importAttempts.current.set(o.id, key);
                          await applyParsedOriginal(o.id, current.revision, key);
                          await studio.refresh(true);
                          setNotice("解析内容已取用，可以撤销恢复之前的稿件。");
                        })
                      }
                    >
                      取用解析内容
                    </button>
                  )}
                  {confirmDelete === o.id ? (
                    <>
                      <span>只删除原件，编辑好的简历仍保留。</span>
                      <button
                        type="button"
                        onClick={() =>
                          void run(async () => {
                            await deleteStudioOriginal(o.id);
                            setConfirmDelete(null);
                            await originals.refetch();
                          })
                        }
                      >
                        确认删除原件
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)}>
                        取消
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(o.id)}>
                      删除原件
                    </button>
                  )}
                </article>
              ))}
              {!originals.data?.items.length && (
                <p>这份简历没有上传原件。你可以继续编辑，也可以从“我的简历”导入。</p>
              )}
            </>
          )}
          {panel === "materials" && (
            <>
              {experiences.isLoading && <p>正在读取经历…</p>}
              {experiences.data?.items.map((experience) => (
                <article className="sw-material-record" key={experience.id}>
                  <strong>{experience.title}</strong>
                  <p>
                    {experience.entry.organization} {experience.entry.role}{" "}
                    {experience.entry.startDate}—{experience.entry.endDate}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const target =
                        materialSection ??
                        d.content.sections.find((s) => s.kind === experience.kind)?.id;
                      const id = crypto.randomUUID();
                      edit((draft) => {
                        let section = draft.content.sections.find((s) => s.id === target);
                        if (!section) {
                          section = {
                            id: crypto.randomUUID(),
                            title: RESUME_MODULE_NAMES[experience.kind],
                            kind: experience.kind,
                            column: "main",
                            hidden: false,
                            pageBreakBefore: false,
                            entries: [],
                          };
                          draft.content.sections.push(section);
                        }
                        section.entries.push({
                          ...structuredClone(experience.entry),
                          id,
                          experienceId: experience.id,
                          experienceRevision: experience.revision,
                        });
                      });
                      setPanel(null);
                      setTimeout(() => locate(id), 0);
                    }}
                  >
                    插入当前简历
                  </button>
                </article>
              ))}
              {experiences.data && !experiences.data.items.length && (
                <p>还没有已收录的经历。直接在简历里写项目或实习，系统会自动积累。</p>
              )}
              {experiences.isError && (
                <button type="button" onClick={() => void experiences.refetch()}>
                  重新读取经历
                </button>
              )}
            </>
          )}
        </ModalSurface>
      )}
      {emptyExport && <ModalSurface ariaLabel="导出当前内容" className="sw-empty-export" closeLabel="返回编辑" onClose={()=>setEmptyExport(null)}><h2>目前还没有教育或经历正文</h2><p>下载文件只包含你实际填写的内容。你可以继续补充，也可以先下载当前稿。</p><button type="button" onClick={()=>setEmptyExport(null)}>返回编辑</button><button type="button" onClick={()=>{const format=emptyExport;setEmptyExport(null);void exportFile(format);}}>继续下载</button></ModalSurface>}
      {exportView && <StudioExportViewer artifact={exportView} close={()=>setExportView(null)}/>}
    </div>
  );
}
