import {
  applyNativeTemplate,
  type NativeResumeDocument,
  type NativeTemplateId,
  nativeTemplateCatalog,
} from "@aijob/resume-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, createIdempotencyKey, ProductApiError } from "../../api/client";
import { NativePdfPreview } from "./NativePdfPreview";
import { nativeGallerySample } from "./native-sample";
import { StudioTemplateSchematic } from "./StudioTemplateSchematic";

type Preference = {
  templateId: string;
  favorite: boolean;
  revision: number;
  lastUsedAt: string | null;
};
const studioEnabled = import.meta.env.VITE_ENABLE_STUDIO_TEMPLATES !== "false";
const availableTemplates = nativeTemplateCatalog.filter(
  (item) => studioEnabled || !item.id.startsWith("studio-"),
);

export function NativeTemplateGallery({
  document,
  close,
  apply,
}: {
  document: NativeResumeDocument;
  close: () => void;
  apply: (id: NativeTemplateId) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<NativeTemplateId>(
    document.presentation?.id ?? "lapis-cn",
  );
  const [query, setQuery] = useState("");
  const [personal, setPersonal] = useState(false);
  const [comparison, setComparison] = useState<NativeTemplateId[]>([]);
  const [comparing, setComparing] = useState(false);
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
            ? item.id.startsWith("studio-")
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
        : Number(b.id.startsWith("studio-")) - Number(a.id.startsWith("studio-")),
    );
  const sample = useMemo(nativeGallerySample, []);
  const candidate = useMemo(
    () => applyNativeTemplate(personal ? document : sample, selected),
    [document, selected, personal, sample],
  );
  const comparisons = useMemo(
    () =>
      comparing
        ? comparison.map((id) => ({
            id,
            name: nativeTemplateCatalog.find((item) => item.id === id)?.name ?? id,
            document: applyNativeTemplate(personal ? document : sample, id),
          }))
        : [],
    [comparing, comparison, personal, document, sample],
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
      data-mobile-view={mobileView}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <h2>选择简历版式</h2>
          <p>应用只改变排版，可以撤销。</p>
          <label>
            <input
              type="checkbox"
              checked={personal}
              disabled={selected.startsWith("studio-")}
              onChange={(event) => setPersonal(event.target.checked)}
            />
            用我的内容预览已有模板
          </label>
          <nav className="native-gallery-mobile-tabs" aria-label="模板浏览视图">
            <button
              type="button"
              aria-pressed={mobileView === "list"}
              onClick={() => setMobileView("list")}
            >
              浏览模板
            </button>
            <button
              type="button"
              aria-pressed={mobileView === "preview"}
              onClick={() => setMobileView("preview")}
            >
              查看预览
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
            <label>
              搜索模板
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="名称或版式"
              />
            </label>
            <label>
              查看
              <select
                aria-label="查看"
                value={view}
                onChange={(event) => setView(event.target.value)}
              >
                {studioEnabled && <option value="recommended">四套主推</option>}
                <option value="all">全部模板（保留原有 40 套）</option>
                <option value="favorites" disabled={!loaded}>
                  我的收藏
                </option>
                <option value="recent" disabled={!loaded}>
                  最近使用
                </option>
              </select>
            </label>
            <label>
              栏位
              <select
                aria-label="栏位"
                value={columns}
                onChange={(event) => setColumns(event.target.value)}
              >
                <option value="all">单栏与双栏</option>
                <option value="1">单栏</option>
                <option value="2">双栏</option>
              </select>
            </label>
            <p aria-live="polite">{filtered.length} 套版式</p>
            <div className="native-comparison-tools">
              <span>{comparison.length}/3 套待比较</span>
              <button
                type="button"
                disabled={comparison.length < 2}
                onClick={() => {
                  setComparing(!comparing);
                  setMobileView("preview");
                }}
              >
                {comparing ? "返回单套预览" : "比较所选模板"}
              </button>
              {comparison.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setComparison([]);
                    setComparing(false);
                  }}
                >
                  清空比较
                </button>
              )}
            </div>
          </div>
          {error && <p role="alert">{error}</p>}
          {!filtered.length && <p>没有符合条件的模板，可调整筛选后继续浏览。</p>}
          {filtered.map((item) => (
            <article key={item.id}>
              <button
                type="button"
                aria-pressed={selected === item.id}
                onClick={() => {
                  setSelected(item.id);
                  setComparing(false);
                  setMobileView("preview");
                }}
              >
                {item.id.startsWith("studio-") ? (
                  <StudioTemplateSchematic id={item.id} />
                ) : (
                  <img
                    src={`/native-templates/${item.id}-v1.png?render=native-cn-v11`}
                    alt={`${item.name}中文样稿，仅展示排版`}
                    loading="lazy"
                  />
                )}
                <strong>{item.name}</strong>
                <span>{item.description}</span>
              </button>
              <label className="native-template-compare-select">
                <input
                  type="checkbox"
                  aria-label={`比较${item.name}`}
                  checked={comparison.includes(item.id)}
                  disabled={!comparison.includes(item.id) && comparison.length >= 3}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...comparison, item.id]
                      : comparison.filter((id) => id !== item.id);
                    setComparison(next);
                    if (next.length < 2) setComparing(false);
                  }}
                />
                加入比较
              </label>
              <button
                type="button"
                className="native-template-favorite"
                disabled={busy || !loaded}
                aria-label={`${preferences.find((pref) => pref.templateId === item.id)?.favorite ? "取消收藏" : "收藏"}${item.name}`}
                onClick={() => void favorite(item.id)}
              >
                {preferences.find((pref) => pref.templateId === item.id)?.favorite
                  ? "★ 已收藏"
                  : "☆ 收藏"}
              </button>
            </article>
          ))}
          <p>{availableTemplates.length} 套版式。换模板保留正文，长内容自动续页。</p>
        </section>
        <div className="native-template-detail" data-comparing={comparing}>
          {comparing ? (
            <section className="native-template-comparison" aria-label="模板对照">
              {comparisons.map((item) => (
                <section
                  key={item.id}
                  className="native-comparison-candidate"
                  aria-label={item.name}
                >
                  <h3>{item.name}</h3>
                  {item.id.startsWith("studio-") ? (
                    <StudioTemplateSchematic id={item.id} />
                  ) : (
                    <NativePdfPreview document={item.document} />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      apply(item.id);
                      close();
                    }}
                  >
                    应用{item.name}
                  </button>
                </section>
              ))}
            </section>
          ) : selected.startsWith("studio-") ? (
            <StudioTemplateSchematic id={selected} />
          ) : (
            <NativePdfPreview document={candidate} />
          )}
          <footer>
            <span>
              {selected.startsWith("studio-")
                ? "结构示意；应用后将在编辑器生成正式预览"
                : personal
                  ? "当前内容预览"
                  : "中文样稿，仅展示排版"}
              ，不会添加样稿经历
            </span>
            {comparing ? (
              <button type="button" onClick={() => setComparing(false)}>
                返回单套预览
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  apply(selected);
                  close();
                }}
              >
                应用这套模板
              </button>
            )}
          </footer>
        </div>
      </div>
    </dialog>
  );
}
