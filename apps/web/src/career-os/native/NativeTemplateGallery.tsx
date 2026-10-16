import {
  type NativeResumeDocument,
  type NativeTemplateId,
  nativeTemplateCatalog,
  recommendedNativeTemplateIds,
} from "@aijob/resume-core";
import { useEffect, useRef, useState } from "react";
import { apiRequest, createIdempotencyKey, ProductApiError } from "../../api/client";
import { NativeTemplatePreview, NativeTemplateSamplePreview } from "./NativeTemplatePreview";
import { templateSpecimens } from "./template-specimens";

type Preference = {
  templateId: string;
  favorite: boolean;
  revision: number;
  lastUsedAt: string | null;
};
const studioEnabled = import.meta.env.VITE_ENABLE_STUDIO_TEMPLATES !== "false";
const recommended = new Set<string>(recommendedNativeTemplateIds);
const availableTemplates = nativeTemplateCatalog.filter(
  (item) => studioEnabled || !item.id.startsWith("studio-"),
);

export function NativeTemplateGallery({
  document,
  documentId,
  revision,
  close,
  apply,
}: {
  document: NativeResumeDocument;
  documentId: string;
  revision: number;
  close: () => void;
  apply: (id: NativeTemplateId) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<NativeTemplateId>(
    studioEnabled
      ? document.presentation?.id && recommended.has(document.presentation.id)
        ? document.presentation.id
        : "studio-campus-cn"
      : (document.presentation?.id ?? "lapis-cn"),
  );
  const [contentMode, setContentMode] = useState<"sample" | "personal">("sample");
  const [query, setQuery] = useState("");
  const [mobileView, setMobileView] = useState("list");
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [view, setView] = useState(studioEnabled ? "recommended" : "all");
  const [columns, setColumns] = useState("all");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const receipt = useRef<{ fingerprint: string; key: string } | null>(null);
  useEffect(() => {
    let active = true;
    void apiRequest<{ items: Preference[] }>("/v2/native-template-preferences")
      .then((result) => {
        if (active) {
          setPreferences(result.items);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setError("收藏暂时无法读取，仍可浏览和应用模板。请重新打开图库重试。");
      });
    return () => {
      active = false;
    };
  }, []);
  async function favorite(id: NativeTemplateId) {
    const current = preferences.find((item) => item.templateId === id);
    const body = {
      templateId: id,
      favorite: !current?.favorite,
      expectedRevision: current?.revision ?? 0,
    };
    const fingerprint = JSON.stringify(body);
    if (receipt.current?.fingerprint !== fingerprint)
      receipt.current = { fingerprint, key: createIdempotencyKey() };
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ items: Preference[] }>("/v2/native-template-preferences", {
        method: "PUT",
        body,
        idempotencyKey: receipt.current.key,
      });
      setPreferences(result.items);
      receipt.current = null;
    } catch (failure) {
      if (failure instanceof ProductApiError && failure.status === 409) {
        try {
          const latest = await apiRequest<{ items: Preference[] }>(
            "/v2/native-template-preferences",
          );
          setPreferences(latest.items);
          receipt.current = null;
          setError("收藏已在另一个页面更新，已显示最新状态。你可以继续调整。");
        } catch {
          setError("收藏状态暂时无法同步，请重新打开图库；简历内容保持不变。");
        }
      } else setError("收藏未能保存，请重试；模板和简历内容保持不变。");
    } finally {
      setBusy(false);
    }
  }
  const filtered = availableTemplates
    .filter((item) => {
      const pref = preferences.find((pref) => pref.templateId === item.id);
      return (
        `${item.name}${item.description}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()) &&
        (columns === "all" || String(item.columns) === columns) &&
        (view === "all" ||
          (view === "recommended"
            ? recommended.has(item.id)
            : view === "favorites"
              ? pref?.favorite
              : pref?.lastUsedAt))
      );
    })
    .sort((a, b) =>
      view === "recent"
        ? (preferences.find((p) => p.templateId === b.id)?.lastUsedAt ?? "").localeCompare(
            preferences.find((p) => p.templateId === a.id)?.lastUsedAt ?? "",
          )
        : Number(recommended.has(b.id)) - Number(recommended.has(a.id)),
    );
  useEffect(() => {
    const previous = window.document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="native-template-dialog"
      aria-labelledby="native-template-title"
      data-mobile-view={mobileView}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <h2 id="native-template-title">选择简历版式</h2>
          <p>每套严格一页 A4。先看完整样张，再用你的内容比较；应用后可以继续编辑和撤销。</p>
          <nav className="native-gallery-mobile-tabs" aria-label="模板浏览视图">
            <button
              type="button"
              aria-pressed={mobileView === "list"}
              onClick={() => setMobileView("list")}
            >
              模板
            </button>
            <button
              type="button"
              aria-pressed={mobileView === "preview"}
              onClick={() => setMobileView("preview")}
            >
              预览
            </button>
          </nav>
        </div>
        <button type="button" onClick={close}>
          返回编辑
        </button>
      </header>
      <div className="native-template-body">
        <section className="native-template-list" aria-label="模板列表">
          <div className="native-template-filters">
            {view !== "recommended" && (
              <label>
                查找模板
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="名称或版式"
                />
              </label>
            )}
            <label>
              查看
              <select
                value={view}
                onChange={(event) => {
                  setView(event.target.value);
                  setQuery("");
                  setColumns("all");
                }}
              >
                {studioEnabled && (
                  <option value="recommended">
                    精选单页 · {recommendedNativeTemplateIds.length} 套
                  </option>
                )}
                <option value="all">全部版式（含旧版）</option>
                <option value="favorites">我的收藏</option>
                <option value="recent">最近使用</option>
              </select>
            </label>
            {view !== "recommended" && (
              <label>
                结构
                <select value={columns} onChange={(event) => setColumns(event.target.value)}>
                  <option value="all">全部结构</option>
                  <option value="1">单栏</option>
                  <option value="2">双栏</option>
                </select>
              </label>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
          {!filtered.length && <p>没有匹配的模板，试试切换筛选。</p>}
          <div className="native-template-cards">
            {filtered.map((item) => (
              <article key={item.id}>
                <button
                  type="button"
                  aria-pressed={selected === item.id}
                  onClick={() => {
                    setSelected(item.id);
                    setMobileView("preview");
                  }}
                >
                  {templateSpecimens[item.id] || !item.id.startsWith("studio-") ? (
                    <img
                      src={
                        templateSpecimens[item.id]?.image ??
                        `/native-templates/${item.id}-v1.png?render=native-cn-v11`
                      }
                      alt={`${item.name}完整样张`}
                      loading="lazy"
                    />
                  ) : (
                    <div className="native-template-no-image">
                      选择后查看
                      <br />
                      你的内容排版
                    </div>
                  )}
                  <strong>{item.name}</strong>
                  {templateSpecimens[item.id] && (
                    <span>{templateSpecimens[item.id]?.structure}</span>
                  )}
                  <span>{item.description}</span>
                </button>
                <button
                  type="button"
                  className="native-template-favorite"
                  disabled={busy || !loaded}
                  onClick={() => void favorite(item.id)}
                >
                  {preferences.find((pref) => pref.templateId === item.id)?.favorite
                    ? "取消收藏"
                    : "收藏"}
                </button>
              </article>
            ))}
          </div>
        </section>
        <div className="native-template-detail">
          <div className="native-template-preview-controls">
            <div>
              <strong>{nativeTemplateCatalog.find((item) => item.id === selected)?.name}</strong>
              <span>{document.presentation?.id === selected ? "当前使用" : "候选版式"}</span>
            </div>
            <nav aria-label="预览内容">
              <button
                type="button"
                aria-pressed={contentMode === "sample"}
                onClick={() => setContentMode("sample")}
              >
                完整样张
              </button>
              <button
                type="button"
                aria-pressed={contentMode === "personal"}
                onClick={() => setContentMode("personal")}
              >
                用我的内容
              </button>
            </nav>
          </div>
          {contentMode === "sample" ? (
            <NativeTemplateSamplePreview document={document} templateId={selected} />
          ) : (
            <NativeTemplatePreview
              key={selected}
              document={document}
              documentId={documentId}
              revision={revision}
              templateId={selected}
            />
          )}
          <footer>
            <span>只应用版式 · 样张不会写入你的简历</span>
            <button
              type="button"
              className="native-primary-action"
              onClick={() => {
                apply(selected);
                close();
              }}
            >
              应用这套模板
            </button>
          </footer>
        </div>
      </div>
    </dialog>
  );
}
