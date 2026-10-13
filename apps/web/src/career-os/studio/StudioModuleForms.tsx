import { memo, useState, useEffect, useRef } from "react";
import {
  blankResumeEntry,
  RESUME_MODULE_FIELDS,
  RESUME_MODULE_NAMES,
  RESUME_WRITING_HINTS,
  studioV2Columns,
  type ResumeEntryField,
  type ResumeStudioDraft,
  type ResumeStudioEntry,
  type ResumeStudioSection,
} from "@aijob/contracts";
import { RichTextField } from "./RichTextField";
export type StudioEdit = (fn: (draft: ResumeStudioDraft) => void, group?: string) => void;
export type EntryEdit = (
  id: string,
  fn: (entry: ResumeStudioEntry) => void,
  group?: string,
) => void;
const valueAt = (entry: ResumeStudioEntry, key: ResumeEntryField["key"]) =>
  key.startsWith("details.")
    ? (entry.details?.[key.slice(8) as keyof NonNullable<ResumeStudioEntry["details"]>] ?? "")
    : String(entry[key as keyof ResumeStudioEntry] ?? "");
function EntryField({
  field,
  entry,
  edit,
}: {
  field: ResumeEntryField;
  entry: ResumeStudioEntry;
  edit: EntryEdit;
}) {
  const value = valueAt(entry, field.key);
  const limits: Record<string,number> = { title:500, organization:200, role:200, location:100, startDate:40, endDate:40, degree:100, major:100, 'details.department':200, 'details.background':3000, 'details.methods':3000, 'details.results':3000, 'details.gpa':100, 'details.courses':1000, 'details.researchFocus':1000, 'details.authors':1500, 'details.venue':500, 'details.publicationStatus':100, 'details.url':2000, 'details.skillCategory':200, 'details.proficiency':200, 'details.issuer':200 };
  const change = (value: string) =>
    edit(
      entry.id,
      (e) => {
        if (field.key.startsWith("details.")) {
          e.details ??= {};
          e.details[field.key.slice(8) as keyof NonNullable<ResumeStudioEntry["details"]>] = value;
        } else (e as unknown as Record<string, string>)[field.key] = value;
      },
      `${entry.id}:${field.key}`,
    );
  return (
    <label htmlFor={`${entry.id}:${field.key}`} className={`studio-label${field.multiline ? " sw-field-wide" : ""}`}>
      {field.label}
      {field.multiline ? (
        <textarea
          id={`${entry.id}:${field.key}`}
          value={value}
          maxLength={limits[field.key] ?? 1000}
          rows={3}
          onChange={(e) => change(e.target.value)}
        />
      ) : (
        <input
          id={`${entry.id}:${field.key}`}
          value={value}
          maxLength={limits[field.key] ?? 1000}
          placeholder={
            field.key === "startDate"
              ? "2026.03"
              : field.key === "endDate"
                ? "2026.08 或 至今"
                : undefined
          }
          onChange={(e) => change(e.target.value)}
        />
      )}
    </label>
  );
}
const EntryFields = memo(
  function EntryFields({
    entry,
    kind,
    edit,
    undo,
    redo,
  }: {
    entry: ResumeStudioEntry;
    kind: ResumeStudioSection["kind"];
    edit: EntryEdit;
    undo: () => void;
    redo: () => void;
  }) {
    const fields = RESUME_MODULE_FIELDS[kind],
      required = fields.filter((f) => !f.optional),
      extra = fields.filter((f) => f.optional);
    // Imported legacy fields stay editable even when they are not normally requested by this module.
    for (const key of [
      "title",
      "organization",
      "role",
      "location",
      "degree",
      "major",
      "startDate",
      "endDate",
    ] as const)
      if (entry[key] && !fields.some((f) => f.key === key))
        extra.push({
          key,
          label: {
            title: "原记录名称",
            organization: "原组织信息",
            role: "原角色信息",
            location: "原地点",
            degree: "原学历",
            major: "原专业",
            startDate: "原开始时间",
            endDate: "原结束时间",
          }[key],
          optional: true,
        });
    return (
      <>
        <div className="studio-fields">
          {required.map((f) => (
            <EntryField key={f.key} field={f} entry={entry} edit={edit} />
          ))}
        </div>
        {!!extra.length && (
          <details className="sw-extra-fields">
            <summary>
              补充信息{extra.some((f) => valueAt(entry, f.key)) ? " · 已填写" : "（按需填写）"}
            </summary>
            <div className="studio-fields">
              {extra.map((f) => (
                <EntryField key={f.key} field={f} entry={entry} edit={edit} />
              ))}
            </div>
          </details>
        )}
        <div className="sw-body-label">
          <strong>
            {kind === "skills"
              ? "实际使用说明"
              : kind === "education"
                ? "课程实践与补充说明"
                : kind === "publications"
                  ? "本人贡献与补充说明"
                  : kind === "summary"
                    ? "简介正文"
                    : "工作内容与成果"}
          </strong>
        </div>
        <RichTextField
          label={`${entry.title || entry.organization || RESUME_MODULE_NAMES[kind]}的内容`}
          value={entry.body}
          onChange={(body) =>
            edit(
              entry.id,
              (e) => {
                e.body = body;
              },
              `${entry.id}:body`,
            )
          }
          onUndo={undo}
          onRedo={redo}
        />
      </>
    );
  },
  (a, b) => a.entry === b.entry && a.kind === b.kind,
);
function Module({
  section,
  draft,
  edit,
  editEntry,
  undo,
  redo,
  assistant,
  materials,
  updateExperience,
}: {
  section: ResumeStudioSection;
  draft: ResumeStudioDraft;
  edit: StudioEdit;
  editEntry: EntryEdit;
  undo: () => void;
  redo: () => void;
  assistant: (entryId: string | null, intent?: string) => void;
  materials: (sectionId: string) => void;
  updateExperience: (entry: ResumeStudioEntry) => void;
}) {
  const [open, setOpen] = useState(true);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = root.current;
    const expand = () => setOpen(true);
    node?.addEventListener("studio-expand", expand);
    return () => node?.removeEventListener("studio-expand", expand);
  }, []);
  const mutate = (fn: (s: ResumeStudioSection) => void) =>
    edit((d) => {
      const s = d.content.sections.find((s) => s.id === section.id);
      if (s) fn(s);
    });
  return (
    <section
      ref={root}
      className={`sw-module${section.hidden ? " is-hidden" : ""}`}
      data-form-section={section.id}
    >
      <header>
        <button
          type="button"
          className="sw-module-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <h2>{section.title}</h2>
          <span>
            {section.hidden ? "已隐藏" : `${section.entries.length} 条`} {open ? "⌃" : "⌄"}
          </span>
        </button>
        <button
          type="button"
          className="sw-subtle"
          onClick={() =>
            mutate((s) => {
              s.hidden = !s.hidden;
            })
          }
        >
          {section.hidden ? "恢复显示" : "隐藏模块"}
        </button>
      </header>
      {open && (
        <>
          <p className="sw-module-hint">{RESUME_WRITING_HINTS[section.kind]}</p>
          <div className="sw-module-options">
            <label>
              模块标题
              <input
                aria-label={`修改${section.title}标题`}
                value={section.title}
                maxLength={100}
                onChange={(e) =>
                  edit((d) => {
                    d.content.sections.find((s) => s.id === section.id)!.title = e.target.value;
                  }, `${section.id}:title`)
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={section.pageBreakBefore}
                onChange={(e) =>
                  mutate((s) => {
                    s.pageBreakBefore = e.target.checked;
                  })
                }
              />
              从新页开始
            </label>
            {studioV2Columns(draft.layout) && (
              <label>
                所在栏
                <select
                  value={section.column}
                  onChange={(e) => {
                    edit((d) => {
                      d.layout.autoColumns = false;
                      d.content.sections.find((s) => s.id === section.id)!.column = e.target
                        .value as "main" | "aside";
                    });
                  }}
                >
                  <option value="main">主栏</option>
                  <option value="aside">侧栏</option>
                </select>
              </label>
            )}
          </div>
          {section.entries.map((entry, index) => (
            <div className="sw-record" key={entry.id} data-form-entry={entry.id}>
              <div className="sw-record-top">
                <strong>
                  {entry.title || entry.organization || `第 ${index + 1} 条${section.title}`}
                </strong>
                <div>
                  <button
                    type="button"
                    aria-label={`上移第 ${index + 1} 条${section.title}`}
                    disabled={!index}
                    onClick={() =>
                      mutate((s) => {
                        [s.entries[index - 1], s.entries[index]] = [
                          s.entries[index]!,
                          s.entries[index - 1]!,
                        ];
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`下移第 ${index + 1} 条${section.title}`}
                    disabled={index === section.entries.length - 1}
                    onClick={() =>
                      mutate((s) => {
                        [s.entries[index + 1], s.entries[index]] = [
                          s.entries[index]!,
                          s.entries[index + 1]!,
                        ];
                      })
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      mutate((s) =>
                        s.entries.splice(index + 1, 0, {
                          ...structuredClone(entry),
                          id: crypto.randomUUID(),
                        }),
                      )
                    }
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      editEntry(entry.id, (e) => {
                        e.hidden = !e.hidden;
                      })
                    }
                  >
                    {entry.hidden ? "恢复" : "隐藏"}
                  </button>
                  <button
                    type="button"
                    aria-label={`删除第 ${index + 1} 条${section.title}`}
                    onClick={() =>
                      mutate((s) => {
                        s.entries.splice(index, 1);
                      })
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
              <EntryFields
                entry={entry}
                kind={section.kind}
                edit={editEntry}
                undo={undo}
                redo={redo}
              />
              <div className="sw-inline-ai">
                <span>求职助手</span>
                {[
                  ["精简表达", "请精简这条记录的表达，保留具体动作、角色与事实。"],
                  ["突出贡献", "请检查这条记录中我的个人贡献是否清楚，给出有依据的改写。"],
                  [
                    "追问补充",
                    "请根据这条记录和完整经历，追问最值得澄清的信息；已讲清的内容不要重复问。",
                  ],
                ].map(([name, intent]) => (
                  <button type="button" key={name} onClick={() => assistant(entry.id, intent)}>
                    {name}
                  </button>
                ))}
              </div>
              <footer className="sw-record-footer">
                <label>
                  <input
                    type="checkbox"
                    checked={entry.pageBreakBefore}
                    onChange={(e) =>
                      editEntry(entry.id, (entry) => {
                        entry.pageBreakBefore = e.target.checked;
                      })
                    }
                  />
                  本条从新页开始
                </label>
                {entry.experienceId && (
                  <button type="button" onClick={() => updateExperience(entry)}>
                    更新经历原稿
                  </button>
                )}
              </footer>
            </div>
          ))}
          <div className="sw-module-add">
            <button
              type="button"
              onClick={() => mutate((s) => s.entries.push(blankResumeEntry(crypto.randomUUID())))}
            >
              ＋ 添加一条{section.title}
            </button>
            <button type="button" onClick={() => materials(section.id)}>
              从已有经历取用
            </button>
          </div>
        </>
      )}
    </section>
  );
}
export function StudioModuleForms(props: {
  draft: ResumeStudioDraft;
  edit: StudioEdit;
  editBasic: (key: 'name'|'headline'|'phone'|'email'|'city', value: string) => void;
  editEntry: EntryEdit;
  undo: () => void;
  redo: () => void;
  assistant: (entryId: string | null, intent?: string) => void;
  materials: (sectionId: string) => void;
  updateExperience: (entry: ResumeStudioEntry) => void;
  photo?: React.ReactNode;
}) {
  const { draft: d, edit } = props;
  return (
    <>
      <section className="sw-module sw-basics" data-form-entry="basics">
        <header>
          <h2>个人信息</h2>
          <span>写下联系你的方式</span>
        </header>
        {props.photo}
        <div className="studio-fields">
          {(
            [
              ["name", "姓名"],
              ["headline", "求职方向或简介"],
              ["phone", "电话"],
              ["email", "邮箱"],
              ["city", "所在城市"],
            ] as const
          ).map(([key, title]) => (
            <label className="studio-label" key={key}>
              {title}
              <input
                value={d.content.basics[key]}
                maxLength={key === "headline" || key === "email" ? 200 : 100}
                autoComplete={
                  key === "name"
                    ? "name"
                    : key === "email"
                      ? "email"
                      : key === "phone"
                        ? "tel"
                        : "off"
                }
                onChange={(e) => props.editBasic(key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <details className="sw-links" open={d.content.basics.links.length > 0}>
          <summary>作品与个人链接</summary>
          {d.content.basics.links.map((link, index) => (
            <div className="sw-link-row" key={link.id ?? index}>
              <label>
                名称
                <input
                  value={link.label}
                  maxLength={100}
                  onChange={(e) =>
                    edit((draft) => {
                      draft.content.basics.links[index]!.label = e.target.value;
                    }, `link:${index}:label`)
                  }
                />
              </label>
              <label>
                网址
                <input
                  value={link.url}
                  maxLength={2000}
                  placeholder="https://"
                  onChange={(e) =>
                    edit((draft) => {
                      draft.content.basics.links[index]!.url = e.target.value;
                    }, `link:${index}:url`)
                  }
                />
              </label>
              <button
                type="button"
                aria-label={`移除链接 ${link.label}`}
                onClick={() =>
                  edit((draft) => {
                    draft.content.basics.links.splice(index, 1);
                  })
                }
              >
                移除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              edit((draft) => {
                draft.content.basics.links.push({
                  id: crypto.randomUUID(),
                  label: "作品集",
                  url: "https://",
                });
              })
            }
          >
            ＋ 添加链接
          </button>
        </details>
      </section>
      {d.content.sections.map((section) => (
        <Module key={section.id} {...props} section={section} />
      ))}
    </>
  );
}
