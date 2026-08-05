import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getCareerCaseWorkspace, requirementGroups } from "../case-workspace-domain";
import { EvidenceState } from "../components/EvidenceState";
import { Icon } from "../components/Icon";
import { RequirementInspector } from "../components/RequirementInspector";
import type { CareerCase } from "../domain";

function shouldOpenInspectorByDefault(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
}

export function CaseRequirementsWorkspace({ careerCase }: { careerCase: CareerCase }) {
  const workspace = getCareerCaseWorkspace(careerCase.id);
  const defaultRequirement = workspace.requirements[0];
  if (!defaultRequirement) {
    throw new Error(`Static Career OS case has no requirements: ${careerCase.id}`);
  }
  const [searchParams, setSearchParams] = useSearchParams();
  const [isInspectorOpen, setInspectorOpen] = useState(shouldOpenInspectorByDefault);
  const requestedRequirementId = searchParams.get("requirement");
  const selectedRequirement =
    workspace.requirements.find((item) => item.id === requestedRequirementId) ?? defaultRequirement;

  const selectRequirement = useCallback(
    (requirementId: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("requirement", requirementId);
      next.delete("block");
      setSearchParams(next);
      setInspectorOpen(true);
    },
    [searchParams, setSearchParams],
  );

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-requirement-trigger="${selectedRequirement.id}"]`)
        ?.focus();
    });
  }, [selectedRequirement.id]);

  return (
    <div className="career-case-detail-layout career-requirements-layout">
      <div className="career-case-detail-layout__main">
        <header className="career-workspace-heading">
          <div>
            <p>Phase 1B · 静态交互原型</p>
            <h2>逐项理解岗位要求</h2>
            <span>岗位事实、用户证据和未知项分开；当前操作不会保存个人信息。</span>
          </div>
          <fieldset className="career-workspace-heading__legend">
            <legend className="sr-only">证据状态图例</legend>
            <EvidenceState state="confirmed" />
            <EvidenceState state="needs_work" />
            <EvidenceState state="unconfirmed" />
          </fieldset>
        </header>

        <div className="career-requirement-groups">
          {requirementGroups.map((group) => {
            const requirements = workspace.requirements.filter(
              (item) => item.group === group.value,
            );
            return (
              <section
                className={`career-requirement-group career-requirement-group--${group.value}`}
                key={group.value}
                aria-labelledby={`requirement-group-${group.value}`}
              >
                <header>
                  <div>
                    <h3 id={`requirement-group-${group.value}`}>{group.label}</h3>
                    <p>{group.description}</p>
                  </div>
                  <span>{requirements.length}</span>
                </header>
                <ul>
                  {requirements.map((requirement) => (
                    <li key={requirement.id}>
                      <button
                        type="button"
                        className={
                          selectedRequirement.id === requirement.id ? "is-selected" : undefined
                        }
                        aria-pressed={selectedRequirement.id === requirement.id}
                        data-requirement-trigger={requirement.id}
                        onClick={() => selectRequirement(requirement.id)}
                      >
                        <span className="career-requirement-row__grip" aria-hidden="true">
                          ···
                        </span>
                        <span className="career-requirement-row__content">
                          <strong>{requirement.title}</strong>
                          <small>{requirement.sourceLabel}</small>
                        </span>
                        <EvidenceState state={requirement.state} />
                        <Icon name="chevron" size={17} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <button className="career-add-question" type="button" disabled>
          <Icon name="question" size={18} />
          添加个人补充问题
          <span>领域阶段接入</span>
        </button>
      </div>

      <div className={`career-context-panel${isInspectorOpen ? " is-open" : ""}`}>
        <RequirementInspector
          careerCase={careerCase}
          requirement={selectedRequirement}
          onClose={closeInspector}
        />
      </div>
      {isInspectorOpen ? (
        <button
          className="career-context-panel-backdrop"
          type="button"
          aria-label="关闭要求检查器"
          onClick={closeInspector}
        />
      ) : null}
    </div>
  );
}
