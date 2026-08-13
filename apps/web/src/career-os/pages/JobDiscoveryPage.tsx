import type { JobFacet, JobSearchItem } from "@aijob/contracts";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { getJobs, type JobFilters } from "../../api/product";
import { displayField, formatDateTime, jobFamilyLabels } from "../../product/domain";
import { Icon } from "../components/Icon";
import {
  emptyJobFilters,
  hasActiveJobFilters,
  jobDetailPath,
  jobFiltersFromSearchParams,
  jobFiltersToSearchParams,
  recommendedJobsPath,
} from "../job-navigation";

function splitValues(value: string): string[] {
  return value
    .split(/[，,、；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function facet(response: { facets: JobFacet[] } | undefined, key: string) {
  return response?.facets.find((item) => item.key === key);
}

function activeFilterCount(filters: JobFilters): number {
  const { cursor: _cursor, includeUnknownHardConditions, ...values } = filters;
  return (
    Object.values(values).filter((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value)))
      .length + (includeUnknownHardConditions ? 0 : 1)
  );
}

export function JobDiscoveryPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const filters = useMemo(
    () => jobFiltersFromSearchParams(new URLSearchParams(searchKey)),
    [searchKey],
  );
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters]);

  const jobsQuery = useQuery({
    queryKey: ["career-os", "jobs", searchKey],
    queryFn: ({ signal }) => getJobs(filters, signal),
  });
  const result = jobsQuery.data;
  const currentPath = `${location.pathname}${location.search}`;
  const knownJobs = result?.items.filter((item) => item.conditionState === "explicit_match") ?? [];
  const unknownJobs =
    result?.items.filter((item) => item.conditionState === "information_unknown") ?? [];

  function submit(event: FormEvent) {
    event.preventDefault();
    setSearchParams(jobFiltersToSearchParams({ ...draft, cursor: undefined }));
  }

  function clear() {
    setDraft(emptyJobFilters);
    setSearchParams(new URLSearchParams());
  }

  function setList(key: keyof JobFilters, value: string) {
    setDraft((current) => ({ ...current, [key]: splitValues(value), cursor: undefined }));
  }

  const cityFacet = facet(result, "city");
  const companyFacet = facet(result, "company");

  return (
    <section className="career-job-discovery" aria-labelledby="job-discovery-title">
      <header className="career-page-heading career-job-discovery__heading">
        <div>
          <p>可信岗位入口</p>
          <h1 id="job-discovery-title">发现岗位</h1>
          <span>只展示经过当前目录政策允许的企业官网与官方 ATS 岗位事实。</span>
        </div>
        <nav className="career-job-discovery__modes" aria-label="岗位工作区视图">
          <Link className="is-active" to={currentPath} aria-current="page">
            <Icon name="list" size={17} />
            岗位目录
          </Link>
          <Link to={recommendedJobsPath(filters)}>
            <Icon name="check" size={17} />
            证据推荐
          </Link>
          <Link to="/jobs/insights">
            <Icon name="book" size={17} />
            市场洞察
          </Link>
        </nav>
      </header>

      <search>
        <form className="career-job-searchbar" onSubmit={submit}>
          <Icon name="search" size={19} />
          <label>
            <span className="sr-only">搜索岗位、公司或 JD 内容</span>
            <input
              value={draft.keyword}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  keyword: event.target.value,
                  cursor: undefined,
                }))
              }
              placeholder="搜索岗位、公司或 JD 内容"
              maxLength={200}
            />
          </label>
          <button className="career-button career-button--primary" type="submit">
            搜索
          </button>
        </form>
      </search>

      <div className="career-job-discovery__layout">
        <aside className="career-job-filters" aria-label="岗位筛选">
          <header>
            <div>
              <strong>筛选岗位</strong>
              <span>{activeFilterCount(filters)} 项已启用</span>
            </div>
            {hasActiveJobFilters(filters) ? (
              <button type="button" onClick={clear}>
                清除
              </button>
            ) : null}
          </header>
          <form onSubmit={submit}>
            <label>
              <span>城市</span>
              <input
                list="career-job-city-options"
                value={draft.cities.join("、")}
                onChange={(event) => setList("cities", event.target.value)}
                placeholder="例如 深圳、上海"
              />
              <datalist id="career-job-city-options">
                {cityFacet?.values.map((item) => (
                  <option key={item.value} value={item.value} />
                ))}
              </datalist>
              <small>
                已知 {cityFacet?.knownCount ?? 0} · 未说明 {cityFacet?.unknownCount ?? 0}
              </small>
            </label>
            <label>
              <span>岗位方向</span>
              <select
                value={draft.jobFamilies[0] ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    jobFamilies: event.target.value ? [event.target.value] : [],
                    cursor: undefined,
                  }))
                }
              >
                <option value="">全部方向</option>
                {Object.entries(jobFamilyLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>公司</span>
              <input
                list="career-job-company-options"
                value={draft.companies.join("、")}
                onChange={(event) => setList("companies", event.target.value)}
                placeholder="输入企业名称"
              />
              <datalist id="career-job-company-options">
                {companyFacet?.values.map((item) => (
                  <option key={item.value} value={item.value} />
                ))}
              </datalist>
            </label>
            <div className="career-job-filters__pair">
              <label>
                <span>每周可出勤</span>
                <select
                  value={draft.availableWeeklyAttendanceDays}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      availableWeeklyAttendanceDays: event.target.value,
                      cursor: undefined,
                    }))
                  }
                >
                  <option value="">不限</option>
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                    <option key={day} value={day}>
                      {day} 天
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>可持续月数</span>
                <input
                  type="number"
                  min="1"
                  max="36"
                  value={draft.availableDurationMonths}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      availableDurationMonths: event.target.value,
                      cursor: undefined,
                    }))
                  }
                  placeholder="不限"
                />
              </label>
            </div>
            <label>
              <span>毕业年份</span>
              <input
                value={draft.graduationYears.join("、")}
                onChange={(event) => setList("graduationYears", event.target.value)}
                placeholder="例如 2027"
              />
            </label>
            <details className="career-job-filters__advanced">
              <summary>更多筛选</summary>
              <label>
                <span>招聘批次</span>
                <input
                  value={draft.recruitmentBatches.join("、")}
                  onChange={(event) => setList("recruitmentBatches", event.target.value)}
                  placeholder="例如 日常实习"
                />
              </label>
              <label>
                <span>学历</span>
                <input
                  value={draft.educationLevels.join("、")}
                  onChange={(event) => setList("educationLevels", event.target.value)}
                />
              </label>
              <label>
                <span>专业</span>
                <input
                  value={draft.majors.join("、")}
                  onChange={(event) => setList("majors", event.target.value)}
                />
              </label>
              <div className="career-job-filters__pair">
                <label>
                  <span>最低薪资</span>
                  <input
                    type="number"
                    min="0"
                    value={draft.minimumSalary}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        minimumSalary: event.target.value,
                        cursor: undefined,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>薪资周期</span>
                  <select
                    value={draft.salaryPeriods[0] ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        salaryPeriods: event.target.value ? [event.target.value] : [],
                        cursor: undefined,
                      }))
                    }
                  >
                    <option value="">不限</option>
                    <option value="hour">小时</option>
                    <option value="day">天</option>
                    <option value="week">周</option>
                    <option value="month">月</option>
                    <option value="year">年</option>
                  </select>
                </label>
              </div>
              <label>
                <span>办公方式</span>
                <input
                  value={draft.workModes.join("、")}
                  onChange={(event) => setList("workModes", event.target.value)}
                  placeholder="例如 onsite"
                />
              </label>
              <label>
                <span>来源名称</span>
                <input
                  value={draft.sources.join("、")}
                  onChange={(event) => setList("sources", event.target.value)}
                />
              </label>
              <label>
                <span>最近核验状态</span>
                <select
                  value={draft.freshness}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      freshness: event.target.value,
                      cursor: undefined,
                    }))
                  }
                >
                  <option value="">不限</option>
                  <option value="fresh">新鲜</option>
                  <option value="due">待刷新</option>
                  <option value="stale">已过期</option>
                  <option value="unknown">未核验</option>
                </select>
              </label>
            </details>
            <label className="career-job-filters__unknown">
              <input
                type="checkbox"
                checked={draft.includeUnknownHardConditions}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    includeUnknownHardConditions: event.target.checked,
                    cursor: undefined,
                  }))
                }
              />
              <span>保留官方未说明的硬条件</span>
            </label>
            <button className="career-button career-button--primary" type="submit">
              应用筛选
            </button>
          </form>
        </aside>

        <div className="career-job-results">
          <header className="career-job-results__summary">
            <div>
              <strong>{(result?.totalKnown ?? 0) + (result?.totalUnknown ?? 0)} 个岗位</strong>
              <span>
                条件明确 {result?.totalKnown ?? 0} · 官方未说明 {result?.totalUnknown ?? 0}
              </span>
            </div>
            <Link className="career-button career-button--quiet" to={recommendedJobsPath(filters)}>
              用已确认资料生成推荐
            </Link>
          </header>

          {jobsQuery.isPending ? (
            <output className="career-request-state">正在读取可信岗位目录…</output>
          ) : jobsQuery.isError ? (
            <div className="career-inline-error" role="alert">
              <strong>岗位目录暂时无法读取</strong>
              <span>{jobsQuery.error.message}</span>
              <button type="button" onClick={() => jobsQuery.refetch()}>
                重试
              </button>
            </div>
          ) : result?.items.length === 0 ? (
            <div className="career-empty-state">
              <Icon name="search" size={28} />
              <strong>{hasActiveJobFilters(filters) ? "当前筛选没有岗位" : "可信岗位目录当前为空"}</strong>
              <p>
                {hasActiveJobFilters(filters)
                  ? "筛选条件会保留在地址中。你可以清除部分条件，再查看官方未说明的信息。"
                  : "公开与 Alpha 目录为空时不会注入演示岗位，也不会用二手招聘页补位。"}
              </p>
              {hasActiveJobFilters(filters) ? (
                <button type="button" onClick={clear}>
                  清除全部筛选
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <JobResultGroup
                title="条件信息明确"
                note="只表示官方字段足以执行当前筛选，不代表用户符合。"
                jobs={knownJobs}
                from={currentPath}
              />
              <JobResultGroup
                title="官方信息待补充"
                note="至少一个筛选字段未在官方页面明确说明，仍保留给用户判断。"
                jobs={unknownJobs}
                from={currentPath}
                unknown
              />
            </>
          )}

          {result?.nextCursor ? (
            <div className="career-load-more">
              <button
                className="career-button career-button--quiet"
                type="button"
                onClick={() =>
                  setSearchParams(
                    jobFiltersToSearchParams(
                      { ...filters, cursor: result.nextCursor ?? undefined },
                      { includeCursor: true },
                    ),
                  )
                }
              >
                查看下一页
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function JobResultGroup({
  title,
  note,
  jobs,
  from,
  unknown = false,
}: {
  title: string;
  note: string;
  jobs: JobSearchItem[];
  from: string;
  unknown?: boolean;
}) {
  if (jobs.length === 0) return null;
  return (
    <section className="career-job-group">
      <header>
        <div>
          <h2>{title}</h2>
          <p>{note}</p>
        </div>
        <span>{jobs.length} 个</span>
      </header>
      <ol>
        {jobs.map((job) => (
          <li key={job.id}>
            <JobDiscoveryCard job={job} from={from} unknown={unknown} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function JobDiscoveryCard({
  job,
  from,
  unknown,
}: {
  job: JobSearchItem;
  from: string;
  unknown: boolean;
}) {
  const locations = displayField(job.locations, (value) => value.join("、"));
  const attendance = displayField(job.weeklyAttendanceDays, (value) => `每周 ${value} 天`);
  const duration = displayField(job.durationMonths, (value) => `${value} 个月`);
  const deadline = displayField(job.deadlineAt, (value) => formatDateTime(value));
  return (
    <article className="career-job-card">
      <div className="career-job-card__identity">
        <div>
          <span className="career-job-card__source">
            <Icon name="check" size={14} />
            {job.source.displayName}
          </span>
          <span className={`career-job-card__state${unknown ? " is-unknown" : ""}`}>
            {unknown ? "用户尚未确认" : "用户尚未确认"}
          </span>
        </div>
        <h3>
          <Link to={jobDetailPath(job.id, from)}>{job.title}</Link>
        </h3>
        <p>{job.companyName}</p>
      </div>
      <dl className="career-job-card__facts">
        <div>
          <dt>地点</dt>
          <dd className={`is-${locations.state}`}>{locations.text}</dd>
        </div>
        <div>
          <dt>出勤</dt>
          <dd className={`is-${attendance.state}`}>{attendance.text}</dd>
        </div>
        <div>
          <dt>时长</dt>
          <dd className={`is-${duration.state}`}>{duration.text}</dd>
        </div>
        <div>
          <dt>截止</dt>
          <dd className={`is-${deadline.state}`}>{deadline.text}</dd>
        </div>
      </dl>
      <footer>
        <span>核验 {formatDateTime(job.source.lastVerifiedAt)}</span>
        <Link to={jobDetailPath(job.id, from)}>
          查看岗位事实 <Icon name="chevron" size={15} />
        </Link>
      </footer>
    </article>
  );
}
