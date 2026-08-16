import type {
  ResumeDocumentContentRevisionReadModel,
  ResumeReviewRunMode,
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
  resumeReviewGenerationLabel,
  resumeReviewReasonLabel,
  resumeReviewRequirementIds,
  resumeReviewStatusLabel,
} from "../resume-review-view";
import { Icon } from "./Icon";

interface DecisionCommand {
  signature: string;
  idempotencyKey: string;
}

const startReviewCommands = new Map<string, { signature: string; key: string }>();

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
    case "CONTROLLED_AI_CONSENT_REQUIRED":
      return "请先明确同意本次去标识化处理，再开始受控 AI 审阅。";
    case "RESUME_REVIEW_V2_WRITE_DISABLED":
      return "当前环境尚未开放 Review v2 新写入；模板审阅仍可沿用兼容路径。";
    default:
      return error.message;
  }
}

function requirementNecessityLabel(necessity: string): string {
  switch (necessity) {
    case "required":
      return "必须";
    case "preferred":
      return "优先";
    case "optional":
      return "可选";
    default:
      return "未说明";
  }
}

export function ResumeReviewPanel({
  documentId,
  documentRevision,
  currentContentRevisionId,
  contentRevisions,
  selectedBlockId,
  selectedRequirementId,
  disabled,
  onBusyChange,
  onSelectBlock,
  onSelectRequirement,
}: {
  documentId: string;
  documentRevision: number;
  currentContentRevisionId: string;
  contentRevisions: ResumeDocumentContentRevisionReadModel[];
  selectedBlockId: string | null;
  selectedRequirementId: string | null;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSelectBlock: (blockId: string) => void;
  onSelectRequirement: (requirementId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [decisionDraft, setDecisionDraft] = useState<ResumeReviewDecisionDraft | null>(null);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const startCommandRef = useRef<{ signature: string; key: string } | null>(
    startReviewCommands.get(documentId) ?? null,
  );
  const decisionCommandsRef = useRef<Map<string, DecisionCommand>>(new Map());

  const reviewQuery = useQuery({
    queryKey: careerOsQueryKeys.resumeReview(documentId),
    queryFn: ({ signal }) => getCurrentResumeReview(documentId, signal),
    refetchInterval: (query) =>
      query.state.data?.review?.reviewRun.status === "pending" ? 1_000 : false,
  });
  const review = reviewQuery.data?.review ?? null;
  const requirements = reviewQuery.data?.requirements ?? [];
  const requirementById = useMemo(
    () => new Map(requirements.map((requirement) => [requirement.id, requirement])),
    [requirements],
  );
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
    mutationFn: (mode: ResumeReviewRunMode) => {
      const request =
        mode === "template"
          ? ({ expectedRevision: documentRevision, mode } as const)
          : ({ expectedRevision: documentRevision, mode, privacyConsent: true } as const);
      const signature = JSON.stringify(request);
      if (!startCommandRef.current || startCommandRef.current.signature !== signature) {
        startCommandRef.current = {
          signature,
          key: createIdempotencyKey("resume-review"),
        };
        startReviewCommands.set(documentId, startCommandRef.current);
      }
      return createResumeReview(documentId, request, startCommandRef.current.key);
    },
    retry: false,
    onMutate: () => onBusyChange(true),
    onSuccess: async (_response, mode) => {
      startReviewCommands.delete(documentId);
      startCommandRef.current = null;
      setDecisionDraft(null);
      if (mode === "controlled_ai") setPrivacyConsent(false);
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
          <p>岗位要求 · 证据 · 建议</p>
          <h3 id="career-resume-review-heading">岗位审阅</h3>
          <span>
            {review
              ? resumeReviewGenerationLabel(review.reviewRun)
              : "先核对固定岗位要求，再由你明确选择审阅方式。"}
          </span>
        </div>
      </header>

      <section
        className="career-resume-review__composer"
        aria-labelledby="career-resume-review-composer-title"
      >
        <div>
          <strong id="career-resume-review-composer-title">生成当前修订的建议</strong>
          <span>两种方式都只生成待决定建议，不会自动改写正文。</span>
        </div>
        <button
          className="career-button career-button--quiet"
          type="button"
          disabled={disabled || mutationBusy || currentReviewIsPending}
          onClick={() => startMutation.mutate("template")}
        >
          {startMutation.isPending && startMutation.variables === "template"
            ? "正在创建…"
            : "运行确定性模板"}
        </button>
        <label className="career-resume-review__consent">
          <input
            type="checkbox"
            checked={privacyConsent}
            disabled={disabled || mutationBusy || currentReviewIsPending}
            onChange={(event) => setPrivacyConsent(event.currentTarget.checked)}
          />
          <span>
            <strong>本次同意去标识化处理</strong>
            <small>仅发送固定要求、已确认证据和去标识化正文；远程环境默认关闭。</small>
          </span>
        </label>
        <button
          className="career-button career-button--primary"
          type="button"
          disabled={
            !privacyConsent || disabled || mutationBusy || currentReviewIsPending
          }
          onClick={() => startMutation.mutate("controlled_ai")}
        >
          {startMutation.isPending && startMutation.variables === "controlled_ai"
            ? "正在创建…"
            : "使用受控 AI 审阅"}
        </button>
      </section>

      <section
        className="career-resume-review__requirements"
        aria-labelledby="career-resume-review-requirements-title"
      >
        <header>
          <div>
            <p>固定输入</p>
            <strong id="career-resume-review-requirements-title">岗位要求</strong>
          </div>
          <span>{requirements.length}</span>
        </header>
        {requirements.length > 0 ? (
          <ol>
            {requirements.map((requirement, index) => (
              <li
                key={requirement.id}
                className={requirement.id === selectedRequirementId ? "is-selected" : undefined}
              >
                <button
                  type="button"
                  aria-pressed={requirement.id === selectedRequirementId}
                  onClick={() => onSelectRequirement(requirement.id)}
                >
                  <span>
                    要求 {index + 1} · {requirementNecessityLabel(requirement.necessity)}
                  </span>
                  <strong>{requirement.sourceText}</strong>
                </button>
              </li>
            ))}
          </ol>
        ) : reviewQuery.isPending ? (
          <output>正在读取固定岗位要求…</output>
        ) : (
          <p className="career-resume-review__requirements-empty">
            当前固定岗位版本没有可引用的结构化要求；系统不会补写未知要求。
          </p>
        )}
      </section>

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

          {review.reviewRun.schemaVersion === "resume-review-run-v2" &&
          review.reviewRun.usedTemplateFallback ? (
            <p className="career-resume-review__notice is-fallback">
              {resumeReviewGenerationLabel(review.reviewRun)}。降级原因已随本次 Run 保存，正文没有被自动修改。
            </p>
          ) : null}
          {review.reviewRun.schemaVersion === "resume-review-run-v1" ? (
            <p className="career-resume-review__notice">
              这是兼容读取的历史 v1 审阅；系统不会用当前模板或 AI 配置伪造它的生成来源。
            </p>
          ) : null}

          {currentReviewIsPending ? (
            <output className="career-resume-review__processing">
              <Icon name="calendar" size={18} />
              {review.reviewRun.mode === "controlled_ai"
                ? "受控审阅正在隔离队列中处理；不可用时会明确降级为确定性模板。"
                : "确定性模板正在隔离队列中处理；完成后会自动刷新。"}
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
                const requirementIds = resumeReviewRequirementIds(suggestion);
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
                    <div className="career-resume-review__requirement-refs">
                      <span>岗位要求引用</span>
                      {requirementIds.length > 0 ? (
                        <div>
                          {requirementIds.map((requirementId) => {
                            const requirement = requirementById.get(requirementId);
                            return (
                              <button
                                key={requirementId}
                                type="button"
                                onClick={() => onSelectRequirement(requirementId)}
                              >
                                {requirement?.sourceText ?? "固定要求已保留，但当前投影不可读"}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <small>
                          {suggestion.schemaVersion === "resume-review-suggestion-v1"
                            ? "历史 v1 没有伪造岗位要求引用。"
                            : "此建议不包含岗位要求文本引用。"}
                        </small>
                      )}
                    </div>

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
                    <span>
                      {resumeReviewReasonLabel(finding.reasonCode)}
                      {resumeReviewRequirementIds(finding).length > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            onSelectRequirement(resumeReviewRequirementIds(finding)[0] ?? "")
                          }
                        >
                          查看岗位要求
                        </button>
                      ) : null}
                    </span>
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
