import {
  changeNativeItems,
  type EditableNativeSection,
  type NativeResumeDocument,
  newNativeItem,
} from "@aijob/resume-core";
import type { ReactNode } from "react";
import { NativeEntry } from "./NativeEntry";
import { NativeEntryExtras } from "./NativeEntryExtras";
import { NativeExperienceRoles } from "./NativeExperienceRoles";

export const nativeEntryFields: Record<string, readonly (readonly [string, string])[]> = {
  education: [
    ["school", "学校"],
    ["degree", "学历"],
    ["area", "专业"],
    ["grade", "成绩／绩点"],
    ["location", "学校所在地"],
    ["period", "就读时间"],
  ],
  experience: [
    ["company", "企业／组织"],
    ["position", "职位"],
    ["location", "工作地点"],
    ["period", "工作时间"],
  ],
  projects: [
    ["name", "项目名称"],
    ["role", "本人角色"],
    ["unit", "所属单位"],
    ["method", "方法"],
    ["period", "项目时间"],
  ],
  publications: [
    ["title", "论文／成果名称"],
    ["authors", "作者"],
    ["authorPosition", "本人署名顺序"],
    ["publisher", "期刊／会议"],
    ["status", "发表状态"],
    ["date", "发表时间"],
  ],
  skills: [
    ["name", "技能名称／分类"],
    ["proficiency", "实际使用说明"],
  ],
  languages: [
    ["language", "语言名称"],
    ["fluency", "水平／成绩"],
  ],
  certifications: [
    ["title", "证书名称"],
    ["issuer", "颁发机构"],
    ["date", "获得时间"],
  ],
  awards: [
    ["title", "奖项名称"],
    ["awarder", "授予单位"],
    ["date", "获奖时间"],
  ],
  volunteer: [
    ["organization", "活动／组织"],
    ["location", "活动地点"],
    ["period", "活动时间"],
  ],
  profiles: [
    ["network", "作品平台／主页类型"],
    ["username", "账号／展示名称"],
  ],
  interests: [["name", "兴趣与特长"]],
  references: [
    ["name", "推荐人姓名"],
    ["position", "推荐人职位"],
    ["phone", "推荐人联系方式"],
  ],
  summary: [],
  "cover-letter": [],
};
type Item = { id: string; hidden: boolean } & Record<string, unknown>;
export function NativeCustomSections({
  document,
  edit,
  text,
}: {
  document: NativeResumeDocument;
  edit: (key: string, change: (draft: NativeResumeDocument) => void) => void;
  text: (label: string, value: string, change: (value: string) => void) => ReactNode;
}) {
  const primaryResearchId = document.data.customSections.find(
    (section) => section.aijobKind === "research" && section.type === "projects",
  )?.id;
  return (
    <>
      {document.data.customSections
        .filter((section) => section.id !== primaryResearchId)
        .map((section) => {
          const update = (id: string, key: string, value: unknown) =>
            edit(`${id}:${key}`, (draft) => {
              const item = draft.data.customSections
                .find((value) => value.id === section.id)
                ?.items.find((value) => value.id === id);
              if (item) Object.assign(item, { [key]: value });
            });
          return (
            <section key={section.id}>
              <header>
                <h2>{section.title}</h2>
                <button
                  type="button"
                  disabled={!nativeEntryFields[section.type]}
                  onClick={() =>
                    edit(`add:${section.id}`, (draft) => {
                      const target = draft.data.customSections.find(
                        (value) => value.id === section.id,
                      );
                      if (!target) return;
                      const id = crypto.randomUUID();
                      const entry =
                        target.type === "summary"
                          ? { id, hidden: false, content: "" }
                          : target.type === "cover-letter"
                            ? { id, hidden: false, recipient: "", content: "" }
                            : newNativeItem(target.type as EditableNativeSection, id);
                      (target.items as Item[]).push(entry);
                    })
                  }
                >
                  添加{section.title}
                </button>
              </header>
              {(section.items as Item[]).map((item, index) => (
                <NativeEntry
                  key={item.id}
                  id={item.id}
                  title={String(
                    item.name || item.school || item.company || item.title || `第 ${index + 1} 条`,
                  )}
                  subtitle={[item.role, item.position, item.period, item.date]
                    .filter(Boolean)
                    .join(" · ")}
                  hidden={item.hidden}
                  initiallyOpen={
                    index === 0 || !(item.name || item.school || item.company || item.title)
                  }
                >
                  <div className="native-fields">
                    {(nativeEntryFields[section.type] ?? []).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          value={String(item[key] ?? "")}
                          onChange={(event) => update(item.id, key, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                  {(["description", "content", "recipient"] as const)
                    .filter((key) => typeof item[key] === "string")
                    .map((key) => (
                      <div key={key}>
                        {text(
                          `${section.title}${key === "recipient" ? "收件人" : "正文"}`,
                          String(item[key]),
                          (value) => update(item.id, key, value),
                        )}
                      </div>
                    ))}
                  {section.type === "experience" && (
                    <NativeExperienceRoles
                      roles={
                        (
                          section.items as NativeResumeDocument["data"]["sections"]["experience"]["items"]
                        ).find((entry) => entry.id === item.id)?.roles ?? []
                      }
                      text={text}
                      change={(key, change) =>
                        edit(`roles:${item.id}:${key}`, (draft) => {
                          const targetSection = draft.data.customSections.find(
                            (value) => value.id === section.id && value.type === "experience",
                          );
                          const target = (
                            targetSection?.items as
                              | NativeResumeDocument["data"]["sections"]["experience"]["items"]
                              | undefined
                          )?.find((value) => value.id === item.id);
                          if (target) change(target.roles);
                        })
                      }
                    />
                  )}
                  <NativeEntryExtras document={document} id={item.id} edit={edit} />
                  <fieldset className="native-item-actions" aria-label={`${section.title}条目操作`}>
                    {(["up", "down", "duplicate", "visibility", "delete"] as const).map(
                      (action) => (
                        <button
                          key={action}
                          type="button"
                          disabled={
                            (action === "up" && index === 0) ||
                            (action === "down" && index === section.items.length - 1)
                          }
                          onClick={() =>
                            edit(`${action}:${item.id}`, (draft) => {
                              const target = draft.data.customSections.find(
                                (value) => value.id === section.id,
                              );
                              if (target)
                                changeNativeItems(
                                  target.items,
                                  item.id,
                                  action,
                                  crypto.randomUUID(),
                                );
                            })
                          }
                        >
                          {
                            {
                              up: "上移",
                              down: "下移",
                              duplicate: "复制",
                              visibility: item.hidden ? "恢复显示" : "隐藏",
                              delete: "删除",
                            }[action]
                          }
                        </button>
                      ),
                    )}
                  </fieldset>
                </NativeEntry>
              ))}
            </section>
          );
        })}
    </>
  );
}
