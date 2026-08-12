import type {
  ApplicationCaseWithJobContext,
  ConfirmCaseDebriefRequest,
  GetCaseDebriefResponse,
  InterviewSession,
} from "@aijob/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  careerOsQueryKeys,
  confirmCaseDebrief,
  createInterviewSession,
  deleteDebrief,
  deleteInterviewSession,
  getCaseDebrief,
  getInterviewSession,
  listInterviewSessions,
  prepareCaseDebrief,
  submitInterviewAnswer,
} from "../../api/career-os";
import { createIdempotencyKey, ProductApiError } from "../../api/client";
import { AssetDeletionDialog } from "../components/AssetDeletionDialog";
import { DebriefConfirmationPanel } from "../components/DebriefConfirmationPanel";
import { Icon } from "../components/Icon";
import {
  caseDebriefSessionState,
  currentInterviewQuestion,
  interviewFeedbackCategoryLabels,
  interviewFeedbackSeverityLabels,
  interviewStatusLabels,
  interviewTurnLabel,
} from "../interview-view";

function sessionTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function CaseInterviewWorkspace({
  applicationCase,
}: {
  applicationCase: ApplicationCaseWithJobContext;
}) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState("");
  const [sessionDeleteOpen, setSessionDeleteOpen] = useState(false);
  const [debriefDeleteOpen, setDebriefDeleteOpen] = useState(false);
  const createCommandRef = useRef<{ signature: string; key: string } | null>(null);
  const answerCommandRef = useRef<{ signature: string; key: string } | null>(null);
  const prepareDebriefCommandRef = useRef<{ signature: string; key: string } | null>(null);
  const confirmDebriefCommandRef = useRef<{ signature: string; key: string } | null>(null);
  const sessionsQuery = useInfiniteQuery({
    queryKey: careerOsQueryKeys.interviewSessions(applicationCase.id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listInterviewSessions(
        applicationCase.id,
        { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const sessions = useMemo(
    () => (sessionsQuery.data?.pages ?? []).flatMap((page) => page.items),
    [sessionsQuery.data?.pages],
  );
  const requestedSessionId = searchParams.get("session");
  const selectedSessionId = requestedSessionId ?? sessions[0]?.id ?? null;
  const detailQuery = useQuery({
    queryKey: careerOsQueryKeys.interviewSession(applicationCase.id, selectedSessionId ?? "none"),
    queryFn: ({ signal }) =>
      getInterviewSession(applicationCase.id, selectedSessionId ?? "", signal),
    enabled: Boolean(selectedSessionId),
    retry: (failureCount, error) =>
      error instanceof ProductApiError && error.status === 404 ? false : failureCount < 1,
  });
  const debriefQuery = useQuery({
    queryKey: careerOsQueryKeys.caseDebrief(applicationCase.id),
    queryFn: ({ signal }) => getCaseDebrief(applicationCase.id, signal),
    retry: (failureCount, error) =>
      error instanceof ProductApiError && error.status === 404 ? false : failureCount < 1,
  });

  const selectSession = (sessionId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("session", sessionId);
    setSearchParams(next);
    setDraft("");
    answerCommandRef.current = null;
  };

  const createMutation = useMutation({
    mutationFn: ({ key }: { key: string }) =>
      createInterviewSession(
        applicationCase.id,
        { expectedCaseRevision: applicationCase.revision },
        key,
      ),
    retry: false,
    onSuccess: async (result) => {
      createCommandRef.current = null;
      selectSession(result.sessionId);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.interviewSessions(applicationCase.id),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.interviewSession(applicationCase.id, result.sessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseDetail(applicationCase.id),
        }),
        queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.caseList() }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseEvents(applicationCase.id),
        }),
      ]);
    },
    onError: async (error) => {
      if (error instanceof ProductApiError && error.code === "APPLICATION_CASE_REVISION_CONFLICT") {
        await queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseDetail(applicationCase.id),
        });
      }
    },
  });

  const startSession = () => {
    const signature = `${applicationCase.id}:${applicationCase.revision}`;
    if (createCommandRef.current?.signature !== signature) {
      createCommandRef.current = {
        signature,
        key: createIdempotencyKey("interview-session"),
      };
    }
    createMutation.mutate({ key: createCommandRef.current.key });
  };

  const answerMutation = useMutation({
    mutationFn: ({
      sessionId,
      expectedRevision,
      answer,
      key,
    }: {
      sessionId: string;
      expectedRevision: number;
      answer: string;
      key: string;
    }) => submitInterviewAnswer(applicationCase.id, sessionId, { expectedRevision, answer }, key),
    retry: false,
    onSuccess: async (_result, variables) => {
      setDraft("");
      answerCommandRef.current = null;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.interviewSession(applicationCase.id, variables.sessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.interviewSessions(applicationCase.id),
        }),
      ]);
    },
    onError: async (error, variables) => {
      if (
        error instanceof ProductApiError &&
        error.code === "INTERVIEW_SESSION_REVISION_CONFLICT"
      ) {
        await queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.interviewSession(applicationCase.id, variables.sessionId),
        });
      }
    },
  });

  const prepareDebriefMutation = useMutation({
    mutationFn: ({
      sessionId,
      expectedSessionRevision,
      key,
    }: {
      sessionId: string;
      expectedSessionRevision: number;
      key: string;
    }) =>
      prepareCaseDebrief(
        applicationCase.id,
        { interviewSessionId: sessionId, expectedSessionRevision },
        key,
      ),
    retry: false,
    onSuccess: (result) => {
      prepareDebriefCommandRef.current = null;
      queryClient.setQueryData(careerOsQueryKeys.caseDebrief(applicationCase.id), {
        feedback: result.feedback,
        debrief: result.debrief,
        itemDecisions: [],
        confirmation: null,
      });
    },
    onError: async (error, variables) => {
      if (
        error instanceof ProductApiError &&
        error.code === "INTERVIEW_SESSION_REVISION_CONFLICT"
      ) {
        await queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.interviewSession(applicationCase.id, variables.sessionId),
        });
      }
      if (error instanceof ProductApiError && error.code === "CASE_DEBRIEF_ALREADY_EXISTS") {
        await queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseDebrief(applicationCase.id),
        });
      }
    },
  });

  const confirmDebriefMutation = useMutation({
    mutationFn: ({ request, key }: { request: ConfirmCaseDebriefRequest; key: string }) =>
      confirmCaseDebrief(applicationCase.id, request, key),
    retry: false,
    onSuccess: (result) => {
      confirmDebriefCommandRef.current = null;
      queryClient.setQueryData<GetCaseDebriefResponse>(
        careerOsQueryKeys.caseDebrief(applicationCase.id),
        (current) =>
          current
            ? {
                feedback: current.feedback,
                debrief: result.debrief,
                itemDecisions: result.itemDecisions,
                confirmation: result.confirmation,
              }
            : current,
      );
    },
    onError: async (error) => {
      if (
        error instanceof ProductApiError &&
        (error.code === "DEBRIEF_REVISION_CONFLICT" ||
          error.code === "DEBRIEF_ITEM_DECISIONS_INCOMPLETE")
      ) {
        await queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseDebrief(applicationCase.id),
        });
      }
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: ({
      sessionId,
      expectedRevision,
    }: {
      sessionId: string;
      expectedRevision: number;
    }) => deleteInterviewSession(sessionId, { expectedRevision }),
    retry: false,
    onSuccess: async (_result, variables) => {
      setSessionDeleteOpen(false);
      queryClient.removeQueries({
        queryKey: careerOsQueryKeys.interviewSession(applicationCase.id, variables.sessionId),
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.interviewSessions(applicationCase.id),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseDebrief(applicationCase.id),
        }),
      ]);
      if (selectedSessionId === variables.sessionId) {
        const next = new URLSearchParams(searchParams);
        next.delete("session");
        setSearchParams(next, { replace: true });
      }
    },
    onError: async (error, variables) => {
      if (
        error instanceof ProductApiError &&
        (error.code === "INTERVIEW_SESSION_REVISION_CONFLICT" || error.status === 404)
      ) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: careerOsQueryKeys.interviewSession(applicationCase.id, variables.sessionId),
          }),
          queryClient.invalidateQueries({
            queryKey: careerOsQueryKeys.interviewSessions(applicationCase.id),
          }),
        ]);
      }
    },
  });

  const deleteDebriefMutation = useMutation({
    mutationFn: ({
      debriefId,
      expectedRevision,
    }: {
      debriefId: string;
      expectedRevision: number;
    }) => deleteDebrief(debriefId, { expectedRevision }),
    retry: false,
    onSuccess: () => {
      setDebriefDeleteOpen(false);
      queryClient.setQueryData<GetCaseDebriefResponse>(
        careerOsQueryKeys.caseDebrief(applicationCase.id),
        {
          feedback: null,
          debrief: null,
          itemDecisions: [],
          confirmation: null,
        },
      );
    },
    onError: async (error) => {
      if (
        error instanceof ProductApiError &&
        (error.code === "DEBRIEF_REVISION_CONFLICT" || error.status === 404)
      ) {
        await queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseDebrief(applicationCase.id),
        });
      }
    },
  });

  const detail = detailQuery.data;
  const currentQuestion = currentInterviewQuestion(detail);
  const reviewState = caseDebriefSessionState(
    debriefQuery.data,
    detail?.session.id ?? selectedSessionId,
  );
  const feedback = reviewState === "selected" ? debriefQuery.data?.feedback : null;
  const debrief = reviewState === "selected" ? debriefQuery.data?.debrief : null;
  const submitAnswer = () => {
    const answer = draft.trim();
    if (!detail || !currentQuestion || !answer) return;
    const signature = `${detail.session.id}:${detail.session.revision}:${answer}`;
    if (answerCommandRef.current?.signature !== signature) {
      answerCommandRef.current = {
        signature,
        key: createIdempotencyKey("interview-answer"),
      };
    }
    answerMutation.mutate({
      sessionId: detail.session.id,
      expectedRevision: detail.session.revision,
      answer,
      key: answerCommandRef.current.key,
    });
  };
  const prepareDebrief = () => {
    if (!detail || detail.session.status !== "completed") return;
    const signature = `${detail.session.id}:${detail.session.revision}`;
    if (prepareDebriefCommandRef.current?.signature !== signature) {
      prepareDebriefCommandRef.current = {
        signature,
        key: createIdempotencyKey("interview-debrief"),
      };
    }
    prepareDebriefMutation.mutate({
      sessionId: detail.session.id,
      expectedSessionRevision: detail.session.revision,
      key: prepareDebriefCommandRef.current.key,
    });
  };
  const confirmDebrief = (request: ConfirmCaseDebriefRequest) => {
    const signature = `${applicationCase.id}:${request.expectedDebriefRevision}:${JSON.stringify(request.itemDecisions)}`;
    if (confirmDebriefCommandRef.current?.signature !== signature) {
      confirmDebriefCommandRef.current = {
        signature,
        key: createIdempotencyKey("debrief-confirmation"),
      };
    }
    confirmDebriefMutation.mutate({
      request,
      key: confirmDebriefCommandRef.current.key,
    });
  };
  const createNeedsResume =
    createMutation.error instanceof ProductApiError &&
    createMutation.error.code === "INTERVIEW_INPUTS_NOT_READY";
  const createConflict =
    createMutation.error instanceof ProductApiError &&
    createMutation.error.code === "APPLICATION_CASE_REVISION_CONFLICT";
  const answerConflict =
    answerMutation.error instanceof ProductApiError &&
    answerMutation.error.code === "INTERVIEW_SESSION_REVISION_CONFLICT";
  const debriefConflict =
    prepareDebriefMutation.error instanceof ProductApiError &&
    (prepareDebriefMutation.error.code === "INTERVIEW_SESSION_REVISION_CONFLICT" ||
      prepareDebriefMutation.error.code === "CASE_DEBRIEF_ALREADY_EXISTS");

  return (
    <div className="career-interview-workspace">
      <section className="career-interview-guardrail" aria-labelledby="interview-guardrail-title">
        <span>
          <Icon name="interview" />
        </span>
        <div>
          <p>M3 · 确定性文字练习</p>
          <h2 id="interview-guardrail-title">只根据固定 JD 和通用模板提问</h2>
          <p>
            当前不调用
            AI、不生成评分，也不会替你补写经历。请只回答真实发生过的内容；没有相关经历时可以直接说明。
          </p>
        </div>
        <button
          className="career-button career-button--primary"
          type="button"
          disabled={createMutation.isPending}
          onClick={startSession}
        >
          {createMutation.isPending ? "正在固定输入…" : "开始一轮模板面试"}
        </button>
      </section>

      {debriefQuery.data?.debrief ? (
        <div className="career-asset-actions">
          <span>当前复盘 · 修订 {debriefQuery.data.debrief.revision}</span>
          <button
            className="career-button career-button--danger-quiet"
            type="button"
            onClick={() => setDebriefDeleteOpen(true)}
          >
            删除当前复盘
          </button>
        </div>
      ) : null}

      {createMutation.isError ? (
        <div className="career-inline-error" role="alert">
          <strong>
            {createNeedsResume
              ? "还不能开始面试"
              : createConflict
                ? "求职项目已经变化"
                : "本轮面试没有创建"}
          </strong>
          <span>
            {createNeedsResume
              ? "请先创建岗位简历并确认基础简历证据。"
              : createConflict
                ? "已重新读取最新 Case，请核对后再开始。"
                : createMutation.error instanceof Error
                  ? createMutation.error.message
                  : "请稍后重试。"}
          </span>
          {createNeedsResume ? (
            <Link to={`/applications/${applicationCase.id}/resume`}>前往岗位简历</Link>
          ) : null}
        </div>
      ) : null}

      {sessionsQuery.isPending ? (
        <output className="career-request-state">正在读取面试练习…</output>
      ) : null}
      {sessionsQuery.isError ? (
        <div className="career-inline-error" role="alert">
          <strong>面试练习暂时无法读取</strong>
          <span>
            {sessionsQuery.error instanceof Error ? sessionsQuery.error.message : "请稍后重试。"}
          </span>
          <button type="button" onClick={() => void sessionsQuery.refetch()}>
            重试
          </button>
        </div>
      ) : null}
      {!sessionsQuery.isPending && !sessionsQuery.isError && sessions.length === 0 ? (
        <section className="career-interview-empty">
          <h2>还没有面试练习</h2>
          <p>点击“开始一轮模板面试”后才会固定当前岗位简历和证据；打开页面本身不会写入数据。</p>
        </section>
      ) : null}

      {sessions.length > 0 ? (
        <div className="career-interview-layout">
          <aside className="career-interview-history" aria-label="面试练习历史">
            <header>
              <strong>练习历史</strong>
              <span>{sessions.length} 轮已加载</span>
            </header>
            <ol>
              {sessions.map((session: InterviewSession, index) => (
                <li key={session.id}>
                  <button
                    type="button"
                    className={session.id === selectedSessionId ? "is-active" : undefined}
                    aria-current={session.id === selectedSessionId ? "true" : undefined}
                    onClick={() => selectSession(session.id)}
                  >
                    <span>第 {sessions.length - index} 轮</span>
                    <strong>{interviewStatusLabels[session.status]}</strong>
                    <time dateTime={session.createdAt}>{sessionTime(session.createdAt)}</time>
                  </button>
                </li>
              ))}
            </ol>
            {sessionsQuery.hasNextPage ? (
              <button
                className="career-button career-button--quiet"
                type="button"
                disabled={sessionsQuery.isFetchingNextPage}
                onClick={() => void sessionsQuery.fetchNextPage()}
              >
                {sessionsQuery.isFetchingNextPage ? "正在加载…" : "继续加载"}
              </button>
            ) : null}
          </aside>

          <section className="career-interview-session" aria-live="polite">
            {detailQuery.isPending ? (
              <output className="career-request-state">正在打开这轮练习…</output>
            ) : null}
            {detailQuery.isError ? (
              <div className="career-inline-error" role="alert">
                <strong>
                  {detailQuery.error instanceof ProductApiError && detailQuery.error.status === 404
                    ? "没有找到这轮练习"
                    : "这轮练习暂时无法读取"}
                </strong>
                <span>
                  {detailQuery.error instanceof Error ? detailQuery.error.message : "请稍后重试。"}
                </span>
                {requestedSessionId ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.delete("session");
                      setSearchParams(next, { replace: true });
                    }}
                  >
                    打开最近一轮
                  </button>
                ) : null}
              </div>
            ) : null}
            {detail ? (
              <>
                <header className="career-interview-session__header">
                  <div className="career-interview-session__identity">
                    <p>{interviewStatusLabels[detail.session.status]}</p>
                    <h2>固定输入的模板面试</h2>
                    <button
                      className="career-button career-button--danger-quiet"
                      type="button"
                      onClick={() => setSessionDeleteOpen(true)}
                    >
                      删除本轮练习
                    </button>
                  </div>
                  <dl>
                    <div>
                      <dt>岗位版本</dt>
                      <dd>
                        {detail.session.jobContext.kind === "public"
                          ? detail.session.jobContext.publishedJobVersionId.slice(0, 8)
                          : `私有修订 ${detail.session.jobContext.contentRevision}`}
                      </dd>
                    </div>
                    <div>
                      <dt>简历修订</dt>
                      <dd>{detail.session.resumeContentRevisionId?.slice(0, 8) ?? "未固定"}</dd>
                    </div>
                    <div>
                      <dt>证据修订</dt>
                      <dd>{detail.session.evidenceRevisionId.slice(0, 8)}</dd>
                    </div>
                  </dl>
                </header>

                <ol className="career-interview-transcript">
                  {detail.turns.map((turn) => (
                    <li key={turn.id} className={`is-${turn.kind}`}>
                      <header>
                        <strong>{interviewTurnLabel(turn.kind)}</strong>
                        <span>#{turn.sequence}</span>
                      </header>
                      <p>{turn.content}</p>
                      {turn.requirementIds.length > 0 ? (
                        <small>引用固定 JD 要求 · {turn.requirementIds.join("、")}</small>
                      ) : null}
                    </li>
                  ))}
                </ol>

                {currentQuestion ? (
                  <form
                    className="career-interview-answer"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitAnswer();
                    }}
                  >
                    <label htmlFor="interview-answer-draft">你的回答</label>
                    <textarea
                      id="interview-answer-draft"
                      value={draft}
                      maxLength={20_000}
                      rows={7}
                      placeholder="只写真实发生过的经历；没有相关经历时可以直接说明。"
                      disabled={answerMutation.isPending}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        answerMutation.reset();
                      }}
                    />
                    <div>
                      <span>{draft.length.toLocaleString("zh-CN")} / 20,000</span>
                      <button
                        className="career-button career-button--primary"
                        type="submit"
                        disabled={answerMutation.isPending || draft.trim().length === 0}
                      >
                        {answerMutation.isPending ? "正在保存…" : "保存并进入下一题"}
                      </button>
                    </div>
                    {answerMutation.isError ? (
                      <div className="career-inline-error" role="alert">
                        <strong>{answerConflict ? "这轮练习已经变化" : "回答没有保存"}</strong>
                        <span>
                          {answerConflict
                            ? "草稿仍在，请核对最新问题后再次保存。"
                            : answerMutation.error instanceof Error
                              ? answerMutation.error.message
                              : "请稍后重试。"}
                        </span>
                      </div>
                    ) : null}
                  </form>
                ) : null}

                {detail.session.status === "completed" ? (
                  <section
                    className="career-interview-review"
                    aria-labelledby="interview-review-title"
                  >
                    <header className="career-interview-complete">
                      <Icon name="check" />
                      <span className="career-interview-complete__copy">
                        <strong id="interview-review-title">本轮模板面试已完成</strong>
                        <span>
                          反馈只检查回答中可观察的结构、长度和显式证据关联，不判断经历真伪、ATS
                          得分或录用概率。
                        </span>
                      </span>
                    </header>

                    {debriefQuery.isPending ? (
                      <output className="career-request-state">正在读取本求职项目的复盘…</output>
                    ) : null}
                    {debriefQuery.isError ? (
                      <div className="career-inline-error" role="alert">
                        <strong>反馈与复盘暂时无法读取</strong>
                        <span>
                          {debriefQuery.error instanceof Error
                            ? debriefQuery.error.message
                            : "请稍后重试。"}
                        </span>
                        <button type="button" onClick={() => void debriefQuery.refetch()}>
                          重新读取
                        </button>
                      </div>
                    ) : null}

                    {!debriefQuery.isPending && !debriefQuery.isError && reviewState === "empty" ? (
                      <div className="career-interview-review__prepare">
                        <div>
                          <strong>生成确定性反馈与复盘</strong>
                          <p>
                            只有点击后才会写入；生成结果固定到本轮
                            Session、岗位版本、岗位简历和证据修订。
                          </p>
                        </div>
                        <button
                          className="career-button career-button--primary"
                          type="button"
                          disabled={prepareDebriefMutation.isPending}
                          onClick={prepareDebrief}
                        >
                          {prepareDebriefMutation.isPending ? "正在生成…" : "生成反馈与复盘"}
                        </button>
                      </div>
                    ) : null}

                    {!debriefQuery.isPending && !debriefQuery.isError && reviewState === "other" ? (
                      <div className="career-interview-review__prepare">
                        <div>
                          <strong>本求职项目已有另一轮复盘</strong>
                          <p>一个求职项目当前只保留一份活动复盘，请打开生成它的面试记录查看。</p>
                        </div>
                        {debriefQuery.data?.debrief?.interviewSessionId ? (
                          <button
                            className="career-button career-button--quiet"
                            type="button"
                            onClick={() =>
                              selectSession(
                                debriefQuery.data?.debrief?.interviewSessionId ?? detail.session.id,
                              )
                            }
                          >
                            打开对应练习
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {prepareDebriefMutation.isError ? (
                      <div className="career-inline-error" role="alert">
                        <strong>
                          {debriefConflict ? "面试或现有复盘已经变化" : "反馈与复盘没有生成"}
                        </strong>
                        <span>
                          {debriefConflict
                            ? "已重新读取最新数据，请核对后再决定是否生成。"
                            : prepareDebriefMutation.error instanceof Error
                              ? prepareDebriefMutation.error.message
                              : "请稍后重试。"}
                        </span>
                      </div>
                    ) : null}

                    {reviewState === "selected" && (!feedback || !debrief) ? (
                      <div className="career-inline-error" role="alert">
                        <strong>复盘记录不完整</strong>
                        <span>当前记录缺少结构化反馈，请重新读取；系统不会自动补写。</span>
                        <button type="button" onClick={() => void debriefQuery.refetch()}>
                          重新读取
                        </button>
                      </div>
                    ) : null}

                    {feedback && debrief ? (
                      <div className="career-interview-review__content">
                        <section className="career-interview-feedback-summary">
                          <div>
                            <h3>本轮观察</h3>
                            <p>确定性模板反馈 · 草稿</p>
                          </div>
                          <p>{feedback.feedback.summary}</p>
                          <ul>
                            {feedback.feedback.strengths.map((strength) => (
                              <li key={strength}>{strength}</li>
                            ))}
                          </ul>
                        </section>

                        <section className="career-interview-feedback-items">
                          <header>
                            <h3>逐项提示</h3>
                            <span>{feedback.feedback.items.length} 项</span>
                          </header>
                          {feedback.feedback.items.length > 0 ? (
                            <ol>
                              {feedback.feedback.items.map((item) => (
                                <li key={item.id}>
                                  <header>
                                    <strong>
                                      {interviewFeedbackCategoryLabels[item.category]}
                                    </strong>
                                    <span data-severity={item.severity}>
                                      {interviewFeedbackSeverityLabels[item.severity]}
                                    </span>
                                  </header>
                                  <p>{item.message}</p>
                                  {item.improvement ? <small>{item.improvement}</small> : null}
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p className="career-interview-review__empty">
                              模板没有发现结构或显式证据关联提示；这不代表回答质量、事实真实性或岗位适配度已经通过专业评估。
                            </p>
                          )}
                        </section>

                        <div className="career-interview-debrief-grid">
                          <section>
                            <header>
                              <h3>表达问题</h3>
                              <span>{debrief.expressionIssues.length}</span>
                            </header>
                            {debrief.expressionIssues.length > 0 ? (
                              <ul>
                                {debrief.expressionIssues.map((issue) => (
                                  <li key={issue.id}>{issue.description}</li>
                                ))}
                              </ul>
                            ) : (
                              <p>本轮没有生成表达结构提示。</p>
                            )}
                          </section>
                          <section>
                            <header>
                              <h3>证据缺口</h3>
                              <span>{debrief.evidenceGaps.length}</span>
                            </header>
                            {debrief.evidenceGaps.length > 0 ? (
                              <ul>
                                {debrief.evidenceGaps.map((gap) => (
                                  <li key={gap.id}>{gap.description}</li>
                                ))}
                              </ul>
                            ) : (
                              <p>本轮没有生成显式证据关联提示。</p>
                            )}
                          </section>
                          <section>
                            <header>
                              <h3>练习计划</h3>
                              <span>{debrief.practicePlan.length}</span>
                            </header>
                            <ol>
                              {debrief.practicePlan.map((item) => (
                                <li key={item.id}>{item.action}</li>
                              ))}
                            </ol>
                          </section>
                        </div>

                        <DebriefConfirmationPanel
                          key={debrief.id}
                          caseId={applicationCase.id}
                          debrief={debrief}
                          itemDecisions={debriefQuery.data?.itemDecisions ?? []}
                          confirmation={debriefQuery.data?.confirmation ?? null}
                          pending={confirmDebriefMutation.isPending}
                          error={confirmDebriefMutation.error}
                          onConfirm={confirmDebrief}
                        />
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </>
            ) : null}
          </section>
        </div>
      ) : null}
      <AssetDeletionDialog
        open={sessionDeleteOpen && Boolean(detail)}
        title="删除这轮面试练习？"
        description="只删除当前选择的面试练习，不删除求职项目或岗位简历。"
        consequence="已经生成的复盘不会自动删除；你可以继续保留，或使用单独的复盘删除入口。"
        pending={deleteSessionMutation.isPending}
        error={deleteSessionMutation.error}
        onClose={() => {
          if (deleteSessionMutation.isPending) return;
          setSessionDeleteOpen(false);
          deleteSessionMutation.reset();
        }}
        onConfirm={() => {
          if (!detail) return;
          deleteSessionMutation.mutate({
            sessionId: detail.session.id,
            expectedRevision: detail.session.revision,
          });
        }}
      />
      <AssetDeletionDialog
        open={debriefDeleteOpen && Boolean(debriefQuery.data?.debrief)}
        title="删除当前复盘？"
        description="删除表达问题、证据缺口、练习计划和本次确认记录。"
        consequence="关联面试练习、岗位简历和求职项目不会被连带删除。"
        pending={deleteDebriefMutation.isPending}
        error={deleteDebriefMutation.error}
        onClose={() => {
          if (deleteDebriefMutation.isPending) return;
          setDebriefDeleteOpen(false);
          deleteDebriefMutation.reset();
        }}
        onConfirm={() => {
          const currentDebrief = debriefQuery.data?.debrief;
          if (!currentDebrief) return;
          deleteDebriefMutation.mutate({
            debriefId: currentDebrief.id,
            expectedRevision: currentDebrief.revision,
          });
        }}
      />
    </div>
  );
}
