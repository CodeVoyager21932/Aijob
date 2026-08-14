import type { ApplicationCaseWithJobContext, CaseMatchState } from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Link } from "react-router-dom";
import { careerOsQueryKeys, createCaseMatchRun, getCaseMatchState } from "../../api/career-os";
import { createIdempotencyKey, ProductApiError } from "../../api/client";
import {
  caseMatchCatalogLabels,
  caseMatchMissingInputLabels,
  caseMatchStaleReasonLabels,
  toCaseMatchAxes,
} from "../case-match-view";
import { Icon } from "./Icon";

function MatchStateHeading({ state }: { state: CaseMatchState }) {
  if (state.status === "not_applicable_private") {
    return <strong>私有 JD 保持逐项核对</strong>;
  }
  if (state.status === "profile_incomplete") return <strong>资料还没有准备完整</strong>;
  if (state.status === "not_run") return <strong>尚未核对这个固定岗位版本</strong>;
  if (state.status === "queued") return <strong>核对任务已进入队列</strong>;
  if (state.status === "processing") return <strong>正在核对三类依据</strong>;
  if (state.status === "current") return <strong>结果对应当前固定输入</strong>;
  if (state.status === "stale") return <strong>已有结果需要重新核对</strong>;
  return <strong>上次核对没有完成</strong>;
}

function MatchInputSummary({ state }: { state: CaseMatchState }) {
  if (state.status === "not_applicable_private") {
    return <p>当前岗位只在你的私有 Case 中保存，不与公共目录岗位建立三轴运行。</p>;
  }
  if (state.status === "profile_incomplete") {
    return (
      <div className="career-case-match__missing">
        <p>
          待确认：
          {state.missingInputs.map((item) => caseMatchMissingInputLabels[item]).join("、")}。
        </p>
        <Link className="career-button career-button--quiet" to="/resumes/import">
          完善资料
          <Icon name="chevron" size={16} />
        </Link>
      </div>
    );
  }
  if (state.status === "stale") {
    return (
      <ul className="career-case-match__reasons">
        {state.staleReasons.map((reason) => (
          <li key={reason}>{caseMatchStaleReasonLabels[reason]}</li>
        ))}
      </ul>
    );
  }
  if (state.status === "failed") {
    return (
      <p>
        {state.run?.failureCode === "CASE_MATCH_CONTEXT_CHANGED"
          ? "Case 在任务执行期间发生变化，旧任务没有写回结果。"
          : "固定输入仍然保留，可以重新发起一次核对。"}
      </p>
    );
  }
  if (state.status === "queued" || state.status === "processing") {
    return <p>任务只使用当前 Case 固定岗位版本和已确认资料修订。</p>;
  }
  if (state.status === "not_run") {
    return <p>资格、经历证据与个人偏好将分别呈现，不合并为总分。</p>;
  }
  return null;
}

export function CaseMatchPanel({
  applicationCase,
}: {
  applicationCase: ApplicationCaseWithJobContext;
}) {
  const queryClient = useQueryClient();
  const commandRef = useRef<{ signature: string; key: string } | null>(null);
  const matchQuery = useQuery({
    queryKey: careerOsQueryKeys.caseMatchState(applicationCase.id),
    queryFn: ({ signal }) => getCaseMatchState(applicationCase.id, signal),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "processing" ? 1_000 : false;
    },
    retry: (failureCount, error) =>
      error instanceof ProductApiError && error.status === 404 ? false : failureCount < 1,
  });
  const matchMutation = useMutation({
    mutationFn: (idempotencyKey: string) =>
      createCaseMatchRun(applicationCase.id, applicationCase.revision, idempotencyKey),
    retry: false,
    onSuccess: (state) => {
      queryClient.setQueryData(careerOsQueryKeys.caseMatchState(applicationCase.id), state);
    },
    onError: (error) => {
      if (
        error instanceof ProductApiError &&
        [
          "APPLICATION_CASE_REVISION_CONFLICT",
          "CASE_MATCH_INPUT_CHANGED",
          "CASE_MATCH_CONTEXT_CHANGED",
          "CASE_MATCH_PROFILE_INCOMPLETE",
        ].includes(error.code ?? "")
      ) {
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: careerOsQueryKeys.caseDetail(applicationCase.id),
          }),
          queryClient.invalidateQueries({
            queryKey: careerOsQueryKeys.caseMatchState(applicationCase.id),
          }),
        ]);
      }
    },
  });

  if (matchQuery.isPending) {
    return <output className="career-request-state">正在读取三轴核对状态…</output>;
  }
  if (matchQuery.isError) {
    return (
      <section className="career-case-match career-inline-error" role="alert">
        <div>
          <strong>三轴核对状态暂时无法读取</strong>
          <p>{matchQuery.error.message}</p>
        </div>
        <button type="button" onClick={() => void matchQuery.refetch()}>
          重新读取
        </button>
      </section>
    );
  }

  const state = matchQuery.data;
  const result =
    state.status === "current" || state.status === "stale" ? state.run?.result : null;
  const canRun =
    state.status === "not_run" || state.status === "stale" || state.status === "failed";
  const signature = `${applicationCase.id}:${applicationCase.revision}:${JSON.stringify(state.input)}`;
  const startMatch = () => {
    if (!commandRef.current || commandRef.current.signature !== signature) {
      commandRef.current = { signature, key: createIdempotencyKey("case-match") };
    }
    matchMutation.mutate(commandRef.current.key);
  };

  return (
    <section className="career-case-match" aria-labelledby="case-match-heading">
      <header>
        <div>
          <p>固定输入核对</p>
          <h2 id="case-match-heading">资格、证据与偏好</h2>
        </div>
        {state.catalogState ? (
          <span className={`career-case-match__catalog is-${state.catalogState}`}>
            {caseMatchCatalogLabels[state.catalogState]}
          </span>
        ) : (
          <span className="career-case-match__catalog is-private">仅当前用户可见</span>
        )}
      </header>

      <div className="career-case-match__status" aria-live="polite">
        <span className={`is-${state.status}`}>
          <Icon
            name={
              state.status === "current"
                ? "check"
                : state.status === "failed"
                  ? "warning"
                  : "question"
            }
            size={20}
          />
        </span>
        <div>
          <MatchStateHeading state={state} />
          <MatchInputSummary state={state} />
        </div>
        {canRun ? (
          <button
            className="career-button career-button--primary"
            type="button"
            disabled={matchMutation.isPending}
            onClick={startMatch}
          >
            {matchMutation.isPending
              ? "正在提交…"
              : state.status === "not_run"
                ? "开始核对"
                : "重新核对"}
          </button>
        ) : null}
      </div>

      {result ? (
        <div className="career-case-match__axes">
          {state.status === "stale" ? (
            <p className="career-case-match__axes-note">
              以下是上次固定输入的结果；重新核对前不会覆盖。
            </p>
          ) : null}
          {toCaseMatchAxes(result).map((axis) => (
            <article className={`is-${axis.tone}`} key={axis.key}>
              <span>{axis.label}</span>
              <strong>{axis.value}</strong>
              {axis.explanations.length > 0 ? (
                <ul>
                  {axis.explanations.slice(0, 3).map((explanation, index) => (
                    <li key={`${axis.key}-${index}-${explanation}`}>{explanation}</li>
                  ))}
                </ul>
              ) : (
                <small>当前已确认信息中没有额外说明。</small>
              )}
            </article>
          ))}
          {result.unknownRequirementIds.length > 0 ? (
            <p className="career-case-match__unknown">
              仍有 {result.unknownRequirementIds.length} 项岗位要求无法可靠核对，请回到要求页确认。
            </p>
          ) : null}
        </div>
      ) : null}

      {matchMutation.isError ? (
        <div className="career-revision-conflict" role="alert">
          <strong>本次核对没有提交成功</strong>
          <p>{matchMutation.error.message} 页面草稿和已有结果均未被覆盖。</p>
          <button type="button" disabled={matchMutation.isPending} onClick={startMatch}>
            重试
          </button>
        </div>
      ) : null}
    </section>
  );
}
