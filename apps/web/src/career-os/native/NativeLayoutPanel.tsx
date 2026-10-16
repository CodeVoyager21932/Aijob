import type { NativeResumeDocument } from "@aijob/resume-core";

type Edit = (key: string, change: (draft: NativeResumeDocument) => void) => void;
export function NativeLayoutPanel({
  document,
  edit,
  close,
}: {
  document: NativeResumeDocument;
  edit: Edit;
  close: () => void;
}) {
  const data = document.data,
    m = data.metadata;
  function number(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    change: (draft: NativeResumeDocument, value: number) => void,
  ) {
    return (
      <label>
        {label}
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value) && value >= min && value <= max)
              edit(`layout:${label}`, (draft) => change(draft, value));
          }}
        />
      </label>
    );
  }
  return (
    <section className="native-layout-panel" aria-label="排版设置">
      <header>
        <h2>排版设置</h2>
        <button type="button" onClick={close}>
          收起排版
        </button>
      </header>
      <p>优先按以下设置排版；超页时会在可读范围内自动收紧。模块和顺序在内容大纲调整。</p>
      <div className="native-fields">
        <label>
          正文字体
          <select
            value={m.typography.body.fontFamily}
            onChange={(event) =>
              edit("layout:font", (draft) => {
                draft.data.metadata.typography.body.fontFamily = event.target.value;
                draft.data.metadata.typography.heading.fontFamily = event.target.value;
              })
            }
          >
            <option>Noto Sans SC</option>
            <option>Noto Serif SC</option>
          </select>
        </label>
        {number("正文 pt", m.typography.body.fontSize, 9.5, 16, 0.5, (d, v) => {
          d.data.metadata.typography.body.fontSize = v;
        })}
        {number("标题 pt", m.typography.heading.fontSize, 10, 22, 0.5, (d, v) => {
          d.data.metadata.typography.heading.fontSize = v;
        })}
        {number("行距", m.typography.body.lineHeight, 1, 2.2, 0.1, (d, v) => {
          d.data.metadata.typography.body.lineHeight = v;
        })}
        {number("左右页边距 pt", m.page.marginX, 18, 72, 1, (d, v) => {
          d.data.metadata.page.marginX = v;
        })}
        {number("上下页边距 pt", m.page.marginY, 18, 72, 1, (d, v) => {
          d.data.metadata.page.marginY = v;
        })}
        {number(
          "模块间距 pt",
          m.page.sectionGap ?? (document.presentation?.id === "lapis-cn" ? 10 : m.page.marginY),
          0,
          48,
          1,
          (d, v) => {
            d.data.metadata.page.sectionGap = v;
          },
        )}
        {number("条目间距 pt", m.page.gapY, 2, 24, 1, (d, v) => {
          d.data.metadata.page.gapY = v;
        })}
        {!m.layout.pages[0]?.fullWidth &&
          number("侧栏宽度 %", m.layout.sidebarWidth, 20, 45, 1, (d, v) => {
            d.data.metadata.layout.sidebarWidth = v;
          })}
      </div>
    </section>
  );
}
