import type {
  CompanyScaleBand,
  JobFamily,
  JobInsightRequirement,
  JobInsightRun,
} from "@aijob/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { createJobInsightRun, getProfileEvidence } from "../api/product";
import { ProductError, ProductLoading } from "../components/ProductStates";
import { companyScaleLabels, formatDateTime, jobFamilyLabels } from "../product/domain";

const scaleOptions: CompanyScaleBand[] = ["small", "medium", "large", "unknown"];

const personalStatusLabels = {
  confirmed_evidence: "简历已有证据",
  not_in_resume: "简历暂未体现",
  needs_confirmation: "需要确认个人资料",
} as const;

const insufficiencyLabels = {
  too_few_jobs: "当前方向不足 20 个活动岗位",
  too_few_companies: "当前方向不足 5 家公司",
  low_requirement_coverage: "可核对的原子要求覆盖不足 70%",
} as const;

export function JobInsightsPage() {
  const [jobFamily, setJobFamily] = useState<JobFamily | "">("");
  const [city, setCity] = useState("");
  const [scaleBands, setScaleBands] = useState<CompanyScaleBand[]>([]);
  const [useEvidence, setUseEvidence] = useState(true);
  const [run, setRun] = useState<JobInsightRun | null>(null);
  const evidenceQuery = useQuery({
    queryKey: ["product", "profile", "evidence"],
    queryFn: ({ signal }) => getProfileEvidence(signal),
  });
  const evidenceRevisionId =
    evidenceQuery.data && "id" in evidenceQuery.data ? evidenceQuery.data.id : null;

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
    onSuccess: setRun,
  });

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
    <>
      <header className="insight-heading">
        <p className="eyebrow">基于当前官方 JD 样本</p>
        <h1>岗位要求洞察</h1>
        <p>按跨公司覆盖识别共同要求，并与已确认的简历证据分开核对。</p>
      </header>

      <form className="product-panel insight-filter" onSubmit={submit}>
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
          <span>城市（可选）</span>
          <input
            value={city}
            onChange={(event) => setCity(event.target.value)}
            placeholder="例如：上海"
          />
        </label>
        <fieldset className="insight-scale-filter">
          <legend>公司规模（可选）</legend>
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
        <div className="insight-filter__action">
          <label className="consent-row insight-use-evidence">
            <input
              type="checkbox"
              checked={useEvidence}
              disabled={!evidenceRevisionId}
              onChange={(event) => setUseEvidence(event.target.checked)}
            />
            <span>同时对照已确认的简历证据</span>
          </label>
          {!evidenceRevisionId ? (
            <Link className="text-link" to="/resume">
              先确认简历证据
            </Link>
          ) : null}
          <button className="button button--primary" type="submit" disabled={mutation.isPending}>
            生成洞察
          </button>
        </div>
      </form>

      {mutation.isPending ? <ProductLoading label="正在核对岗位要求样本" /> : null}
      {mutation.isError ? (
        <ProductError title="岗位洞察暂时无法生成" error={mutation.error} />
      ) : null}
      {run ? <InsightReport run={run} /> : null}
    </>
  );
}

function InsightReport({ run }: { run: JobInsightRun }) {
  const { result } = run;
  return (
    <div className="insight-report" aria-live="polite">
      <section className="product-panel" aria-labelledby="insight-sample-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">样本依据</p>
            <h2 id="insight-sample-heading">这次结论用了哪些数据</h2>
          </div>
          <p>最后核验 {formatDateTime(result.sample.lastVerifiedAt)}</p>
        </div>
        <dl className="insight-sample">
          <div>
            <dt>活动岗位</dt>
            <dd>{result.sample.jobCount}</dd>
          </div>
          <div>
            <dt>公司</dt>
            <dd>{result.sample.companyCount}</dd>
          </div>
          <div>
            <dt>规模已核验公司</dt>
            <dd>
              {result.sample.knownScaleCompanyCount} / {result.sample.companyCount}
            </dd>
          </div>
          <div>
            <dt>要求已拆解岗位</dt>
            <dd>
              {result.sample.structuredRequirementJobCount} / {result.sample.jobCount}
            </dd>
          </div>
        </dl>
        {!result.dataSufficient ? (
          <div className="product-callout is-warning">
            <strong>当前样本不足，暂不生成高频排名</strong>
            <ul>
              {result.insufficiencyReasons.map((reason) => (
                <li key={reason}>{insufficiencyLabels[reason]}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {result.dataSufficient ? (
        <>
          <InsightSection
            id="hard-requirements"
            eyebrow="普遍门槛"
            title="常见硬要求"
            items={result.commonHardRequirements}
          />
          <InsightSection
            id="capabilities"
            eyebrow="能力与经验"
            title="高频能力与经历"
            items={result.frequentCapabilities}
          />
          <InsightSection
            id="preferred"
            eyebrow="优先与加分"
            title="常见加分项"
            items={result.preferredRequirements}
          />
        </>
      ) : null}
    </div>
  );
}

function InsightSection({
  id,
  eyebrow,
  title,
  items,
}: {
  id: string;
  eyebrow: string;
  title: string;
  items: JobInsightRequirement[];
}) {
  return (
    <section className="product-panel insight-section" aria-labelledby={id}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      {items.length > 0 ? (
        <ol className="insight-requirements">
          {items.map((item) => (
            <li key={item.key}>
              <div className="insight-requirement__main">
                <strong>{item.label}</strong>
                <span>
                  {item.jobCount} 个岗位 · {item.companyCount} 家公司
                </span>
              </div>
              {item.personalStatus ? (
                <span className={`insight-personal-status is-${item.personalStatus}`}>
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
        <p className="insight-empty">当前样本中没有达到跨公司展示门槛的要求。</p>
      )}
    </section>
  );
}
