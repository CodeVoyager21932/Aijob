import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { resumeRichPlain, type AssistantSession, type ResumeStudioDraft } from "@aijob/contracts";
import {
  adoptAssistant,
  assistantStatus,
  createAssistant,
  getAssistant,
  sendAssistant,
} from "../../api/career-assistant";
import { createIdempotencyKey, subscribeToSessionBoundary } from "../../api/client";
import { aiFailureMessage } from "./ai-errors";
export function StudioInlineAssistant({
  draft,
  entryId,
  initialIntent,
  flush,
  refresh,
  close,
}: {
  draft: ResumeStudioDraft;
  entryId: string | null;
  initialIntent: string;
  flush: () => Promise<ResumeStudioDraft | null>;
  refresh: (remember?: boolean) => Promise<void>;
  close: () => void;
}) {
  const [session, setSession] = useState<AssistantSession | null>(null),
    [message, setMessage] = useState(initialIntent),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const current = useRef(true),
    adopted = useRef(new Set<string>()),
    pending = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    current.current = true;
    const off = subscribeToSessionBoundary(() => {
      current.current = false;
      setSession(null);
      setMessage("");
    });
    return () => {
      current.current = false;
      off();
    };
  }, []);
  const status = useQuery({
    queryKey: ["career-os", "assistant-status"],
    queryFn: assistantStatus,
  });
  const polling = useQuery({
    queryKey: ["career-os", "studio-assistant", session?.id],
    enabled: Boolean(session?.turns.some((t) => t.status === "queued")),
    queryFn: () => getAssistant(session!.id),
    refetchInterval: (q) => (q.state.data?.turns.some((t) => t.status === "queued") ? 1000 : false),
  });
  useEffect(() => {
    if (polling.data && current.current && (!session || polling.data.revision > session.revision))
      setSession(polling.data);
  }, [polling.data, session]);
  const latest = session?.turns.at(-1),
    result = latest?.result,
    waiting = session?.turns.some((t) => t.status === "queued") ?? false;
  const entry = draft.content.sections.flatMap((s) => s.entries).find((e) => e.id === entryId);
  async function send(intent: "continue" | "draft" | "skip" = "continue", fixed = false) {
    setBusy(true);
    setNotice("");
    try {
      const saved = await flush();
      if (!saved) throw new Error("请先处理保存问题，你的输入仍保留。");
      let active = session;
      if (!active) {
        const focus = entryId
          ? saved.content.sections.flatMap((s) => s.entries).find((e) => e.id === entryId)
          : undefined;
        const created = await createAssistant({
          task: "resume_review",
          title: focus
            ? `整理：${focus.title || focus.organization || "当前条目"}`
            : "审阅整份简历",
          context: {
            documentId: saved.documentId,
            experienceIds: focus?.experienceId ? [focus.experienceId] : [],
            initialText: focus
              ? `本次主要帮助条目 ${focus.id}，标题：${focus.title}。保留完整上下文，修改限于当前条目。`
              : "审阅当前稿件的选材、顺序、贡献表达与重复内容。",
          },
        });
        active = created;
        if (current.current) setSession(created);
      }
      const signature = `${active.id}:${active.revision}:${intent}:${fixed}:${message}`;
      if (pending.current?.signature !== signature)
        pending.current = { signature, key: createIdempotencyKey() };
      const response = await sendAssistant(
        active.id,
        { expectedRevision: active.revision, message, intent, mode: fixed ? "fixed" : "ai" },
        pending.current.key,
      );
      if (current.current) {
        setSession(response);
        setMessage("");
        setSelected([]);
        pending.current = null;
      }
    } catch (error) {
      if (current.current)
        setNotice(error instanceof Error ? error.message : "本轮未完成，请重试。");
    } finally {
      if (current.current) setBusy(false);
    }
  }
  async function adopt() {
    if (!latest || !selected.length) return;
    setBusy(true);
    setNotice("");
    try {
      const saved = await flush();
      if (!saved) throw new Error("请先完成当前保存。");
      await adoptAssistant(
        latest.id,
        { target: "resume", changeIds: selected, expectedDraftRevision: saved.revision },
        createIdempotencyKey(),
      );
      for (const id of selected) adopted.current.add(`${latest.id}:${id}`);
      await refresh(true);
      if (current.current) {
        setSelected([]);
        setNotice("已采用到当前稿件，可以在顶部撤销。");
      }
    } catch (error) {
      if (current.current) setNotice(error instanceof Error ? error.message : "采用未成功。");
    } finally {
      if (current.current) setBusy(false);
    }
  }
  return (
    <div className="sw-inline-assistant">
      <header>
        <div>
          <h2>{entry ? "整理这条经历" : "审阅整份简历"}</h2>
          <p>{entry?.title || entry?.organization || draft.title}</p>
        </div>
        <button type="button" onClick={close}>
          收起助手
        </button>
      </header>
      {!status.data?.enabled && (
        <p className="sw-ai-config">
          连接自己的 API 后可以获得动态追问和改写。<Link to="/settings/ai">配置 API</Link>
        </p>
      )}
      <div className="sw-ai-conversation">
        {session?.turns.map((turn) => (
          <article key={turn.id}>
            <p className="sw-ai-user">
              {turn.userMessage || (turn.intent === "draft" ? "先形成一版" : "继续")}
            </p>
            {turn.status === "queued" ? (
              <output>
                {turn.executionStatus === "processing" ? "正在结合材料思考…" : "正在等待处理…"}
              </output>
            ) : turn.status === "failed" ? (
              <p role="alert">{aiFailureMessage(turn.failureCode)}</p>
            ) : (
              <>
                <small>
                  {turn.status === "fixed" ? "固定写作提示" : `AI · ${turn.model ?? "你的模型"}`}
                </small>
                <p>{turn.result?.reply}</p>
                {turn.result?.question && <strong>{turn.result.question}</strong>}
              </>
            )}
          </article>
        ))}
      </div>
      {!!result?.changes.length && (
        <section className="sw-ai-changes">
          <h3>修改对照</h3>
          {result.changes.map((change) => {
            const original = draft.content.sections
              .flatMap((s) => s.entries)
              .find((e) => e.id === change.entryId);
            return (
              <article key={change.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(change.id)}
                    disabled={adopted.current.has(`${latest!.id}:${change.id}`)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, change.id]
                          : selected.filter((id) => id !== change.id),
                      )
                    }
                  />
                  {change.reason}
                </label>
                <div>
                  <small>当前内容</small>
                  <p>
                    {change.target === "headline"
                      ? draft.content.basics.headline
                      : change.target === "entry_title"
                        ? original?.title
                        : original
                          ? resumeRichPlain(original.body)
                          : "模块顺序"}
                  </p>
                  <small>建议修改</small>
                  <p>{change.text || change.sectionIds.join(" → ")}</p>
                </div>
              </article>
            );
          })}
          <button
            type="button"
            className="studio-primary"
            disabled={busy || !selected.length}
            onClick={() => void adopt()}
          >
            采用所选修改
          </button>
        </section>
      )}
      {notice && <output>{notice}</output>}
      <label className="studio-label">
        告诉助手你的想法
        <textarea
          value={message}
          maxLength={12000}
          rows={4}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="可以补充背景、说明自己的贡献，或提出具体修改要求"
        />
      </label>
      <div className="sw-ai-actions">
        <button
          type="button"
          className="studio-primary"
          disabled={busy || waiting || !status.data?.enabled || !message.trim()}
          onClick={() => void send()}
        >
          发送给 AI
        </button>
        <button
          type="button"
          disabled={busy || waiting || !status.data?.enabled}
          onClick={() => void send("draft")}
        >
          先形成一版
        </button>
        <button
          type="button"
          disabled={busy || waiting || !status.data?.enabled}
          onClick={() => void send("skip")}
        >
          跳过这个问题
        </button>
        {!status.data?.enabled && (
          <button type="button" disabled={busy} onClick={() => void send("continue", true)}>
            查看固定写作提示
          </button>
        )}
      </div>
      {session && <Link to={`/assistant?sessionId=${session.id}`}>在完整助手中继续</Link>}
    </div>
  );
}
