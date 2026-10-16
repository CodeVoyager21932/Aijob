import type { MaterialSnippet } from "@aijob/contracts";
import {
  insertNativeExperience,
  type NativeExperience,
  type NativeResumeDocument,
  nativeExperienceEntries,
} from "@aijob/resume-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, createIdempotencyKey } from "../../api/client";

function entries(document: NativeResumeDocument) {
  return [...Object.values(document.data.sections), ...document.data.customSections].flatMap(
    (section) =>
      section.items.flatMap((item) => {
        if (!("description" in item) || typeof item.description !== "string") return [];
        const values = item as unknown as Record<string, unknown>;
        const title = ["name", "school", "company", "title", "organization"]
          .map((key) => values[key])
          .find((value) => typeof value === "string" && value);
        return [
          {
            id: item.id,
            title: `${section.title} · ${title || "未命名条目"}`,
            description: item.description,
          },
        ];
      }),
  );
}
function plain(html: string) {
  return (
    new DOMParser()
      .parseFromString(html.replace(/<\/(?:p|li|div)>/gi, "$&\n"), "text/html")
      .body.textContent?.trim() ?? ""
  );
}
function paragraphs(value: string) {
  return value
    .split(/\n+/)
    .filter(Boolean)
    .map(
      (line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
    )
    .join("");
}
export function NativeMaterials({
  documentId,
  document,
  edit,
  close,
}: {
  documentId: string;
  document: NativeResumeDocument;
  edit: (key: string, change: (draft: NativeResumeDocument) => void) => void;
  close: () => void;
}) {
  const sources = useMemo(() => nativeExperienceEntries(document), [document]);
  const options = entries(document),
    dialog = useRef<HTMLDialogElement>(null),
    alive = useRef(true);
  const [target, setTarget] = useState(options[0]?.id ?? ""),
    [title, setTitle] = useState("");
  const [kind, setKind] = useState<MaterialSnippet["kind"]>("project_short");
  const [body, setBody] = useState(""),
    [items, setItems] = useState<MaterialSnippet[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [next, setNext] = useState<number | null>(0);
  const [experiences, setExperiences] = useState<
    {
      id: string;
      title: string;
      revision: number;
      experience: NativeExperience;
      legacy?: boolean;
    }[]
  >([]);
  const receipt = useRef<{ fingerprint: string; key: string } | null>(null);
  const loadSequence = useRef(0);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (offset: number) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const result = await apiRequest<{ items: MaterialSnippet[]; nextOffset: number | null }>(
        `/v1/material-snippets?offset=${offset}&limit=30`,
      );
      if (!alive.current || sequence !== loadSequence.current) return;
      setItems((previous) => (offset === 0 ? result.items : [...previous, ...result.items]));
      setNext(result.nextOffset);
    } catch {
      if (alive.current && sequence === loadSequence.current)
        setError("材料暂时无法读取，请重试。");
    } finally {
      if (alive.current && sequence === loadSequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    const previous = window.document.activeElement;
    dialog.current?.showModal();
    void load(0);
    void apiRequest<typeof experiences>("/v2/native-experiences?includeLegacy=true")
      .then((result) => {
        if (alive.current) setExperiences(result);
      })
      .catch(() => {
        if (alive.current) setError("经历暂时无法读取，请关闭后重试。");
      });
    return () => {
      alive.current = false;
      loadSequence.current++;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [load]);
  async function updateOriginal(id: string) {
    const original = experiences.find((item) => item.id === id);
    const source = sources.find((item) => item.entry.id === target);
    if (!original || original.legacy || !source) return;
    setBusy(true);
    setError("");
    try {
      const saved = await apiRequest<(typeof experiences)[number]>(`/v2/native-experiences/${id}`, {
        method: "PUT",
        body: { expectedRevision: original.revision, experience: source },
      });
      if (alive.current)
        setExperiences((previous) => previous.map((item) => (item.id === id ? saved : item)));
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : "经历原稿未更新，当前稿件保持不变。");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function save() {
    const request = {
      kind,
      title: title.trim(),
      body: body.trim(),
      sourceDocumentId: documentId,
      sourceBlockIds: target ? [target] : [],
    };
    const fingerprint = JSON.stringify(request);
    if (receipt.current?.fingerprint !== fingerprint)
      receipt.current = { fingerprint, key: createIdempotencyKey() };
    setBusy(true);
    setError("");
    try {
      const saved = await apiRequest<MaterialSnippet>("/v1/material-snippets", {
        method: "POST",
        body: request,
        idempotencyKey: receipt.current.key,
      });
      if (!alive.current) return;
      loadSequence.current++;
      setLoading(false);
      setItems((previous) => [saved, ...previous.filter((item) => item.id !== saved.id)]);
      setBody((latest) => (latest.trim() === request.body ? "" : latest));
      setTitle((latest) => (latest.trim() === request.title ? "" : latest));
      receipt.current = null;
    } catch {
      if (alive.current) setError("未能保存表达，输入仍保留，请重试。");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <dialog
      aria-label="经历与常用表达"
      ref={dialog}
      className="native-template-dialog native-material-dialog"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <h2>经历与常用表达</h2>
          <p>保存可复用的介绍；插入只修改当前稿件，可以撤销。</p>
        </div>
        <button type="button" onClick={close}>
          返回编辑
        </button>
      </header>
      <div className="native-material-body">
        {error && (
          <p role="alert">
            {error}
            <button type="button" onClick={() => void load(0)}>
              重新读取
            </button>
          </p>
        )}
        <label>
          当前条目
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">不关联条目</option>
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary>取用完整经历（{experiences.length}）</summary>
          <p>新增或导入的经历自动收录；取用后编辑只改当前稿。</p>
          {experiences.map((item) => (
            <article key={item.id} className="native-contact-entry">
              <h3>{item.title}</h3>
              <p>{plain(item.experience.entry.description)}</p>
              <p>
                <Link to={`/assistant?task=experience&experienceId=${item.id}`}>
                  和助手整理这段经历
                </Link>{" "}
                ·{" "}
                <Link to={`/assistant?task=interview&experienceId=${item.id}`}>用这段经历练习</Link>
              </p>
              <button
                type="button"
                disabled={
                  busy ||
                  item.legacy ||
                  !sources.some(
                    (source) =>
                      source.entry.id === target &&
                      source.type === item.experience.type &&
                      source.kind === item.experience.kind,
                  )
                }
                onClick={() => void updateOriginal(item.id)}
              >
                用当前条目更新这份原稿
              </button>
              <button
                type="button"
                onClick={() => {
                  edit(`insert:experience:${crypto.randomUUID()}`, (draft) =>
                    insertNativeExperience(draft, item.experience, crypto.randomUUID()),
                  );
                  close();
                }}
              >
                插入完整经历
              </button>
            </article>
          ))}
          {!experiences.length && <p>写下第一段项目或实习后，它会出现在这里。</p>}
        </details>
        <details>
          <summary>将当前表达保存为材料</summary>
          <button
            type="button"
            disabled={!target}
            onClick={() => {
              const selected = options.find((item) => item.id === target);
              if (selected) {
                setTitle(selected.title);
                setBody(plain(selected.description));
              }
            }}
          >
            取用当前条目正文
          </button>
          <label>
            用途
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as MaterialSnippet["kind"])}
            >
              <option value="introduction">自我介绍</option>
              <option value="project_short">项目短介绍</option>
              <option value="project_long">项目详细介绍</option>
              <option value="email">邮件</option>
              <option value="other">其他表达</option>
            </select>
          </label>
          <label>
            表达名称
            <input
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            表达正文
            <textarea
              rows={7}
              maxLength={20000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !title.trim() || !body.trim()}
            onClick={() => void save()}
          >
            {busy ? "正在保存…" : "保存常用表达"}
          </button>
        </details>
        {!items.length && <p>还没有常用表达。可以从当前经历整理一份自我介绍或项目介绍。</p>}
        {items.map((item) => (
          <article key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
            <button
              type="button"
              disabled={!target}
              onClick={() => {
                edit(`material:${item.id}:${crypto.randomUUID()}`, (draft) => {
                  for (const section of [
                    ...Object.values(draft.data.sections),
                    ...draft.data.customSections,
                  ]) {
                    const destination = section.items.find((entry) => entry.id === target);
                    if (destination && "description" in destination) {
                      destination.description = `${destination.description ?? ""}${paragraphs(item.body)}`;
                      return;
                    }
                  }
                });
                close();
              }}
            >
              追加到当前条目
            </button>
          </article>
        ))}
        {next !== null && (
          <button type="button" disabled={loading} onClick={() => void load(next)}>
            加载更多表达
          </button>
        )}
      </div>
    </dialog>
  );
}
