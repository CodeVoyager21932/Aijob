import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  careerOsQueryKeys,
  getApplicationCase,
  transitionApplicationCase,
} from "../../api/career-os";
import { createIdempotencyKey, ProductApiError } from "../../api/client";
import type { ApplicationCaseView } from "../application-case-view";
import {
  type CaseOutcome,
  type CaseStage,
  caseOutcomes,
  getCaseOutcomeLabel,
  getCaseStageLabel,
  getCaseTransitionTargets,
  isCaseTransitionSelectionValid,
} from "../workspace-model";
import { Icon } from "./Icon";
import { StageBadge } from "./StageBadge";

interface ContextInspectorProps {
  applicationCase: ApplicationCaseView;
  onClose: () => void;
  titleId?: string | undefined;
  closeButtonRef?: RefObject<HTMLButtonElement | null> | undefined;
  onMutationPendingChange?: ((pending: boolean) => void) | undefined;
}

interface ContextInspectorFrameProps {
  ariaLabel: string;
  eyebrow: string;
  title: string;
  meta: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  titleId?: string | undefined;
  closeButtonRef?: RefObject<HTMLButtonElement | null> | undefined;
  closeDisabled?: boolean | undefined;
}

export function ContextInspectorFrame({
  ariaLabel,
  eyebrow,
  title,
  meta,
  closeLabel,
  onClose,
  children,
  footer,
  titleId,
  closeButtonRef,
  closeDisabled = false,
}: ContextInspectorFrameProps) {
  return (
    <aside className="career-inspector" aria-label={ariaLabel}>
      <header className="career-inspector__header">
        <div>
          <p>{eyebrow}</p>
          <h2 id={titleId}>{title}</h2>
          <span>{meta}</span>
        </div>
        <button
          ref={closeButtonRef}
          className="career-icon-button"
          type="button"
          aria-label={closeLabel}
          disabled={closeDisabled}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>

      <div className="career-inspector__scroll">{children}</div>

      {footer ? <footer className="career-inspector__footer">{footer}</footer> : null}
    </aside>
  );
}

export function ContextInspector({
  applicationCase,
  onClose,
  titleId,
  closeButtonRef,
  onMutationPendingChange,
}: ContextInspectorProps) {
  const queryClient = useQueryClient();
  const [toStage, setToStage] = useState<CaseStage | "">("");
  const [outcome, setOutcome] = useState<CaseOutcome | "">("");
  const [requiresReconfirm, setRequiresReconfirm] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const commandRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);
  const targets = getCaseTransitionTargets(applicationCase.stage);
  const selectionValid = isCaseTransitionSelectionValid({
    currentStage: applicationCase.stage,
    currentOutcome: applicationCase.outcome,
    toStage,
    outcome,
  });
  const mutation = useMutation({
    mutationFn: ({
      expectedRevision,
      selectedStage,
      selectedOutcome,
      idempotencyKey,
    }: {
      expectedRevision: number;
      selectedStage: CaseStage;
      selectedOutcome: CaseOutcome | null;
      idempotencyKey: string;
    }) =>
      transitionApplicationCase(
        applicationCase.id,
        {
          expectedRevision,
          toStage: selectedStage,
          outcome: selectedOutcome,
          reason:
            applicationCase.stage === "resolved" && selectedStage === "resolved"
              ? "USER_OUTCOME_CORRECTION"
              : null,
        },
        idempotencyKey,
      ),
    retry: false,
    onSuccess: async () => {
      setToStage("");
      setOutcome("");
      setRequiresReconfirm(false);
      setConflictMessage(null);
      commandRef.current = null;
      await queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.cases });
    },
    onError: async (error) => {
      if (!(error instanceof ProductApiError) || error.status !== 409) return;
      setRequiresReconfirm(true);
      setConflictMessage(
        error.code === "SESSION_RECOVERED_RETRY_REQUIRED"
          ? "本机会话已恢复，刚才的修改没有重放。请核对最新阶段后再次确认。"
          : "项目阶段已变化，已读取最新版本。你的目标选择仍保留，请核对后再次确认。",
      );
      commandRef.current = null;
      await queryClient.fetchQuery({
        queryKey: careerOsQueryKeys.caseDetail(applicationCase.id),
        queryFn: ({ signal }) => getApplicationCase(applicationCase.id, signal),
        staleTime: 0,
      });
    },
  });

  useEffect(() => {
    onMutationPendingChange?.(mutation.isPending);
    return () => onMutationPendingChange?.(false);
  }, [mutation.isPending, onMutationPendingChange]);

  const submitTransition = () => {
    if (!selectionValid || !toStage) return;
    const selectedOutcome = toStage === "resolved" && outcome ? outcome : null;
    const signature = JSON.stringify({
      caseId: applicationCase.id,
      expectedRevision: applicationCase.revision,
      toStage,
      outcome: selectedOutcome,
    });
    if (!commandRef.current || commandRef.current.signature !== signature) {
      commandRef.current = {
        signature,
        idempotencyKey: createIdempotencyKey("case-transition"),
      };
    }
    setConflictMessage(null);
    mutation.mutate({
      expectedRevision: applicationCase.revision,
      selectedStage: toStage,
      selectedOutcome,
      idempotencyKey: commandRef.current.idempotencyKey,
    });
  };

  return (
    <ContextInspectorFrame
      ariaLabel={`${applicationCase.companyName}岗位侧览`}
      eyebrow={applicationCase.companyName}
      title={applicationCase.roleTitle}
      meta={`${applicationCase.locationLabel} · ${applicationCase.workModeLabel}`}
      closeLabel="关闭岗位侧览"
      onClose={onClose}
      titleId={titleId}
      closeButtonRef={closeButtonRef}
      closeDisabled={mutation.isPending}
      footer={
        <Link
          className="career-button career-button--primary"
          to={`/applications/${applicationCase.id}/overview`}
        >
          打开求职工作区
          <Icon name="chevron" size={17} />
        </Link>
      }
    >
      <section className="career-inspector__section">
        <h3>当前阶段</h3>
        <div className="career-inspector__current-stage">
          <StageBadge stage={applicationCase.stage} />
          {applicationCase.outcome ? (
            <span>{getCaseOutcomeLabel(applicationCase.outcome)}</span>
          ) : null}
        </div>
      </section>

      <section className="career-inspector__section career-stage-command">
        <h3>{applicationCase.stage === "resolved" ? "更正结果" : "更新阶段"}</h3>
        {targets.length > 0 ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitTransition();
            }}
          >
            <label>
              <span>目标阶段</span>
              <select
                value={toStage}
                disabled={mutation.isPending}
                onChange={(event) => {
                  const nextStage = event.target.value as CaseStage | "";
                  setToStage(nextStage);
                  if (nextStage !== "resolved") setOutcome("");
                  setRequiresReconfirm(false);
                  setConflictMessage(null);
                  commandRef.current = null;
                }}
              >
                <option value="">请选择</option>
                {targets.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage === "resolved" && applicationCase.stage === "resolved"
                      ? "结果（更正）"
                      : getCaseStageLabel(stage)}
                  </option>
                ))}
              </select>
            </label>
            {toStage === "resolved" ? (
              <label>
                <span>求职结果</span>
                <select
                  value={outcome}
                  disabled={mutation.isPending}
                  onChange={(event) => {
                    setOutcome(event.target.value as CaseOutcome | "");
                    setRequiresReconfirm(false);
                    setConflictMessage(null);
                    commandRef.current = null;
                  }}
                >
                  <option value="">请选择</option>
                  {caseOutcomes.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {conflictMessage ? (
              <div className="career-stage-command__conflict" role="alert">
                <Icon name="warning" size={16} />
                <span>{conflictMessage}</span>
              </div>
            ) : null}
            {mutation.isError && !conflictMessage ? (
              <div className="career-inline-error" role="alert">
                <span>
                  {mutation.error instanceof Error
                    ? mutation.error.message
                    : "阶段暂时无法更新，请核对后重试。"}
                </span>
              </div>
            ) : null}
            {toStage && !selectionValid ? (
              <p className="career-stage-command__invalid" role="alert">
                该目标不再适用于当前阶段，请重新选择。
              </p>
            ) : null}
            <button
              className="career-button career-button--primary"
              type="submit"
              disabled={!selectionValid || mutation.isPending}
            >
              {mutation.isPending ? "正在更新…" : requiresReconfirm ? "再次确认更新" : "确认更新"}
            </button>
          </form>
        ) : (
          <p className="career-inspector__copy">该项目已记录最终结果。</p>
        )}
      </section>

      <section className="career-inspector__section">
        <h3>固定岗位信息</h3>
        <dl className="career-axis-summary">
          <div>
            <dt>地点</dt>
            <dd>{applicationCase.locationLabel}</dd>
          </div>
          <div>
            <dt>截止时间</dt>
            <dd>{applicationCase.deadlineLabel}</dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>{applicationCase.fixedVersionLabel}</dd>
          </div>
        </dl>
      </section>

      <section className="career-inspector__section">
        <h3>来源说明</h3>
        <div className="career-source-proof">
          <Icon name={applicationCase.sourceKind === "catalog" ? "check" : "document"} size={18} />
          <div>
            <strong>{applicationCase.sourceLabel}</strong>
            <span>{applicationCase.sourceMeta}</span>
          </div>
        </div>
      </section>

      {applicationCase.externalUrl ? (
        <section className="career-inspector__section">
          <h3>{applicationCase.externalUrlVerified ? "岗位链接" : "用户提供链接"}</h3>
          <p className="career-inspector__copy">
            打开外部链接不会改变求职阶段，也不会自动标记为已投递。
          </p>
          <a
            className="career-button career-button--quiet"
            href={applicationCase.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            打开外部页面
            <Icon name="external" size={16} />
          </a>
        </section>
      ) : null}
    </ContextInspectorFrame>
  );
}
