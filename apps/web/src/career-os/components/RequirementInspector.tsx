import { Link } from "react-router-dom";
import type { CareerCaseRequirement } from "../case-workspace-domain";
import { getRequirementGroupLabel } from "../case-workspace-domain";
import type { CareerCase } from "../domain";
import { ContextInspectorFrame } from "./ContextInspector";
import { EvidenceState } from "./EvidenceState";
import { Icon } from "./Icon";

interface RequirementInspectorProps {
  careerCase: CareerCase;
  requirement: CareerCaseRequirement;
  onClose: () => void;
}

export function RequirementInspector({
  careerCase,
  requirement,
  onClose,
}: RequirementInspectorProps) {
  const relatedEvidence = careerCase.evidence.filter((item) =>
    requirement.evidenceIds.includes(item.id),
  );

  return (
    <ContextInspectorFrame
      ariaLabel={`${requirement.title}要求检查器`}
      eyebrow={getRequirementGroupLabel(requirement.group)}
      title={requirement.title}
      meta={`${careerCase.companyName} · ${careerCase.roleTitle}`}
      closeLabel="关闭要求检查器"
      onClose={onClose}
      footer={
        <Link
          className="career-button career-button--primary"
          to={`/applications/${careerCase.id}/resume`}
        >
          进入简历准备
          <Icon name="chevron" size={17} />
        </Link>
      }
    >
      <section className="career-inspector__section">
        <h3>当前证据状态</h3>
        <EvidenceState state={requirement.state} />
      </section>

      <section className="career-inspector__section">
        <h3>官方 JD 原文</h3>
        <blockquote className="career-requirement-quote">
          <p>{requirement.sourceText}</p>
          <cite>{requirement.sourceLabel}</cite>
        </blockquote>
        <p className="career-static-disclaimer">静态原型不打开真实招聘链接。</p>
      </section>

      <section className="career-inspector__section">
        <h3>你的相关证据</h3>
        {relatedEvidence.length > 0 ? (
          <ul className="career-inspector__evidence career-inspector__evidence--cards">
            {relatedEvidence.map((evidence) => (
              <li key={evidence.id}>
                <span>{evidence.label}</span>
                <EvidenceState state={evidence.state} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="career-inspector-empty">
            <Icon name="question" size={18} />
            <p>当前没有已确认的关联证据，系统不会自动补写。</p>
          </div>
        )}
      </section>

      <section className="career-inspector__section">
        <h3>下一步</h3>
        <div className="career-next-task">
          <Icon name={requirement.state === "confirmed" ? "check" : "warning"} size={19} />
          <p>{requirement.nextStep}</p>
        </div>
      </section>
    </ContextInspectorFrame>
  );
}
