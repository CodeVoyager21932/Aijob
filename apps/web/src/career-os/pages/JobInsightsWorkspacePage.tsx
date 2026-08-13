import type { CompanyScaleBand, JobFamily, JobInsightRequirement, JobInsightRun } from "@aijob/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ProductApiError } from "../../api/client";
import { createJobInsightRun, getJobInsightRun, getProfileEvidence } from "../../api/product";
import { companyScaleLabels, formatDateTime, jobFamilyLabels } from "../../product/domain";
import { Icon } from "../components/Icon";

const scaleOptions: CompanyScaleBand[] = ["small", "medium", "large", "unknown"];
const personalStatusLabels = {
  confirmed_evidence: "已有证据",
  not_in_resume: "证据待补充",
  needs_confirmation: "用户尚未确认",
} as const;

export function JobInsightsWorkspacePage() {
  const { runId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const navigate = useNavigate();
  const [jobFamily, setJobFamily] = useState<JobFamily | "">(
    (searchParams.get("jobFamily") as JobFamily | null) ?? "",
  );
  const [city, setCity] = useState(searchParams.get("city") ?? "");
  const [scaleBands, setScaleBands] = useState<CompanyScaleBand[]>(
    searchParams
      .getAll("scale")
      .flatMap((value) => value.split(","))
      .filter((value): value is CompanyScaleBand => scaleOptions.includes(value as CompanyScaleBand)),
  );
  const [useEvidence, setUseEvidence] = useState(searchParams.get("evidence") !== "false");
  const evidenceQuery = useQuery({
    queryKey: ["career-os", "profile", "evidence"],
    queryFn: ({ signal }) => getProfileEvidence(signal),
  });
  const evidenceRevisionId = evidenceQuery.data && "id" in evidenceQuery.data ? evidenceQuery.data.id : null;
  const runQuery = useQuery({
    queryKey: ["career-os", "insight", runId],
    queryFn: ({ signal }) => getJobInsightRun(runId ?? "", signal),
    enabled: Boolean(runId),
    retry: (failureCount, error) =>
      error instanceof ProductApiError && error.status === 404 ? false : failureCount < 1,
  });
  const mutation = useMutation({
    mutationFn: () => {
      if (!jobFamily) throw new Error("请先选择一个岗位方向。");
      return createJobInsightRun({
        scope: {
          jobFamily,
          cities: city.trim() ? [city.trim()] : [],
          companyScaleBands: scaleBands,
        },
        evidenceRevisionId: useEvidence ? evidenceRevisionId : null,
      });
    },
    onSuccess: (run) => navigate(`/jobs/insights/${encodeURIComponent(run.id)}`),
  });
  useEffect(() => {
    if (runId) return;
    const next = new URLSearchParams();
    if (jobFamily) next.set("jobFamily", jobFamily);
    if (city.trim()) next.set("city", city.trim());
    if (scaleBands.length > 0) next.set("scale", scaleBands.join(","));
    if (!useEvidence) next.set("evidence", "false");
    if (next.toString() === searchKey) return;
    setSearchParams(next, { replace: true });
  }, [city, jobFamily, runId, scaleBands, searchKey, setSearchParams, useEvidence]);

  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }
  function toggleScale(value: CompanyScaleBand) {
    setScaleBands((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  return (
    <section className="career-insights" aria-labelledby="insights-title">
      <header className="career-page-heading career-insights__heading">
        <div>
          <p>跨岗位事实</p>
          <h1 id="insights-title">岗位市场洞察</h1>
          <span>只聚合当前可信官方 JD；样本不足时明确停止，不把市场结论冒充单岗位要求。</span>
        </div>
        <Link className="career-button career-button--quiet" to="/jobs">
          返回岗位目录
        </Link>
      </header>

      {!runId ? (
        <form className="career-insight-builder" onSubmit={submit}>
          <div className="career-insight-builder__fields">
            <label>
              <span>岗位方向</span>
              <select
                required
                value={jobFamily}
                onChange={(event) => setJobFamily(event.target.value as JobFamily | "")}
              >
                <option value="">请选择</option>
                {Object.entries(jobFamilyLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>城市</span>
              <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="可选" />
            </label>
            <fieldset>
              <legend>企业规模</legend>
              {scaleOptions.map((value) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={scaleBands.includes(value)}
                    onChange={() => toggleScale(value)}
                  />
                  <span>{companyScaleLabels[value]}</span>
                </label>
              ))}
            </fieldset>
            <label className="career-insight-builder__evidence">
              <input
                type="checkbox"
                checked={useEvidence}
                disabled={!evidenceRevisionId}
                onChange={(event) => setUseEvidence(event.target.checked)}
              />
              <span>对照最新已确认经历证据</span>
            </label>
          </div>
          <aside>
            <Icon name="book" size={28} />
            <h2>建立一份可恢复洞察运行</h2>
            <p>结果会固定候选岗位版本、Requirements 与来源核验时间，刷新和深链不会重新计算。</p>
            {!evidenceRevisionId ? <Link to="/resumes/import">先准备简历证据</Link> : null}
            <button className="career-button career-button--primary" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "正在生成…" : "生成市场洞察"}
            </button>
          </aside>
        </form>
      ) : null}

      {mutation.isError ? (
        <div className="career-inline-error" role="alert">
          <strong>岗位洞察暂时无法生成</strong>
          <span>{mutation.error.message}</span>
          <button type="button" onClick={() => mutation.mutate()}>
            重试
          </button>
        </div>
      ) : null}
      {runId && runQuery.isPending ? (
        <output className="career-request-state">正在恢复固定洞察运行…</output>
      ) : null}
      {runQuery.isError ? (
        <div className="career-inline-error" role="alert">
          <strong>
            {runQuery.error instanceof ProductApiError && runQuery.error.status === 404
              ? "这次洞察不可读取"
              : "岗位洞察暂时不可用"}
          </strong>
          <span>{runQuery.error.message}</span>
          <Link to="/jobs/insights">创建新的洞察</Link>
        </div>
      ) : runQuery.data ? (
        <InsightReport run={runQuery.data} />
      ) : null}
    </section>
  );
}

function InsightReport({ run }: { run: JobInsightRun }) {
  const result = run.result;
  return (
    <div className="career-insight-report">
      <header>
        <div>
          <p>固定运行 {run.id.slice(0, 8)}</p>
          <h2>{jobFamilyLabels[run.scope.jobFamily]}岗位要求概览</h2>
        </div>
        <Link className="career-button career-button--quiet" to="/jobs/insights">
          创建新洞察
        </Link>
      </header>
      <dl className="career-insight-report__sample">
        <div>
          <dt>活动岗位</dt>
          <dd>{result.sample.jobCount}</dd>
        </div>
        <div>
          <dt>企业</dt>
          <dd>{result.sample.companyCount}</dd>
        </div>
        <div>
          <dt>要求已拆解</dt>
          <dd>{result.sample.structuredRequirementJobCount}</dd>
        </div>
        <div>
          <dt>最后核验</dt>
          <dd>{formatDateTime(result.sample.lastVerifiedAt)}</dd>
        </div>
      </dl>
      {!result.dataSufficient ? (
        <div className="career-insight-report__insufficient">
          <Icon name="warning" size={22} />
          <div>
            <strong>当前样本不足，不生成高频排名</strong>
            <p>{result.insufficiencyReasons.join(" · ")}</p>
          </div>
        </div>
      ) : (
        <div className="career-insight-report__sections">
          <InsightSection title="常见硬要求" items={result.commonHardRequirements} />
          <InsightSection title="高频能力与经历" items={result.frequentCapabilities} />
          <InsightSection title="常见加分项" items={result.preferredRequirements} />
        </div>
      )}
    </div>
  );
}

function InsightSection({ title, items }: { title: string; items: JobInsightRequirement[] }) {
  return (
    <section>
      <header>
        <h3>{title}</h3>
        <span>{items.length} 项</span>
      </header>
      {items.length > 0 ? (
        <ol>
          {items.map((item) => (
            <li key={item.key}>
              <div>
                <strong>{item.label}</strong>
                <span>
                  {item.jobCount} 个岗位 · {item.companyCount} 家企业
                </span>
              </div>
              {item.personalStatus ? (
                <span className={`is-${item.personalStatus}`}>
                  {personalStatusLabels[item.personalStatus]}
                </span>
              ) : null}
              <details>
                <summary>查看官方原句</summary>
                <ul>
                  {item.examples.map((example) => (
                    <li key={`${example.jobId}-${example.companyName}`}>
                      <strong>
                        {example.companyName} · {example.jobTitle}
                      </strong>
                      <p>{example.sourceText}</p>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p>当前样本没有达到跨企业展示门槛的要求。</p>
      )}
    </section>
  );
}
