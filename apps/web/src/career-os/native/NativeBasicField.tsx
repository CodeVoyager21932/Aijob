import type { NativeResumeDocument } from "@aijob/resume-core";
import { useEffect, useRef, useState } from "react";

export type NativeLocalField = "headline" | "email";
type FieldLayout = NonNullable<NativeResumeDocument["fieldLayout"]>[NativeLocalField];
type Edit = (key: string, change: (draft: NativeResumeDocument) => void) => void;

export function updateNativeBasicField(
  document: NativeResumeDocument,
  field: NativeLocalField,
  value: string,
) {
  if (document.data.basics[field] === value) return;
  document.data.basics[field] = value;
  const layout = document.fieldLayout?.[field];
  if (layout?.lineMode === "manual") {
    layout.lineMode = "auto";
    delete layout.breakAfter;
  }
}

/** An offset always refers to the original UTF-16 input, never the displayed PDF lines. */
export function validNativeFieldBreak(value: string, offset: number | null): offset is number {
  if (offset === null || !Number.isInteger(offset) || offset <= 0 || offset >= value.length)
    return false;
  if (!value.slice(0, offset).trim() || !value.slice(offset).trim()) return false;
  return (
    new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(value).containing(offset)
      ?.index === offset
  );
}

export function NativeBasicField({
  document,
  field,
  label,
  edit,
  active,
  open,
}: {
  document: NativeResumeDocument;
  field: NativeLocalField;
  label: string;
  edit: Edit;
  active: boolean;
  open: () => void;
}) {
  const value = document.data.basics[field];
  const originalLayout = document.fieldLayout?.[field];
  const textLayout = document.textLayout?.[`basics:${field}`];
  const unified = textLayout?.sourceText === value ? textLayout : undefined;
  const layout = unified
    ? {
        ...originalLayout,
        fontSize: unified.fontSize ?? originalLayout?.fontSize,
        lineMode: unified.lineMode ?? originalLayout?.lineMode,
        breakAfter: unified.breakAfter ?? originalLayout?.breakAfter,
      }
    : originalLayout;
  const defaultSize = Math.max(9.5, document.data.metadata.typography.body.fontSize);
  const fontSize = layout?.fontSize ?? defaultSize;
  const maxSize = unified ? 36 : 18;
  const [sizeInput, setSizeInput] = useState(String(fontSize));
  const [sizeError, setSizeError] = useState("");
  const [cursor, setCursor] = useState<number | null>(null);
  const source = useRef<HTMLInputElement>(null);
  const validCursor = validNativeFieldBreak(value, cursor);
  const panelId = `native-local-layout-${field}`;
  useEffect(() => {
    setSizeInput(String(fontSize));
    setSizeError("");
  }, [fontSize]);
  const changeLayout = (key: string, patch: FieldLayout) =>
    edit(`field-layout:${field}:${key}`, (draft) => {
      draft.fieldLayout ??= {};
      const legacyPatch = { ...patch };
      if (legacyPatch.fontSize !== undefined && legacyPatch.fontSize > 18)
        delete legacyPatch.fontSize;
      draft.fieldLayout[field] = { ...draft.fieldLayout[field], ...legacyPatch };
      if (patch?.lineMode && patch.lineMode !== "manual")
        delete draft.fieldLayout[field]?.breakAfter;
      const current = draft.textLayout?.[`basics:${field}`];
      if (current?.sourceText === value) {
        if (patch?.fontSize !== undefined) {
          current.fontSize = patch.fontSize;
          delete current.ranges;
        }
        if (patch?.lineMode) {
          current.lineMode = patch.lineMode;
          if (patch.lineMode === "manual" && patch.breakAfter !== undefined)
            current.breakAfter = patch.breakAfter;
          else delete current.breakAfter;
        }
      }
    });
  const changeSize = (next: number) => {
    setSizeInput(String(next));
    setSizeError("");
    changeLayout("font-size", { fontSize: next });
  };
  const stepSize = (delta: number) => {
    const entered = Number(sizeInput);
    const base =
      sizeInput.trim() && Number.isFinite(entered) && (entered * 2) % 1 === 0 ? entered : fontSize;
    changeSize(Math.max(9.5, Math.min(maxSize, base + delta)));
  };
  const commitSize = () => {
    const next = Number(sizeInput);
    if (
      !sizeInput.trim() ||
      next < 9.5 ||
      next > maxSize ||
      !Number.isFinite(next) ||
      (next * 2) % 1
    ) {
      setSizeError(`请输入 9.5–${maxSize} pt，按 0.5 pt 调整。`);
      return;
    }
    if (next !== fontSize) changeSize(next);
    else setSizeError("");
  };
  return (
    <div
      className={`native-local-field native-field-wide${active ? " is-active" : ""}`}
      data-native-field={`basics:${field}`}
    >
      <div className="native-local-field-heading">
        <label htmlFor={`native-basics-${field}`}>{label}</label>
        <button type="button" aria-expanded={active} aria-controls={panelId} onClick={open}>
          调整{label}排版
        </button>
      </div>
      <input
        ref={source}
        id={`native-basics-${field}`}
        value={value}
        onFocus={open}
        onSelect={(event) =>
          setCursor(
            event.currentTarget.selectionStart === event.currentTarget.selectionEnd
              ? event.currentTarget.selectionStart
              : null,
          )
        }
        onChange={(event) => {
          const next = event.target.value;
          setCursor(event.currentTarget.selectionStart);
          edit(`basics:${field}`, (draft) => updateNativeBasicField(draft, field, next));
        }}
      />
      {active && (
        <section className="native-field-layout" id={panelId} aria-label={`${label}局部排版`}>
          <div className="native-field-layout-heading">
            <strong>作用范围：整个{label}字段</strong>
            <button
              type="button"
              disabled={(!originalLayout || !Object.keys(originalLayout).length) && !textLayout}
              onClick={() => {
                edit(`field-layout:${field}:reset`, (draft) => {
                  delete draft.fieldLayout?.[field];
                  if (draft.fieldLayout && !Object.keys(draft.fieldLayout).length)
                    delete draft.fieldLayout;
                  delete draft.textLayout?.[`basics:${field}`];
                  if (draft.textLayout && !Object.keys(draft.textLayout).length)
                    delete draft.textLayout;
                });
                setSizeInput(String(defaultSize));
                setSizeError("");
              }}
            >
              恢复该字段默认
            </button>
          </div>
          <div className="native-field-layout-controls">
            <div className="native-field-size">
              <label htmlFor={`${panelId}-size`}>字号 · pt</label>
              <div>
                <button
                  type="button"
                  aria-label={`减小${label}字号`}
                  disabled={fontSize <= 9.5}
                  onClick={() => stepSize(-0.5)}
                >
                  A−
                </button>
                <input
                  id={`${panelId}-size`}
                  aria-label={`${label}字号`}
                  type="number"
                  min={9.5}
                  max={maxSize}
                  step={0.5}
                  value={sizeInput}
                  aria-invalid={!!sizeError}
                  aria-describedby={sizeError ? `${panelId}-size-error` : undefined}
                  onChange={(event) => setSizeInput(event.target.value)}
                  onBlur={commitSize}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitSize();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setSizeInput(String(fontSize));
                      setSizeError("");
                    }
                  }}
                />
                <button
                  type="button"
                  aria-label={`增大${label}字号`}
                  disabled={fontSize >= maxSize}
                  onClick={() => stepSize(0.5)}
                >
                  A+
                </button>
              </div>
            </div>
            <label>
              位置
              <select
                aria-label={`${label}位置`}
                value={layout?.position ?? "auto"}
                onChange={(event) =>
                  changeLayout("position", {
                    position: event.target.value as "auto" | "sidebar" | "main",
                  })
                }
              >
                <option value="auto">自动选择</option>
                <option value="sidebar">左侧身份栏</option>
                <option value="main">右侧宽页首</option>
              </select>
            </label>
          </div>
          {sizeError && (
            <p role="alert" id={`${panelId}-size-error`}>
              {sizeError}
            </p>
          )}
          <fieldset className="native-field-line-controls" aria-label={`${label}换行`}>
            <legend>换行</legend>
            <button
              type="button"
              aria-pressed={!layout?.lineMode || layout.lineMode === "auto"}
              onClick={() => changeLayout("line-mode", { lineMode: "auto" })}
            >
              自动排好
            </button>
            <button
              type="button"
              aria-pressed={layout?.lineMode === "single"}
              onClick={() => changeLayout("line-mode", { lineMode: "single" })}
            >
              保持一行
            </button>
            <button
              type="button"
              aria-pressed={layout?.lineMode === "manual"}
              disabled={!validCursor}
              onClick={() => {
                if (validNativeFieldBreak(value, cursor))
                  changeLayout("line-mode", { lineMode: "manual", breakAfter: cursor });
              }}
            >
              在光标处换行
            </button>
          </fieldset>
          <p className="native-field-hint">
            在上方内容框中点选两字之间，再点“在光标处换行”。只调整显示，原文不变。
          </p>
          {layout?.lineMode === "manual" && layout.breakAfter !== undefined && (
            <output className="native-field-break-preview" aria-label={`${label}指定换行效果`}>
              <span>{value.slice(0, layout.breakAfter)}</span>
              <span>{value.slice(layout.breakAfter)}</span>
            </output>
          )}
          <p className="native-field-hint">
            格式调整会自动保存，可用顶部“撤销”恢复。空间不足时不会自动缩字。
          </p>
        </section>
      )}
    </div>
  );
}
