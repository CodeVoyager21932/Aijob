import { blankResumeEntry, type ExperienceRecord, type ResumeSectionKind } from "@aijob/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { createExperience, putExperience } from "../../api/resume-studio";
import { ModalSurface } from "../components/ModalSurface";
import { RichTextField } from "./RichTextField";

export const experienceKindNames: Record<ResumeSectionKind, string> = {
  education: "教育",
  internship: "实习",
  project: "项目",
  research: "科研",
  publications: "论文与成果",
  languages: "语言能力",
  certificates: "证书",
  activity: "校园与实践",
  skills: "技能",
  awards: "荣誉奖项",
  summary: "个人简介",
  custom: "其他经历",
};
export function ExperienceEditor({
  item,
  onClose,
}: {
  item?: ExperienceRecord;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState(item?.entry ?? blankResumeEntry(crypto.randomUUID())),
    [kind, setKind] = useState<ResumeSectionKind>(item?.kind ?? "project"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const first = useRef<HTMLInputElement>(null),
    client = useQueryClient();
  return (
    <ModalSurface
      className="experience-editor resume-studio"
      ariaLabel={item ? "编辑完整经历" : "新增完整经历"}
      initialFocusRef={first}
      onClose={onClose}
      dismissible={!busy}
      closeLabel="关闭经历编辑"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void (item ? putExperience(item.id, item.revision, entry) : createExperience(kind, entry))
            .then(async () => {
              await client.invalidateQueries({ queryKey: ["career-os", "experiences"] });
              onClose();
            })
            .catch((error) =>
              setError(error instanceof Error ? error.message : "保存失败，输入仍保留。"),
            )
            .finally(() => setBusy(false));
        }}
      >
        <header>
          <p>经历与材料</p>
          <h2>{item ? "把经历补充完整" : "从一件做过的事开始"}</h2>
          <p>课堂、社团、科研和个人作品都可以写。背景、自己的工作和成果放在同一段经历里。</p>
        </header>
        <div className="studio-fields">
          <label className="studio-label">
            经历名称
            <input
              ref={first}
              required
              maxLength={180}
              value={entry.title}
              onChange={(e) => setEntry({ ...entry, title: e.target.value })}
            />
          </label>
          <label className="studio-label">
            类别
            <select
              disabled={Boolean(item)}
              value={kind}
              onChange={(e) => setKind(e.target.value as ResumeSectionKind)}
            >
              {Object.entries(experienceKindNames).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["organization", "组织 / 企业 / 学校"],
              ["role", "自己的角色"],
              ["location", "地点"],
              ["startDate", "开始时间"],
              ["endDate", "结束时间"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="studio-label">
              {label}
              <input
                value={entry[key]}
                onChange={(e) => setEntry({ ...entry, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <p className="studio-label">完整描述</p>
        <RichTextField
          value={entry.body}
          onChange={(body) => setEntry({ ...entry, body })}
          label="经历完整描述"
        />
        {item ? (
          <p>这里更新经历原稿。已经写好的简历和表达保留各自内容，可以在使用时比较调整。</p>
        ) : null}
        {error ? (
          <p role="alert" className="studio-alert">
            {error}
          </p>
        ) : null}
        <footer className="core-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" className="studio-primary" disabled={busy}>
            {busy ? "保存中…" : "保存完整经历"}
          </button>
        </footer>
      </form>
    </ModalSurface>
  );
}
