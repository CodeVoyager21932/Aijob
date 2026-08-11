import type { ApplicationCaseWithJobContext, InterviewSession } from "@aijob/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  careerOsQueryKeys,
  createInterviewSession,
  getInterviewSession,
  listInterviewSessions,
  submitInterviewAnswer,
} from "../../api/career-os";
import { createIdempotencyKey, ProductApiError } from "../../api/client";
import { Icon } from "../components/Icon";
import {
  currentInterviewQuestion,
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
  const createCommandRef = useRef<{ signature: string; key: string } | null>(null);
  const answerCommandRef = useRef<{ signature: string; key: string } | null>(null);
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

  const detail = detailQuery.data;
  const currentQuestion = currentInterviewQuestion(detail);
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
  const createNeedsResume =
    createMutation.error instanceof ProductApiError &&
    createMutation.error.code === "INTERVIEW_INPUTS_NOT_READY";
  const createConflict =
    createMutation.error instanceof ProductApiError &&
    createMutation.error.code === "APPLICATION_CASE_REVISION_CONFLICT";
  const answerConflict =
    answerMutation.error instanceof ProductApiError &&
    answerMutation.error.code === "INTERVIEW_SESSION_REVISION_CONFLICT";

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
                  <div>
                    <p>{interviewStatusLabels[detail.session.status]}</p>
                    <h2>固定输入的模板面试</h2>
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
                  <output className="career-interview-complete">
                    <Icon name="check" />
                    <span className="career-interview-complete__copy">
                      <strong>本轮模板面试已完成</strong>
                      <span>当前只保留问答记录；反馈与复盘会在 M3 后续切片单独开放。</span>
                    </span>
                  </output>
                ) : null}
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
