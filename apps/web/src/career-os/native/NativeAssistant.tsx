import type { AssistantSession } from "@aijob/contracts";
import { type NativeResumeDocument, parseNativeResumeDocument } from "@aijob/resume-core";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  adoptAssistant,
  assistantStatus,
  createAssistant,
  getAssistant,
  sendAssistant,
} from "../../api/career-assistant";
import { createIdempotencyKey } from "../../api/client";

export function NativeAssistant({
  open,
  documentId,
  caseId,
  revision,
  document,
  close,
  adopted,
}: {
  open: boolean;
  documentId: string;
  caseId?: string | null | undefined;
  revision: number;
  document: NativeResumeDocument;
  close: () => void;
  adopted: (
    revision: number,
    document: NativeResumeDocument,
    original: NativeResumeDocument,
  ) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    alive = useRef(true);
  const [session, setSession] = useState<AssistantSession | null>(null),
    [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const createKeys = useRef(new Map<string, string>()),
    turnRequest = useRef<{ fingerprint: string; key: string } | null>(null);
  const adoptionKeys = useRef(new Map<string, string>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      return;
    }
    const previous = window.document.activeElement;
    dialog.current?.showModal();
    let active = true;
    void assistantStatus()
      .then((status) => {
        if (active) setEnabled(status.enabled);
      })
      .catch(() => {
        if (active) setEnabled(false);
      });
    return () => {
      active = false;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);
  const waiting = session?.turns.some((turn) => turn.status === "queued") ?? false;
  useEffect(() => {
    if (!open || !waiting || !session) return;
    let active = true,
      pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void getAssistant(session.id)
        .then((next) => {
          if (active) setSession(next);
        })
        .catch(() => {
          if (active) setError("暂时无法读取进度；本轮对话仍保留，可关闭后重新打开。");
        })
        .finally(() => {
          pending = false;
        });
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, waiting, session]);
  async function send(
    mode: "ai" | "fixed",
    intent: "continue" | "draft" = "continue",
    workflow: "dialogue" | "resume_prepare" = "dialogue",
  ) {
    setBusy(true);
    setError("");
    try {
      const createKey = createKeys.current.get(workflow) ?? createIdempotencyKey();
      createKeys.current.set(workflow, createKey);
      const current =
        (session?.workflow === workflow ? session : null) ??
        (await createAssistant(
          {
            task: "resume_review",
            workflow,
            title: workflow === "resume_prepare" ? "简历起草与审阅" : "当前简历审阅",
            context: { documentId, ...(caseId ? { caseId } : {}) },
          },
          createKey,
        ));
      if (!alive.current) return;
      setSession(current);
      const input = { expectedRevision: current.revision, message, mode, intent };
      const fingerprint = JSON.stringify({ id: current.id, input });
      if (turnRequest.current?.fingerprint !== fingerprint)
        turnRequest.current = { fingerprint, key: createIdempotencyKey() };
      const response = await sendAssistant(current.id, input, turnRequest.current.key);
      if (!alive.current) return;
      setSession(response);
      setMessage((latest) => (latest === input.message ? "" : latest));
      turnRequest.current = null;
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : "本轮未发送成功，输入已保留。");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function adopt(turnId: string, changeIds: string[]) {
    const baseDocument = document,
      baseRevision = revision;
    setBusy(true);
    setError("");
    const fingerprint = `${turnId}:${changeIds.join(",")}:${baseRevision}`;
    const key = adoptionKeys.current.get(fingerprint) ?? createIdempotencyKey();
    adoptionKeys.current.set(fingerprint, key);
    try {
      const result = (await adoptAssistant(
        turnId,
        { target: "resume", expectedDraftRevision: baseRevision, changeIds },
        key,
      )) as { draft?: { revision: number; document: unknown } };
      if (!result.draft || !Number.isSafeInteger(result.draft.revision))
        throw new Error("采用结果格式异常，请重新读取版本。");
      const content = parseNativeResumeDocument(result.draft.document);
      if (alive.current) {
        adopted(result.draft.revision, content, baseDocument);
        close();
      }
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : "未采用这项修改，当前输入保持不变。");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="native-template-dialog native-material-dialog"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <h2>简历助手</h2>
          <p>根据当前稿件和你的回答审阅；建议由你选择采用，可以撤销。</p>
        </div>
        <button type="button" onClick={close}>
          返回编辑
        </button>
      </header>
      <div className="native-material-body">
        <section>
          <h3>{caseId ? "准备这个岗位的简历" : "整理当前简历"}</h3>
          <p>
            结合已有材料起草，再做一轮审阅；岗位要求只用于选材，个人经历来自你的材料。审阅未完成时，起草结果仍会保留。
          </p>
          <button
            type="button"
            disabled={busy || waiting || !enabled}
            onClick={() => void send("ai", "draft", "resume_prepare")}
          >
            起草并审阅一版建议
          </button>
          <button
            type="button"
            disabled={busy || waiting}
            onClick={() => void send("fixed", "draft", "resume_prepare")}
          >
            使用固定准备清单
          </button>
          <p>AI 起草与审阅各调用一次你选择的 API，受个人用量限制约束。</p>
        </section>
        {!enabled && (
          <p>
            尚未启用个人 API。可继续手工编辑，或查看明确标记的固定自检提示。API 在资料与设置中配置。
          </p>
        )}
        <p>
          <Link
            to={
              session
                ? `/assistant?sessionId=${session.id}`
                : `/assistant?task=resume_review&documentId=${documentId}`
            }
          >
            在完整助手中继续
          </Link>{" "}
          ·{" "}
          <Link to={`/assistant?task=interview&documentId=${documentId}`}>用这份简历练习面试</Link>
        </p>
        {error && <p role="alert">{error}</p>}
        {session?.turns.map((turn) => (
          <article key={turn.id}>
            {turn.userMessage && <p>你：{turn.userMessage}</p>}
            {turn.status === "queued" ? (
              <output>
                {turn.executionStatus === "processing" ? "正在结合材料分析…" : "等待处理…"}
              </output>
            ) : null}
            {turn.status === "failed" && (
              <p>这轮未完成：{turn.failureCode || "请求失败"}。可以保留问题重新发送。</p>
            )}
            {turn.result && (
              <>
                <strong>{turn.status === "fixed" ? "固定自检提示" : "AI 建议"}</strong>
                <p>{turn.result.reply}</p>
                {turn.result.question && <p>{turn.result.question}</p>}
                {turn.result.artifact && (
                  <div>
                    <h3>{turn.result.artifact.title}</h3>
                    <p>{turn.result.artifact.body}</p>
                  </div>
                )}
                {turn.result.preparationReview && (
                  <section>
                    <h3>
                      {turn.result.preparationReview.status === "completed"
                        ? "这一版的审阅"
                        : turn.result.preparationReview.status === "fixed"
                          ? "固定准备"
                          : "草稿已保留"}
                    </h3>
                    <p>{turn.result.preparationReview.summary}</p>
                    {turn.result.preparationReview.issues.map((issue, index) => (
                      <p key={`${issue.changeId ?? "whole"}:${index}`}>{issue.detail}</p>
                    ))}
                  </section>
                )}
                {turn.result.preparation.map((item) => (
                  <p key={item.title}>
                    <strong>{item.title}：</strong>
                    {item.detail}
                  </p>
                ))}
                {turn.result.openQuestions.length > 0 && (
                  <p>待补充：{turn.result.openQuestions.join("；")}</p>
                )}
                {turn.status === "completed" && turn.result.changes.length > 1 && (
                  <button
                    type="button"
                    disabled={
                      busy ||
                      turn.result.preparationReview?.issues.some(
                        (issue) => issue.severity === "unsupported_fact",
                      )
                    }
                    onClick={() =>
                      void adopt(turn.id, turn.result?.changes.map((change) => change.id) ?? [])
                    }
                  >
                    采用本轮修改 · 可撤销
                  </button>
                )}
                {turn.status === "completed" &&
                  turn.result.changes.map((change) => (
                    <div className="native-contact-entry" key={change.id}>
                      <p>{change.text}</p>
                      <small>{change.reason}</small>
                      <div>
                        <button
                          type="button"
                          disabled={
                            busy ||
                            turn.result?.preparationReview?.issues.some(
                              (issue) =>
                                issue.severity === "unsupported_fact" &&
                                (issue.changeId === null || issue.changeId === change.id),
                            )
                          }
                          onClick={() => void adopt(turn.id, [change.id])}
                        >
                          采用这项修改
                        </button>
                      </div>
                    </div>
                  ))}
              </>
            )}
          </article>
        ))}
        <label>
          希望怎样改进，或补充你的回答
          <textarea
            aria-label="希望怎样改进，或补充你的回答"
            rows={5}
            maxLength={12000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <div className="native-item-actions">
          <button
            type="button"
            disabled={busy || waiting || !enabled}
            onClick={() => void send("ai")}
          >
            用我的 API 继续
          </button>
          <button
            type="button"
            disabled={busy || waiting || !enabled}
            onClick={() => void send("ai", "draft")}
          >
            先形成一版建议
          </button>
          <button type="button" disabled={busy || waiting} onClick={() => void send("fixed")}>
            查看固定自检提示
          </button>
        </div>
      </div>
    </dialog>
  );
}
