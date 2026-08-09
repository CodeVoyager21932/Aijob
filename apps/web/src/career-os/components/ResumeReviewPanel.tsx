import type {
  ResumeDocumentContentRevisionReadModel,
  ResumeReviewSuggestion,
} from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  careerOsQueryKeys,
  createResumeReview,
  decideResumeReviewSuggestion,
  getCurrentResumeReview,
} from "../../api/career-os";
import { createIdempotencyKey, ProductApiError } from "../../api/client";
import {
  buildResumeReviewDecisionRequest,
  type ResumeReviewDecisionDraft,
} from "../resume-review-decision";
import {
  orderResumeReviewSuggestions,
  resumeReviewBlockText,
  resumeReviewChangeLabel,
  resumeReviewDecisionLabel,
  resumeReviewReasonLabel,
  resumeReviewStatusLabel,
} from "../resume-review-view";
import { Icon } from "./Icon";

interface DecisionCommand {
  signature: string;
  idempotencyKey: string;
}

function requestUuid(): string {
  return crypto.randomUUID();
}

function reviewErrorMessage(error: unknown): string {
  if (!(error instanceof ProductApiError)) {
    return error instanceof Error ? error.message : "请求没有完成，请稍后重试。";
  }
  switch (error.code) {
    case "RESUME_DOCUMENT_REVISION_CONFLICT":
      return "简历已经产生新修订。你的选择仍保留，请核对最新内容后再次提交。";
    case "RESUME_REVIEW_SUGGESTION_CONFLICT":
      return "这条建议已经在另一个页面处理。你的本地选择仍保留，请核对最新状态。";
    case "RESUME_REVIEW_SUGGESTION_STALE":
      return "目标区块已变化，系统没有覆盖新内容。请重新审阅当前修订。";
    case "RESUME_REVIEW_NOT_READY":
      return "审阅任务尚未完成，请稍后再决定。";
    default:
      return error.message;
  }
}

export function ResumeReviewPanel({
  documentId,
  documentRevision,
  currentContentRevisionId,
  contentRevisions,
  selectedBlockId,
  disabled,
  onBusyChange,
  onSelectBlock,
}: {
  documentId: string;
  documentRevision: number;
  currentContentRevisionId: string;
  contentRevisions: ResumeDocumentContentRevisionReadModel[];
  selectedBlockId: string | null;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSelectBlock: (blockId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [decisionDraft, setDecisionDraft] = useState<ResumeReviewDecisionDraft | null>(null);
  const startCommandRef = useRef<{ signature: string; key: string } | null>(null);
  const decisionCommandsRef = useRef<Map<string, DecisionCommand>>(new Map());

  const reviewQuery = useQuery({
    queryKey: careerOsQueryKeys.resumeReview(documentId),
    queryFn: ({ signal }) => getCurrentResumeReview(documentId, signal),
    refetchInterval: (query) =>
      query.state.data?.review?.reviewRun.status === "pending" ? 1_000 : false,
  });
  const review = reviewQuery.data?.review ?? null;
  const reviewedRevision = useMemo(
    () =>
      review
        ? (contentRevisions.find((item) => item.id === review.reviewRun.contentRevisionId) ?? null)
        : null,
    [contentRevisions, review],
  );
  const suggestions = useMemo(
    () => orderResumeReviewSuggestions(review?.suggestions ?? [], selectedBlockId),
    [review?.suggestions, selectedBlockId],
  );
  const suggestionFindingIds = useMemo(
    () => new Set((review?.suggestions ?? []).map((item) => item.findingId)),
    [review?.suggestions],
  );
  const findingsWithoutAction =
    review?.findings.filter((finding) => !suggestionFindingIds.has(finding.id)) ?? [];

  const invalidateReviewState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.resumeReview(documentId) }),
      queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.resumeContent(documentId) }),
      queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.resumeLayout(documentId) }),
      queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.resumeDocument(documentId) }),
      queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.resumeDocumentLists }),
    ]);
  };

  const startMutation = useMutation({
    mutationFn: () => {
      const request = { expectedRevision: documentRevision, mode: "template" as const };
      const signature = JSON.stringify(request);
      if (!startCommandRef.current || startCommandRef.current.signature !== signature) {
        startCommandRef.current = {
          signature,
          key: createIdempotencyKey("resume-review"),
        };
      }
      return createResumeReview(documentId, request, startCommandRef.current.key);
    },
    retry: false,
    onMutate: () => onBusyChange(true),
    onSuccess: async () => {
      setDecisionDraft(null);
      await invalidateReviewState();
    },
    onSettled: () => onBusyChange(false),
  });

  const decisionMutation = useMutation({
    mutationFn: ({
      suggestion,
      draft,
    }: {
      suggestion: ResumeReviewSuggestion;
      draft: ResumeReviewDecisionDraft;
    }) => {
      const signature = JSON.stringify({
        suggestionId: suggestion.id,
        suggestionRevision: suggestion.revision,
        draft,
      });
      const current = decisionCommandsRef.current.get(suggestion.id);
      const command =
        current?.signature === signature ? current : { signature, idempotencyKey: requestUuid() };
      decisionCommandsRef.current.set(suggestion.id, command);
      return decideResumeReviewSuggestion(
        documentId,
        suggestion.reviewRunId,
        suggestion.id,
        buildResumeReviewDecisionRequest(suggestion, draft, command.idempotencyKey),
      );
    },
    retry: false,
    onMutate: () => onBusyChange(true),
    onSuccess: async () => {
      setDecisionDraft(null);
      await invalidateReviewState();
    },
    onError: () => {
      void Promise.all([reviewQuery.refetch(), invalidateReviewState()]);
    },
    onSettled: () => onBusyChange(false),
  });

  const mutationBusy = startMutation.isPending || decisionMutation.isPending;
  const currentReviewIsPending = review?.reviewRun.status === "pending";
  const reviewBasedOnOlderRevision = Boolean(
    review && review.reviewRun.contentRevisionId !== currentContentRevisionId,
  );

  return (
    <section className="career-resume-review" aria-labelledby="career-resume-review-heading">
      <header>
        <div>
          <p>专业审阅 · 确定性模板</p>
          <h3 id="career-resume-review-heading">逐条核对岗位简历建议</h3>
          <span>当前阶段不调用 AI；建议只使用岗位简历固定的已确认证据。</span>
        </div>
        <button
          className="career-button career-button--primary"
          type="button"
          disabled={disabled || mutationBusy || currentReviewIsPending}
          onClick={() => startMutation.mutate()}
        >
          {startMutation.isPending ? "正在创建审阅…" : review ? "重新审阅当前修订" : "开始模板审阅"}
        </button>
      </header>

      {disabled && !mutationBusy ? (
        <p className="career-resume-review__notice">
          请先保存或放弃编辑器中的本地修改，再开始审阅或提交建议决定。
        </p>
      ) : null}
      {reviewBasedOnOlderRevision ? (
        <p className="career-resume-review__notice">
          此记录基于较早正文修订。系统会在采用时逐区块核对；若目标已变化，将拒绝覆盖并保留你的选择。
        </p>
      ) : null}
      {reviewQuery.isError ? (
        <div className="career-inline-error" role="alert">
          <strong>审阅记录暂时无法读取</strong>
          <span>{reviewErrorMessage(reviewQuery.error)}</span>
          <button type="button" onClick={() => void reviewQuery.refetch()}>
            重新读取
          </button>
        </div>
      ) : null}
      {startMutation.isError ? (
        <div className="career-inline-error" role="alert">
          <strong>没有创建新的审阅</strong>
          <span>{reviewErrorMessage(startMutation.error)}</span>
        </div>
      ) : null}
      {decisionMutation.isError ? (
        <div className="career-inline-error" role="alert">
          <strong>这次决定没有保存</strong>
          <span>{reviewErrorMessage(decisionMutation.error)}</span>
        </div>
      ) : null}

      {reviewQuery.isPending ? (
        <output className="career-request-state">正在读取审阅记录…</output>
      ) : !review ? (
        <div className="career-resume-review__empty">
          <Icon name="document" size={22} />
          <div>
            <strong>还没有审阅记录</strong>
            <p>由你明确开始后，后台任务才会生成建议；页面打开不会自动写入。</p>
          </div>
        </div>
      ) : (
        <>
          <div className="career-resume-review__status" aria-live="polite">
            <span className={`is-${review.reviewRun.status}`}>
              {resumeReviewStatusLabel(review.reviewRun.status)}
            </span>
            <span>审阅修订 {review.reviewRun.revision}</span>
            <span>{review.findings.length} 项发现</span>
            <span>{review.suggestions.length} 条可决定建议</span>
          </div>

          {currentReviewIsPending ? (
            <output className="career-resume-review__processing">
              <Icon name="calendar" size={18} />
              模板任务正在隔离队列中处理；完成后会自动刷新，不会调用外部模型。
            </output>
          ) : null}
          {review.reviewRun.status === "failed" ? (
            <div className="career-resume-review__empty">
              <Icon name="warning" size={22} />
              <div>
                <strong>本次审阅任务失败</strong>
                <p>没有改写任何正文。可在确认服务恢复后重新审阅当前修订。</p>
              </div>
            </div>
          ) : null}

          {suggestions.length > 0 ? (
            <ol className="career-resume-review__suggestions">
              {suggestions.map((suggestion) => {
                const targetBlockId = suggestion.targetIds[0] ?? null;
                const originalText = targetBlockId
                  ? resumeReviewBlockText(reviewedRevision, targetBlockId)
                  : null;
                const finding = review.findings.find((item) => item.id === suggestion.findingId);
                const savedDecision = review.decisions.find(
                  (item) => item.suggestionId === suggestion.id,
                );
                const activeDraft =
                  decisionDraft?.suggestionId === suggestion.id ? decisionDraft : null;
                const isSelected = Boolean(
                  selectedBlockId && suggestion.targetIds.includes(selectedBlockId),
                );
                return (
                  <li key={suggestion.id} className={isSelected ? "is-selected" : undefined}>
                    <header>
                      <div>
                        <span>{resumeReviewChangeLabel(suggestion.changeType)}</span>
                        <strong>{resumeReviewDecisionLabel(suggestion.decision)}</strong>
                      </div>
                      {targetBlockId ? (
                        <button type="button" onClick={() => onSelectBlock(targetBlockId)}>
                          {isSelected ? "当前区块" : "定位原文"}
                        </button>
                      ) : null}
                    </header>
                    <p className="career-resume-review__reason">
                      {resumeReviewReasonLabel(finding?.reasonCode ?? "")}
                    </p>
                    <div className="career-resume-review__comparison">
                      <section>
                        <span>审阅时原文</span>
                        <p>{originalText ?? "原始修订未在当前分页中加载。"}</p>
                      </section>
                      <section>
                        <span>模板建议</span>
                        <p>
                          {suggestion.changeType === "remove_block"
                            ? "建议删除此区块；原修订仍保留，可通过后续修订恢复。"
                            : (suggestion.suggestedText ?? "无文本建议")}
                        </p>
                      </section>
                    </div>
                    <p className="career-resume-review__evidence-copy">
                      证据引用：
                      {suggestion.evidenceIds.length > 0
                        ? suggestion.evidenceIds.join("、")
                        : "无；因此只允许删除建议，不生成新经历。"}
                    </p>

                    {suggestion.decision === "pending" ? (
                      activeDraft ? (
                        <div className="career-resume-review__decision-draft">
                          {activeDraft.kind === "edited" ? (
                            <label>
                              编辑后采用
                              <textarea
                                rows={5}
                                maxLength={10_000}
                                value={activeDraft.text}
                                disabled={disabled || mutationBusy}
                                onChange={(event) =>
                                  setDecisionDraft({
                                    ...activeDraft,
                                    text: event.currentTarget.value,
                                  })
                                }
                              />
                              <small>
                                {activeDraft.text.length.toLocaleString("zh-CN")} / 10,000
                              </small>
                            </label>
                          ) : (
                            <p>
                              {activeDraft.kind === "accepted"
                                ? suggestion.changeType === "remove_block"
                                  ? "确认后会生成删除该区块的新修订，不会抹除历史。"
                                  : "确认后会把模板建议写入一个新的不可变正文修订。"
                                : "确认后保留原文，只记录拒绝决定。"}
                            </p>
                          )}
                          <div>
                            <button
                              className="career-button career-button--primary"
                              type="button"
                              disabled={
                                disabled ||
                                mutationBusy ||
                                (activeDraft.kind === "edited" && !activeDraft.text.trim())
                              }
                              onClick={() =>
                                decisionMutation.mutate({ suggestion, draft: activeDraft })
                              }
                            >
                              {decisionMutation.isPending ? "正在保存…" : "确认保存决定"}
                            </button>
                            <button
                              className="career-button career-button--quiet"
                              type="button"
                              disabled={mutationBusy}
                              onClick={() => setDecisionDraft(null)}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="career-resume-review__actions">
                          <button
                            className="career-button career-button--primary"
                            type="button"
                            disabled={disabled || mutationBusy}
                            onClick={() =>
                              setDecisionDraft({ kind: "accepted", suggestionId: suggestion.id })
                            }
                          >
                            {suggestion.changeType === "remove_block" ? "采用删除建议" : "采用建议"}
                          </button>
                          {suggestion.changeType === "rewrite_block" && suggestion.suggestedText ? (
                            <button
                              className="career-button career-button--quiet"
                              type="button"
                              disabled={disabled || mutationBusy}
                              onClick={() =>
                                setDecisionDraft({
                                  kind: "edited",
                                  suggestionId: suggestion.id,
                                  text: suggestion.suggestedText ?? "",
                                })
                              }
                            >
                              编辑后采用
                            </button>
                          ) : null}
                          <button
                            className="career-button career-button--quiet"
                            type="button"
                            disabled={disabled || mutationBusy}
                            onClick={() =>
                              setDecisionDraft({ kind: "rejected", suggestionId: suggestion.id })
                            }
                          >
                            保留原文
                          </button>
                        </div>
                      )
                    ) : (
                      <div className="career-resume-review__decision-saved">
                        <Icon name="check" size={17} />
                        <span>
                          决定已保存于 {savedDecision?.createdAt ?? suggestion.updatedAt}。
                          {savedDecision?.resultContentRevisionId
                            ? "正文变更已形成独立修订；如需恢复，请在编辑器中改回并另存新修订。"
                            : "正文保持不变。"}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : review.reviewRun.status === "completed" ? (
            <div className="career-resume-review__empty">
              <Icon name="check" size={22} />
              <div>
                <strong>没有需要逐条处理的改写</strong>
                <p>仍保留审阅发现，未生成无证据的新内容。</p>
              </div>
            </div>
          ) : null}

          {findingsWithoutAction.length > 0 ? (
            <section className="career-resume-review__findings">
              <h4>无需自动操作的发现</h4>
              <ul>
                {findingsWithoutAction.map((finding) => (
                  <li key={finding.id}>
                    <button type="button" onClick={() => onSelectBlock(finding.sourceBlockId)}>
                      定位区块
                    </button>
                    <span>{resumeReviewReasonLabel(finding.reasonCode)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
