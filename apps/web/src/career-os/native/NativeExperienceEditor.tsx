import {
  type NativeExperience,
  type NativeResumeData,
  parseNativeExperience,
} from "@aijob/resume-core";
import { useRef, useState } from "react";
import { apiRequest } from "../../api/client";
import { ModalSurface } from "../components/ModalSurface";
import { nativeEntryFields } from "./NativeCustomSections";
import { NativeExperienceRoles } from "./NativeExperienceRoles";
import { NativeText } from "./NativeText";
export interface NativeExperienceRecord {
  id: string;
  title: string;
  revision: number;
  experience: NativeExperience;
  updatedAt: string;
}
export function NativeExperienceEditor({
  item,
  close,
  saved,
}: {
  item: NativeExperienceRecord;
  close: () => void;
  saved: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(item.experience));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const first = useRef<HTMLInputElement>(null);
  const update = (field: string, value: unknown) =>
    setDraft((previous) => ({ ...previous, entry: { ...previous.entry, [field]: value } }));
  return (
    <ModalSurface
      className="experience-editor resume-studio"
      ariaLabel="编辑完整经历"
      initialFocusRef={first}
      dismissible={!busy}
      onClose={close}
      closeLabel="关闭经历编辑"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          void Promise.resolve()
            .then(() =>
              apiRequest(`/v2/native-experiences/${item.id}`, {
                method: "PUT",
                body: {
                  expectedRevision: item.revision,
                  experience: parseNativeExperience(draft),
                },
              }),
            )
            .then(() => {
              saved();
              close();
            })
            .catch((failure) =>
              setError(failure instanceof Error ? failure.message : "保存未完成，输入仍保留。"),
            )
            .finally(() => setBusy(false));
        }}
      >
        <header>
          <h2>编辑完整经历</h2>
          <p>更新经历原稿，已有方向稿保留各自的表达。</p>
        </header>
        <div className="studio-fields">
          {(nativeEntryFields[draft.type] ?? []).map(([key, label], index) => (
            <label className="studio-label" key={key}>
              {label}
              <input
                ref={index === 0 ? first : undefined}
                value={String(draft.entry[key] ?? "")}
                onChange={(event) => update(key, event.target.value)}
              />
            </label>
          ))}
        </div>
        <NativeText
          label="完整经历正文"
          value={draft.entry.description}
          change={(value) => update("description", value)}
        />
        {draft.type === "experience" && (
          <NativeExperienceRoles
            roles={
              (draft.entry as NativeResumeData["sections"]["experience"]["items"][number]).roles
            }
            change={(_key, change) =>
              setDraft((previous) => {
                const next = structuredClone(previous);
                change(
                  (next.entry as NativeResumeData["sections"]["experience"]["items"][number]).roles,
                );
                return next;
              })
            }
            text={(label, value, onChange) => (
              <NativeText label={label} value={value} change={onChange} />
            )}
          />
        )}
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="submit" className="studio-primary" disabled={busy}>
            保存经历原稿
          </button>
          <button type="button" disabled={busy} onClick={close}>
            返回材料
          </button>
        </footer>
      </form>
    </ModalSurface>
  );
}
