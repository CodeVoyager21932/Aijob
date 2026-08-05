import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { CareerResumeBlock } from "../case-workspace-domain";
import { getCareerCaseWorkspace } from "../case-workspace-domain";
import { EvidenceState } from "../components/EvidenceState";
import { Icon } from "../components/Icon";
import { ResumeSuggestionInspector } from "../components/ResumeSuggestionInspector";
import type { CareerCase } from "../domain";
import {
  createResumeSuggestionSession,
  getResumeBlockBullets,
  reduceResumeSuggestion,
  type ResumeSuggestionAction,
  type ResumeSuggestionSession,
} from "../resume-suggestion-state";

type ResumeTemplate = "classic" | "compact";

function shouldOpenInspectorByDefault(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
}

function findSelectedBlock(
  blocks: CareerResumeBlock[],
  requestedBlockId: string | null,
): CareerResumeBlock {
  const selected =
    blocks.find((block) => block.id === requestedBlockId) ??
    blocks.find((block) => block.suggestion) ??
    blocks[0];
  if (!selected) {
    throw new Error("Static Career OS resume has no blocks");
  }
  return selected;
}

export function CaseResumeWorkspace({ careerCase }: { careerCase: CareerCase }) {
  const workspace = getCareerCaseWorkspace(careerCase.id);
  const allBlocks = workspace.resume.sections.flatMap((section) => section.blocks);
  const [searchParams, setSearchParams] = useSearchParams();
  const [template, setTemplate] = useState<ResumeTemplate>("classic");
  const [sessions, setSessions] = useState<Record<string, ResumeSuggestionSession>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [isInspectorOpen, setInspectorOpen] = useState(shouldOpenInspectorByDefault);
  const selectedBlock = findSelectedBlock(allBlocks, searchParams.get("block"));
  const suggestedText = selectedBlock.suggestion?.suggestedText ?? "";
  const selectedSession =
    sessions[selectedBlock.id] ?? createResumeSuggestionSession(suggestedText);

  const selectBlock = useCallback(
    (blockId: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("block", blockId);
      next.delete("requirement");
      setSearchParams(next);
      setIsEditing(false);
      setInspectorOpen(true);
    },
    [searchParams, setSearchParams],
  );

  const updateSelectedSession = useCallback(
    (action: ResumeSuggestionAction) => {
      setSessions((current) => {
        const previous = current[selectedBlock.id] ?? createResumeSuggestionSession(suggestedText);
        return {
          ...current,
          [selectedBlock.id]: reduceResumeSuggestion(previous, action),
        };
      });
    },
    [selectedBlock.id, suggestedText],
  );

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    setIsEditing(false);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-resume-block-trigger="${selectedBlock.id}"]`)
        ?.focus();
    });
  }, [selectedBlock.id]);

  const cancelEdit = useCallback(() => {
    updateSelectedSession({ type: "undo", suggestedText });
    setIsEditing(false);
  }, [suggestedText, updateSelectedSession]);

  return (
    <div className="career-case-detail-layout career-resume-layout">
      <div className="career-case-detail-layout__main">
        <header className="career-resume-toolbar">
          <div>
            <p>基础简历 v1 → 岗位定制草稿</p>
            <strong>当前会话自动保存关闭</strong>
          </div>
          <label>
            模板
            <select
              value={template}
              onChange={(event) => setTemplate(event.currentTarget.value as ResumeTemplate)}
            >
              <option value="classic">中文经典单栏</option>
              <option value="compact">中文紧凑技术</option>
            </select>
          </label>
          <div className="career-resume-toolbar__actions">
            <button type="button" disabled title="Resume V2 阶段接入打印">
              打印
            </button>
            <button type="button" disabled title="Resume V2 阶段接入 DOCX">
              导出 DOCX
            </button>
          </div>
        </header>

        <div className="career-resume-studio">
          <aside className="career-resume-rail" aria-label="简历结构与证据">
            <section>
              <header>
                <h2>简历结构</h2>
                <span>{workspace.resume.sections.length} 节</span>
              </header>
              <nav aria-label="简历章节">
                {workspace.resume.sections.map((section) => {
                  const sectionBlock = section.blocks[0];
                  if (!sectionBlock) return null;
                  const isActive = section.blocks.some((block) => block.id === selectedBlock.id);
                  return (
                    <button
                      key={section.id}
                      type="button"
                      className={isActive ? "is-active" : undefined}
                      onClick={() => selectBlock(sectionBlock.id)}
                    >
                      <Icon name="document" size={17} />
                      <span>{section.label}</span>
                      <small>{section.blocks.length}</small>
                      <Icon name="chevron" size={15} />
                    </button>
                  );
                })}
              </nav>
            </section>

            <section className="career-resume-evidence-library">
              <header>
                <h2>证据状态</h2>
                <span>{careerCase.evidence.length} 项</span>
              </header>
              <ul>
                {careerCase.evidence.map((item) => (
                  <li key={item.id}>
                    <strong>{item.label}</strong>
                    <EvidenceState state={item.state} />
                  </li>
                ))}
              </ul>
            </section>
          </aside>

          <main className="career-resume-preview" aria-label="A4 简历预览">
            <div className="career-resume-preview__bar">
              <span>A4 预览</span>
              <span>100%</span>
            </div>
            <article className={`career-resume-sheet career-resume-sheet--${template}`}>
              <header>
                <div>
                  <h2>{workspace.resume.candidateName}</h2>
                  <p>静态原型不显示真实联系方式</p>
                </div>
                <strong>{workspace.resume.targetLabel}</strong>
              </header>

              {workspace.resume.sections.slice(1).map((section) => (
                <section key={section.id} aria-labelledby={`resume-section-${section.id}`}>
                  <h3 id={`resume-section-${section.id}`}>{section.label}</h3>
                  {section.blocks.map((block) => {
                    const blockSession = sessions[block.id];
                    const bullets = getResumeBlockBullets(block, blockSession);
                    return (
                      <button
                        key={block.id}
                        type="button"
                        className={`career-resume-block${
                          selectedBlock.id === block.id ? " is-selected" : ""
                        }`}
                        aria-pressed={selectedBlock.id === block.id}
                        aria-label={`编辑简历区块 ${block.title}`}
                        data-resume-block-trigger={block.id}
                        onClick={() => selectBlock(block.id)}
                      >
                        <span className="career-resume-block__heading">
                          <strong>{block.title}</strong>
                          <small>{block.meta}</small>
                        </span>
                        {bullets.map((bullet) => (
                          <span className="career-resume-block__bullet" key={bullet}>
                            {bullet}
                          </span>
                        ))}
                      </button>
                    );
                  })}
                </section>
              ))}
            </article>
            <p className="career-resume-preview__note">
              建议不会自动写入；刷新页面后恢复静态初始状态。
            </p>
          </main>
        </div>
      </div>

      <div className={`career-context-panel${isInspectorOpen ? " is-open" : ""}`}>
        <ResumeSuggestionInspector
          careerCase={careerCase}
          block={selectedBlock}
          session={selectedSession}
          isEditing={isEditing}
          onClose={closeInspector}
          onAccept={() => updateSelectedSession({ type: "accept", suggestedText })}
          onBeginEdit={() => setIsEditing(true)}
          onDraftChange={(value) => updateSelectedSession({ type: "update_draft", value })}
          onConfirmEdit={() => {
            updateSelectedSession({ type: "accept_edit" });
            setIsEditing(false);
          }}
          onCancelEdit={cancelEdit}
          onReject={() => updateSelectedSession({ type: "reject" })}
          onUndo={() => updateSelectedSession({ type: "undo", suggestedText })}
        />
      </div>
      {isInspectorOpen ? (
        <button
          className="career-context-panel-backdrop"
          type="button"
          aria-label="关闭简历建议检查器"
          onClick={closeInspector}
        />
      ) : null}
    </div>
  );
}
