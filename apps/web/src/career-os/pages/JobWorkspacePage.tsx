import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { careerOsQueryKeys, createApplicationCase } from "../../api/career-os";
import { createIdempotencyKey, ProductApiError } from "../../api/client";
import { getJob } from "../../api/product";
import { OfficialJobText } from "../../components/OfficialJobText";
import {
  displayField,
  formatDateTime,
  jobFamilyLabels,
  sourceTypeLabels,
} from "../../product/domain";
import { Icon } from "../components/Icon";
import { safeJobReturnPath } from "../job-navigation";

export function JobWorkspacePage() {
  const { jobId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const returnPath = safeJobReturnPath(searchParams.get("from"));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const commandRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);
  const jobQuery = useQuery({
    queryKey: ["career-os", "jobs", "detail", jobId],
    queryFn: ({ signal }) => getJob(jobId, signal),
    enabled: Boolean(jobId),
    retry: (failureCount, error) =>
      error instanceof ProductApiError && error.status === 404 ? false : failureCount < 1,
  });
  const caseMutation = useMutation({
    mutationFn: (input: { publishedJobId: string; publishedJobVersionId: string }) => {
      const signature = `${input.publishedJobId}:${input.publishedJobVersionId}`;
      if (!commandRef.current || commandRef.current.signature !== signature) {
        commandRef.current = {
          signature,
          idempotencyKey: createIdempotencyKey("catalog-case"),
        };
      }
      return createApplicationCase(
        {
          jobContext: {
            kind: "public",
            publishedJobId: input.publishedJobId,
            publishedJobVersionId: input.publishedJobVersionId,
          },
        },
        commandRef.current.idempotencyKey,
      );
    },
    retry: false,
    onSuccess: async ({ applicationCase }) => {
      await queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.cases });
      navigate(`/applications/${applicationCase.id}/requirements`);
    },
  });

  if (jobQuery.isPending) {
    return <output className="career-request-state">正在读取固定岗位版本…</output>;
  }
  if (jobQuery.isError) {
    const missing = jobQuery.error instanceof ProductApiError && jobQuery.error.status === 404;
    return (
      <section className="career-route-state" aria-labelledby="job-workspace-error-title">
        <p>岗位工作台</p>
        <h1 id="job-workspace-error-title">{missing ? "这个岗位不可读取" : "岗位详情暂时不可用"}</h1>
        <span>
          {missing
            ? "岗位不存在、已从当前目录移除，或不属于当前可见范围。"
            : jobQuery.error.message}
        </span>
        <div>
          {!missing ? (
            <button
              className="career-button career-button--primary"
              type="button"
              onClick={() => jobQuery.refetch()}
            >
              重试
            </button>
          ) : null}
          <Link className="career-button career-button--quiet" to={returnPath}>
            返回岗位目录
          </Link>
        </div>
      </section>
    );
  }

  const job = jobQuery.data;
  const family = displayField(job.jobFamily, (value) => jobFamilyLabels[value] ?? value);
  const locations = displayField(job.locations, (value) => value.join("、"));
  const attendance = displayField(job.weeklyAttendanceDays, (value) => `每周 ${value} 天`);
  const duration = displayField(job.durationMonths, (value) => `${value} 个月`);
  const graduation = displayField(job.graduationYears, (value) => value.join("、"));
  const education = displayField(job.educationLevels, (value) => value.join("、"));
  const workMode = displayField(job.workMode);
  const salary = displayField(job.salary, (value) => value.rawText);
  const deadline = displayField(job.deadlineAt, (value) => formatDateTime(value));
  const responsibilities = displayField(job.responsibilitiesText);
  const requirements = displayField(job.requirementsText);

  return (
    <article className="career-job-workspace" aria-labelledby="job-workspace-title">
      <Link className="career-job-workspace__back" to={returnPath}>
        <Icon name="chevron" size={16} />
        返回岗位目录
      </Link>

      <header className="career-job-workspace__hero">
        <div className="career-job-workspace__identity">
          <p>{job.companyName}</p>
          <h1 id="job-workspace-title">{job.title}</h1>
          <div>
            <span>
              <Icon name="check" size={15} />
              {sourceTypeLabels[job.source.type] ?? job.source.type} · {job.source.displayName}
            </span>
            <span>
              <Icon name="location" size={15} />
              {locations.text}
            </span>
            <span>核验 {formatDateTime(job.source.lastVerifiedAt)}</span>
          </div>
        </div>
        <div className="career-job-workspace__actions">
          {job.officialLink ? (
            <a
              className="career-button career-button--quiet"
              href={job.officialLink}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" size={16} />
              打开官方页面
            </a>
          ) : null}
          <button
            className="career-button career-button--primary"
            type="button"
            disabled={!job.publishedJobVersionId || caseMutation.isPending}
            onClick={() => {
              if (!job.publishedJobVersionId) return;
              caseMutation.mutate({
                publishedJobId: job.id,
                publishedJobVersionId: job.publishedJobVersionId,
              });
            }}
          >
            <Icon name="briefcase" size={16} />
            {caseMutation.isPending ? "正在建立 Case…" : "加入我的求职"}
          </button>
        </div>
      </header>

      <nav className="career-job-workspace__tabs" aria-label="岗位详情区段">
        <a href="#overview">岗位概览</a>
        <a href="#official-jd">官方 JD</a>
        <a href="#source">来源依据</a>
      </nav>

      {caseMutation.isError ? (
        <div className="career-inline-error" role="alert">
          <strong>暂时无法建立求职 Case</strong>
          <span>{caseMutation.error.message}</span>
          <button type="button" onClick={() => caseMutation.reset()}>
            关闭提示
          </button>
        </div>
      ) : null}

      <div className="career-job-workspace__layout">
        <main>
          <section id="overview" className="career-job-workspace__section">
            <header>
              <p>当前固定版本</p>
              <h2>岗位事实</h2>
            </header>
            <dl className="career-job-workspace__facts">
              <Fact label="岗位方向" value={family.text} state={family.state} />
              <Fact label="工作地点" value={locations.text} state={locations.state} />
              <Fact label="每周出勤" value={attendance.text} state={attendance.state} />
              <Fact label="实习时长" value={duration.text} state={duration.state} />
              <Fact label="毕业年份" value={graduation.text} state={graduation.state} />
              <Fact label="学历要求" value={education.text} state={education.state} />
              <Fact label="办公方式" value={workMode.text} state={workMode.state} />
              <Fact label="薪资" value={salary.text} state={salary.state} />
              <Fact label="截止时间" value={deadline.text} state={deadline.state} />
            </dl>
          </section>

          <section id="official-jd" className="career-job-workspace__section">
            <header>
              <p>企业原文</p>
              <h2>工作内容</h2>
            </header>
            {responsibilities.state === "known" ? (
              <OfficialJobText text={responsibilities.text} />
            ) : (
              <p className="career-job-workspace__unknown">官方页面未说明工作内容。</p>
            )}
          </section>

          <section className="career-job-workspace__section">
            <header>
              <p>企业原文</p>
              <h2>任职要求</h2>
            </header>
            {requirements.state === "known" ? (
              <OfficialJobText text={requirements.text} />
            ) : (
              <p className="career-job-workspace__unknown">官方页面未说明任职要求。</p>
            )}
          </section>
        </main>

        <aside className="career-job-workspace__rail">
          <section>
            <p>下一步</p>
            <h2>建立同一个岗位 Case</h2>
            <span>
              Case 会固定当前岗位版本与 Requirements。后续简历、投递、面试和复盘都回到同一上下文。
            </span>
            <button
              className="career-button career-button--primary"
              type="button"
              disabled={!job.publishedJobVersionId || caseMutation.isPending}
              onClick={() => {
                if (!job.publishedJobVersionId) return;
                caseMutation.mutate({
                  publishedJobId: job.id,
                  publishedJobVersionId: job.publishedJobVersionId,
                });
              }}
            >
              加入简历准备
            </button>
          </section>
          <section id="source">
            <p>来源事实</p>
            <h2>{job.source.displayName}</h2>
            <dl>
              <div>
                <dt>来源类型</dt>
                <dd>{sourceTypeLabels[job.source.type] ?? job.source.type}</dd>
              </div>
              <div>
                <dt>来源域名</dt>
                <dd>{job.source.domain}</dd>
              </div>
              <div>
                <dt>当前状态</dt>
                <dd>{job.displayStatus === "recruiting" ? "招聘中" : "状态待核对"}</dd>
              </div>
            </dl>
            <a href={job.source.originalUrl} target="_blank" rel="noreferrer">
              查看原始岗位页面 <Icon name="external" size={14} />
            </a>
          </section>
        </aside>
      </div>
    </article>
  );
}

function Fact({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: "known" | "unknown" | "conflict";
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={`is-${state}`}>{value}</dd>
    </div>
  );
}
