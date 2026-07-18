import type { MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { formatAbsoluteDateTime } from "../domain/jobs";
import type { ResearchField, ResearchJob } from "./types";

interface ResearchJobRowProps {
  job: ResearchJob;
}

function fieldText<T>(
  field: ResearchField<T>,
  format: (value: T) => string,
  unknownLabel: string,
): string {
  if (field.state === "known") return format(field.value);
  return field.state === "conflict" ? "待核对" : unknownLabel;
}

export function ResearchJobRow({ job }: ResearchJobRowProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const detailPath = `/research/jobs/${encodeURIComponent(job.id)}`;
  const fromSearch = `${location.pathname}${location.search}`;

  function openDetail(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(detailPath, { state: { fromSearch, scrollY: window.scrollY, originJobId: job.id } });
  }
  const family = fieldText(
    job.family,
    (value) => (value === "product" ? "产品" : "运营"),
    "方向未说明",
  );
  const cities = fieldText(
    job.cities,
    (value) => value.map((city) => city.label).join("、"),
    "城市未说明",
  );
  const attendance = fieldText(
    job.weeklyAttendanceDays,
    (value) => `每周 ${value} 天`,
    "出勤未说明",
  );
  const duration = fieldText(job.durationMonths, (value) => `${value} 个月`, "时长未说明");
  const activity = fieldText(
    job.activityState,
    (value) => (value === "active" ? "仍在招聘" : "已关闭"),
    "状态未说明",
  );

  return (
    <article className="research-result" aria-labelledby={`research-job-${job.id}`}>
      <div className="research-result__identity">
        <p className="research-result__company">{job.organizationName}</p>
        <h2 id={`research-job-${job.id}`}>
          <Link id={`research-job-link-${job.id}`} to={detailPath} onClick={openDetail}>
            {job.title}
          </Link>
        </h2>
      </div>
      <dl className="research-result__facts">
        <div>
          <dt>城市</dt>
          <dd>{cities}</dd>
        </div>
        <div>
          <dt>方向</dt>
          <dd>{family}</dd>
        </div>
        <div>
          <dt>实习要求</dt>
          <dd>
            {attendance} · {duration}
          </dd>
        </div>
      </dl>
      <div className="research-result__source">
        <span>
          {job.sourceType} · {activity}
        </span>
        <span>人工核验 {formatAbsoluteDateTime(job.reviewedAt || job.lastVerifiedAt)}</span>
      </div>
      <Link className="research-result__action" to={detailPath} onClick={openDetail}>
        查看详情
        <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
