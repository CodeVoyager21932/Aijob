import type { AdoptAssistantResultSchema, AssistantSession, AssistantTask } from "@aijob/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { z } from "zod";
import {
  adoptAssistant,
  assistantStatus,
  createAssistant,
  getAssistant,
  listAssistantSessions,
  retryAssistant,
  sendAssistant,
  setAssistantStatus,
} from "../../api/career-assistant";
import { listResumeDocuments } from "../../api/career-os";
import { apiRequest, createIdempotencyKey, subscribeToSessionBoundary } from "../../api/client";
import { materialKeys } from "../../api/materials";
import { coreKeys } from "../../api/product-core";
import { getExperiences } from "../../api/resume-studio";
import { type EditableDraft, prepareEditableDraft, restoreEditableDraft } from "../editor-document";
import { useWorkspaceDraft } from "../use-workspace-draft";
import { aiFailureMessage } from "./ai-errors";
import { refreshOpenStudioDraft } from "./use-studio-draft";
import "./studio.css";
export const assistantTaskLabels: Record<AssistantTask, string> = {
  experience: "整理经历",
  resume_review: "优化简历",
  interview: "模拟面试",
  job_explanation: "理解岗位",
  expression: "生成常用表达",
};
type AssistantInputDraft = {
  message: string;
  questionId: string | null;
  artifactBody: string;
  artifactTurn: string;
  selectedChanges: string[];
};
const inputDrafts = new Map<string, AssistantInputDraft>();
const artifactDrafts = new Map<string, { body: string; selectedChanges: string[] }>();
subscribeToSessionBoundary(() => {
  inputDrafts.clear();
  artifactDrafts.clear();
});
export function AssistantWorkspace(props: { defaultTask?: AssistantTask; contextCaseId?: string }) {
  const [params] = useSearchParams();
  return (
    <AssistantWorkspaceContent
      key={
        params.get("sessionId") ??
        `${props.contextCaseId ?? ""}:${props.defaultTask ?? "assistant"}:${params.toString()}`
      }
      {...props}
    />
  );
}
function AssistantWorkspaceContent({
  defaultTask,
  contextCaseId,
}: {
  defaultTask?: AssistantTask;
  contextCaseId?: string;
}) {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams(),
    id = params.get("sessionId");
  const savedInput = id ? inputDrafts.get(id) : undefined;
  const taskParam = params.get("task") as AssistantTask | null;
  const caseId = contextCaseId ?? params.get("caseId");
  const startKey = `assistant-start:${caseId ?? ""}:${defaultTask ?? ""}:${params.toString()}`;
  const [task, setTask] = useWorkspaceDraft<AssistantTask>(
    `${startKey}:task`,
    defaultTask ?? (taskParam && taskParam in assistantTaskLabels ? taskParam : "experience"),
  );
  const [documentId, setDocumentId] = useWorkspaceDraft(
      `${startKey}:document`,
      params.get("documentId") ?? "",
    ),
    [experienceIds, setExperienceIds] = useWorkspaceDraft<string[]>(
      `${startKey}:experiences`,
      params.get("experienceIds")?.split(",").filter(Boolean) ??
        (params.get("experienceId") ? [params.get("experienceId")!] : []),
    ),
    [initialText, setInitialText] = useWorkspaceDraft(`${startKey}:text`, ""),
    [direction, setDirection] = useWorkspaceDraft(`${startKey}:direction`, ""),
    [pace, setPace] = useWorkspaceDraft<"guided" | "simulation">(`${startKey}:pace`, "guided"),
    [expressionKind, setExpressionKind] = useWorkspaceDraft<
      "introduction" | "project_long" | "project_short" | "email"
    >(`${startKey}:expression`, "introduction");
  const [session, setSession] = useState<AssistantSession | null>(null),
    [message, setMessage] = useState(savedInput?.message ?? ""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [questionId, setQuestionId] = useState<string | null>(savedInput?.questionId ?? null),
    [artifactBody, setArtifactBody] = useState(savedInput?.artifactBody ?? "");
  const [selectedOutput, setSelectedOutput] = useState("");
  const [selectedChanges, setSelectedChanges] = useState<string[]>(
      savedInput?.selectedChanges ?? [],
    ),
    [mobilePanel, setMobilePanel] = useState<"conversation" | "result">("conversation");
  const startAttempt = useRef<{ signature: string; key: string } | null>(null);
  const sendAttempt = useRef<{ signature: string; key: string } | null>(null),
    adoptAttempts = useRef(new Map<string, string>()),
    chatEnd = useRef<HTMLDivElement>(null),
    artifactTurn = useRef(savedInput?.artifactTurn ?? ""),
    retryAttempts = useRef(new Map<string, string>()),
    answerInput = useRef<HTMLTextAreaElement>(null);
  const [undoAdoption, setUndoAdoption] = useState<{
    draft: EditableDraft;
    appliedRevision: number;
  } | null>(null);
  useEffect(() => {
    if (id)
      inputDrafts.set(id, {
        message,
        questionId,
        artifactBody,
        artifactTurn: artifactTurn.current,
        selectedChanges,
      });
  }, [id, message, questionId, artifactBody, selectedChanges]);
  useEffect(
    () =>
      subscribeToSessionBoundary(() => {
        setSession(null);
        setMessage("");
        setQuestionId(null);
        setArtifactBody("");
        setSelectedChanges([]);
        setUndoAdoption(null);
      }),
    [],
  );
  const availability = useQuery({
    queryKey: ["career-os", "assistant-status"],
    queryFn: assistantStatus,
  });
  const history = useQuery({
    queryKey: ["career-os", "assistant-sessions", contextCaseId ?? "all"],
    queryFn: () => listAssistantSessions(contextCaseId),
  });
  const resumes = useQuery({
    queryKey: ["career-os", "assistant-resumes"],
    queryFn: () => listResumeDocuments({ limit: 100 }),
    enabled: !id,
  });
  const experiences = useQuery({
    queryKey: ["career-os", "experiences", "assistant"],
    queryFn: async () => {
      const [legacy,native] = await Promise.all([getExperiences(),apiRequest<{id:string;title:string}[]>("/v2/native-experiences")]);
      return {items:[...legacy.items,...native]};
    },
    enabled: !id,
  });
  useEffect(() => {
    let active = true;
    setSession(null);
    if (id)
      void getAssistant(id)
        .then((s) => {
          if (active) setSession(s);
        })
        .catch((e) => setNotice(e instanceof Error ? e.message : "读取失败"));
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    if (!session?.turns.some((t) => t.status === "queued")) return;
    let active = true;
    const timer = setInterval(
      () =>
        void getAssistant(session.id)
          .then((s) => {
            if (active) setSession(s);
          })
          .catch(() => {}),
      900,
    );
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session]);
  const outputs =
    session?.turns.filter(
      (t) =>
        t.result && (t.result.artifact || t.result.changes.length || t.result.preparation.length),
    ) ?? [];
  const latest =
      outputs.find((t) => t.id === selectedOutput) ??
      outputs.at(-1) ??
      session?.turns.filter((t) => t.result).at(-1),
    result = latest?.result;
  function rememberOutput(body: string, changes: string[]) {
    if (id && latest) artifactDrafts.set(`${id}:${latest.id}`, { body, selectedChanges: changes });
  }
  useEffect(() => {
    if (latest && artifactTurn.current !== latest.id) {
      artifactTurn.current = latest.id;
      const remembered = artifactDrafts.get(`${id}:${latest.id}`);
      setArtifactBody(remembered?.body ?? latest.result?.artifact?.body ?? "");
      setSelectedChanges(
        remembered?.selectedChanges ?? latest.result?.changes.map((c) => c.id) ?? [],
      );
      chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [latest, id]);
  async function start() {
    setBusy(true);
    setNotice("");
    try {
      if (documentId) await prepareEditableDraft(documentId);
      const request = {
        task,
        title: assistantTaskLabels[task],
        pace,
        expressionKind,
        context: {
          ...(documentId ? { documentId } : {}),
          experienceIds,
          initialText,
          direction,
          ...(caseId ? { caseId } : {}),
          ...(params.get("jobId") ? { jobId: params.get("jobId")! } : {}),
        },
      };
      const signature = JSON.stringify(request);
      if (startAttempt.current?.signature !== signature)
        startAttempt.current = { signature, key: createIdempotencyKey() };
      const s = await createAssistant(request, startAttempt.current.key);
      startAttempt.current = null;
      setSession(s);
      setParams({ sessionId: s.id });
      await history.refetch();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "暂时无法开始");
    } finally {
      setBusy(false);
    }
  }
  async function send(
    intent: "continue" | "draft" | "skip" | "retry" | "finish" = "continue",
    mode: "ai" | "fixed" = "ai",
  ) {
    if (!session) return;
    setBusy(true);
    setNotice("");
    const body = { expectedRevision: session.revision, message, intent, questionId, mode },
      signature = JSON.stringify(body);
    if (sendAttempt.current?.signature !== signature)
      sendAttempt.current = { signature, key: createIdempotencyKey() };
    try {
      const s = await sendAssistant(session.id, body, sendAttempt.current.key);
      setSession(s);
      setMessage((current) => (current === body.message ? "" : current));
      setQuestionId((current) => (current === body.questionId ? null : current));
      sendAttempt.current = null;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "发送失败，回答仍保留");
      const fresh = await getAssistant(session.id).catch(() => null);
      if (fresh) setSession(fresh);
    } finally {
      setBusy(false);
    }
  }
  async function adopt(
    target: z.input<typeof AdoptAssistantResultSchema>["target"],
    changeIds = selectedChanges,
  ) {
    if (!latest || !session) return;
    setBusy(true);
    setNotice("");
    try {
      const draft = session.context.documentId
        ? await prepareEditableDraft(session.context.documentId)
        : null;
      const body = {
          target,
          changeIds,
          ...(target === "resume" && draft ? { expectedDraftRevision: draft.revision } : {}),
          ...(target === "expression" || target === "experience"
            ? { editedBody: artifactBody }
            : {}),
        },
        signature = JSON.stringify({ id: latest.id, body });
      if (!adoptAttempts.current.has(signature))
        adoptAttempts.current.set(signature, createIdempotencyKey());
      const adoption = (await adoptAssistant(
        latest.id,
        body,
        adoptAttempts.current.get(signature)!,
      )) as { draft?: { revision: number } };
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["career-os", "experiences"] }),
        queryClient.invalidateQueries({ queryKey: materialKeys.snippets }),
        queryClient.invalidateQueries({ queryKey: coreKeys.planner }),
      ]);
      if (target === "resume" && draft) {
        if (!adoption.draft || !Number.isSafeInteger(adoption.draft.revision))
          throw new Error("采用返回版本异常，请查看历史版本，勿重复采用。");
        setUndoAdoption({ draft, appliedRevision: adoption.draft.revision });
        await refreshOpenStudioDraft(draft.documentId);
      }
      setNotice(
        {
          resume: "修改已写入当前简历。",
          expression: "已保存到常用表达。",
          experience:
            session.task === "experience" && session.context.experienceIds.length === 1
              ? "原经历已更新，相关简历仍保留各自的表达。"
              : "完整经历已收录到经历与材料。",
          preparation: "已加入准备清单。",
        }[target],
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "采用失败，草稿仍保留");
    } finally {
      setBusy(false);
    }
  }
  async function retryFailedTurn(turnId: string) {
    if (!session) return;
    setBusy(true);
    setNotice("");
    const signature = `${turnId}:${session.revision}`;
    if (!retryAttempts.current.has(signature))
      retryAttempts.current.set(signature, createIdempotencyKey());
    try {
      setSession(
        await retryAssistant(turnId, session.revision, retryAttempts.current.get(signature)!),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "原回答已保留，请稍后重试。");
      const fresh = await getAssistant(session.id).catch(() => null);
      if (fresh) setSession(fresh);
    } finally {
      setBusy(false);
    }
  }
  async function undoLastAdoption() {
    if (!undoAdoption) return;
    setBusy(true);
    setNotice("");
    try {
      const current = await prepareEditableDraft(undoAdoption.draft.documentId);
      if (current.revision !== undoAdoption.appliedRevision)
        throw new Error("简历已有后续修改，请在历史中对照恢复，当前内容保留。");
      await restoreEditableDraft(undoAdoption.draft, current.revision, createIdempotencyKey());
      setUndoAdoption(null);
      setNotice("已撤销这次采用，恢复到采用前的简历。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "撤销失败，当前简历仍保留。");
    } finally {
      setBusy(false);
    }
  }
  const queued = session?.turns.some((t) => t.status === "queued") ?? false;
  return (
    <section className="assistant-workspace resume-studio">
      <header className="assistant-heading">
        <div>
          <p>做准备 / 求职助手</p>
          <h1>{session ? assistantTaskLabels[session.task] : "把经历写清楚，也练习讲明白。"}</h1>
          <p>{session ? "接着你的材料和回答继续。" : "选择当前要完成的事，已有材料随时取用。"}</p>
        </div>
        {session ? (
          <button
            type="button"
            onClick={() => {
              setSession(null);
              setParams({});
            }}
          >
            开始另一项任务
          </button>
        ) : null}
      </header>
      {availability.data && !availability.data.enabled ? (
        <div className="studio-alert">
          {availability.data.reason}。<Link to="/settings/ai">配置我的 API</Link>
          ，也可以继续手工编辑和使用固定自检提示。
        </div>
      ) : null}
      {notice ? <output className="studio-alert">{notice}</output> : null}
      {!id ? (
        <div className="assistant-start-layout">
          <div className="assistant-start-card">
            <div className="assistant-task-options">
              {(["experience", "resume_review", "interview"] as const).map((value) => (
                <button
                  type="button"
                  aria-pressed={task === value}
                  key={value}
                  onClick={() => setTask(value)}
                >
                  {assistantTaskLabels[value]}
                </button>
              ))}
            </div>
            <div className="studio-fields">
              <label className="studio-label">
                当前任务
                <select value={task} onChange={(e) => setTask(e.target.value as AssistantTask)}>
                  {Object.entries(assistantTaskLabels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="studio-label">
                选一份简历（可选）
                <select value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
                  <option value="">暂不选择</option>
                  {resumes.data?.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="studio-label">
                目标方向（可选）
                <input
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  placeholder="例如：产品、材料研发、内容运营"
                />
              </label>
              {task === "interview" ? (
                <label className="studio-label">
                  练习节奏
                  <select
                    value={pace}
                    onChange={(e) => setPace(e.target.value as "guided" | "simulation")}
                  >
                    <option value="guided">边练边改</option>
                    <option value="simulation">完整模拟，结束后复盘</option>
                  </select>
                </label>
              ) : null}
              {task === "expression" ? (
                <label className="studio-label">
                  表达用途
                  <select
                    value={expressionKind}
                    onChange={(e) => setExpressionKind(e.target.value as typeof expressionKind)}
                  >
                    <option value="introduction">自我介绍</option>
                    <option value="project_short">项目短版</option>
                    <option value="project_long">项目长版</option>
                    <option value="email">邮件草稿</option>
                  </select>
                </label>
              ) : null}
            </div>
            {experiences.data?.items.length ? (
              <details className="assistant-source-picker">
                <summary>使用已有经历 · 已选择 {experienceIds.length} 段</summary>
                {experiences.data.items.map((e) => (
                  <label key={e.id}>
                    <input
                      type="checkbox"
                      checked={experienceIds.includes(e.id)}
                      onChange={() =>
                        setExperienceIds((ids) =>
                          ids.includes(e.id) ? ids.filter((id) => id !== e.id) : [...ids, e.id],
                        )
                      }
                    />
                    {e.title}
                  </label>
                ))}
              </details>
            ) : null}
            <label className="studio-label">
              你想从哪里开始
              <textarea
                rows={7}
                value={initialText}
                onChange={(e) => setInitialText(e.target.value)}
                placeholder="可以直接描述一件做过的事，或者说说简历哪里写不清楚。"
              />
            </label>
            <button
              type="button"
              className="studio-primary"
              disabled={busy}
              onClick={() => void start()}
            >
              进入{assistantTaskLabels[task]}
            </button>
          </div>
          <aside className="assistant-history">
            <h2>接着上次继续</h2>
            {history.data?.items.length === 0 ? <p>开始后，对话和成果会保存在这里。</p> : null}
            {history.data?.items.map((s) => (
              <button key={s.id} type="button" onClick={() => setParams({ sessionId: s.id })}>
                <strong>{s.title}</strong>
                <small>
                  {new Date(s.updatedAt).toLocaleDateString("zh-CN")} ·{" "}
                  {s.status === "paused"
                    ? "已暂停"
                    : s.status === "completed"
                      ? "已完成"
                      : "可继续"}
                </small>
              </button>
            ))}
          </aside>
        </div>
      ) : !session ? (
        <output>正在打开练习…</output>
      ) : (
        <>
          <div className="assistant-mobile-tabs">
            <button
              type="button"
              aria-pressed={mobilePanel === "conversation"}
              onClick={() => setMobilePanel("conversation")}
            >
              对话与练习
            </button>
            <button
              type="button"
              aria-pressed={mobilePanel === "result"}
              onClick={() => setMobilePanel("result")}
            >
              成稿与修改
            </button>
          </div>
          <div className={`assistant-session-layout mobile-${mobilePanel}`}>
            <div className="assistant-conversation">
              <div className="assistant-session-toolbar">
                <span>
                  {session.task === "interview"
                    ? session.pace === "guided"
                      ? "边练边改"
                      : "完整模拟"
                    : "求职助手"}
                  {availability.data?.enabled ? ` · ${availability.data.model}` : ""}
                  {session.status === "completed"
                    ? " · 已完成"
                    : session.status === "paused"
                      ? " · 已暂停"
                      : ""}
                </span>
                <button
                  type="button"
                  disabled={busy || queued}
                  onClick={() =>
                    void setAssistantStatus(
                      session.id,
                      session.revision,
                      session.status === "active" ? "paused" : "active",
                    )
                      .then(setSession)
                      .catch((e) => setNotice(e.message))
                  }
                >
                  {session.status === "active"
                    ? "暂停"
                    : session.status === "completed"
                      ? "继续补充"
                      : "继续"}
                </button>
                {session.context.documentId ? (
                  <Link
                    to={`/resumes/${session.documentCore === "native-v1" ? "native/" : ""}${session.context.documentId}`}
                  >
                    打开当前简历
                  </Link>
                ) : null}
              </div>
              <div className="assistant-message-list">
                {session.context.initialText ? (
                  <div className="assistant-message is-user">
                    <small>起点材料</small>
                    <p>{session.context.initialText}</p>
                  </div>
                ) : null}
                {session.turns.map((turn) => (
                  <div key={turn.id}>
                    {turn.userMessage ? (
                      <div className="assistant-message is-user">
                        <small>{turn.questionId ? "同题重答" : "我的回答"}</small>
                        <p>{turn.userMessage}</p>
                      </div>
                    ) : null}
                    {turn.status === "queued" ? (
                      <output className="assistant-message" aria-live="polite">
                        {turn.executionStatus === "processing"
                          ? "正在整理本轮材料并等待你的 API 返回…"
                          : "回答已保存，正在排队等待处理。你可以先整理其他材料，回来后继续查看。"}
                      </output>
                    ) : turn.status === "failed" ? (
                      <div className="assistant-message studio-alert">
                        <p>
                          这次 AI 没有完成，回答已保存。
                          {aiFailureMessage(turn.failureCode)}
                        </p>
                        {session.turns.at(-1)?.id === turn.id ? (
                          <button
                            type="button"
                            disabled={
                              busy ||
                              queued ||
                              session.status !== "active" ||
                              !availability.data?.enabled
                            }
                            onClick={() => void retryFailedTurn(turn.id)}
                          >
                            用原回答重试
                          </button>
                        ) : null}
                      </div>
                    ) : turn.result ? (
                      <div className="assistant-message">
                        <small>
                          {turn.status === "fixed"
                            ? "固定自检提示"
                            : "AI · " + (turn.model ?? "求职助手")}
                        </small>
                        <p>{turn.result.reply}</p>
                        {turn.result.question ? (
                          <>
                            <h2>{turn.result.question}</h2>
                            {session.task === "interview" ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setQuestionId(turn.id);
                                  setMessage("");
                                  setMobilePanel("conversation");
                                  answerInput.current?.focus();
                                }}
                              >
                                重答这道题
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
                <div ref={chatEnd} />
                {session.turns.length === 0 ? (
                  <div className="assistant-message">
                    <h2>从你现在的材料开始。</h2>
                    <p>可以直接让助手帮你看看，也可以补充你希望解决的问题。</p>
                  </div>
                ) : null}
              </div>
              <div className="assistant-composer">
                {questionId ? (
                  <p>
                    正在重答原题
                    <button type="button" onClick={() => setQuestionId(null)}>
                      返回连续练习
                    </button>
                  </p>
                ) : null}
                <label className="studio-label">
                  我的回答或补充
                  <textarea
                    ref={answerInput}
                    value={message}
                    rows={5}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="按自己的理解说就好。不知道、没有参与，也可以直接说明。"
                  />
                </label>
                <div className="assistant-composer-actions">
                  <button
                    type="button"
                    className="studio-primary"
                    disabled={
                      busy || queued || session.status !== "active" || !availability.data?.enabled
                    }
                    onClick={() => void send(questionId ? "retry" : "continue")}
                  >
                    {queued ? "正在处理" : "发送给 AI"}
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy || queued || session.status !== "active" || !availability.data?.enabled
                    }
                    onClick={() => void send("draft")}
                  >
                    先形成一版
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy || queued || session.status !== "active" || !availability.data?.enabled
                    }
                    onClick={() => void send("skip")}
                  >
                    跳过当前问题
                  </button>
                  {session.task === "interview" ? (
                    <button
                      type="button"
                      disabled={
                        busy || queued || session.status !== "active" || !availability.data?.enabled
                      }
                      onClick={() => void send("finish")}
                    >
                      结束并复盘
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy || queued || session.status !== "active"}
                    onClick={() => void send("continue", "fixed")}
                  >
                    固定自检提示
                  </button>
                </div>
              </div>
            </div>
            <aside className="assistant-results">
              <h2>把这次准备留下来</h2>
              {outputs.length > 1 ? (
                <label className="studio-label">
                  查看哪次成果
                  <select
                    value={latest?.id ?? ""}
                    onChange={(e) => setSelectedOutput(e.target.value)}
                  >
                    {outputs.map((turn) => (
                      <option key={turn.id} value={turn.id}>
                        第 {turn.ordinal} 轮 · {turn.result?.artifact?.title || "修改与准备建议"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {undoAdoption ? (
                <button type="button" disabled={busy} onClick={() => void undoLastAdoption()}>
                  撤销上次采用的简历修改
                </button>
              ) : null}
              {!result?.artifact && !result?.changes.length && !result?.preparation.length ? (
                <p>成稿、修改建议和准备事项会出现在这里；你也可以随时选择“先形成一版”。</p>
              ) : null}
              {result?.artifact ? (
                <div className="assistant-artifact">
                  <h3>{result.artifact.title}</h3>
                  <textarea
                    aria-label="可编辑成稿"
                    rows={14}
                    value={artifactBody}
                    onChange={(e) => {
                      setArtifactBody(e.target.value);
                      rememberOutput(e.target.value, selectedChanges);
                    }}
                  />
                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(artifactBody)
                          .then(() => setNotice("已复制成稿。"))
                      }
                    >
                      复制
                    </button>
                    <button type="button" disabled={busy} onClick={() => void adopt("expression")}>
                      保存为常用表达
                    </button>
                    <button type="button" disabled={busy} onClick={() => void adopt("experience")}>
                      {session.task === "experience" && session.context.experienceIds.length === 1
                        ? "更新这段经历"
                        : "收录为完整经历"}
                    </button>
                  </div>
                </div>
              ) : null}
              {result?.changes.length ? (
                <>
                  <div className="assistant-change-heading">
                    <h3>建议修改</h3>
                    <button
                      type="button"
                      className="studio-primary"
                      disabled={busy || !selectedChanges.length}
                      onClick={() => void adopt("resume")}
                    >
                      采用所选修改
                    </button>
                  </div>
                  {result.changes.map((c) => (
                    <div className="assistant-change" key={c.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedChanges.includes(c.id)}
                          onChange={() =>
                            setSelectedChanges((ids) => {
                              const changed = ids.includes(c.id)
                                ? ids.filter((id) => id !== c.id)
                                : [...ids, c.id];
                              rememberOutput(artifactBody, changed);
                              return changed;
                            })
                          }
                        />
                        {c.reason}
                      </label>
                      <p>{c.text || "调整模块顺序"}</p>
                      <details>
                        <summary>查看所依据的材料</summary>
                        {Array.from(new Set(c.sourceQuotes)).map((quote) => (
                          <blockquote key={quote}>{quote}</blockquote>
                        ))}
                      </details>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void adopt("resume", [c.id])}
                      >
                        采用这一项
                      </button>
                    </div>
                  ))}
                </>
              ) : null}
              {result?.preparation.length ? (
                <div className="assistant-preparation">
                  <h3>下一步可以准备</h3>
                  {result.preparation.map((p, index) => (
                    <div key={`${p.title}:${p.detail}`}>
                      <strong>{p.title}</strong>
                      <p>{p.detail}</p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void adopt("preparation", [`preparation:${index}`])}
                      >
                        加入准备清单
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="assistant-destinations">
                <Link to="/materials">经历与材料 →</Link>
                <Link to="/applications/planner">准备清单 →</Link>
              </div>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
