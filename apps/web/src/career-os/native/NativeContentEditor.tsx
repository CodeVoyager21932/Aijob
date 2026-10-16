import {
  changeNativeItems,
  type EditableNativeSection,
  ensureNativeResearchSection,
  type NativeResumeDocument,
  newNativeItem,
} from "@aijob/resume-core";
import { useEffect, useRef, useState } from "react";
import { SortableList } from "../ui/SortableList";
import {
  NativeBasicField,
  type NativeLocalField,
  updateNativeBasicField,
} from "./NativeBasicField";
import { NativeContactLinks } from "./NativeContactLinks";
import { nativeEntryFields } from "./NativeCustomSections";
import { NativeEntry } from "./NativeEntry";
import { NativeEntryExtras } from "./NativeEntryExtras";
import { NativeExperienceRoles } from "./NativeExperienceRoles";
import { NativePhotoEditor } from "./NativePhotoEditor";
import { NativeText } from "./NativeText";

type Edit = (key: string, change: (draft: NativeResumeDocument) => void) => void;
type Entry = { id: string; hidden: boolean } & Record<string, unknown>;
function findSection(document: NativeResumeDocument, id: string) {
  return id in document.data.sections
    ? document.data.sections[id as keyof typeof document.data.sections]
    : document.data.customSections.find((section) => section.id === id);
}
function outline(document: NativeResumeDocument) {
  const ids = [
    ...new Set(
      document.data.metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]),
    ),
  ];
  return ids.flatMap((id) => {
    if (id === "summary")
      return [
        {
          id,
          title: document.data.summary.title || "个人简介",
          count: document.data.summary.content.replace(/<[^>]*>/g, "").trim() ? 1 : 0,
          hidden: document.data.summary.hidden,
        },
      ];
    const section = findSection(document, id);
    return section
      ? [{ id, title: section.title, count: section.items.length, hidden: section.hidden }]
      : [];
  });
}
const entryName = (item: Entry) =>
  String(
    item.school ||
      item.company ||
      item.name ||
      item.title ||
      item.organization ||
      item.language ||
      item.network ||
      "未命名条目",
  );

export function NativeContentEditor({
  document,
  edit,
  focusItem,
}: {
  document: NativeResumeDocument;
  edit: Edit;
  focusItem?: { id: string; request: number } | null;
}) {
  const [active, setActive] = useState("basics");
  const [adding, setAdding] = useState(false);
  const [localField, setLocalField] = useState<NativeLocalField | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const latestDocument = useRef(document);
  latestDocument.current = document;
  const modules = outline(document);
  const visibleModules = modules.filter((item) => item.count > 0 || item.id === active);
  const emptyModules = modules.filter((item) => !item.count && item.id !== active);
  const section = findSection(document, active);
  const kind =
    active in document.data.sections
      ? active
      : section && "type" in section
        ? section.type
        : active;
  const entries = (section?.items ?? []) as Entry[];
  useEffect(() => {
    if (!focusItem) return;
    const id = focusItem.id;
    const currentDocument = latestDocument.current;
    if (
      currentDocument.presentation?.id === "studio-sidebar-cn" &&
      (id === "basics:headline" || id === "basics:email")
    ) {
      setActive("basics");
      setAdding(false);
      setLocalField(id === "basics:headline" ? "headline" : "email");
      const frame = requestAnimationFrame(() => {
        const field = content.current?.querySelector<HTMLElement>(`[data-native-field="${id}"]`);
        field?.scrollIntoView({ block: "nearest" });
        field?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
    const found = outline(currentDocument).find(
      (item) =>
        item.id === id ||
        findSection(currentDocument, item.id)?.items.some((entry) => entry.id === id),
    );
    if (found) setActive(found.id);
    requestAnimationFrame(() => {
      const entry = content.current?.querySelector<HTMLDetailsElement>(
        `[data-native-item="${CSS.escape(id)}"]`,
      );
      if (entry) {
        entry.open = true;
        entry.scrollIntoView({ block: "nearest" });
        entry.querySelector<HTMLElement>("input,[contenteditable=true]")?.focus();
      }
    });
  }, [focusItem]);
  const select = (id: string) => {
    setActive(id);
    setAdding(false);
    content.current?.scrollTo({ top: 0 });
  };
  const update = (id: string, field: string, value: unknown) =>
    edit(`${id}:${field}`, (draft) => {
      const target = findSection(draft, active)?.items.find((item) => item.id === id);
      if (target) Object.assign(target, { [field]: value });
    });
  const addEntry = () =>
    edit(`add:${active}:${crypto.randomUUID()}`, (draft) => {
      const target = findSection(draft, active);
      const id = crypto.randomUUID();
      if (target)
        (target.items as Entry[]).push(
          kind === "summary"
            ? { id, hidden: false, content: "" }
            : kind === "cover-letter"
              ? { id, hidden: false, content: "", recipient: "" }
              : (newNativeItem(kind as EditableNativeSection, id) as Entry),
        );
    });
  return (
    <div className="native-content-workspace">
      <aside className="native-outline" aria-label="简历内容大纲">
        <div className="native-outline-heading">
          <strong>内容大纲</strong>
          <span>拖动可排序</span>
        </div>
        <button
          className="native-outline-basics"
          type="button"
          aria-current={active === "basics" ? "true" : undefined}
          onClick={() => select("basics")}
        >
          个人信息
        </button>
        <SortableList
          items={visibleModules}
          label="简历模块顺序"
          name={(item) => item.title}
          move={(from, to) => {
            const source = visibleModules[from],
              target = visibleModules[to];
            if (!source || !target) return;
            edit(`module-order:${source.id}`, (draft) => {
              for (const page of draft.data.metadata.layout.pages) {
                page.main = page.main.filter((id) => id !== source.id);
                page.sidebar = page.sidebar.filter((id) => id !== source.id);
              }
              for (const page of draft.data.metadata.layout.pages)
                for (const region of [page.main, page.sidebar]) {
                  const index = region.indexOf(target.id);
                  if (index >= 0) region.splice(index + (from < to ? 1 : 0), 0, source.id);
                }
            });
          }}
        >
          {(item) => (
            <button
              type="button"
              aria-current={active === item.id ? "true" : undefined}
              className="native-outline-link"
              onClick={() => select(item.id)}
            >
              <span>{item.title}</span>
              <small>{item.hidden ? "已隐藏" : item.count}</small>
            </button>
          )}
        </SortableList>
        <button
          type="button"
          className="native-outline-add"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          ＋ 添加模块
        </button>
        {adding && (
          <div className="native-module-picker">
            {emptyModules.map((item) => (
              <button key={item.id} type="button" onClick={() => select(item.id)}>
                {item.title}
              </button>
            ))}
            {!document.data.customSections.some((item) => item.aijobKind === "research") && (
              <button
                type="button"
                onClick={() => {
                  const id = crypto.randomUUID();
                  edit(`module:${id}`, (draft) => {
                    ensureNativeResearchSection(draft.data, id);
                  });
                  select(id);
                }}
              >
                科研经历
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const id = crypto.randomUUID();
                edit(`module:${id}`, (draft) => {
                  draft.data.customSections.push({
                    id,
                    type: "summary",
                    title: "补充内容",
                    icon: "",
                    columns: 1,
                    hidden: false,
                    keepTogether: false,
                    startOnNewPage: false,
                    items: [{ id: crypto.randomUUID(), hidden: false, content: "" }],
                  });
                  draft.data.metadata.layout.pages[0]?.main.push(id);
                });
                select(id);
              }}
            >
              自定义模块
            </button>
          </div>
        )}
      </aside>
      <div className="native-form" ref={content}>
        {active === "basics" ? (
          <>
            <header className="native-section-heading">
              <div>
                <h2>个人信息</h2>
                <p>让招聘者快速知道你是谁、如何联系。</p>
              </div>
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
              ).map(([key, label]) =>
                document.presentation?.id === "studio-sidebar-cn" &&
                (key === "headline" || key === "email") ? (
                  <NativeBasicField
                    key={key}
                    document={document}
                    field={key}
                    label={label}
                    edit={edit}
                    active={localField === key}
                    open={() => setLocalField(key)}
                  />
                ) : (
                  <label key={key}>
                    {label}
                    <input
                      value={document.data.basics[key]}
                      onChange={(event) =>
                        edit(`basics:${key}`, (draft) => {
                          if (key === "headline" || key === "email")
                            updateNativeBasicField(draft, key, event.target.value);
                          else draft.data.basics[key] = event.target.value;
                        })
                      }
                    />
                  </label>
                ),
              )}
            </div>
            <NativeContactLinks document={document} edit={edit} />
          </>
        ) : active === "summary" ? (
          <>
            <header className="native-section-heading">
              <h2>{document.data.summary.title || "个人简介"}</h2>
            </header>
            <details className="native-section-options">
              <summary>修改模块名称</summary>
              <label>
                模块名称
                <input
                  value={document.data.summary.title}
                  onChange={(event) =>
                    edit("summary:title", (draft) => {
                      draft.data.summary.title = event.target.value;
                    })
                  }
                />
              </label>
            </details>
            <NativeText
              label="个人简介正文"
              value={document.data.summary.content}
              change={(value) =>
                edit("summary", (draft) => {
                  draft.data.summary.content = value;
                })
              }
            />
            <label className="native-visibility">
              <input
                type="checkbox"
                checked={!document.data.summary.hidden}
                onChange={(event) =>
                  edit("summary:visibility", (draft) => {
                    draft.data.summary.hidden = !event.target.checked;
                  })
                }
              />
              在简历中显示
            </label>
          </>
        ) : section ? (
          <>
            <header className="native-section-heading">
              <div>
                <h2>{section.title}</h2>
                <p>写清你的行动与结果。拖动条目可调整先后。</p>
              </div>
              <button type="button" onClick={addEntry}>
                ＋ 添加
              </button>
            </header>
            <details className="native-section-options">
              <summary>模块名称与显示</summary>
              <label>
                模块名称
                <input
                  value={section.title}
                  onChange={(event) =>
                    edit(`module-title:${active}`, (draft) => {
                      const target = findSection(draft, active);
                      if (target) target.title = event.target.value;
                    })
                  }
                />
              </label>
              <label className="native-visibility">
                <input
                  type="checkbox"
                  checked={!section.hidden}
                  onChange={(event) =>
                    edit(`module-visibility:${active}`, (draft) => {
                      const target = findSection(draft, active);
                      if (target) target.hidden = !event.target.checked;
                    })
                  }
                />
                在简历中显示
              </label>
            </details>
            {!entries.length && (
              <div className="native-section-empty">
                <p>加入一段{section.title}，就可以开始写了。</p>
                <button type="button" onClick={addEntry}>
                  添加第一条
                </button>
              </div>
            )}
            <SortableList
              items={entries}
              label={`${section.title}条目顺序`}
              name={entryName}
              move={(from, to) =>
                edit(`entry-order:${active}`, (draft) => {
                  const list = findSection(draft, active)?.items as Entry[] | undefined;
                  const entry = list?.splice(from, 1)[0];
                  if (entry) list?.splice(to, 0, entry);
                })
              }
            >
              {(item, index) => (
                <NativeEntry
                  id={item.id}
                  title={entryName(item)}
                  subtitle={String(item.period || item.date || "")}
                  hidden={item.hidden}
                  initiallyOpen={index === 0 || entryName(item) === "未命名条目"}
                >
                  <div className="native-fields">
                    {(nativeEntryFields[kind] ?? []).map(([key, label], fieldIndex) => (
                      <label
                        key={key}
                        className={fieldIndex === 0 ? "native-field-wide" : undefined}
                      >
                        {label}
                        <input
                          value={String(item[key] ?? "")}
                          onChange={(event) => update(item.id, key, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                  {(["description", "content", "recipient"] as const)
                    .filter((key) => key in item)
                    .map((key) => (
                      <NativeText
                        key={key}
                        label={key === "recipient" ? "收件人" : "内容与成果"}
                        value={String(item[key] ?? "")}
                        change={(value) => update(item.id, key, value)}
                      />
                    ))}
                  {Array.isArray(item.roles) && (
                    <NativeExperienceRoles
                      roles={
                        item.roles as NativeResumeDocument["data"]["sections"]["experience"]["items"][number]["roles"]
                      }
                      change={(key, change) =>
                        edit(`roles:${item.id}:${key}`, (draft) => {
                          const target = findSection(draft, active)?.items.find(
                            (entry) => entry.id === item.id,
                          );
                          if (target && "roles" in target) change(target.roles);
                        })
                      }
                      text={(label, value, change) => (
                        <NativeText label={label} value={value} change={change} />
                      )}
                    />
                  )}
                  <NativeEntryExtras document={document} id={item.id} edit={edit} />
                  <div className="native-item-actions">
                    {(
                      [
                        ["duplicate", "复制"],
                        ["visibility", item.hidden ? "恢复显示" : "隐藏这条"],
                        ["delete", "删除"],
                      ] as const
                    ).map(([action, label]) => (
                      <button
                        type="button"
                        key={action}
                        onClick={() =>
                          edit(`${action}:${item.id}`, (draft) => {
                            const list = findSection(draft, active)?.items;
                            if (list) changeNativeItems(list, item.id, action, crypto.randomUUID());
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </NativeEntry>
              )}
            </SortableList>
          </>
        ) : (
          <p>从大纲中选择要编辑的内容。</p>
        )}
      </div>
    </div>
  );
}
