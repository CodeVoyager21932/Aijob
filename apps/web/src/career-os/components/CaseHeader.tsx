import type { ApplicationCaseView } from "../application-case-view";
import { Icon } from "./Icon";
import { StageBadge } from "./StageBadge";

export function CaseHeader({
  applicationCase,
  onRequestDelete,
}: {
  applicationCase: ApplicationCaseView;
  onRequestDelete?: () => void;
}) {
  return (
    <header className="career-case-header">
      <div className="career-case-header__identity">
        <div className="career-case-header__title-row">
          <h1>
            {applicationCase.companyName} · {applicationCase.roleTitle}
          </h1>
          <StageBadge stage={applicationCase.stage} />
        </div>
        <div className="career-case-header__meta">
          <span className="career-case-header__source" title={applicationCase.sourceMeta}>
            <Icon
              name={applicationCase.sourceKind === "catalog" ? "check" : "document"}
              size={17}
            />
            {applicationCase.sourceLabel}
          </span>
          <span>
            <Icon name="location" size={17} />
            {applicationCase.locationLabel} · {applicationCase.workModeLabel}
          </span>
        </div>
      </div>
      <div className="career-case-header__actions">
        {applicationCase.externalUrl ? (
          <a
            className="career-button career-button--quiet"
            href={applicationCase.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {applicationCase.externalUrlVerified ? "打开岗位页面" : "打开用户提供链接"}
            <Icon name="external" size={16} />
          </a>
        ) : null}
        {onRequestDelete ? (
          <button
            data-case-delete-trigger
            className="career-button career-button--danger-quiet"
            type="button"
            onClick={onRequestDelete}
          >
            删除求职项目
          </button>
        ) : null}
      </div>
    </header>
  );
}
