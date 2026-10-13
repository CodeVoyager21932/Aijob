import {
  RESUME_TEMPLATES,
  RESUME_TEMPLATE_GROUPS,
  RESUME_TEMPLATE_BY_ID,
  RESUME_SAMPLE_PHOTO,
  resumeGallerySample,
  resumeTemplateLayout,
  resumeContentForTemplate,
  studioV2Html,
  type ResumeStudioContent,
  type ResumeStudioLayout,
} from "@aijob/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { subscribeToSessionBoundary } from '../../api/client';
import { getTemplatePreferences, setTemplateFavorite } from "../../api/resume-studio";
import { ModalSurface } from "../components/ModalSurface";
import { StudioPagedPreview, studioWebFontCss } from "./StudioPagedPreview";
const searchable = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
type GalleryView = {search:string;group:string;view:string;columns:string;photoFilter:boolean;compact:boolean;longMaterial:boolean;previewId:string;selected:string[];scroll:number};
const galleryViews=new Map<string,GalleryView>();
subscribeToSessionBoundary(()=>galleryViews.clear());

export function StudioTemplateGallery({
  content,
  current,
  photo,
  apply,
  close,
  stateKey='gallery',
}: {
  content: ResumeStudioContent;
  current: string;
  photo?: string | undefined;
  apply: (layout: ResumeStudioLayout) => Promise<void>;
  close: () => void;
  stateKey?:string;
}) {
  const remembered=useRef(galleryViews.get(stateKey)).current;
  const preferences = useQuery({
    queryKey: ["career-os", "template-preferences"],
    queryFn: getTemplatePreferences,
  });
  const [search, setSearch] = useState(remembered?.search??""),
    [group, setGroup] = useState(remembered?.group??"all"),
    [view, setView] = useState(remembered?.view??"all"),
    [columns, setColumns] = useState(remembered?.columns??"all"),
    [photoFilter, setPhotoFilter] = useState(remembered?.photoFilter??false),
    [compact, setCompact] = useState(remembered?.compact??false),
    [longMaterial, setLongMaterial] = useState(remembered?.longMaterial??false),
    [previewId, setPreviewId] = useState(
      remembered?.previewId??(RESUME_TEMPLATE_BY_ID.has(current) ? current : "lapis_cn"),
    ),
    [selected, setSelected] = useState<string[]>(remembered?.selected??[]),
    [comparing, setComparing] = useState(false),
    [mobilePreview, setMobilePreview] = useState(false),
    [own, setOwn] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const list = useRef<HTMLElement>(null),
    lastThumb = useRef<HTMLButtonElement | null>(null),
    compareReturn = useRef<HTMLElement | null>(null);
  const prefs = useMemo(() => preferences.data?.items ?? [], [preferences.data]);
  const restored=useRef(false),scroll=useRef(remembered?.scroll??0);
  useLayoutEffect(()=>{if(restored.current||preferences.isLoading)return;if(list.current)list.current.scrollTop=scroll.current;restored.current=true;},[preferences.isLoading]);
  useEffect(()=>{
    const save=()=>{if(restored.current&&list.current?.getClientRects().length&&!comparing&&!mobilePreview)scroll.current=list.current.scrollTop;galleryViews.set(stateKey,{search,group,view,columns,photoFilter,compact,longMaterial,previewId,selected,scroll:scroll.current});};
    const node=list.current;node?.addEventListener('scroll',save,{passive:true});save();
    return()=>{save();node?.removeEventListener('scroll',save);};
  },[stateKey,search,group,view,columns,photoFilter,compact,longMaterial,previewId,selected,comparing,mobilePreview]);
  const sample = useMemo(() => resumeGallerySample(), []);
  const items = useMemo(
    () =>
      RESUME_TEMPLATES.filter(
        (t) =>
          (!search ||
            searchable(
              `${t.name} ${t.sourceKey} ${t.upstream} ${RESUME_TEMPLATE_GROUPS[t.group]}`,
            ).includes(searchable(search))) &&
          (group === "all" || group === t.group) &&
          (columns === "all" || (columns === "single") === (t.columns === "single")) &&
          (!photoFilter || /photo|identity|sidebar/.test(t.header)) &&
          (!compact || t.group === "project" || t.id === "jp_ats") &&
          (!longMaterial || t.group === "research") &&
          (view === "all" ||
            (view === "favorites" && prefs.find((p) => p.templateId === t.id)?.favorite) ||
            (view === "recent" && prefs.find((p) => p.templateId === t.id)?.lastUsedAt)),
      ).sort((a, b) =>
        view === "recent"
          ? (prefs.find((p) => p.templateId === b.id)?.lastUsedAt ?? "").localeCompare(
              prefs.find((p) => p.templateId === a.id)?.lastUsedAt ?? "",
            )
          : 0,
      ),
    [search, group, columns, photoFilter, compact, longMaterial, view, prefs],
  );
  async function favorite(id: string) {
    try {
      setNotice("");
      const p = prefs.find((p) => p.templateId === id);
      await setTemplateFavorite(id, !p?.favorite, p?.revision ?? 0);
      await preferences.refetch();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "收藏暂时失败");
      await preferences.refetch();
    }
  }
  async function use(id: string) {
    setBusy(true);
    setNotice("");
    try {
      await apply(resumeTemplateLayout(id));
      close();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "模板应用未完成");
    } finally {
      setBusy(false);
    }
  }
  function backToList() {
    const target = comparing ? compareReturn.current : lastThumb.current;
    setComparing(false);
    setMobilePreview(false);
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  }
  function renderPreview(id: string) {
    const t = RESUME_TEMPLATE_BY_ID.get(id)!,
      layout = resumeTemplateLayout(id);
    return (
      <article className="sw-gallery-preview" key={`${id}:${own}`}>
        <header>
          <div>
            <h3>{t.name}</h3>
            <p>
              {RESUME_TEMPLATE_GROUPS[t.group]} · {t.columns === "single" ? "单栏" : "双栏"}
            </p>
          </div>
          <button type="button" className="sw-gallery-back" onClick={backToList}>
            返回模板列表
          </button>
        </header>
        <StudioPagedPreview
          presentation="page"
          html={studioV2Html(
            "模板预览",
            resumeContentForTemplate(own ? content : sample,id),
            layout,
            studioWebFontCss(layout.fontFamily, layout),
            own ? (photo ? { photoDataUrl: photo } : {}) : { photoDataUrl: RESUME_SAMPLE_PHOTO },
          )}
        />
        <footer>
          <span>{current === id ? "当前使用的模板" : "预览中 · 应用后可撤销"}</span>
          <button type="button" className="primary" disabled={busy} onClick={() => void use(id)}>
            应用这套模板
          </button>
        </footer>
      </article>
    );
  }
  return (
    <ModalSurface
      ariaLabel="选择简历模板"
      className={`sw-gallery${mobilePreview ? " is-previewing" : ""}${comparing ? " is-comparing" : ""}`}
      closeLabel="关闭模板库"
      onClose={close}
    >
      <header className="sw-gallery-header">
        <div>
          <span className="sw-eyebrow">简历模板库 · {RESUME_TEMPLATES.length} 套</span>
          <h2>选一份版式，开始填写</h2>
        </div>
        <button type="button" onClick={close}>
          返回编辑
        </button>
      </header>
      <div className="sw-gallery-filters" hidden={comparing}>
        <div className="sw-tabs">
          {[
            ["all", "全部"],
            ["favorites", "已收藏"],
            ["recent", "最近使用"],
          ].map(([id, title]) => (
            <button
              type="button"
              key={id}
              aria-pressed={view === id}
              onClick={() => {
                setView(id!);
                list.current?.scrollTo(0, 0);
              }}
            >
              {title}
            </button>
          ))}
        </div>
        <input
          aria-label="搜索模板"
          placeholder="搜索名称或风格"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            list.current?.scrollTo(0, 0);
          }}
        />
        <details className="sw-gallery-more">
          <summary>更多筛选</summary>
          <div>
            <select aria-label="模板用途" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="all">全部用途</option>
              {Object.entries(RESUME_TEMPLATE_GROUPS).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="模板分栏"
              value={columns}
              onChange={(e) => setColumns(e.target.value)}
            >
              <option value="all">单栏与双栏</option>
              <option value="single">单栏</option>
              <option value="two">双栏</option>
            </select>
            <label>
              <input
                type="checkbox"
                checked={photoFilter}
                onChange={(e) => setPhotoFilter(e.target.checked)}
              />
              照片布局
            </label>
            <label>
              <input
                type="checkbox"
                checked={compact}
                onChange={(e) => setCompact(e.target.checked)}
              />
              紧凑排版
            </label>
            <label>
              <input
                type="checkbox"
                checked={longMaterial}
                onChange={(e) => setLongMaterial(e.target.checked)}
              />
              长材料优先
            </label>
          </div>
        </details>
      </div>
      <div className="sw-gallery-context">
        <span>{own ? "预览你的当前内容；页数由实际内容决定" : "一页中文样稿 · 仅展示版式"}</span>
        <label>
          <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
          用我的内容预览
        </label>
      </div>
      {notice && <p role="alert">{notice}</p>}
      {preferences.isError && (
        <p role="alert">
          收藏暂未读到，仍可选模板。
          <button type="button" onClick={() => void preferences.refetch()}>
            重试
          </button>
        </p>
      )}
      <div className="sw-gallery-body">
        <section
          className="sw-gallery-list"
          ref={list}
          aria-label="模板列表"
          hidden={comparing}
        >
          <p className="sw-muted">{items.length} 套模板 · 点击查看，或直接使用</p>
          <div className="sw-gallery-grid">
            {items.map((t) => {
              const favorited = !!prefs.find((p) => p.templateId === t.id)?.favorite;
              return (
                <article
                  className={`sw-template-card${previewId === t.id ? " is-selected" : ""}${current === t.id ? " is-current" : ""}`}
                  key={t.id}
                >
                  <button
                    type="button"
                    className="sw-template-thumb"
                    aria-label={`放大查看${t.name}`}
                    aria-pressed={previewId === t.id}
                    onClick={(e) => {
                      lastThumb.current = e.currentTarget;
                      setPreviewId(t.id);
                      setMobilePreview(true);
                      requestAnimationFrame(() => {
                        const back = document.querySelector<HTMLButtonElement>(
                          ".sw-gallery-detail .sw-gallery-back",
                        );
                        if (back?.getClientRects().length) back.focus({ preventScroll: true });
                      });
                    }}
                  >
                    <img
                      src={`/resume-templates/${t.id}${t.rendererVersion === 'studio-pages-v3' ? `-${t.version}` : ''}.png?v=${t.version}`}
                      width="360"
                      height="510"
                      loading="lazy"
                      alt={`${t.name}的一页中文样稿`}
                    />
                  </button>
                  <div className="sw-template-name">
                    <h3>{t.name}</h3>
                    <button
                      type="button"
                      aria-label={`${favorited ? "取消收藏" : "收藏"}${t.name}`}
                      aria-pressed={favorited}
                      onClick={() => void favorite(t.id)}
                    >
                      {favorited ? "★" : "☆"}
                    </button>
                  </div>
                  <p>
                    {RESUME_TEMPLATE_GROUPS[t.group]} · {t.columns === "single" ? "单栏" : "双栏"}
                    {current === t.id ? " · 使用中" : ""}
                  </p>
                  <div className="sw-template-actions">
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(t.id)}
                        disabled={!selected.includes(t.id) && selected.length === 3}
                        onChange={() =>
                          setSelected((old) =>
                            old.includes(t.id)
                              ? old.filter((i) => i !== t.id)
                              : old.length < 3
                                ? [...old, t.id]
                                : old,
                          )
                        }
                      />
                      对照
                    </label>
                    <button type="button" disabled={busy} onClick={() => void use(t.id)}>
                      使用模板
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {!items.length && <p className="sw-empty">没有符合条件的模板，试试其他筛选。</p>}
        </section>
        {!comparing && (
          <aside className="sw-gallery-detail" aria-label="当前模板预览">
            {renderPreview(previewId)}
          </aside>
        )}
        {comparing && (
          <section className="sw-gallery-comparison">
            <header>
              <h3>候选对照 · {selected.length} 套</h3>
              <button type="button" onClick={backToList}>
                返回模板列表
              </button>
            </header>
            <div
              className="sw-gallery-compare-grid"
              style={{ gridTemplateColumns: `repeat(${selected.length},minmax(0,1fr))` }}
            >
              {selected.map(renderPreview)}
            </div>
          </section>
        )}
      </div>
      <footer className="sw-gallery-footer" hidden={comparing}>
        <span>已选 {selected.length} / 3 套对照</span>
        <button
          type="button"
          disabled={selected.length < 2}
          onClick={(e) => {
            compareReturn.current = e.currentTarget;
            setComparing(true);
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLButtonElement>(".sw-gallery-comparison > header button")
                ?.focus({ preventScroll: true }),
            );
          }}
        >
          对照所选模板
        </button>
      </footer>
    </ModalSurface>
  );
}
