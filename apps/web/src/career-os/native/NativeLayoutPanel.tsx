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
  const order = [...new Set(m.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]))];
  function section(draft: NativeResumeDocument, id: string) {
    if (id === "summary") return draft.data.summary;
    return (
      Object.entries(draft.data.sections).find(([key]) => key === id)?.[1] ??
      draft.data.customSections.find((value) => value.id === id)
    );
  }
  function move(id: string, direction: number) {
    edit(`module:${id}:${direction}`, (draft) => {
      for (const page of draft.data.metadata.layout.pages)
        for (const region of [page.main, page.sidebar]) {
          const index = region.indexOf(id),
            target = index + direction;
          const from = region[index],
            to = region[target];
          if (index >= 0 && from !== undefined && to !== undefined) {
            region[index] = to;
            region[target] = from;
          }
        }
    });
  }
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
    <section className="native-layout-panel" aria-label="排版与模块管理">
      <header>
        <h2>排版与模块</h2>
        <button type="button" onClick={close}>
          收起排版
        </button>
      </header>
      <button
        type="button"
        onClick={() =>
          edit(`custom:${crypto.randomUUID()}`, (draft) => {
            const id = crypto.randomUUID();
            draft.data.customSections.push({
              id,
              type: "summary",
              title: "补充材料",
              icon: "",
              columns: 1,
              hidden: false,
              keepTogether: false,
              startOnNewPage: false,
              items: [{ id: crypto.randomUUID(), hidden: false, content: "" }],
            });
            draft.data.metadata.layout.pages[0]?.main.push(id);
          })
        }
      >
        添加自定义模块
      </button>
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
        {number("正文 pt", m.typography.body.fontSize, 8, 16, 0.5, (d, v) => {
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
      <details>
        <summary>模块名称、顺序和显示</summary>
        {order.map((id) => {
          const value = section(document, id);
          if (!value) return null;
          return (
            <div className="native-module-row" key={id}>
              <label>
                模块名
                <input
                  value={value.title}
                  onChange={(event) =>
                    edit(`module:${id}:title`, (draft) => {
                      const s = section(draft, id);
                      if (s) s.title = event.target.value;
                    })
                  }
                />
              </label>
              <button
                type="button"
                onClick={() => move(id, -1)}
                aria-label={`${value.title}模块上移`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(id, 1)}
                aria-label={`${value.title}模块下移`}
              >
                ↓
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={!value.hidden}
                  onChange={(event) =>
                    edit(`module:${id}:hidden`, (draft) => {
                      const s = section(draft, id);
                      if (s) s.hidden = !event.target.checked;
                    })
                  }
                />
                显示
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={value.startOnNewPage}
                  onChange={(event) =>
                    edit(`module:${id}:page`, (draft) => {
                      const s = section(draft, id);
                      if (s) s.startOnNewPage = event.target.checked;
                    })
                  }
                />
                另起一页
              </label>
            </div>
          );
        })}
      </details>
    </section>
  );
}
