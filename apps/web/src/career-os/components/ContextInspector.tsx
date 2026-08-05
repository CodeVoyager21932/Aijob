import { Link } from "react-router-dom";
import type { CareerCase } from "../domain";
import { EvidenceState } from "./EvidenceState";
import { Icon } from "./Icon";
import { StageBadge } from "./StageBadge";

interface ContextInspectorProps {
  careerCase: CareerCase;
  onClose: () => void;
}

export function ContextInspector({ careerCase, onClose }: ContextInspectorProps) {
  return (
    <aside className="career-inspector" aria-label={`${careerCase.companyName}岗位侧览`}>
      <header className="career-inspector__header">
        <div>
          <p>{careerCase.companyName}</p>
          <h2>{careerCase.roleTitle}</h2>
          <span>
            {careerCase.location} · {careerCase.workMode}
          </span>
        </div>
        <button
          className="career-icon-button"
          type="button"
          aria-label="关闭岗位侧览"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>

      <div className="career-inspector__scroll">
        <section className="career-inspector__section">
          <h3>当前阶段</h3>
          <StageBadge stage={careerCase.stage} />
        </section>

        <section className="career-inspector__section">
          <h3>下一步任务</h3>
          <div className="career-next-task">
            <Icon name="check" size={19} />
            <div>
              <strong>{careerCase.nextTask}</strong>
              <p>{careerCase.nextTaskDetail}</p>
            </div>
          </div>
        </section>

        <section className="career-inspector__section">
          <h3>官方来源说明</h3>
          <div className="career-source-proof">
            <Icon name="check" size={18} />
            <div>
              <strong>{careerCase.sourceLabel}</strong>
              <span>最近核验 {careerCase.sourceVerifiedAt}</span>
            </div>
          </div>
        </section>

        <section className="career-inspector__section">
          <h3>三轴分别判断</h3>
          <dl className="career-axis-summary">
            <div>
              <dt>资格</dt>
              <dd>{careerCase.qualification}</dd>
            </div>
            <div>
              <dt>经历证据</dt>
              <dd>{careerCase.evidence.length} 项逐项核对</dd>
            </div>
            <div>
              <dt>偏好</dt>
              <dd>{careerCase.preference}</dd>
            </div>
          </dl>
        </section>

        <section className="career-inspector__section">
          <h3>经历证据</h3>
          <ul className="career-inspector__evidence">
            {careerCase.evidence.map((item) => (
              <li key={item.id}>
                <span>{item.label}</span>
                <EvidenceState state={item.state} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="career-inspector__footer">
        <Link
          className="career-button career-button--primary"
          to={`/applications/${careerCase.id}/overview`}
        >
          打开求职工作区
          <Icon name="external" size={17} />
        </Link>
      </footer>
    </aside>
  );
}
