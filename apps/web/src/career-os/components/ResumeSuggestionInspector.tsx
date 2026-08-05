import type { CareerResumeBlock } from "../case-workspace-domain";
import { getCareerCaseWorkspace } from "../case-workspace-domain";
import type { CareerCase } from "../domain";
import type { ResumeSuggestionSession } from "../resume-suggestion-state";
import { ContextInspectorFrame } from "./ContextInspector";
import { EvidenceState } from "./EvidenceState";
import { Icon } from "./Icon";

interface ResumeSuggestionInspectorProps {
  careerCase: CareerCase;
  block: CareerResumeBlock;
  session: ResumeSuggestionSession;
  isEditing: boolean;
  onClose: () => void;
  onAccept: () => void;
  onBeginEdit: () => void;
  onDraftChange: (value: string) => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
  onReject: () => void;
  onUndo: () => void;
}

const decisionLabels = {
  pending: "待用户确认",
  accepted: "已在当前会话接受",
  edited: "已编辑后采用",
  rejected: "已拒绝并保留原文",
} as const;

export function ResumeSuggestionInspector({
  careerCase,
  block,
  session,
  isEditing,
  onClose,
  onAccept,
  onBeginEdit,
  onDraftChange,
  onConfirmEdit,
  onCancelEdit,
  onReject,
  onUndo,
}: ResumeSuggestionInspectorProps) {
  const workspace = getCareerCaseWorkspace(careerCase.id);
  const suggestion = block.suggestion;
  const requirement = workspace.requirements.find((item) => item.id === suggestion?.requirementId);
  const evidence = careerCase.evidence.filter((item) => suggestion?.evidenceIds.includes(item.id));

  if (!suggestion) {
    return (
      <ContextInspectorFrame
        ariaLabel={`${block.title}简历区块检查器`}
        eyebrow="当前简历区块"
        title={block.title}
        meta={`${careerCase.companyName} · ${careerCase.roleTitle}`}
        closeLabel="关闭简历建议检查器"
        onClose={onClose}
      >
        <section className="career-inspector__section">
          <h3>当前区块说明</h3>
          <div className="career-inspector-empty">
            <Icon name="document" size={18} />
            <p>此静态区块没有岗位建议；原文保持不变，不会自动生成内容。</p>
          </div>
        </section>
      </ContextInspectorFrame>
    );
  }

  return (
    <ContextInspectorFrame
      ariaLabel={`${block.title}简历建议检查器`}
      eyebrow="当前简历区块"
      title={block.title}
      meta={`${careerCase.companyName} · ${careerCase.roleTitle}`}
      closeLabel="关闭简历建议检查器"
      onClose={onClose}
    >
      <section className="career-inspector__section">
        <h3>岗位要求</h3>
        <div className="career-resume-inspector__requirement">
          <strong>{requirement?.title ?? "当前岗位要求"}</strong>
          <p>{requirement?.sourceText ?? "当前静态区块没有关联要求。"}</p>
        </div>
      </section>

      <section className="career-inspector__section">
        <h3>引用的已确认证据</h3>
        {evidence.length > 0 ? (
          <ul className="career-inspector__evidence career-inspector__evidence--cards">
            {evidence.map((item) => (
              <li key={item.id}>
                <span>{item.label}</span>
                <EvidenceState state={item.state} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="career-static-disclaimer">没有已确认的证据引用，建议不可采用。</p>
        )}
      </section>

      <section className="career-inspector__section">
        <div className="career-inspector-section-heading">
          <h3>规则示例建议</h3>
          <span>未调用 AI</span>
        </div>
        {session.decision === "rejected" ? (
          <div className="career-inspector-empty">
            <Icon name="close" size={18} />
            <p>建议已隐藏，A4 预览继续使用原文。</p>
          </div>
        ) : isEditing ? (
          <label className="career-suggestion-editor">
            编辑后采用
            <textarea
              value={session.draftText}
              rows={7}
              onChange={(event) => onDraftChange(event.currentTarget.value)}
            />
          </label>
        ) : (
          <blockquote className="career-resume-suggestion-copy">
            <p>{session.draftText}</p>
          </blockquote>
        )}
        <p className="career-suggestion-status" aria-live="polite">
          {decisionLabels[session.decision]}
        </p>
      </section>

      <section className="career-inspector__section career-suggestion-actions">
        {session.decision === "pending" && !isEditing ? (
          <>
            <button
              className="career-button career-button--primary"
              type="button"
              onClick={onAccept}
            >
              接受
            </button>
            <button
              className="career-button career-button--quiet"
              type="button"
              onClick={onBeginEdit}
            >
              编辑后采用
            </button>
            <button
              className="career-button career-button--danger"
              type="button"
              onClick={onReject}
            >
              拒绝
            </button>
          </>
        ) : null}
        {isEditing ? (
          <>
            <button
              className="career-button career-button--primary"
              type="button"
              disabled={!session.draftText.trim()}
              onClick={onConfirmEdit}
            >
              确认采用
            </button>
            <button
              className="career-button career-button--quiet"
              type="button"
              onClick={onCancelEdit}
            >
              取消
            </button>
          </>
        ) : null}
        {session.decision !== "pending" && !isEditing ? (
          <button className="career-button career-button--quiet" type="button" onClick={onUndo}>
            撤销本次操作
          </button>
        ) : null}
      </section>
    </ContextInspectorFrame>
  );
}
