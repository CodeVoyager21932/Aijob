import type { CareerCase } from "../domain";
import { Icon } from "./Icon";
import { StageBadge } from "./StageBadge";

export function CaseHeader({ careerCase }: { careerCase: CareerCase }) {
  return (
    <header className="career-case-header">
      <div className="career-case-header__identity">
        <div className="career-case-header__title-row">
          <h1>
            {careerCase.companyName} · {careerCase.roleTitle}
          </h1>
          <StageBadge stage={careerCase.stage} />
        </div>
        <div className="career-case-header__meta">
          <span className="career-case-header__source">
            <Icon name="check" size={17} />
            {careerCase.sourceLabel} · 最近核验 {careerCase.sourceVerifiedAt}
          </span>
          <span>
            <Icon name="location" size={17} />
            {careerCase.location} · {careerCase.workMode}
          </span>
        </div>
      </div>
      <button className="career-button career-button--quiet" type="button" disabled>
        静态原型暂不打开外部页面
        <Icon name="external" size={16} />
      </button>
    </header>
  );
}
