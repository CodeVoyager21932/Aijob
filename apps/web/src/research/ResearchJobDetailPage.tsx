import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { formatAbsoluteDateTime } from "../domain/jobs";
import { safeOfficialUrl, safeResearchSearchPath } from "./navigation";
import { findApprovedResearchJob } from "./researchJobs";
import type { ResearchField, ResearchJob } from "./types";

interface DetailNavigationState {
  fromSearch?: unknown;
  scrollY?: unknown;
}

function fieldPresentation<T>(
  field: ResearchField<T>,
  format: (value: T) => string,
): { value: string; note: string; state: ResearchField<T>["state"] } {
  if (field.state === "known") {
    return { value: format(field.value), note: "来自官方页面并经人工核验", state: field.state };
  }
  if (field.state === "conflict") {
    return { value: "待核对", note: "官方页面存在不一致信息，未替用户推断", state: field.state };
  }
  return { value: "未说明", note: field.reason, state: field.state };
}

export function ResearchJobDetailPage() {
  const { jobId = "" } = useParams();
  const location = useLocation();
  const navigationState = (location.state as DetailNavigationState | null) ?? null;
  const returnPath = safeResearchSearchPath(navigationState?.fromSearch);
  const returnState =
    typeof navigationState?.scrollY === "number" ? { scrollY: navigationState.scrollY } : undefined;
  const query = useQuery({
    queryKey: ["research", "approved-job", jobId],
    queryFn: ({ signal }) => findApprovedResearchJob(jobId, signal),
  });

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  if (query.isPending) {
    return <DetailState title="正在读取岗位详情" message="只读取已经人工确认的研究样本。" />;
  }

  if (query.isError) {
    return (
      <DetailState
        title="暂时无法读取岗位详情"
        message="研究样本没有被修改。请返回岗位列表后重试。"
        returnPath={returnPath}
        returnState={returnState}
      />
    );
  }

  if (!query.data) {
    return (
      <DetailState
        title="这条岗位不在已确认研究目录中"
        message="自动采集候选或待复核岗位不会通过详情地址进入研究原型。"
        returnPath={returnPath}
        returnState={returnState}
      />
    );
  }

  return <ResearchJobDetail job={query.data} returnPath={returnPath} returnState={returnState} />;
}

function ResearchJobDetail({
  job,
  returnPath,
  returnState,
}: {
  job: ResearchJob;
  returnPath: string;
  returnState?: { scrollY: number } | undefined;
}) {
  const officialUrl = safeOfficialUrl(job.sourceUrl, job.officialTarget);
  const activity = fieldPresentation(job.activityState, (value) =>
    value === "active" ? "仍在招聘" : "已关闭",
  );
  const facts = [
    {
      label: "城市",
      ...fieldPresentation(job.cities, (value) => value.map((city) => city.label).join("、")),
    },
    {
      label: "岗位方向",
      ...fieldPresentation(job.family, (value) => (value === "product" ? "产品" : "运营")),
    },
    {
      label: "每周出勤",
      ...fieldPresentation(job.weeklyAttendanceDays, (value) => `${value} 天`),
    },
    {
      label: "持续时长",
      ...fieldPresentation(job.durationMonths, (value) => `${value} 个月`),
    },
    {
      label: "招聘批次",
      ...fieldPresentation(job.recruitmentBatch, (value) => value),
    },
    {
      label: "最早到岗",
      ...fieldPresentation(job.earliestStartDate, (value) => value),
    },
    {
      label: "毕业年份",
      ...fieldPresentation(job.graduationYears, (value) => value.join("、")),
    },
  ];

  return (
    <article className="research-detail">
      <Link className="research-back-link" to={returnPath} state={returnState} replace>
        <span aria-hidden="true">←</span>
        返回岗位结果
      </Link>

      <header className="research-detail__hero">
        <p className="research-detail__company">{job.organizationName}</p>
        <h1>{job.title}</h1>
        <div>
          <span>
            {job.sourceType} · {activity.value}
          </span>
          <span>最后核验 {formatAbsoluteDateTime(job.reviewedAt || job.lastVerifiedAt)}</span>
        </div>
      </header>

      <section className="research-detail__section" aria-labelledby="research-detail-facts">
        <div className="research-detail__section-heading">
          <div>
            <p className="research-eyebrow">先核对硬条件</p>
            <h2 id="research-detail-facts">岗位事实</h2>
          </div>
          <p className="research-detail__section-note">未说明和待核对保持原样，不由系统补写。</p>
        </div>
        <dl className="research-detail__facts">
          {facts.map((fact) => (
            <div key={fact.label} data-state={fact.state}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
              <small>{fact.note}</small>
            </div>
          ))}
        </dl>
      </section>

      <div className="research-detail__columns">
        <section className="research-detail__section" aria-labelledby="responsibilities-title">
          <p className="research-eyebrow">你会做什么</p>
          <h2 id="responsibilities-title">岗位职责</h2>
          <p className="research-detail__copy">{job.responsibilitiesExcerpt}</p>
        </section>
        <section className="research-detail__section" aria-labelledby="requirements-title">
          <p className="research-eyebrow">岗位需要什么</p>
          <h2 id="requirements-title">任职要求</h2>
          <p className="research-detail__copy">{job.requirementsExcerpt}</p>
        </section>
      </div>

      <section className="research-official-handoff" aria-labelledby="official-source-title">
        <div>
          <p className="research-eyebrow">回到事实源</p>
          <h2 id="official-source-title">在官方页面复核并自行投递</h2>
          <p>
            来源：{job.organizationName} · {job.sourceType}
            {officialUrl ? ` · ${officialUrl.hostname}` : ""}
          </p>
        </div>
        {officialUrl ? (
          <a
            className="button button--primary"
            href={officialUrl.href}
            target="_blank"
            rel="noreferrer"
          >
            打开官方岗位
            <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <p className="research-official-handoff__unavailable">
            官方地址当前不可用，请勿据此投递。
          </p>
        )}
      </section>
    </article>
  );
}

function DetailState({
  title,
  message,
  returnPath = "/research/jobs",
  returnState,
}: {
  title: string;
  message: string;
  returnPath?: string;
  returnState?: { scrollY: number } | undefined;
}) {
  return (
    <section className="research-empty" aria-labelledby="research-detail-state-title">
      <span className="research-empty__icon" aria-hidden="true">
        ◇
      </span>
      <div>
        <h1 id="research-detail-state-title">{title}</h1>
        <p className="research-empty__message">{message}</p>
        <Link className="button button--secondary" to={returnPath} state={returnState} replace>
          返回岗位结果
        </Link>
      </div>
    </section>
  );
}
