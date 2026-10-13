import {
  changeNativeItems,
  ensureNativeResearchSection,
  type NativeResumeData,
  type NativeResumeDocument,
  newNativeItem,
} from "@aijob/resume-core";
import type { ReactNode } from "react";
import { NativeCustomSections } from "./NativeCustomSections";
import { NativeEntry } from "./NativeEntry";
import { NativeEntryExtras } from "./NativeEntryExtras";

type Edit = (key: string, change: (draft: NativeResumeDocument) => void) => void;
type Text = (label: string, value: string, change: (value: string) => void) => ReactNode;
type Base = { id: string; hidden: boolean };
type StringKey<T> = {
  [K in keyof T]-?: Exclude<T[K], undefined> extends string ? K : never;
}[keyof T];

function Entries<T extends Base>({
  title,
  items,
  fields,
  add,
  update,
  action,
  rich,
  extras,
}: {
  title: string;
  items: T[];
  fields: readonly (readonly [StringKey<T>, string])[];
  add: () => void;
  update: (id: string, key: StringKey<T>, value: string) => void;
  action: (id: string, action: "up" | "down" | "duplicate" | "visibility" | "delete") => void;
  rich?: (item: T) => ReactNode;
  extras?: (item: T) => ReactNode;
}) {
  return (
    <section>
      <header>
        <h2>{title}</h2>
        <button type="button" onClick={add}>
          添加{title}
        </button>
      </header>
      {items.map((item, index) => (
        <NativeEntry
          key={item.id}
          id={item.id}
          title={(fields[0] ? String(item[fields[0][0]]) : "") || `填写${title}`}
          subtitle={fields
            .slice(1, 4)
            .map(([key]) => String(item[key] ?? ""))
            .filter(Boolean)
            .join(" · ")}
          hidden={item.hidden}
          initiallyOpen={index === 0 || !fields[0] || !item[fields[0][0]]}
        >
          <div className="native-fields">
            {fields.map(([key, label]) => (
              <label key={String(key)}>
                {label}
                <input
                  value={String(item[key] ?? "")}
                  onChange={(event) => update(item.id, key, event.target.value)}
                />
              </label>
            ))}
          </div>
          {rich?.(item)}
          {extras?.(item)}
          <fieldset className="native-item-actions" aria-label={`${title}条目操作`}>
            <button type="button" disabled={index === 0} onClick={() => action(item.id, "up")}>
              上移
            </button>
            <button
              type="button"
              disabled={index === items.length - 1}
              onClick={() => action(item.id, "down")}
            >
              下移
            </button>
            <button type="button" onClick={() => action(item.id, "duplicate")}>
              复制
            </button>
            <button type="button" onClick={() => action(item.id, "visibility")}>
              {item.hidden ? "恢复显示" : "隐藏"}
            </button>
            <button type="button" onClick={() => action(item.id, "delete")}>
              删除
            </button>
          </fieldset>
        </NativeEntry>
      ))}
    </section>
  );
}

export function NativeAdditionalSections({
  document,
  edit,
  text,
}: {
  document: NativeResumeDocument;
  edit: Edit;
  text: Text;
}) {
  const section = <
    K extends
      | "projects"
      | "publications"
      | "certifications"
      | "awards"
      | "skills"
      | "languages"
      | "volunteer"
      | "profiles"
      | "interests"
      | "references",
  >(
    kind: K,
  ) => {
    type Item = NativeResumeDocument["data"]["sections"][K]["items"][number];
    return {
      title: document.data.sections[kind].title,
      extras: (item: Item) => <NativeEntryExtras document={document} id={item.id} edit={edit} />,
      items: document.data.sections[kind].items as Item[],
      add: () =>
        edit(`add:${kind}:${crypto.randomUUID()}`, (draft) => {
          (draft.data.sections[kind].items as Item[]).push(
            newNativeItem(kind, crypto.randomUUID()),
          );
        }),
      update: (id: string, key: StringKey<Item>, value: string) =>
        edit(`${id}:${String(key)}`, (draft) => {
          const item = draft.data.sections[kind].items.find((candidate) => candidate.id === id);
          if (item) Object.assign(item, { [key]: value });
        }),
      action: (id: string, action: "up" | "down" | "duplicate" | "visibility" | "delete") =>
        edit(`${action}:${id}`, (draft) => {
          changeNativeItems(
            draft.data.sections[kind].items as Item[],
            id,
            action,
            crypto.randomUUID(),
          );
        }),
    };
  };
  const projects = section("projects"),
    papers = section("publications"),
    certificates = section("certifications"),
    awards = section("awards"),
    skills = section("skills"),
    languages = section("languages"),
    volunteer = section("volunteer"),
    profiles = section("profiles"),
    interests = section("interests"),
    references = section("references");
  type ResearchItem = NativeResumeData["sections"]["projects"]["items"][number];
  const research = document.data.customSections.find(
    (s) => s.aijobKind === "research" && s.type === "projects",
  );
  const updateResearch = (id: string, key: StringKey<ResearchItem>, value: string) =>
    edit(`${id}:${String(key)}`, (draft) => {
      const section = draft.data.customSections.find(
        (s) => s.aijobKind === "research" && s.type === "projects",
      );
      const item = section?.items.find((i) => i.id === id);
      if (item) Object.assign(item, { [key]: value });
    });
  return (
    <>
      <section>
        <header>
          <h2>个人简介</h2>
        </header>
        {text("个人简介正文", document.data.summary.content, (value) =>
          edit("summary", (draft) => {
            draft.data.summary.content = value;
          }),
        )}
      </section>
      <Entries
        {...projects}
        fields={[
          ["name", "项目名称"],
          ["role", "本人角色"],
          ["period", "项目时间"],
          ["unit", "项目所属单位（选填）"],
          ["method", "项目方法（选填）"],
        ]}
        rich={(item) =>
          text("项目背景、行动与成果", item.description, (value) =>
            projects.update(item.id, "description", value),
          )
        }
      />
      <Entries<ResearchItem>
        extras={(item) => <NativeEntryExtras document={document} id={item.id} edit={edit} />}
        title="科研经历"
        items={(research?.items ?? []) as ResearchItem[]}
        fields={[
          ["name", "课题名称"],
          ["unit", "研究单位"],
          ["role", "科研角色"],
          ["period", "科研时间"],
          ["method", "研究方法"],
        ]}
        add={() =>
          edit(`research:add:${crypto.randomUUID()}`, (draft) => {
            ensureNativeResearchSection(draft.data, crypto.randomUUID()).items.push(
              newNativeItem("projects", crypto.randomUUID()),
            );
          })
        }
        update={updateResearch}
        action={(id, action) =>
          edit(`research:${action}:${id}`, (draft) => {
            const section = draft.data.customSections.find(
              (s) => s.aijobKind === "research" && s.type === "projects",
            );
            if (section) changeNativeItems(section.items, id, action, crypto.randomUUID());
          })
        }
        rich={(item) =>
          text("科研过程与成果", item.description, (value) =>
            updateResearch(item.id, "description", value),
          )
        }
      />
      <Entries
        {...skills}
        fields={[
          ["name", "技能名称／分类"],
          ["proficiency", "实际使用说明"],
        ]}
        rich={(item) =>
          text("技能实践补充", item.description ?? "", (value) =>
            skills.update(item.id, "description", value),
          )
        }
      />
      <Entries
        {...papers}
        fields={[
          ["title", "论文／成果名称"],
          ["publisher", "期刊／会议"],
          ["authors", "作者"],
          ["authorPosition", "本人署名顺序"],
          ["status", "发表状态"],
          ["date", "发表时间"],
        ]}
        rich={(item) =>
          text("论文补充说明", item.description, (value) =>
            papers.update(item.id, "description", value),
          )
        }
      />
      <Entries
        {...languages}
        fields={[
          ["language", "语言名称"],
          ["fluency", "语言水平／成绩"],
        ]}
        rich={(item) =>
          text("语言使用补充", item.description ?? "", (value) =>
            languages.update(item.id, "description", value),
          )
        }
      />
      <Entries
        {...volunteer}
        fields={[
          ["organization", "校园组织／活动名称"],
          ["location", "活动地点"],
          ["period", "活动时间"],
        ]}
        rich={(item) =>
          text("校园实践内容", item.description, (value) =>
            volunteer.update(item.id, "description", value),
          )
        }
      />
      <Entries
        {...certificates}
        fields={[
          ["title", "证书名称"],
          ["issuer", "颁发机构"],
          ["date", "获得时间"],
        ]}
        rich={(item) =>
          text("证书说明", item.description, (value) =>
            certificates.update(item.id, "description", value),
          )
        }
      />
      <Entries
        {...awards}
        fields={[
          ["title", "奖项名称"],
          ["awarder", "授予单位"],
          ["date", "获奖时间"],
        ]}
        rich={(item) =>
          text("奖项说明", item.description, (value) =>
            awards.update(item.id, "description", value),
          )
        }
      />
      <Entries
        {...profiles}
        fields={[
          ["network", "作品平台／主页类型"],
          ["username", "账号／展示名称"],
        ]}
      />
      <Entries {...interests} fields={[["name", "兴趣与特长"]]} />
      <Entries
        {...references}
        fields={[
          ["name", "推荐人姓名"],
          ["position", "推荐人职位"],
          ["phone", "推荐人联系方式"],
        ]}
        rich={(item) =>
          text("推荐说明", item.description, (value) =>
            references.update(item.id, "description", value),
          )
        }
      />
      <NativeCustomSections document={document} edit={edit} text={text} />
    </>
  );
}
