import { Link } from "react-router-dom";
import type { ApplicationCaseView } from "../application-case-view";
import type { ResumeBlockView } from "../resume-view";
import { ContextInspectorFrame } from "./ContextInspector";
import { Icon } from "./Icon";

interface ResumeBlockInspectorProps {
  applicationCase: ApplicationCaseView;
  block: ResumeBlockView;
  baseDocumentRevisionId: string;
  evidenceRevisionId: string;
  onClose: () => void;
}

export function ResumeBlockInspector({
  applicationCase,
  block,
  baseDocumentRevisionId,
  evidenceRevisionId,
  onClose,
}: ResumeBlockInspectorProps) {
  return (
    <ContextInspectorFrame
      ariaLabel="简历区块检查器"
      eyebrow="只读岗位简历"
      title="当前区块"
      meta={`${applicationCase.companyName} · ${applicationCase.roleTitle}`}
      closeLabel="关闭简历区块检查器"
      onClose={onClose}
      footer={
        <Link
          className="career-button career-button--quiet"
          to={`/applications/${applicationCase.id}/requirements`}
        >
          返回 JD 能力
          <Icon name="chevron" size={17} />
        </Link>
      }
    >
      <section className="career-inspector__section">
        <h3>当前文本</h3>
        <p className="career-resume-block-copy">{block.text}</p>
      </section>
      <section className="career-inspector__section">
        <h3>证据 ID</h3>
        {block.evidenceIds.length > 0 ? (
          <ul className="career-resume-block-evidence">
            {block.evidenceIds.map((evidenceId) => (
              <li key={evidenceId}>{evidenceId}</li>
            ))}
          </ul>
        ) : (
          <p className="career-inspector__copy">这个区块没有关联证据 ID；系统不会自动补写。</p>
        )}
      </section>
      <section className="career-inspector__section">
        <h3>固定来源</h3>
        <dl className="career-axis-summary">
          <div>
            <dt>基础内容</dt>
            <dd>{baseDocumentRevisionId}</dd>
          </div>
          <div>
            <dt>证据修订</dt>
            <dd>{evidenceRevisionId}</dd>
          </div>
        </dl>
      </section>
      <section className="career-inspector__section">
        <p className="career-inspector__copy">
          当前检查器只展示真实区块、证据与来源，不会自动改写内容。
        </p>
      </section>
    </ContextInspectorFrame>
  );
}
