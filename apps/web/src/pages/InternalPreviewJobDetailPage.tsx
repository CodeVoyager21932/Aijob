import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ApiError, getInternalPreviewJob } from "../api/jobs";
import { ErrorState, LoadingState } from "../components/AsyncState";
import { CopyLinkButton } from "../components/CopyLinkButton";
import { OfficialJobText } from "../components/OfficialJobText";
import { StatusBadge } from "../components/StatusBadge";
import {
  type DisplayField,
  displayStatusLabel,
  fieldStateLabel,
  formatAbsoluteDateTime,
  toPreviewJobDetail,
} from "../domain/jobs";

export function InternalPreviewJobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const query = useQuery({
    queryKey: ["internal-preview", "jobs", jobId],
    queryFn: ({ signal }) => getInternalPreviewJob(jobId || "", signal),
    enabled: Boolean(jobId),
  });

  if (!jobId) {
    return (
      <ErrorState title="岗位地址不完整" message="当前地址没有岗位编号，请返回列表重新选择岗位。" />
    );
  }

  if (query.isPending) {
    return (
      <>
        <BackLink />
        <LoadingState label="正在读取岗位详情" cards={1} />
      </>
    );
  }

  if (query.isError) {
    const isNotFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <BackLink />
        <ErrorState
          title={isNotFound ? "没有找到这条岗位" : "暂时无法读取岗位详情"}
          message={
            isNotFound
              ? "岗位编号不存在，或它已经不在当前内部预览范围内。"
              : "这不表示岗位已经关闭。请重试，或返回列表查看其他岗位。"
          }
          {...(isNotFound ? {} : { onRetry: () => void query.refetch() })}
        />
      </>
    );
  }

  const job = toPreviewJobDetail(query.data);

  return (
    <article className="job-detail">
      <BackLink />
      <header className="detail-hero">
        <section className="badge-row" aria-label="岗位状态">
          <StatusBadge kind="track" value={job.functionTrack} />
          <StatusBadge kind="publication" value={job.publicationState} />
          <StatusBadge kind="activity" value={job.activityState} />
        </section>
        <p className="detail-hero__company">{job.organizationName}</p>
        <h1>{job.title}</h1>
        <p className="detail-hero__meta">
          {job.department.value !== "未说明" ? `${job.department.value} · ` : ""}
          {job.recruitmentType.value !== "未说明" ? `${job.recruitmentType.value} · ` : ""}
          {job.jobCode.value !== "未说明" ? `岗位编号 ${job.jobCode.value}` : "岗位编号未说明"}
        </p>
      </header>

      {job.warnings.length > 0 ? (
        <section className="review-notice" aria-labelledby="review-notice-title">
          <div className="review-notice__icon" aria-hidden="true">
            △
          </div>
          <div>
            <h2 id="review-notice-title">此岗位有 {job.warnings.length} 项待核对</h2>
            <ul>
              {job.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="detail-section" aria-labelledby="conditions-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">结构化条件</p>
            <h2 id="conditions-title">实习要求</h2>
          </div>
          <p>未明确写出的信息保持“未说明”，不会自动推断。</p>
        </div>
        <dl className="fact-grid">
          {job.structuredRequirements.map((requirement) => (
            <FieldFact key={requirement.key} label={requirement.label} field={requirement.field} />
          ))}
        </dl>
      </section>

      <div className="detail-columns">
        <section className="detail-section prose-section" aria-labelledby="responsibilities-title">
          <p className="eyebrow">官方原文</p>
          <h2 id="responsibilities-title">岗位职责</h2>
          <FieldText field={job.responsibilities} />
        </section>
        <section className="detail-section prose-section" aria-labelledby="requirements-title">
          <p className="eyebrow">官方原文</p>
          <h2 id="requirements-title">岗位要求</h2>
          <FieldText field={job.requirements} />
        </section>
      </div>

      <section className="detail-section" aria-labelledby="source-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">来源证据</p>
            <h2 id="source-title">这条岗位来自哪里</h2>
          </div>
          <StatusBadge kind="source" value={job.sourceType} />
        </div>
        <dl className="evidence-list">
          <div>
            <dt>发布主体</dt>
            <dd>{job.source.publisherName || job.organizationName}</dd>
          </div>
          <div>
            <dt>来源名称</dt>
            <dd>{job.sourceName}</dd>
          </div>
          <div>
            <dt>原始域名</dt>
            <dd>
              <code>{job.sourceDomain || "未说明"}</code>
            </dd>
          </div>
          <div>
            <dt>原始页面</dt>
            <dd>
              {job.source.originalUrl ? (
                <a
                  className="text-link"
                  href={job.source.originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看来源页面
                  <span aria-hidden="true">↗</span>
                </a>
              ) : (
                "未说明"
              )}
            </dd>
          </div>
          <div>
            <dt>主体证明等级</dt>
            <dd>{job.source.provenanceLevel || "未说明"}</dd>
          </div>
          <div>
            <dt>最后核验时间</dt>
            <dd>{formatAbsoluteDateTime(job.lastVerifiedAt)}</dd>
          </div>
          <div>
            <dt>当前状态</dt>
            <dd>{displayStatusLabel(job.displayStatus)}</dd>
          </div>
          <div>
            <dt>发布时间</dt>
            <dd>{job.postedAt.value}</dd>
          </div>
          <div>
            <dt>申请截止</dt>
            <dd>{job.deadlineAt.value}</dd>
          </div>
        </dl>
      </section>

      {job.internalPreview ? (
        <details className="internal-details">
          <summary>查看内部采集状态</summary>
          <dl className="evidence-list">
            <div>
              <dt>访问政策</dt>
              <dd>{job.internalPreview.policyStatus}</dd>
            </div>
            <div>
              <dt>解析状态</dt>
              <dd>{job.internalPreview.ingestionState}</dd>
            </div>
            <div>
              <dt>导入方式</dt>
              <dd>{job.internalPreview.importMode}</dd>
            </div>
            <div>
              <dt>来源岗位 ID</dt>
              <dd>
                <code>{job.internalPreview.sourceJobId}</code>
              </dd>
            </div>
            <div>
              <dt>修订 ID</dt>
              <dd>
                <code>{job.internalPreview.revisionId}</code>
              </dd>
            </div>
          </dl>
        </details>
      ) : null}

      <OfficialHandoff job={job} />
    </article>
  );
}

function BackLink() {
  return (
    <Link className="back-link" to="/internal-preview/jobs">
      <span aria-hidden="true">←</span>
      返回岗位列表
    </Link>
  );
}

function FieldFact({ label, field }: { label: string; field: DisplayField }) {
  return (
    <div className={`fact fact--${field.state}`}>
      <dt>{label}</dt>
      <dd>
        <strong>{field.value}</strong>
        <span>{fieldStateLabel(field.state)}</span>
        {field.detail ? <small>{field.detail}</small> : null}
      </dd>
    </div>
  );
}

function FieldText({ field }: { field: DisplayField }) {
  if (field.state !== "known") {
    return (
      <div className={`missing-content missing-content--${field.state}`}>
        <strong>{field.value}</strong>
        <p>{field.detail || "官方页面没有提供可确认的内容。"}</p>
      </div>
    );
  }

  return <OfficialJobText text={field.value} />;
}

function OfficialHandoff({ job }: { job: ReturnType<typeof toPreviewJobDetail> }) {
  return (
    <section className="official-handoff" aria-labelledby="handoff-title">
      <div>
        <p className="eyebrow">官方页面交接</p>
        <h2 id="handoff-title">前往 {job.organizationName} 官方岗位页</h2>
        <p>
          目标域名：<code>{job.officialLinkDomain || "未确认"}</code>
          <br />
          最后核验：{formatAbsoluteDateTime(job.lastVerifiedAt)}
        </p>
      </div>
      {job.officialLink && job.officialLinkIsSafe ? (
        <div className="handoff-actions">
          <a
            className="button button--primary"
            href={job.officialLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            前往官方岗位页
            <span className="external-icon" aria-hidden="true">
              ↗
            </span>
          </a>
          <CopyLinkButton url={job.officialLink} />
          <p className="handoff-note">将在新标签页打开；此操作不会被记录为“已投递”。</p>
        </div>
      ) : (
        <section className="link-unavailable" aria-live="polite" aria-label="官方链接状态">
          <strong>官方链接待复核</strong>
          <p>链接缺失、格式错误或未使用 HTTPS，因此暂不提供直接跳转。</p>
        </section>
      )}
    </section>
  );
}
