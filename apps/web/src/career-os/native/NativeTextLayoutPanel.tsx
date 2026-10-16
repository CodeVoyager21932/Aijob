import type { NativeResumeDocument, NativeTextLayout } from "@aijob/resume-core";
import { useEffect, useRef, useState } from "react";
import { validNativeFieldBreak } from "./NativeBasicField";
import {
  type NativeTextRange,
  type NativeTextSelection,
  type NativeTextTarget,
  validNativeTextRange,
} from "./preview-text-targets";
import {
  nativeEffectiveTextLayout,
  nativeRangeFontSize,
  patchNativeTextLayout,
  resetNativeTextLayout,
  setNativeTextRangeSize,
} from "./text-layout-edit";
import "./native-text-layout.css";

type Edit = (key: string, change: (draft: NativeResumeDocument) => void) => void;

export function NativeTextLayoutPanel({
  document,
  targets,
  selection,
  edit,
  select,
  close,
  selectionNotice,
}: {
  document: NativeResumeDocument;
  targets: NativeTextTarget[];
  selection: NativeTextSelection | null;
  edit: Edit;
  select: (selection: NativeTextSelection) => void;
  close: () => void;
  selectionNotice?: string;
}) {
  const target = selection?.target;
  const uniqueTargets = [...new Map(targets.map((value) => [value.targetId, value])).values()];
  const currentTarget = target && targets.find((value) => value.targetId === target.targetId);
  return (
    <section className="native-text-layout-panel" aria-label="局部排版">
      <header>
        <div>
          <p>局部排版</p>
          <h2>选哪里，调哪里</h2>
        </div>
        <button type="button" onClick={close}>
          返回内容编辑
        </button>
      </header>
      <p className="native-text-layout-intro">
        点选右侧纸张中的标题、正文或联系方式；拖选一段文字，可只调整选中字的字号。
      </p>
      {selectionNotice && <output className="native-text-stale">{selectionNotice}</output>}
      <label className="native-text-target-picker">
        调整对象
        <select
          aria-label="局部调整对象"
          value={currentTarget?.targetId ?? ""}
          onChange={(event) => {
            const next = targets.find((value) => value.targetId === event.target.value);
            if (next) select({ target: next });
          }}
        >
          <option value="" disabled>
            从纸张中点选，或在此选择
          </option>
          {uniqueTargets.map((value) => (
            <option key={value.targetId} value={value.targetId}>
              {value.label} · {value.text.replace(/\s+/g, " ").slice(0, 36)}
            </option>
          ))}
        </select>
      </label>
      {currentTarget && selection ? (
        <NativeTextBlockControls
          key={`${currentTarget.targetId}:${currentTarget.text}`}
          document={document}
          target={currentTarget}
          selectedRange={target?.text === currentTarget.text ? selection.range : undefined}
          edit={edit}
        />
      ) : (
        <div className="native-text-layout-empty">
          从“调整对象”选择一个标题或段落，即可开始。所有调整都可撤销，正文内容保持不变。
        </div>
      )}
    </section>
  );
}

export function NativeTextBlockControls({
  document,
  target,
  selectedRange,
  edit,
}: {
  document: NativeResumeDocument;
  target: NativeTextTarget;
  selectedRange: NativeTextRange | undefined;
  edit: Edit;
}) {
  const layout = nativeEffectiveTextLayout(document, target);
  const stored = document.textLayout?.[target.targetId];
  const stale = target.stale || (!!stored && stored.sourceText !== target.text);
  const [range, setRange] = useState<NativeTextRange | undefined>(selectedRange);
  const [scope, setScope] = useState<"block" | "selection">(() =>
    validNativeTextRange(target.text, selectedRange) ? "selection" : "block",
  );
  const [cursor, setCursor] = useState<number | null>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  const activeRange =
    scope === "selection" && validNativeTextRange(target.text, range) ? range : undefined;
  const currentSize = nativeRangeFontSize(layout, activeRange, target.defaultFontSize);
  const [sizeInput, setSizeInput] = useState(currentSize === null ? "" : String(currentSize));
  const [sizeError, setSizeError] = useState("");
  const panelId = "native-text-block";
  useEffect(() => {
    setRange(selectedRange);
    setScope(validNativeTextRange(target.text, selectedRange) ? "selection" : "block");
    setCursor(null);
    if (selectedRange) source.current?.setSelectionRange(selectedRange.start, selectedRange.end);
  }, [selectedRange, target.text]);
  useEffect(() => {
    setSizeInput(currentSize === null ? "" : String(currentSize));
    setSizeError("");
  }, [currentSize]);
  const patch = (key: string, value: Partial<NativeTextLayout>) =>
    edit(`text-layout:${target.targetId}:${key}`, (draft) =>
      patchNativeTextLayout(draft, target, value),
    );
  const changeSize = (next: number) => {
    if (scope === "selection" && !activeRange) return;
    edit(
      `text-layout:${target.targetId}:size:${activeRange ? `${activeRange.start}-${activeRange.end}` : "block"}`,
      (draft) => {
        if (activeRange) setNativeTextRangeSize(draft, target, activeRange, next);
        else patchNativeTextLayout(draft, target, { fontSize: next, ranges: [] });
      },
    );
    setSizeInput(String(next));
    setSizeError("");
  };
  const validSize = (value: string) =>
    value.trim() &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 9.5 &&
    Number(value) <= 36 &&
    (Number(value) * 2) % 1 === 0;
  const commitSize = () => {
    if (!validSize(sizeInput)) {
      setSizeError("请输入 9.5–36 pt，按 0.5 pt 调整。");
      return;
    }
    if (Number(sizeInput) !== currentSize) changeSize(Number(sizeInput));
    else setSizeError("");
  };
  const stepSize = (delta: number) => {
    const base = validSize(sizeInput)
      ? Number(sizeInput)
      : (currentSize ?? layout?.fontSize ?? target.defaultFontSize);
    changeSize(Math.min(36, Math.max(9.5, Math.round((base + delta) * 2) / 2)));
  };
  const updateSelection = (input: HTMLTextAreaElement) => {
    const next = { start: input.selectionStart, end: input.selectionEnd };
    if (validNativeTextRange(target.text, next)) {
      setRange(next);
      setScope("selection");
      setCursor(null);
    } else {
      setRange(undefined);
      setScope("block");
      setCursor(input.selectionStart === input.selectionEnd ? input.selectionStart : null);
    }
  };
  const validCursor = validNativeFieldBreak(target.text, cursor);
  const sidebarField =
    document.presentation?.id === "studio-sidebar-cn" &&
    (target.targetId === "basics:headline" || target.targetId === "basics:email")
      ? (target.targetId.slice(7) as "headline" | "email")
      : null;
  return (
    <div className="native-text-block-controls">
      {stale && (
        <output className="native-text-stale">
          这段内容已变动，旧局部格式暂未应用。重新调整会按当前文字保存，也可恢复本块默认。
        </output>
      )}
      <div className="native-text-source-heading">
        <label htmlFor={`${panelId}-source`}>{target.label} · 选字区</label>
        <span>只读原文</span>
      </div>
      <textarea
        ref={source}
        id={`${panelId}-source`}
        aria-label="局部排版选字区"
        value={target.text}
        readOnly
        rows={Math.min(7, Math.max(2, Math.ceil(target.text.length / 32)))}
        onSelect={(event) => updateSelection(event.currentTarget)}
        onKeyUp={(event) => updateSelection(event.currentTarget)}
      />
      <fieldset className="native-text-scope" aria-label="字号作用范围">
        <button type="button" aria-pressed={scope === "block"} onClick={() => setScope("block")}>
          整个文字块
        </button>
        <button
          type="button"
          aria-pressed={scope === "selection"}
          disabled={!validNativeTextRange(target.text, range)}
          onClick={() => setScope("selection")}
        >
          选中的文字
        </button>
      </fieldset>
      <p className="native-text-scope-description" aria-live="polite">
        {activeRange ? (
          <>
            仅调整：<q>{target.text.slice(activeRange.start, activeRange.end)}</q>
          </>
        ) : (
          "整块字号会统一该块文字；换行和位置始终作用于整个文字块。"
        )}
      </p>
      <div className="native-text-font-row">
        <label htmlFor={`${panelId}-size`}>字号 · pt</label>
        <div className="native-text-size-input">
          <button
            type="button"
            aria-label="减小局部字号"
            disabled={currentSize !== null && currentSize <= 9.5}
            onClick={() => stepSize(-0.5)}
          >
            A−
          </button>
          <input
            id={`${panelId}-size`}
            aria-label="局部字号"
            type="number"
            min={9.5}
            max={36}
            step={0.5}
            value={sizeInput}
            placeholder={currentSize === null ? "混合" : undefined}
            aria-invalid={!!sizeError}
            aria-describedby={sizeError ? `${panelId}-error` : undefined}
            onChange={(event) => setSizeInput(event.target.value)}
            onBlur={() => {
              if (sizeInput || currentSize !== null) commitSize();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitSize();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setSizeInput(currentSize === null ? "" : String(currentSize));
                setSizeError("");
              }
            }}
          />
          <button
            type="button"
            aria-label="增大局部字号"
            disabled={currentSize !== null && currentSize >= 36}
            onClick={() => stepSize(0.5)}
          >
            A+
          </button>
        </div>
      </div>
      {sizeError && (
        <p role="alert" id={`${panelId}-error`}>
          {sizeError}
        </p>
      )}
      <fieldset className="native-text-line-controls">
        <legend>整块换行</legend>
        <button
          type="button"
          aria-pressed={!layout?.lineMode || layout.lineMode === "auto"}
          onClick={() => patch("line-mode", { lineMode: "auto" })}
        >
          自动换行
        </button>
        <button
          type="button"
          aria-pressed={layout?.lineMode === "single"}
          onClick={() => patch("line-mode", { lineMode: "single" })}
        >
          保持一行
        </button>
        <button
          type="button"
          aria-pressed={layout?.lineMode === "manual"}
          disabled={!validCursor}
          onClick={() => {
            if (validNativeFieldBreak(target.text, cursor))
              patch("line-mode", { lineMode: "manual", breakAfter: cursor });
          }}
        >
          在光标处换行
        </button>
      </fieldset>
      <p className="native-text-help">
        在上方选字区点选两字之间，可指定换行；选中几个字，可只调整它们的字号。
      </p>
      {layout?.lineMode === "manual" && layout.breakAfter !== undefined && (
        <output className="native-text-break-preview" aria-label="局部指定换行效果">
          <span>{target.text.slice(0, layout.breakAfter)}</span>
          <span>{target.text.slice(layout.breakAfter)}</span>
        </output>
      )}
      <fieldset className="native-text-position-controls">
        <legend>整块位置与间距</legend>
        <label>
          对齐方式
          <select
            aria-label="局部对齐方式"
            disabled={target.alignmentAvailable === false}
            aria-describedby={
              target.alignmentAvailable === false ? `${panelId}-alignment-hint` : undefined
            }
            value={layout?.textAlign ?? "default"}
            onChange={(event) =>
              patch("align", {
                textAlign:
                  event.target.value === "default"
                    ? undefined
                    : (event.target.value as NativeTextLayout["textAlign"]),
              })
            }
          >
            <option value="default">模板默认</option>
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option>
            <option value="justify">两端对齐</option>
          </select>
          {target.alignmentAvailable === false && (
            <small id={`${panelId}-alignment-hint`} className="native-text-help">
              这个文字框紧贴内容，可用缩进调整位置。
            </small>
          )}
        </label>
        {sidebarField && (
          <label>
            所在区域
            <select
              aria-label="局部所在区域"
              value={document.fieldLayout?.[sidebarField]?.position ?? "auto"}
              onChange={(event) =>
                edit(`field-layout:${sidebarField}:position`, (draft) => {
                  draft.fieldLayout ??= {};
                  draft.fieldLayout[sidebarField] = {
                    ...draft.fieldLayout[sidebarField],
                    position: event.target.value as "auto" | "sidebar" | "main",
                  };
                })
              }
            >
              <option value="auto">自动选择</option>
              <option value="sidebar">左侧身份栏</option>
              <option value="main">右侧宽页首</option>
            </select>
          </label>
        )}
        {(
          [
            ["inset", "增加左侧缩进", 36],
            ["spaceBefore", "段前间距", 24],
            ["spaceAfter", "段后间距", 24],
          ] as const
        ).map(([key, label, max]) => (
          <label key={key}>
            {label} · pt
            <input
              aria-label={label}
              type="number"
              min={0}
              max={max}
              step={1}
              value={layout?.[key] ?? ""}
              placeholder="模板默认"
              onChange={(event) => {
                const value = Number(event.target.value);
                if (event.target.value === "") patch(key, { [key]: undefined });
                else if (
                  event.target.value !== "" &&
                  Number.isFinite(value) &&
                  value >= 0 &&
                  value <= max
                )
                  patch(key, { [key]: value });
              }}
            />
          </label>
        ))}
      </fieldset>
      <footer>
        <button
          type="button"
          disabled={!stored}
          onClick={() =>
            edit(`text-layout:${target.targetId}:reset`, (draft) =>
              resetNativeTextLayout(draft, target.targetId),
            )
          }
        >
          恢复本块默认
        </button>
        <p>自动保存，支持顶部撤销与重做。不会自动缩字或删内容；超过一页时需调整后再下载。</p>
      </footer>
    </div>
  );
}
