import type {
  CaseQuestion,
  CaseQuestionStatus,
  JobRequirement,
  LegacyResumeEvidence,
  RequirementEvidenceState,
  ResumeEvidence,
} from "@aijob/contracts";
import type { RefObject } from "react";
import { Link } from "react-router-dom";
import type { ApplicationCaseView } from "../application-case-view";
import {
  type RequirementGroup,
  requirementGroups,
  requirementKindLabel,
  requirementNextStep,
} from "../requirements-view";
import { ContextInspectorFrame } from "./ContextInspector";
import { Icon } from "./Icon";

type Evidence = ResumeEvidence | LegacyResumeEvidence;

interface RequirementInspectorProps {
  applicationCase: ApplicationCaseView;
  requirement: JobRequirement;
  group: RequirementGroup;
  sourceLabel: string;
  state: RequirementEvidenceState;
  userNote: string;
  evidenceIds: string[];
  evidenceRevisionId: string | null;
  evidence: Evidence[];
  questions: CaseQuestion[];
  questionDraft: string;
  answerDrafts: Record<string, string>;
  pending: boolean;
  conflict: boolean;
  error: unknown;
  onClose: () => void;
  onStateChange: (state: RequirementEvidenceState) => void;
  onNoteChange: (note: string) => void;
  onEvidenceChange: (ids: string[]) => void;
  onSaveState: () => void;
  onSaveEvidence: () => void;
  onQuestionDraftChange: (value: string) => void;
  onCreateQuestion: () => void;
  onAnswerDraftChange: (questionId: string, value: string) => void;
  onUpdateQuestion: (
    question: CaseQuestion,
    status: CaseQuestionStatus,
    answer: string | null,
  ) => void;
  titleId?: string;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
}

function evidenceText(evidence: Evidence): string {
  return "statement" in evidence ? evidence.statement : evidence.claim;
}

export function RequirementInspector({
  applicationCase,
  requirement,
  group,
  sourceLabel,
  state,
  userNote,
  evidenceIds,
  evidenceRevisionId,
  evidence,
  questions,
  questionDraft,
  answerDrafts,
  pending,
  conflict,
  error,
  onClose,
  onStateChange,
  onNoteChange,
  onEvidenceChange,
  onSaveState,
  onSaveEvidence,
  onQuestionDraftChange,
  onCreateQuestion,
  onAnswerDraftChange,
  onUpdateQuestion,
  titleId,
  closeButtonRef,
}: RequirementInspectorProps) {
  const groupLabel = requirementGroups.find((item) => item.value === group)?.label ?? "岗位要求";

  return (
    <ContextInspectorFrame
      ariaLabel={`${requirement.sourceText}要求检查器`}
      eyebrow={groupLabel}
      title={requirement.sourceText}
      meta={`${applicationCase.companyName} · ${applicationCase.roleTitle}`}
      closeLabel="关闭要求检查器"
      onClose={onClose}
      titleId={titleId}
      closeButtonRef={closeButtonRef}
      footer={
        <Link
          className="career-button career-button--primary"
          to={`/applications/${applicationCase.id}/resume`}
        >
          进入简历准备
          <Icon name="chevron" size={17} />
        </Link>
      }
    >
      <section className="career-inspector__section">
        <h3>当前证据状态</h3>
        <div className="career-requirement-state-editor">
          <label>
            <span>状态</span>
            <select
              value={state}
              disabled={pending}
              onChange={(event) => onStateChange(event.target.value as RequirementEvidenceState)}
            >
              <option value="confirmed">已有证据</option>
              <option value="needs_work">证据待补充</option>
              <option value="unconfirmed">用户尚未确认</option>
            </select>
          </label>
          <label>
            <span>用户备注</span>
            <textarea
              rows={4}
              maxLength={2_000}
              value={userNote}
              disabled={pending}
              onChange={(event) => onNoteChange(event.target.value)}
            />
          </label>
          <button
            className="career-button career-button--quiet"
            type="button"
            disabled={pending}
            onClick={onSaveState}
          >
            保存状态与备注
          </button>
        </div>
      </section>

      <section className="career-inspector__section">
        <h3>JD 原文</h3>
        <blockquote className="career-requirement-quote">
          <p>{requirement.sourceText}</p>
          <cite>
            {requirementKindLabel(requirement.kind)} · {sourceLabel}
            {requirement.sourceSpan
              ? ` · 字符 ${requirement.sourceSpan.start}–${requirement.sourceSpan.end}`
              : ""}
          </cite>
        </blockquote>
      </section>

      <section className="career-inspector__section">
        <h3>关联已确认证据</h3>
        {evidenceRevisionId && evidence.length > 0 ? (
          <div className="career-requirement-evidence-picker">
            {evidence.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={evidenceIds.includes(item.id)}
                  disabled={pending}
                  onChange={(event) =>
                    onEvidenceChange(
                      event.target.checked
                        ? [...evidenceIds, item.id]
                        : evidenceIds.filter((id) => id !== item.id),
                    )
                  }
                />
                <span>
                  <strong>{item.section}</strong>
                  <small>{evidenceText(item)}</small>
                </span>
              </label>
            ))}
            <button
              className="career-button career-button--quiet"
              type="button"
              disabled={pending}
              onClick={onSaveEvidence}
            >
              保存证据关联
            </button>
          </div>
        ) : (
          <div className="career-inspector-empty">
            <Icon name="question" size={18} />
            <p>还没有可关联的已确认证据。三态和备注仍可保存。</p>
            <Link to="/resumes/import">先确认简历证据</Link>
          </div>
        )}
      </section>

      <section className="career-inspector__section">
        <h3>待确认问题</h3>
        <div className="career-question-composer">
          <textarea
            rows={3}
            maxLength={1_000}
            placeholder="记录需要向招聘方或自己进一步确认的问题"
            value={questionDraft}
            disabled={pending}
            onChange={(event) => onQuestionDraftChange(event.target.value)}
          />
          <button
            className="career-button career-button--quiet"
            type="button"
            disabled={pending || !questionDraft.trim()}
            onClick={onCreateQuestion}
          >
            添加问题
          </button>
        </div>

        {questions.length > 0 ? (
          <ul className="career-case-questions">
            {questions.map((question) => {
              const answer = answerDrafts[question.id] ?? question.answer ?? "";
              return (
                <li key={question.id}>
                  <div>
                    <strong>{question.question}</strong>
                    <span>
                      {question.status === "dismissed"
                        ? "已忽略"
                        : question.status === "answered"
                          ? "已回答"
                          : "待回答"}
                    </span>
                  </div>
                  {question.status !== "dismissed" ? (
                    <textarea
                      rows={3}
                      maxLength={3_000}
                      value={answer}
                      disabled={pending}
                      placeholder="补充真实答案"
                      onChange={(event) => onAnswerDraftChange(question.id, event.target.value)}
                    />
                  ) : null}
                  <div className="career-case-question-actions">
                    {question.status !== "dismissed" ? (
                      <>
                        <button
                          type="button"
                          disabled={pending || !answer.trim()}
                          onClick={() => onUpdateQuestion(question, "answered", answer.trim())}
                        >
                          {question.status === "answered" ? "更新答案" : "标记已回答"}
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => onUpdateQuestion(question, "dismissed", null)}
                        >
                          忽略
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onUpdateQuestion(question, "open", null)}
                      >
                        重新打开
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <section className="career-inspector__section">
        <h3>确定性下一步</h3>
        <div className="career-next-task">
          <Icon name={state === "confirmed" ? "check" : "warning"} size={19} />
          <p>{requirementNextStep(state, evidenceIds.length)}</p>
        </div>
      </section>

      {conflict ? (
        <div className="career-revision-conflict" role="alert">
          <strong>数据已在另一处更新</strong>
          <p>你的草稿仍保留。系统已读取最新 revision，请核对后再次保存。</p>
        </div>
      ) : error ? (
        <div className="career-inline-error" role="alert">
          <strong>本次保存未完成</strong>
          <span>{error instanceof Error ? error.message : "请核对后重试。"}</span>
        </div>
      ) : null}
    </ContextInspectorFrame>
  );
}
