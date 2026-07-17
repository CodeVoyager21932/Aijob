import { Link } from "react-router-dom";
import {
  type DisplayField,
  fieldStateLabel,
  formatAbsoluteDateTime,
  type PreviewJobSummary,
} from "../domain/jobs";
import { StatusBadge } from "./StatusBadge";

interface JobCardProps {
  job: PreviewJobSummary;
}

export function JobCard({ job }: JobCardProps) {
  return (
    <article className="job-card" aria-labelledby={`job-${job.id}-title`}>
      <div className="job-card__topline">
        <section className="badge-row" aria-label="岗位标签">
          <StatusBadge kind="track" value={job.functionTrack} />
          <StatusBadge kind="publication" value={job.publicationState} />
        </section>
        {job.warnings.length > 0 ? (
          <span className="warning-count">
            <span aria-hidden="true">△</span>
            {job.warnings.length} 项待核对
          </span>
        ) : null}
      </div>

      <div className="job-card__heading">
        <p>{job.organizationName}</p>
        <h2 id={`job-${job.id}-title`}>
          <Link to={`/internal-preview/jobs/${encodeURIComponent(job.id)}`}>{job.title}</Link>
        </h2>
      </div>

      <dl className="compact-facts">
        <div>
          <dt>地点</dt>
          <CardField field={job.locations} />
        </div>
        <div>
          <dt>每周出勤</dt>
          <CardField field={job.daysPerWeek} />
        </div>
        <div>
          <dt>持续时间</dt>
          <CardField field={job.internshipMonths} />
        </div>
      </dl>

      <div className="job-card__source">
        <div>
          <span>来源：{job.sourceType || "未说明"}</span>
          <span>核验：{formatAbsoluteDateTime(job.lastVerifiedAt)}</span>
        </div>
        <StatusBadge kind="activity" value={job.activityState} />
      </div>

      <Link
        className="text-link job-card__action"
        to={`/internal-preview/jobs/${encodeURIComponent(job.id)}`}
        aria-label={`查看 ${job.organizationName} ${job.title} 的详情`}
      >
        查看详情
        <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

function CardField({ field }: { field: DisplayField }) {
  return (
    <dd title={field.detail}>
      {field.value}
      {field.state === "conflict" ? (
        <span className="sr-only">（{fieldStateLabel(field.state)}）</span>
      ) : null}
    </dd>
  );
}
