import {
  type CreatePlannerItemRequest,
  type JobGraphResult,
  type JobGraphScope,
  JobGraphScopeSchema,
} from "@aijob/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { createIdempotencyKey } from "../../api/client";
import {
  compareGraphWithEvidence,
  coreKeys,
  getCurrentGraph,
  getGraphEvidence,
  getSavedSearches,
  persistSearch,
  removeSavedSearch,
} from "../../api/product-core";
import { formatDateTime, jobFamilyLabels } from "../../product/domain";
import { BookmarkButton } from "../components/BookmarkButton";
import { ModalSurface } from "../components/ModalSurface";
import { PlannerEditor } from "../components/PlannerEditor";
import "../product-core.css";

type Example = JobGraphResult["items"][number]["examples"][number];
type GraphItem = JobGraphResult["items"][number];
const percent = (value: number) => `${Math.round(value * 100)}%`;
const necessityLabels = {
  required: "明确要求",
  preferred: "优先 / 加分",
  optional: "非必需",
  unknown: "必要性未说明",
};
const kindLabels = {
  tool: "工具",
  task: "任务能力",
  deliverable: "工作产物",
  education: "学历条件",
  school: "院校表述",
  qualification: "其他资格",
};
const subroles = {
  product_operations: "产品运营",
  ai_product: "AI 产品",
  data_analysis: "数据分析",
  user_research: "用户研究",
  supply_quality: "供应链质量",
  content_operations: "内容运营",
  algorithm_research: "算法研究",
};

function GraphFilters({
  scope,
  onChange,
  label,
  privateDataset = false,
}: {
  scope: JobGraphScope;
  onChange: (scope: JobGraphScope) => void;
  label: string;
  privateDataset?: boolean;
}) {
  const [cityDraft, setCityDraft] = useState(scope.cities.join("，"));
  const [batchDraft, setBatchDraft] = useState(scope.batch ?? "");
  useEffect(() => {
    setCityDraft(scope.cities.join("，"));
    setBatchDraft(scope.batch ?? "");
  }, [scope.cities, scope.batch]);
  const field = (patch: Partial<JobGraphScope>) => onChange({ ...scope, ...patch });
  return (
    <fieldset className="core-graph-filters">
      <legend>{label}</legend>
      <label>
        职能
        <select
          value={scope.jobFamily ?? ""}
          onChange={(event) =>
            field({
              jobFamily: (event.target.value || undefined) as JobGraphScope["jobFamily"],
              subrole: undefined,
            })
          }
        >
          <option value="">全部职能</option>
          {Object.entries(jobFamilyLabels).map(([key, value]) => (
            <option key={key} value={key}>
              {value}
            </option>
          ))}
          <option value="unclassified">尚未分类</option>
        </select>
      </label>
      <label>
        子岗位
        <select
          value={scope.subrole ?? ""}
          onChange={(event) => field({ subrole: event.target.value || undefined })}
        >
          <option value="">全部子岗位</option>
          {Object.entries(subroles).map(([key, value]) => (
            <option key={key} value={key}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <details className="core-graph-advanced">
        <summary>更多筛选 · 城市、类型、学历、批次</summary>
        <div className="core-graph-advanced-fields">
          <label>
            城市
            <input
              aria-label={`${label}城市`}
              disabled={privateDataset}
              value={cityDraft}
              placeholder="全部城市"
              maxLength={100}
              onChange={(event) => setCityDraft(event.target.value)}
              onBlur={() =>
                field({
                  cities: cityDraft
                    .split(/[，,]/)
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label>
            招聘类型
            <select
              disabled={privateDataset}
              value={scope.recruitmentTypes[0] ?? ""}
              onChange={(event) =>
                field({
                  recruitmentTypes: event.target.value
                    ? [event.target.value as JobGraphScope["recruitmentTypes"][number]]
                    : [],
                })
              }
            >
              <option value="">全部类型</option>
              <option value="internship">实习</option>
              <option value="campus">校招</option>
              <option value="new_grad">应届</option>
              <option value="management_trainee">管培</option>
              <option value="unknown">未说明</option>
            </select>
          </label>
          <label>
            学历条件
            <select
              value={scope.educationLevels[0] ?? ""}
              onChange={(event) =>
                field({
                  educationLevels: event.target.value
                    ? [event.target.value as JobGraphScope["educationLevels"][number]]
                    : [],
                })
              }
            >
              <option value="">全部学历</option>
              {["本科", "硕士", "博士"].map((value) => (
                <option key={value}>{value}</option>
              ))}
              <option value="unknown">未说明</option>
            </select>
          </label>
          <label>
            招聘批次
            <input
              disabled={privateDataset}
              value={batchDraft}
              placeholder="全部批次"
              maxLength={100}
              onChange={(event) => setBatchDraft(event.target.value)}
              onBlur={() => field({ batch: batchDraft || undefined })}
            />
          </label>
        </div>
      </details>
    </fieldset>
  );
}
function GraphSummary({ data, label }: { data: JobGraphResult; label: string }) {
  return (
    <div className="core-graph-summary">
      <div>
        <small>{label}</small>
        <strong>
          {data.sample.jobCount.toLocaleString()}
          <span> 个岗位</span>
        </strong>
        <p>
          {data.sample.companyCount} 家企业 · 已解析 {data.sample.parsedJobCount} 岗（
          {percent(data.sample.parseCoverage)}）
        </p>
      </div>
      <div>
        <small>{data.dataset === "private" ? "个人分析集合" : "岗位核验范围"}</small>
        <p>
          {data.dataset === "private"
            ? "仅包含自己的私有 JD，原文未进行官网核验。"
            : data.sample.firstVerifiedAt
              ? `${formatDateTime(data.sample.firstVerifiedAt)} — ${formatDateTime(data.sample.lastVerifiedAt ?? data.sample.firstVerifiedAt)}`
              : "暂无核验记录"}
        </p>
        <small>
          {data.sample.jobCount < 10
            ? "样本较少，先看具体岗位和原句。"
            : "统计描述当前收录集合，保留每家企业的全部岗位。"}
        </small>
      </div>
    </div>
  );
}
function QuoteDrawer({
  scope,
  item,
  dataset,
  onClose,
  onPrepare,
}: {
  scope: JobGraphScope;
  item: GraphItem;
  dataset: "public" | "private";
  onClose: () => void;
  onPrepare: (
    example: Example,
    caseId: string | null,
    reference?: {
      evidenceRevisionId: string | null;
      evidenceIds: string[];
      sourceExperienceIds: string[];
    },
  ) => void;
}) {
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);
  const [selectedExperiences, setSelectedExperiences] = useState<string[]>([]);
  const comparison = useMutation({
    mutationFn: () => compareGraphWithEvidence(scope, item.key, dataset),
    retry: false,
  });
  const evidence = useInfiniteQuery({
    queryKey: [...coreKeys.graph, "evidence", dataset, scope, item.key],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      getGraphEvidence(scope, item.key, pageParam, signal, dataset),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  return (
    <ModalSurface
      className="core-quote-drawer"
      ariaLabel={`${item.label}的岗位原句`}
      onClose={onClose}
      closeLabel="关闭岗位原句"
    >
      <header>
        <button type="button" className="career-button" onClick={onClose}>
          关闭原句
        </button>
        <p className="core-eyebrow">回到岗位依据</p>
        <h2>{item.label}</h2>
        <p>
          {item.jobCount} 个岗位提及 · {item.companyCount} 家企业覆盖
        </p>
        <p className="core-note">提及率包括优先、否定和条件表述，请分别核对必要性。</p>
      </header>
      <section aria-label="我的经历对照" className="core-personal-comparison">
        <h3>我的经历对照</h3>
        <p>
          从完整经历中找相关内容，保留项目背景和成果。这是文字与任务线索对照，可以直接选择材料继续准备。
        </p>
        <button
          type="button"
          className="career-button"
          disabled={comparison.isPending}
          onClick={() => {
            setSelectedEvidence([]);
            setSelectedExperiences([]);
            comparison.mutate();
          }}
        >
          {comparison.isPending ? "正在对照…" : "查看相关经历"}
        </button>
        {comparison.isError ? (
          <p role="alert">经历对照暂时不可用，可以直接选择经历或创建准备任务。</p>
        ) : null}
        {comparison.data?.candidates.map((candidate) => {
          const id = candidate.experienceId ?? candidate.evidenceId;
          if (!id) return null;
          const selected = candidate.experienceId ? selectedExperiences : selectedEvidence;
          const setSelected = candidate.experienceId ? setSelectedExperiences : setSelectedEvidence;
          return (
            <div className="core-evidence-option" key={id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(id)}
                  onChange={(event) =>
                    setSelected((values) =>
                      event.target.checked
                        ? [...values, id]
                        : values.filter((value) => value !== id),
                    )
                  }
                />
                <span>
                  <strong>{candidate.title ?? candidate.section}</strong> · {candidate.reason}
                  <br />
                  {candidate.statement}
                </span>
              </label>
              {candidate.experienceId ? (
                <Link to={`/materials?experienceId=${candidate.experienceId}`}>查看完整经历</Link>
              ) : (
                <small>来自以前保存的材料</small>
              )}
            </div>
          );
        })}
        {comparison.data && !comparison.data.candidates.length ? (
          <p>
            暂未找到直接对应的经历，也可以在准备事项中手动选择，或先安排一个准备产物。
            <Link to="/materials">整理我的经历</Link>
          </p>
        ) : null}
        {selectedEvidence.length + selectedExperiences.length > 0 ? (
          <output>
            已选择 {selectedEvidence.length + selectedExperiences.length}{" "}
            段；点击下方岗位的“关联经历 / 加入准备”带入任务。
          </output>
        ) : null}
      </section>
      {evidence.isPending ? (
        <output>正在读取原句…</output>
      ) : evidence.isError ? (
        <p role="alert">
          读取失败。
          <button type="button" onClick={() => void evidence.refetch()}>
            重试
          </button>
        </p>
      ) : null}
      <div className="core-quotes">
        {evidence.data?.pages
          .flatMap((page) => page.items)
          .map((example) => (
            <article
              key={`${example.jobVersionId}-${example.atom.section}-${example.atom.sourceSpan.start}`}
            >
              <p className="core-eyebrow">{example.companyName}</p>
              <h3>
                <Link
                  to={
                    example.context === "private"
                      ? `/applications/${example.caseId}/requirements`
                      : `/jobs/${example.jobId}`
                  }
                >
                  {example.title}
                </Link>
              </h3>
              <span className={`core-necessity ${example.atom.necessity}`}>
                {example.atom.negated
                  ? "否定 / 不限制"
                  : example.atom.condition
                    ? "附带条件 / 或选项"
                    : necessityLabels[example.atom.necessity]}
              </span>
              <blockquote>{example.atom.sourceText}</blockquote>
              <small>
                原文位置：{example.atom.section === "requirements" ? "任职要求" : "工作职责"}
              </small>
              <footer>
                {example.context === "private" ? (
                  <Link
                    className="career-button"
                    to={`/applications/${example.caseId}/requirements`}
                  >
                    打开私有申请
                  </Link>
                ) : (
                  <BookmarkButton jobId={example.jobId} />
                )}
                <button
                  type="button"
                  className="career-button career-button--primary"
                  onClick={() =>
                    onPrepare(
                      example,
                      example.caseId ?? null,
                      selectedEvidence.length + selectedExperiences.length > 0
                        ? {
                            evidenceRevisionId: comparison.data?.evidenceRevisionId ?? null,
                            evidenceIds: selectedEvidence,
                            sourceExperienceIds: selectedExperiences,
                          }
                        : undefined,
                    )
                  }
                >
                  关联经历 / 加入准备
                </button>
              </footer>
            </article>
          ))}
      </div>
      {evidence.hasNextPage ? (
        <button
          type="button"
          className="career-button"
          disabled={evidence.isFetchingNextPage}
          onClick={() => void evidence.fetchNextPage()}
        >
          查看更多原句
        </button>
      ) : null}
    </ModalSurface>
  );
}
export { DirectionGraphPage as CurrentJobGraphPage } from './DirectionGraphPage';
export function LegacyCurrentJobGraphPage() {
  const [params, setParams] = useSearchParams();
  const dataset = params.get("dataset") === "private" ? "private" : "public";
  const readScope = useCallback(
    (key: string) => {
      try {
        return JobGraphScopeSchema.parse(JSON.parse(params.get(key) ?? "{}"));
      } catch {
        return JobGraphScopeSchema.parse({});
      }
    },
    [params],
  );
  const scope = useMemo(() => readScope("scope"), [readScope]);
  const comparing = params.has("compare");
  const comparison = useMemo(() => readScope("compare"), [readScope]);
  const [quote, setQuote] = useState<{ scope: JobGraphScope; item: GraphItem } | null>(null);
  const [preparation, setPreparation] = useState<Partial<CreatePlannerItemRequest> | null>(null);
  const [kind, setKind] = useState<GraphItem["kind"] | "all">("all");
  const [showCount, setShowCount] = useState(30);
  const [saveLabel, setSaveLabel] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const client = useQueryClient();
  const graph = useQuery({
    queryKey: [...coreKeys.graph, dataset, scope],
    queryFn: ({ signal }) => getCurrentGraph(scope, signal, dataset),
    refetchInterval: 60000,
  });
  const compare = useQuery({
    queryKey: [...coreKeys.graph, dataset, comparison],
    queryFn: ({ signal }) => getCurrentGraph(comparison, signal, dataset),
    enabled: comparing,
    refetchInterval: comparing ? 60000 : false,
  });
  const searches = useQuery({
    queryKey: coreKeys.searches,
    queryFn: ({ signal }) => getSavedSearches(signal),
    enabled: savedOpen,
  });
  const save = useMutation({
    mutationFn: () => persistSearch(saveLabel.trim(), scope, createIdempotencyKey(), dataset),
    retry: false,
    onSuccess: async () => {
      setSaveOpen(false);
      setSavedOpen(true);
      await client.invalidateQueries({ queryKey: coreKeys.searches });
    },
  });
  const remove = useMutation({
    mutationFn: removeSavedSearch,
    onSuccess: () => client.invalidateQueries({ queryKey: coreKeys.searches }),
  });
  function changeScope(key: string, value: JobGraphScope | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, JSON.stringify(value));
    else next.delete(key);
    setParams(next, { replace: true });
    setShowCount(30);
  }
  const rows = useMemo(() => {
    const a = new Map((graph.data?.items ?? []).map((item) => [item.key, item]));
    const b = new Map(
      (comparing ? (compare.data?.items ?? []) : []).map((item) => [item.key, item]),
    );
    return [...new Set([...a.keys(), ...b.keys()])]
      .map((key) => ({ key, a: a.get(key), b: b.get(key) }))
      .filter((row) => kind === "all" || (row.a ?? row.b)?.kind === kind)
      .sort(
        (left, right) =>
          Math.max(right.a?.companyCoverage ?? 0, right.b?.companyCoverage ?? 0) -
          Math.max(left.a?.companyCoverage ?? 0, left.b?.companyCoverage ?? 0),
      );
  }, [graph.data, compare.data, comparing, kind]);
  function prepare(
    example: Example,
    caseId: string | null,
    reference?: {
      evidenceRevisionId: string | null;
      evidenceIds: string[];
      sourceExperienceIds: string[];
    },
  ) {
    setPreparation({
      ...reference,
      title: `准备：${quote?.item.label ?? example.atom.label}`,
      caseId,
      source:
        example.context === "private"
          ? null
          : {
              jobId: example.jobId,
              jobVersionId: example.jobVersionId,
              key: example.atom.key,
              section: example.atom.section,
              sourceText: example.atom.sourceText,
              start: example.atom.sourceSpan.start,
              end: example.atom.sourceSpan.end,
            },
      note:
        example.context === "private"
          ? `私有 JD 原句：${example.atom.sourceText}\n核对这项要求，关联已有经历或准备产物。`
          : "核对这项要求，关联已有经历，或安排一个能够展示能力的准备产物。",
    });
  }
  return (
    <section className="core-graph-page" aria-labelledby="graph-title">
      <header className="career-page-heading">
        <div>
          <p className="core-eyebrow">从岗位要求，找到准备方向</p>
          <h1 id="graph-title">方向图谱</h1>
          <p>先看企业在做什么、需要什么，再决定自己的下一步。</p>
        </div>
        <nav className="career-job-discovery__modes" aria-label="机会视图">
          <Link to="/jobs">岗位列表</Link>
          <Link className="is-active" aria-current="page" to={`/jobs/insights?${params}`}>
            方向图谱
          </Link>
          <Link to="/jobs/recommended">证据推荐</Link>
        </nav>
      </header>
      <div className="core-graph-toolbar">
        <label>
          岗位集合
          <select
            value={dataset}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              next.set("dataset", event.target.value);
              next.set(
                "scope",
                JSON.stringify({ ...scope, cities: [], recruitmentTypes: [], batch: undefined }),
              );
              next.delete("compare");
              setParams(next);
              setQuote(null);
            }}
          >
            <option value="public">当前官方岗位</option>
            <option value="private">我的私有 JD</option>
          </select>
        </label>
        <button
          type="button"
          className="career-button"
          onClick={() =>
            changeScope(
              "compare",
              comparing ? null : JobGraphScopeSchema.parse({ jobFamily: "operations" }),
            )
          }
        >
          {comparing ? "收起方向对照" : "对照两个方向"}
        </button>
        <button
          type="button"
          className="career-button"
          onClick={() => setSaveOpen((value) => !value)}
        >
          保存当前搜索
        </button>
        <button
          type="button"
          className="career-button"
          onClick={() => setSavedOpen((value) => !value)}
        >
          已保存搜索
        </button>
        <Link to="/applications/planner">我的准备清单</Link>
      </div>
      {saveOpen ? (
        <form
          className="core-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label>
            搜索名称
            <input
              required
              maxLength={120}
              value={saveLabel}
              onChange={(event) => setSaveLabel(event.target.value)}
              placeholder="例如：上海产品实习"
            />
          </label>
          <button
            type="submit"
            className="career-button career-button--primary"
            disabled={save.isPending}
          >
            保存
          </button>
          {save.isError ? <p role="alert">保存失败，请重试。</p> : null}
        </form>
      ) : null}
      {savedOpen ? (
        <section className="core-saved-searches" aria-label="已保存搜索">
          {searches.isPending ? (
            <p>正在读取…</p>
          ) : searches.isError ? (
            <p role="alert">保存的搜索暂时不可用。</p>
          ) : searches.data?.items.length ? (
            searches.data.items.map((item) => (
              <div key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set("scope", JSON.stringify(item.scope));
                    next.set("dataset", item.dataset);
                    next.delete("compare");
                    setParams(next);
                  }}
                >
                  {item.label}
                </button>
                <button
                  type="button"
                  aria-label={`删除搜索${item.label}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(item.id)}
                >
                  删除
                </button>
              </div>
            ))
          ) : (
            <p>保存感兴趣的筛选，之后可以直接回到这个方向。</p>
          )}
          {remove.isError ? <p role="alert">删除失败，请重试。</p> : null}
        </section>
      ) : null}
      <div className={comparing ? "core-graph-scopes comparing" : "core-graph-scopes"}>
        <GraphFilters
          privateDataset={dataset === "private"}
          scope={scope}
          label={comparing ? "方向 A" : "选择岗位范围"}
          onChange={(value) => changeScope("scope", value)}
        />
        {comparing ? (
          <GraphFilters
            privateDataset={dataset === "private"}
            scope={comparison}
            label="方向 B"
            onChange={(value) => changeScope("compare", value)}
          />
        ) : null}
      </div>
      {dataset === "private" ? (
        <p className="core-note">
          私有 JD
          按本人保存的版本分析。城市、招聘类型和批次缺少已确认字段时不推测；企业未说明的条目不计入企业分母。
          <Link to="/applications">管理私有 JD</Link>
        </p>
      ) : null}
      {graph.isPending ? (
        <output className="career-request-state">正在汇总当前岗位…</output>
      ) : graph.isError ? (
        <div role="alert" className="career-inline-error">
          图谱暂时无法读取。
          <button type="button" onClick={() => void graph.refetch()}>
            重新读取
          </button>
        </div>
      ) : graph.data ? (
        <GraphSummary data={graph.data} label={comparing ? "方向 A" : "当前集合"} />
      ) : null}
      {comparing ? (
        compare.isPending ? (
          <output>正在读取方向 B…</output>
        ) : compare.isError ? (
          <p role="alert">方向 B 读取失败，请调整条件或重试。</p>
        ) : compare.data ? (
          <GraphSummary data={compare.data} label="方向 B" />
        ) : null
      ) : null}
      <div className="core-graph-section-head">
        <h2>共同出现的要求与工作内容</h2>
        <label>
          查看
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as typeof kind);
              setShowCount(30);
            }}
          >
            <option value="all">全部内容</option>
            {Object.entries(kindLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="core-note">
        岗位提及率：提及岗位 / 当前岗位总数。企业覆盖率：提及企业 /
        当前企业总数。学历栏呈现适用条件；优先、否定和“或”不会直接计作硬性要求。
      </p>
      <table className="core-graph-table" aria-label="要求的岗位提及率与企业覆盖率">
        <thead>
          <tr className="core-graph-row core-graph-row--head">
            <th scope="col">要求 / 内容</th>
            <th scope="col">{comparing ? "方向 A" : "当前方向"} · 点击查看原句</th>
            {comparing ? <th scope="col">方向 B · 点击查看原句</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, showCount).map((row) => (
            <tr key={row.key} className={`core-graph-row${comparing ? " comparing" : ""}`}>
              <td>
                <strong>{(row.a ?? row.b)?.label}</strong>
                <small>{kindLabels[(row.a ?? row.b)?.kind ?? "task"]}</small>
              </td>
              {(comparing
                ? [
                    { item: row.a, scope },
                    { item: row.b, scope: comparison },
                  ]
                : [{ item: row.a, scope }]
              ).map((cell, index) => (
                <td key={index === 0 ? "a" : "b"}>
                  {cell.item ? (
                    <button
                      className="core-stat-button"
                      type="button"
                      aria-label={`查看${cell.item.label}${comparing ? (index === 0 ? "方向 A" : "方向 B") : ""}原句`}
                      onClick={() => setQuote({ scope: cell.scope, item: cell.item as GraphItem })}
                    >
                      {comparing ? (
                        <small className="core-direction-label">
                          {index === 0 ? "方向 A" : "方向 B"}
                        </small>
                      ) : null}
                      <span>
                        <b>{percent(cell.item.mentionRate)}</b> 岗位提及{" "}
                        <small>{cell.item.jobCount} 岗</small>
                      </span>
                      <meter
                        min={0}
                        max={1}
                        value={cell.item.mentionRate}
                        aria-label="岗位提及率"
                      />
                      <span>
                        <b>{percent(cell.item.companyCoverage)}</b> 企业覆盖{" "}
                        <small>{cell.item.companyCount} 家</small>
                      </span>
                      <meter
                        className="company"
                        min={0}
                        max={1}
                        value={cell.item.companyCoverage}
                        aria-label="企业覆盖率"
                      />
                      <small>
                        明确要求 {cell.item.requiredJobCount} · 优先 {cell.item.preferredJobCount} ·
                        否定 {cell.item.negatedJobCount} · 条件 {cell.item.conditionalJobCount} ·
                        未说明 {cell.item.unknownJobCount}
                      </small>
                    </button>
                  ) : (
                    <span className="core-note">当前集合未提及</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!graph.isPending && !graph.isError && rows.length === 0 ? (
        <div className="career-empty-state">
          <h3>
            {graph.data?.sample.jobCount
              ? "已有岗位，暂未提取出这类共性内容"
              : "这个范围暂无可见岗位"}
          </h3>
          <p>可以放宽筛选，或回岗位列表直接查看原始 JD。</p>
          <Link to="/jobs">查看岗位列表</Link>
        </div>
      ) : null}
      {rows.length > showCount ? (
        <button
          type="button"
          className="career-button"
          onClick={() => setShowCount((value) => value + 30)}
        >
          继续查看 {rows.length - showCount} 项
        </button>
      ) : null}
      {quote ? (
        <QuoteDrawer
          dataset={dataset}
          scope={quote.scope}
          item={quote.item}
          onClose={() => setQuote(null)}
          onPrepare={prepare}
        />
      ) : null}
      {preparation ? (
        <PlannerEditor initial={preparation} onClose={() => setPreparation(null)} />
      ) : null}
    </section>
  );
}
