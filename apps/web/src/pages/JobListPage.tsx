import type { JobFacet, JobSummary } from "@aijob/contracts";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getJobs, type JobFilters } from "../api/product";
import {
  JourneySteps,
  ProductEmpty,
  ProductError,
  ProductLoading,
} from "../components/ProductStates";
import {
  displayField,
  formatDateTime,
  jobFamilyLabels,
  salaryPeriodLabels,
  sourceTypeLabels,
} from "../product/domain";

const initialFilters: JobFilters = {
  keyword: "",
  companies: [],
  cities: [],
  jobFamilies: [],
  recruitmentBatches: [],
  availableWeeklyAttendanceDays: "",
  availableDurationMonths: "",
  latestStartDate: "",
  graduationYears: [],
  educationLevels: [],
  majors: [],
  minimumSalary: "",
  salaryPeriods: [],
  workModes: [],
  sources: [],
  sourceTypes: [],
  freshness: "",
  includeUnknownHardConditions: true,
};

function facet(response: { facets: JobFacet[] } | undefined, key: string) {
  return response?.facets.find((item) => item.key === key);
}

export function JobListPage() {
  const [draft, setDraft] = useState<JobFilters>(initialFilters);
  const [filters, setFilters] = useState<JobFilters>(initialFilters);
  const [filterError, setFilterError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["product", "jobs", filters],
    queryFn: ({ signal }) => getJobs(filters, signal),
  });

  const groups = useMemo(() => {
    const items = query.data?.items ?? [];
    return {
      clear: items.filter(({ conditionState }) => conditionState === "explicit_match"),
      pending: items.filter(({ conditionState }) => conditionState === "information_unknown"),
    };
  }, [query.data]);

  function apply(event: FormEvent) {
    event.preventDefault();
    if (draft.minimumSalary && draft.salaryPeriods.length === 0) {
      setFilterError("填写薪资下限后，请同时选择计薪周期，避免把日薪和月薪直接比较。");
      return;
    }
    setFilterError(null);
    setFilters(draft);
  }

  function clear() {
    setDraft(initialFilters);
    setFilters(initialFilters);
    setFilterError(null);
  }

  return (
    <>
      <JourneySteps current={1} />
      <header className="product-hero product-hero--jobs">
        <div>
          <p className="eyebrow">官方岗位投递决策助手</p>
          <h1>先看真实岗位，再决定是否提供简历</h1>
          <p>
            每条岗位都保留来源、最后核验时间和未知条件。你可以先浏览，也可以用已确认的简历证据生成推荐。
          </p>
        </div>
        <Link className="button button--primary" to="/resume">
          用简历匹配
        </Link>
      </header>

      <form className="product-filter" onSubmit={apply} aria-label="筛选岗位">
        <div className="filter-primary">
          <label>
            <span>关键词</span>
            <input
              type="search"
              value={draft.keyword}
              onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
              placeholder="岗位、公司、职责或要求"
            />
            <small>可搜索岗位名称、公司、职责与要求</small>
          </label>
          <FacetSelect
            label="城市"
            value={draft.cities[0] ?? ""}
            onChange={(value) => setDraft({ ...draft, cities: value ? [value] : [] })}
            facet={facet(query.data, "city")}
          />
          <FacetSelect
            label="岗位方向"
            value={draft.jobFamilies[0] ?? ""}
            onChange={(value) => setDraft({ ...draft, jobFamilies: value ? [value] : [] })}
            facet={facet(query.data, "jobFamily")}
            labels={jobFamilyLabels}
          />
        </div>

        <div className="filter-primary-actions">
          <p>关键词与条件可以组合使用；官方未说明的条件不会被当作符合。</p>
          <button className="button button--primary" type="submit">
            查看岗位
          </button>
        </div>

        <details className="filter-more">
          <summary>更多筛选条件</summary>
          <div className="filter-more__grid">
            <FacetSelect
              label="公司"
              value={draft.companies[0] ?? ""}
              onChange={(value) => setDraft({ ...draft, companies: value ? [value] : [] })}
              facet={facet(query.data, "company")}
            />
            <FacetSelect
              label="招聘批次"
              value={draft.recruitmentBatches[0] ?? ""}
              onChange={(value) => setDraft({ ...draft, recruitmentBatches: value ? [value] : [] })}
              facet={facet(query.data, "recruitmentBatch")}
            />
            <label>
              <span>我每周最多可出勤</span>
              <select
                value={draft.availableWeeklyAttendanceDays}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    availableWeeklyAttendanceDays: event.target.value,
                  })
                }
              >
                <option value="">不限</option>
                {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                  <option key={value} value={value}>
                    最多可出勤 {value} 天
                  </option>
                ))}
              </select>
              <small>
                已知 {facet(query.data, "weeklyAttendanceDays")?.knownCount ?? 0} · 未说明{" "}
                {facet(query.data, "weeklyAttendanceDays")?.unknownCount ?? 0}
              </small>
            </label>
            <label>
              <span>我最多可持续实习</span>
              <select
                value={draft.availableDurationMonths}
                onChange={(event) =>
                  setDraft({ ...draft, availableDurationMonths: event.target.value })
                }
              >
                <option value="">不限</option>
                {[1, 2, 3, 4, 6, 12].map((value) => (
                  <option key={value} value={value}>
                    最多可持续 {value} 个月
                  </option>
                ))}
              </select>
              <small>
                已知 {facet(query.data, "durationMonths")?.knownCount ?? 0} · 未说明{" "}
                {facet(query.data, "durationMonths")?.unknownCount ?? 0}
              </small>
            </label>
            <label>
              <span>最晚到岗日期</span>
              <input
                type="date"
                value={draft.latestStartDate}
                onChange={(event) => setDraft({ ...draft, latestStartDate: event.target.value })}
              />
              <small>
                已知 {facet(query.data, "earliestStartDate")?.knownCount ?? 0} · 未说明{" "}
                {facet(query.data, "earliestStartDate")?.unknownCount ?? 0}
              </small>
            </label>
            <FacetSelect
              label="毕业年份"
              value={draft.graduationYears[0] ?? ""}
              onChange={(value) => setDraft({ ...draft, graduationYears: value ? [value] : [] })}
              facet={facet(query.data, "graduationYear")}
            />
            <FacetSelect
              label="学历"
              value={draft.educationLevels[0] ?? ""}
              onChange={(value) => setDraft({ ...draft, educationLevels: value ? [value] : [] })}
              facet={facet(query.data, "educationLevel")}
            />
            <FacetSelect
              label="专业"
              value={draft.majors[0] ?? ""}
              onChange={(value) => setDraft({ ...draft, majors: value ? [value] : [] })}
              facet={facet(query.data, "major")}
            />
            <FacetSelect
              label="工作方式"
              value={draft.workModes[0] ?? ""}
              onChange={(value) => setDraft({ ...draft, workModes: value ? [value] : [] })}
              facet={facet(query.data, "workMode")}
            />
            <FacetSelect
              label="岗位来源"
              value={draft.sourceTypes[0] ?? ""}
              onChange={(value) => setDraft({ ...draft, sourceTypes: value ? [value] : [] })}
              facet={facet(query.data, "sourceType")}
              labels={sourceTypeLabels}
            />
            <label>
              <span>薪资下限</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={draft.minimumSalary}
                onChange={(event) => setDraft({ ...draft, minimumSalary: event.target.value })}
                placeholder="例如 180"
              />
              <small>按所选计薪周期核对；官方未写下限时进入信息待确认</small>
            </label>
            <FacetSelect
              label="计薪周期"
              value={draft.salaryPeriods[0] ?? ""}
              onChange={(value) => setDraft({ ...draft, salaryPeriods: value ? [value] : [] })}
              facet={facet(query.data, "salaryPeriod")}
              labels={salaryPeriodLabels}
            />
            <FacetSelect
              label="具体来源"
              value={draft.sources[0] ?? ""}
              onChange={(value) => setDraft({ ...draft, sources: value ? [value] : [] })}
              facet={facet(query.data, "source")}
            />
            <label>
              <span>新鲜度</span>
              <select
                value={draft.freshness}
                onChange={(event) => setDraft({ ...draft, freshness: event.target.value })}
              >
                <option value="">不限</option>
                <option value="fresh">近期已核验</option>
                <option value="due">即将需要复核</option>
                <option value="stale">已过复核期</option>
                <option value="unknown">未知</option>
              </select>
              <small>
                已知 {facet(query.data, "freshness")?.knownCount ?? 0} · 未说明{" "}
                {facet(query.data, "freshness")?.unknownCount ?? 0}
              </small>
            </label>
          </div>
          {filterError ? (
            <p className="filter-inline-error" role="alert">
              {filterError}
            </p>
          ) : null}
          <label className="filter-unknown">
            <input
              type="checkbox"
              checked={draft.includeUnknownHardConditions}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  includeUnknownHardConditions: event.target.checked,
                })
              }
            />
            保留条件未说明的岗位，并单独列为“信息待确认”
          </label>
          <div className="filter-actions">
            <button className="button button--secondary" type="button" onClick={clear}>
              清除全部
            </button>
            <button className="button button--primary" type="submit">
              应用筛选
            </button>
          </div>
        </details>
      </form>

      {query.isPending ? <ProductLoading label="正在读取本地岗位目录" /> : null}
      {query.isError ? (
        <ProductError
          title="岗位目录暂时不可用"
          error={query.error}
          action={
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void query.refetch()}
            >
              重新加载
            </button>
          }
        />
      ) : null}
      {query.data && groups.clear.length + groups.pending.length === 0 ? (
        <ProductEmpty
          title="当前条件下没有岗位"
          action={
            <button className="button button--secondary" type="button" onClick={clear}>
              清除筛选
            </button>
          }
        >
          <p>可以放宽条件；若目录本身为空，请先完成本地岗位导入。</p>
        </ProductEmpty>
      ) : null}
      {query.data && groups.clear.length + groups.pending.length > 0 ? (
        <div className="job-results">
          <div className="results-heading">
            <div>
              <p className="eyebrow">本地 PostgreSQL 目录</p>
              <h2>{groups.clear.length + groups.pending.length} 个岗位</h2>
            </div>
            <p>未知条件不会被算作符合，也不会被静默隐藏。</p>
          </div>
          {query.data.companyQuotaGaps?.length ? (
            <p className="quota-gap-note">
              无中小规模证据企业按单家配额显示：
              {query.data.companyQuotaGaps
                .map((gap) => `${gap.companyName} ${gap.selected}/供给 ${gap.supply}`)
                .join("、")}
              。被压缩的供给保留缺口记录，不代表岗位关闭。
            </p>
          ) : null}
          {groups.clear.length > 0 ? (
            <JobGroup
              title={
                Object.values(filters).some((value) =>
                  Array.isArray(value) ? value.length > 0 : Boolean(value),
                )
                  ? "已知条件下未发现筛选冲突"
                  : "岗位结果"
              }
              note="这里只说明已知字段通过当前筛选，不代表你具备岗位资格。"
              jobs={groups.clear}
            />
          ) : null}
          {groups.pending.length > 0 ? (
            <JobGroup
              title="信息待确认"
              note="至少一个所选硬条件在官方页面未说明，需查看详情或到官方页面核对。"
              jobs={groups.pending}
              pending
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function FacetSelect({
  label,
  value,
  onChange,
  facet: item,
  labels = {},
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  facet?: JobFacet | undefined;
  labels?: Record<string, string>;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">不限</option>
        {item?.values.map((option) => (
          <option key={option.value} value={option.value}>
            {labels[option.value] || option.value}（{option.count}）
          </option>
        ))}
      </select>
      {item ? (
        <small>
          已知 {item.knownCount} · 未说明 {item.unknownCount}
        </small>
      ) : null}
    </label>
  );
}

function JobGroup({
  title,
  note,
  jobs,
  pending = false,
}: {
  title: string;
  note: string;
  jobs: JobSummary[];
  pending?: boolean;
}) {
  return (
    <section className="result-group" aria-labelledby={`group-${pending ? "pending" : "known"}`}>
      <header>
        <div>
          <h3 id={`group-${pending ? "pending" : "known"}`}>{title}</h3>
          <p>{note}</p>
        </div>
        <strong>{jobs.length} 条</strong>
      </header>
      <ul className="product-job-grid">
        {jobs.map((job) => (
          <li key={job.id}>
            <ProductJobCard job={job} pending={pending} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProductJobCard({
  job,
  pending = false,
  axes,
  matchRunId,
}: {
  job: JobSummary;
  pending?: boolean;
  axes?: React.ReactNode;
  matchRunId?: string;
}) {
  const locations = displayField(job.locations, (value) => value.join("、"));
  const attendance = displayField(job.weeklyAttendanceDays, (value) => `每周 ${value} 天`);
  const duration = displayField(job.durationMonths, (value) => `${value} 个月`);
  const salary = displayField(job.salary, (value) => value.rawText);
  const family = displayField(job.jobFamily, (value) => jobFamilyLabels[value] || value);
  const detailPath = `/jobs/${encodeURIComponent(job.id)}${
    matchRunId ? `?matchRunId=${encodeURIComponent(matchRunId)}` : ""
  }`;
  return (
    <article className="product-job-card">
      <div className="product-job-card__meta">
        <span className={`product-chip ${pending ? "is-warning" : ""}`}>
          {pending ? "信息待确认" : family.text}
        </span>
        <span>{job.companyName}</span>
      </div>
      <h3>
        <Link to={detailPath}>{job.title}</Link>
      </h3>
      <dl>
        <div>
          <dt>城市</dt>
          <dd className={`field-${locations.state}`}>{locations.text}</dd>
        </div>
        <div>
          <dt>出勤</dt>
          <dd className={`field-${attendance.state}`}>{attendance.text}</dd>
        </div>
        <div>
          <dt>时长</dt>
          <dd className={`field-${duration.state}`}>{duration.text}</dd>
        </div>
      </dl>
      <p className={`product-job-card__salary field-${salary.state}`}>
        <span>薪资</span>
        <strong>{salary.text}</strong>
      </p>
      {axes}
      <div className="product-job-card__source">
        <span>
          {sourceTypeLabels[job.source.type] || job.source.type} · {job.source.displayName}
        </span>
        <span>核验 {formatDateTime(job.source.lastVerifiedAt)}</span>
      </div>
      <Link className="text-link" to={detailPath}>
        查看来源与岗位依据 <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
