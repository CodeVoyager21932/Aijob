import type { ReactNode, RefObject } from "react";
import { Link } from "react-router-dom";
import type { ApplicationCaseView } from "../application-case-view";
import { Icon } from "./Icon";
import { StageBadge } from "./StageBadge";

interface ContextInspectorProps {
  applicationCase: ApplicationCaseView;
  onClose: () => void;
  titleId?: string | undefined;
  closeButtonRef?: RefObject<HTMLButtonElement | null> | undefined;
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
}: ContextInspectorProps) {
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
        <StageBadge stage={applicationCase.stage} />
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
