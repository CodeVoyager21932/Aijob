import {
  GRAPH_GROUPS,
  JOB_DIRECTIONS,
  JOB_FAMILY_NAMES,
  JobGraphScopeSchema,
  type GraphItemV2,
  type GraphV2,
  type GraphExampleV2,
  type JobGraphScope,
  type CreatePlannerItemRequest,
  resumeRichPlain,
} from "@aijob/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  compareExperienceV2,
  directionsV2,
  graphEvidenceV2,
  graphV2,
  graphV2Key,
  type GraphDataset,
} from "../../api/job-graph-v2";
import { createIdempotencyKey } from "../../api/client";
import {
  coreKeys,
  getSavedSearches,
  persistSearch,
  removeSavedSearch,
} from "../../api/product-core";
import { createStudio, getExperiences } from "../../api/resume-studio";
import { formatDateTime } from "../../product/domain";
import { BookmarkButton } from "../components/BookmarkButton";
import { ModalSurface } from "../components/ModalSurface";
import { PlannerEditor } from "../components/PlannerEditor";
import "../product-core.css";
import "../direction-graph.css";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const recruitmentLabel: Record<string, string> = { internship: '实习', campus: '校招', new_grad: '应届', management_trainee: '管培', unknown: '未说明' };
function scopeFrom(value: string | null) {
  try {
    return JobGraphScopeSchema.parse(JSON.parse(value ?? "{}"));
  } catch {
    return JobGraphScopeSchema.parse({});
  }
}
function label(scope: JobGraphScope) {
  return (
    JOB_DIRECTIONS.find((d) => d.id === scope.subrole)?.label ??
    (scope.subrole === "__general__"
      ? "未细分方向"
      : scope.jobFamily === "unclassified"
        ? "尚未分类的岗位"
        : scope.jobFamily
          ? JOB_FAMILY_NAMES[scope.jobFamily]
          : "选择方向")
  );
}
function condition(item: GraphItemV2) {
  return item.dutyJobCount
    ? `${item.dutyJobCount} 岗工作涉及`
    : item.requiredJobCount
      ? `${item.requiredJobCount} 岗明确要求`
      : item.preferredJobCount
        ? `${item.preferredJobCount} 岗作为加分项`
        : item.negatedJobCount && !item.jobCount
          ? `${item.negatedJobCount} 岗明确不要求`
          : "查看表述与条件";
}

function RangeFilters({
  scope,
  dataset,
  change,
}: {
  scope: JobGraphScope;
  dataset: GraphDataset;
  change: (value: JobGraphScope) => void;
}) {
  const [city, setCity] = useState(scope.cities.join("，")),
    [batch, setBatch] = useState(scope.batch ?? "");
  useEffect(() => {
    setCity(scope.cities.join("，"));
    setBatch(scope.batch ?? "");
  }, [scope]);
  return (
    <details className="dg-filters">
      <summary>
        范围筛选{" "}
        <span>
          {scope.cities.join("、") || "全部城市"} · {scope.educationLevels.join("、") || "全部学历"}
          {scope.batch ? ` · ${scope.batch}` : ""}
        </span>
      </summary>
      <div className="dg-filter-fields">
        <label>
          城市
          <input
            value={city}
            placeholder="例如 上海，杭州"
            disabled={dataset === "private"}
            onChange={(e) => setCity(e.target.value)}
            onBlur={() =>
              change({
                ...scope,
                cities: city
                  .split(/[,，]/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 20),
              })
            }
          />
        </label>
        <label>
          招聘类型
          <select
            value={scope.recruitmentTypes[0] ?? ""}
            disabled={dataset === "private"}
            onChange={(e) =>
              change({
                ...scope,
                recruitmentTypes: e.target.value
                  ? [e.target.value as JobGraphScope["recruitmentTypes"][number]]
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
          学历表述
          <select
            value={scope.educationLevels[0] ?? ""}
            onChange={(e) =>
              change({
                ...scope,
                educationLevels: e.target.value
                  ? [e.target.value as JobGraphScope["educationLevels"][number]]
                  : [],
              })
            }
          >
            <option value="">全部学历</option>
            {["大专", "本科", "硕士", "博士"].map((s) => (
              <option key={s}>{s}</option>
            ))}
            <option value="unknown">未说明</option>
          </select>
        </label>
        <label>
          招聘批次
          <input
            value={batch}
            placeholder="全部批次"
            disabled={dataset === "private"}
            onChange={(e) => setBatch(e.target.value)}
            onBlur={() => change({ ...scope, batch: batch.trim() || undefined })}
          />
        </label>
      </div>
      <small>只按你选择的条件筛选。学历表述包含优先和可选条件，具体限制请看原句。</small>
    </details>
  );
}
function Sample({ data }: { data: GraphV2 }) {
  return (
    <div className="dg-sample">
      <strong>
        {data.sample.jobCount} <small>个岗位</small>
      </strong>
      <span>{data.sample.companyCount} 家企业</span>
      <span>
        已处理 {data.sample.parsedJobCount} 岗 · {pct(data.sample.parseCoverage)}
      </span>
      <details>
        <summary>样本说明与核验范围</summary>
        <p>
          {data.dataset === "private"
            ? "来自自己的私有 JD，未进行官网核验。"
            : data.sample.firstVerifiedAt
              ? `${formatDateTime(data.sample.firstVerifiedAt)} — ${formatDateTime(data.sample.lastVerifiedAt ?? data.sample.firstVerifiedAt)}`
              : "暂无核验记录"}
        </p>
        <p>
          保留每家企业的全部岗位；已处理不代表所有语义都已正确识别。频率描述当前集合，不能代表整个招聘市场。
        </p>
        {data.sample.jobCount < 10 && <p>当前样本较少，可以先阅读具体原句。</p>}
      </details>
    </div>
  );
}
function Concept({
  item,
  onOpen,
  compact = false,
}: {
  item: GraphItemV2;
  onOpen: (item: GraphItemV2) => void;
  compact?: boolean;
}) {
  return (
    <article className={`dg-concept${compact ? " dg-concept--child" : ""}`}>
      <button type="button" className="dg-concept-open" onClick={() => onOpen(item)}>
        <span>
          <strong>{item.label}</strong>
          <small>{condition(item)}</small>
        </span>
        <span>
          {item.jobCount} 岗 · {item.companyCount} 家 <b aria-hidden="true">↗</b>
        </span>
      </button>
      {!compact && item.examples[0] && (
        <p className="dg-excerpt">{item.examples[0].atom.clauseText}</p>
      )}
      {!compact && (
        <details className="dg-numbers">
          <summary>统计细节</summary>
          <p>
            岗位涉及率 {pct(item.mentionRate)} · 企业覆盖率 {pct(item.companyCoverage)}
          </p>
          <p>
            明确要求 {item.requiredJobCount} · 优先 {item.preferredJobCount} · 条件{" "}
            {item.conditionalJobCount} · 否定 {item.negatedJobCount} · 工作职责 {item.dutyJobCount}
          </p>
          <small>
            同一岗位只计一次。不同表述可以同时存在，各状态不能相加；否定不计入正向涉及率。
          </small>
        </details>
      )}
    </article>
  );
}
function ConceptGroup({
  group,
  open,
}: {
  group: GraphV2["groups"][number];
  open: (item: GraphItemV2) => void;
}) {
  const [all, setAll] = useState(false);
  const keys = new Set(group.items.map((i) => i.key));
  const roots = group.items.filter((i) => !i.parentKeys.some((k) => keys.has(k)));
  const visible = all ? roots : roots.slice(0, group.kind === "task" ? 6 : 4);
  return (
    <section className={`dg-group dg-group--${group.kind}`} aria-label={group.title}>
      <header>
        <div>
          <h2>{group.title}</h2>
          <p>{group.description}</p>
        </div>
        <span>{group.items.length} 项</span>
      </header>
      {!roots.length ? (
        <p className="dg-empty-group">未在当前样本中识别到相关内容。可以从具体岗位继续了解。</p>
      ) : (
        <div className="dg-concepts">
          {visible.map((item) => (
            <div key={item.key}>
              <Concept item={item} onOpen={open} />
              {group.items.some((i) => i.parentKeys.includes(item.key)) && (
                <details className="dg-children">
                  <summary>相关细项</summary>
                  {group.items
                    .filter((i) => i.parentKeys.includes(item.key))
                    .map((i) => (
                      <Concept key={i.key} item={i} onOpen={open} compact />
                    ))}
                </details>
              )}
            </div>
          ))}
        </div>
      )}
      {roots.length > visible.length || all ? (
        <button type="button" className="career-button dg-more" onClick={() => setAll(!all)}>
          {all ? "收起" : `查看全部 ${roots.length} 项`}
        </button>
      ) : null}
    </section>
  );
}
function DirectionOverview({
  scope,
  dataset,
  open,
  compact = false,
}: {
  scope: JobGraphScope;
  dataset: GraphDataset;
  open: (scope: JobGraphScope, item: GraphItemV2) => void;
  compact?: boolean;
}) {
  const query = useQuery({
    queryKey: [...graphV2Key, dataset, scope],
    queryFn: ({ signal }) => graphV2(scope, dataset, signal),
    refetchInterval: 60000,
  });
  if (query.isPending) return <output>正在整理{label(scope)}的工作内容…</output>;
  if (query.isError)
    return (
      <p role="alert">
        暂时无法读取这个方向。
        <button type="button" onClick={() => void query.refetch()}>
          重试
        </button>
      </p>
    );
  const data = query.data;
  return (
    <div className={compact ? "dg-sub-overview" : ""}>
      {compact && <h2>{label(scope)}</h2>}
      <Sample data={data} />
      {!data.sample.jobCount ? (
        <div className="dg-empty">
          <h2>当前范围还没有岗位</h2>
          <p>可以放宽筛选，或换一个方向继续了解。</p>
          <Link to="/jobs">查看岗位目录</Link>
        </div>
      ) : compact ? (
        <div className="dg-compact-items">
          {data.groups
            .filter((g) => ["task", "knowledge", "tool"].includes(g.kind))
            .map((g) => (
              <div key={g.kind}>
                <h3>{g.title}</h3>
                {g.items.slice(0, 4).map((item) => (
                  <Concept key={item.key} item={item} onOpen={(i) => open(scope, i)} compact />
                ))}
              </div>
            ))}
        </div>
      ) : (
        <div className="dg-groups">
          {data.groups.map((g) => (
            <ConceptGroup key={g.kind} group={g} open={(i) => open(scope, i)} />
          ))}
        </div>
      )}
    </div>
  );
}
function Comparison({
  a,
  b,
  dataset,
  open,
}: {
  a: JobGraphScope;
  b: JobGraphScope;
  dataset: GraphDataset;
  open: (scope: JobGraphScope, item: GraphItemV2) => void;
}) {
  const left = useQuery({
    queryKey: [...graphV2Key, dataset, a],
    queryFn: ({ signal }) => graphV2(a, dataset, signal),
    refetchInterval: 60000,
  });
  const right = useQuery({
    queryKey: [...graphV2Key, dataset, b],
    queryFn: ({ signal }) => graphV2(b, dataset, signal),
    refetchInterval: 60000,
  });
  if (left.isPending || right.isPending) return <output>正在对齐两个方向…</output>;
  if (!left.data || !right.data)
    return (
      <p role="alert">
        对照暂时不可用。
        <button
          type="button"
          onClick={() => {
            void left.refetch();
            void right.refetch();
          }}
        >
          重试
        </button>
      </p>
    );
  const aa = new Map(left.data.groups.flatMap((g) => g.items).map((i) => [i.key, i])),
    bb = new Map(right.data.groups.flatMap((g) => g.items).map((i) => [i.key, i]));
  const rows = [...new Set([...aa.keys(), ...bb.keys()])].map((key) => ({
    key,
    a: aa.get(key),
    b: bb.get(key),
  }));
  const sets = [
    {
      name: "共同内容",
      rows: rows.filter((r) => r.a?.jobCount && r.b?.jobCount && r.a.kind !== "qualification"),
    },
    {
      name: `${label(a)}更常出现的内容`,
      rows: rows.filter((r) => r.a?.jobCount && r.a.mentionRate > (r.b?.mentionRate ?? 0) && r.a.kind !== "qualification").sort((x,y) => ((y.a?.mentionRate ?? 0)-(y.b?.mentionRate ?? 0))-((x.a?.mentionRate ?? 0)-(x.b?.mentionRate ?? 0))),
    },
    {
      name: `${label(b)}更常出现的内容`,
      rows: rows.filter((r) => r.b?.jobCount && r.b.mentionRate > (r.a?.mentionRate ?? 0) && r.b.kind !== "qualification").sort((x,y) => ((y.b?.mentionRate ?? 0)-(y.a?.mentionRate ?? 0))-((x.b?.mentionRate ?? 0)-(x.a?.mentionRate ?? 0))),
    },
    { name: "申请条件差异", rows: rows.filter((r) => (r.a ?? r.b)?.kind === "qualification") },
  ];
  return (
    <div className="dg-comparison">
      <div className="dg-compare-samples">
        <section>
          <h2>{label(a)}</h2>
          <p>{a.cities.join('、') || '全部城市'} · {a.recruitmentTypes.map(t => recruitmentLabel[t] ?? t).join('、') || '全部类型'} · {a.educationLevels.join('、') || '全部学历'} · {a.batch || '全部批次'}</p>
          <Sample data={left.data} />
        </section>
        <section>
          <h2>{label(b)}</h2>
          <p>{b.cities.join('、') || '全部城市'} · {b.recruitmentTypes.map(t => recruitmentLabel[t] ?? t).join('、') || '全部类型'} · {b.educationLevels.join('、') || '全部学历'} · {b.batch || '全部批次'}</p>
          <Sample data={right.data} />
        </section>
      </div>
      <p>两侧使用各自的岗位和企业作为分母。某侧没有识别到，不代表该方向不需要。</p>
      {sets.map((set) => (
        <section key={set.name}>
          <h2>{set.name}</h2>
          {!set.rows.length ? (
            <p>当前样本没有识别到可对照的条目。</p>
          ) : (
            <div className="dg-compare-rows">
              {set.rows.map((r) => (
                <div className="dg-compare-row" key={r.key}>
                  <strong>
                    {(r.a ?? r.b)!.label}
                    <small>{GRAPH_GROUPS.find((g) => g.kind === (r.a ?? r.b)!.kind)?.title}</small>
                  </strong>
                  {(
                    [
                      ["a", a],
                      ["b", b],
                    ] as const
                  ).map(([side, scope]) =>
                    r[side]?.jobCount ? (
                      <button type="button" key={side} onClick={() => open(scope, r[side]!)}>
                        <b>{pct(r[side]!.mentionRate)}</b>
                        <span>
                          {r[side]!.jobCount} 岗 / {r[side]!.companyCount} 家
                        </span>
                        <small>企业覆盖 {pct(r[side]!.companyCoverage)} · 看原句 ↗</small>
                      </button>
                    ) : (
                      <span key={side}>未在当前样本中识别到</span>
                    ),
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
function Evidence({
  scope,
  item,
  dataset,
  close,
  prepare,
}: {
  scope: JobGraphScope;
  item: GraphItemV2;
  dataset: GraphDataset;
  close: () => void;
  prepare: (example: GraphExampleV2, ids: string[]) => void;
}) {
  const [ids, setIds] = useState<string[]>([]),
    navigate = useNavigate();
  const query = useInfiniteQuery({
    queryKey: [...graphV2Key, "evidence", dataset, scope, item.key],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      graphEvidenceV2(scope, dataset, item.key, pageParam, signal),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  const match = useMutation({ mutationFn: () => compareExperienceV2(scope, dataset, item.key) });
  const [showLibrary, setShowLibrary] = useState(false);
  const library = useQuery({ queryKey: ['career-os', 'experiences'], queryFn: getExperiences, enabled: showLibrary });
  const candidates = showLibrary ? library.data?.items.map(c => ({ experienceId: c.id, title: c.title, statement: resumeRichPlain(c.entry.body) })) : match.data?.candidates;
  const resume = useMutation({
    mutationFn: () => createStudio({ title: `${label(scope)} · 方向简历`, experienceIds: ids }),
    onSuccess: (draft) => {
      close();
      navigate(`/resumes/${draft.documentId}`);
    },
  });
  return (
    <ModalSurface
      className="core-quote-drawer dg-evidence"
      ariaLabel={`${item.label}的岗位原句`}
      closeLabel="关闭原句"
      onClose={close}
    >
      <header>
        <button type="button" className="career-button" onClick={close}>
          返回图谱
        </button>
        <p className="core-eyebrow">
          {label(scope)} · {GRAPH_GROUPS.find((g) => g.kind === item.kind)?.title}
        </p>
        <h2>{item.label}</h2>
        <p>
          {item.jobCount} 个岗位涉及 · {item.companyCount} 家企业
        </p>
      </header>
      <section className="dg-personal">
        <h3>把要求连到自己的经历</h3>
        <p>关联一段完整经历，继续准备或整理为简历表达。</p>
        <button
          type="button"
          className="career-button"
          onClick={() => { setShowLibrary(false); match.mutate(); }}
          disabled={match.isPending}
        >
          {match.isPending ? "正在查看…" : "查看我的相关经历"}
        </button>
        <button type="button" className="career-button" onClick={() => setShowLibrary(true)}>从全部经历选择</button>
        {showLibrary && <p>由你选择相关的完整经历，不以系统识别结果限制取用。</p>}
        {showLibrary && library.isPending && <output>正在读取经历…</output>}
        {showLibrary && library.isError && <p role="alert">暂时无法读取经历。<button type="button" onClick={() => void library.refetch()}>重试</button></p>}
        {match.isError && <p role="alert">暂时无法读取经历，可以稍后重试。</p>}
        {candidates?.map(
          (c) =>
            c.experienceId && (
              <label className="dg-experience" key={c.experienceId}>
                <input
                  type="checkbox"
                  checked={ids.includes(c.experienceId)}
                  onChange={(e) =>
                    setIds(
                      e.target.checked
                        ? [...ids, c.experienceId!]
                        : ids.filter((id) => id !== c.experienceId),
                    )
                  }
                />
                <span>
                  <strong>{c.title}</strong>
                  <p>{c.statement}</p>
                  <Link to={`/materials?experienceId=${c.experienceId}`}>查看完整经历</Link>
                </span>
              </label>
            ),
        )}
        {candidates && !candidates.length && (
          <p>
            暂未找到直接相关的经历。<Link to="/materials">整理一段经历</Link>
            ，也可以先建立准备事项。
          </p>
        )}
        {!!ids.length && (
          <button
            type="button"
            className="career-button career-button--primary"
            disabled={resume.isPending}
            onClick={() => resume.mutate()}
          >
            用所选经历开始方向简历
          </button>
        )}
        {resume.isError && <p role="alert">创建未成功，经历仍然保留，请重试。</p>}
      </section>
      {query.isPending && <output>读取岗位原句…</output>}
      {query.isError && (
        <p role="alert">
          原句读取失败。
          <button type="button" onClick={() => void query.refetch()}>
            重试
          </button>
        </p>
      )}
      <div className="core-quotes">
        {query.data?.pages
          .flatMap((p) => p.items)
          .map((e, index) => (
            <article
              key={`${e.jobVersionId}-${e.atom.section}-${e.atom.sourceSpan.start}-${index}`}
            >
              <p>{e.companyName}</p>
              <h3>
                <Link
                  to={
                    e.context === "private"
                      ? `/applications/${e.caseId}/requirements`
                      : `/jobs/${e.jobId}`
                  }
                >
                  {e.title}
                </Link>
              </h3>
              <span className="dg-status">
                {e.atom.negated
                  ? "明确不要求 / 不限制"
                  : e.atom.necessity === "preferred"
                    ? "优先 / 加分"
                    : e.atom.choiceGroup?.operator === "any"
                      ? "满足其中一项"
                      : e.atom.condition
                        ? "附带条件"
                        : e.atom.section === "responsibilities"
                          ? "工作职责"
                          : e.atom.necessity === "required"
                            ? "明确要求"
                            : "必要性未说明"}
              </span>
              <blockquote>{e.atom.clauseText}</blockquote>
              <small>
                来自{e.atom.section === "responsibilities" ? "工作职责" : "任职要求"}
                {e.atom.choiceGroup ? ` · ${e.atom.choiceGroup.text}` : ""}
              </small>
              <footer>
                {e.context !== "private" && <BookmarkButton jobId={e.jobId} />}
                <button
                  type="button"
                  className="career-button career-button--primary"
                  onClick={() => prepare(e, ids)}
                >
                  关联经历 / 加入准备
                </button>
              </footer>
            </article>
          ))}
      </div>
      {query.hasNextPage && (
        <button
          type="button"
          className="career-button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          加载更多原句
        </button>
      )}
    </ModalSurface>
  );
}

export function DirectionGraphPage() {
  const [params, setParams] = useSearchParams(),
    client = useQueryClient();
  const scope = useMemo(() => scopeFrom(params.get("scope")), [params]);
  const dataset: GraphDataset = params.get("dataset") === "private" ? "private" : "public";
  const other = useMemo(() => scopeFrom(params.get("compare")), [params]);
  const [search, setSearch] = useState(""),
    [quote, setQuote] = useState<{ scope: JobGraphScope; item: GraphItemV2 } | null>(null),
    [preparation, setPreparation] = useState<Partial<CreatePlannerItemRequest> | null>(null),
    [saved, setSaved] = useState(false),
    [saveName, setSaveName] = useState(""),
    [saveOpen, setSaveOpen] = useState(false);
  const query = useQuery({
    queryKey: [
      ...graphV2Key,
      "directions",
      dataset,
      scope.cities,
      scope.educationLevels,
      scope.recruitmentTypes,
      scope.batch,
    ],
    queryFn: ({ signal }) => directionsV2(scope, dataset, signal),
    refetchInterval: 60000,
  });
  const searches = useQuery({
    queryKey: coreKeys.searches,
    queryFn: ({ signal }) => getSavedSearches(signal),
    enabled: saved,
  });
  const save = useMutation({
    mutationFn: () => persistSearch(saveName.trim(), scope, createIdempotencyKey(), dataset),
    onSuccess: () => {
      setSaveOpen(false);
      void client.invalidateQueries({ queryKey: coreKeys.searches });
    },
  });
  const remove = useMutation({
    mutationFn: removeSavedSearch,
    onSuccess: () => client.invalidateQueries({ queryKey: coreKeys.searches }),
  });
  const change = (key: "scope" | "compare", value: JobGraphScope | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, JSON.stringify(value));
    else next.delete(key);
    next.delete("overview");
    setParams(next);
  };
  const family = query.data?.items.find((i) => i.family === scope.jobFamily);
  const open = (s: JobGraphScope, item: GraphItemV2) => setQuote({ scope: s, item });
  const overview = params.get("overview") === "1";
  const knownSubrole =
    !scope.subrole ||
    scope.subrole === "__general__" ||
    JOB_DIRECTIONS.some((d) => d.id === scope.subrole);
  useEffect(() => {
    if (!knownSubrole) {
      const next = new URLSearchParams(params);
      next.set("scope", JSON.stringify({ ...scope, subrole: undefined }));
      next.set("migrated", "1");
      setParams(next, { replace: true });
    }
  }, [knownSubrole, params, scope, setParams]);
  return (
    <section className="dg-page" aria-labelledby="direction-title">
      <header className="career-page-heading">
        <div>
          <p className="core-eyebrow">看懂工作，再开始准备</p>
          <h1 id="direction-title">方向图谱</h1>
          <p>了解一个方向主要做什么，以及可以从哪里开始。</p>
        </div>
        <Link className="career-button" to="/jobs">
          回到岗位发现
        </Link>
      </header>
      <div className="dg-toolbar">
        <label>
          岗位集合{" "}
          <select
            value={dataset}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              next.set("dataset", e.target.value);
              next.delete("compare");
              next.set(
                "scope",
                JSON.stringify({ ...scope, cities: [], recruitmentTypes: [], batch: undefined }),
              );
              setParams(next);
            }}
          >
            <option value="public">当前官方岗位</option>
            <option value="private">我的私有 JD</option>
          </select>
        </label>
        <button type="button" className="career-button" onClick={() => setSaved(true)}>
          常用筛选
        </button>
        {scope.jobFamily && (
          <button
            type="button"
            className="career-button"
            onClick={() => {
              setSaveName(label(scope));
              setSaveOpen(true);
            }}
          >
            保存这组筛选
          </button>
        )}
        <Link to="/planner">我的准备清单</Link>
      </div>
      {params.get("migrated") && (
        <output>旧链接中的子方向已调整，下面显示当前可用的方向范围。</output>
      )}
      <RangeFilters scope={scope} dataset={dataset} change={(s) => change("scope", s)} />
      <nav className="dg-breadcrumb" aria-label="方向范围">
        <button
          type="button"
          onClick={() => change("scope", { ...scope, jobFamily: undefined, subrole: undefined })}
        >
          全部方向
        </button>
        {scope.jobFamily && (
          <>
            <span>/</span>
            <button type="button" onClick={() => change("scope", { ...scope, subrole: undefined })}>
              {scope.jobFamily === "unclassified" ? "尚未分类" : JOB_FAMILY_NAMES[scope.jobFamily]}
            </button>
          </>
        )}
        {scope.subrole && (
          <>
            <span>/</span>
            <strong>{label(scope)}</strong>
          </>
        )}
      </nav>
      {query.isPending ? (
        <output>正在读取方向…</output>
      ) : query.isError ? (
        <p role="alert">
          方向暂时无法读取。
          <button type="button" onClick={() => void query.refetch()}>
            重试
          </button>
        </p>
      ) : !scope.jobFamily ? (
        <>
          <div className="dg-intro">
            <h2>你想先了解哪个方向？</h2>
            <input
              type="search"
              aria-label="搜索方向"
              placeholder="例如：产品、研究、前端"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="dg-directions">
            {query.data.items
              .filter((i) =>
                `${i.label}${i.children.map((c) => c.label).join("")}`.includes(search.trim()),
              )
              .map((i, index) => (
                <button
                  type="button"
                  className="dg-direction"
                  key={i.family}
                  onClick={() =>
                    change("scope", { ...scope, jobFamily: i.family, subrole: undefined })
                  }
                >
                  <span className="dg-direction-number">{String(index + 1).padStart(2, "0")}</span>
                  <h3>{i.label}</h3>
                  <p>{i.children.map((c) => c.label).join(" · ")}</p>
                  <footer>
                    <strong>{i.jobCount} 个岗位</strong>
                    <span>了解方向 →</span>
                  </footer>
                </button>
              ))}
          </div>
          {!query.data.items.length && (
            <p className="dg-empty">
              当前集合还没有岗位。<Link to="/jobs">查看岗位目录</Link>
            </p>
          )}
        </>
      ) : !scope.subrole && !overview ? (
        <>
          <div className="dg-intro">
            <div>
              <h2>进一步看{label(scope)}里的具体工作</h2>
              <p>这些工作有共同点，也有各自的重点。先选一个子方向更容易看清。</p>
            </div>
            <button
              type="button"
              className="career-button"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("overview", "1");
                setParams(next);
              }}
            >
              按子方向查看整体
            </button>
          </div>
          <div className="dg-directions">
            {family?.children.map((c) => (
              <button
                type="button"
                className="dg-direction"
                key={c.id}
                onClick={() => change("scope", { ...scope, subrole: c.id })}
              >
                <h3>{c.label}</h3>
                <p>{c.jobCount} 个岗位</p>
                <footer>
                  <span>任务 · 知识 · 工具 · 产物</span>
                  <b>→</b>
                </footer>
              </button>
            ))}
          </div>
          {!family?.children.length && (
            <p className="dg-empty">当前筛选没有找到这个方向的岗位，可以放宽范围。</p>
          )}
        </>
      ) : overview ? (
        <div className="dg-family-overview">
          {family?.children.map((c) => (
            <DirectionOverview
              key={c.id}
              scope={{ ...scope, subrole: c.id }}
              dataset={dataset}
              open={open}
              compact
            />
          ))}
        </div>
      ) : (
        <>
          <div className="dg-active-heading">
            <h2>{label(scope)}</h2>
            <label>
              与另一个方向对照{" "}
              <select
                value={params.has("compare") ? `${other.jobFamily}:${other.subrole}` : ""}
                onChange={(e) => {
                  if (!e.target.value) {
                    change("compare", null);
                    return;
                  }
                  const [familyId, subrole] = e.target.value.split(":");
                  change("compare", {
                    ...scope,
                    jobFamily: familyId as JobGraphScope["jobFamily"],
                    subrole,
                  });
                }}
              >
                <option value="">选择对照方向</option>
                {query.data.items.map((f) => (
                  <optgroup key={f.family} label={f.label}>
                    {f.children.map((c) => (
                      <option
                        key={c.id}
                        value={`${f.family}:${c.id}`}
                        disabled={f.family === scope.jobFamily && c.id === scope.subrole}
                      >
                        {c.label} · {c.jobCount} 岗
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
          {params.has("compare") ? (
            <Comparison a={scope} b={other} dataset={dataset} open={open} />
          ) : (
            <DirectionOverview scope={scope} dataset={dataset} open={open} />
          )}
        </>
      )}
      {quote && (
        <Evidence
          {...quote}
          dataset={dataset}
          close={() => setQuote(null)}
          prepare={(e, ids) =>
            setPreparation({
              kind: "preparation",
              title: `准备：${e.atom.label}`,
              caseId: e.caseId ?? null,
              sourceExperienceIds: ids,
              note:
                e.context === "private" ? `私有 JD 原句：${e.atom.clauseText}` : e.atom.clauseText,
              source:
                e.context === "private"
                  ? null
                  : {
                      extractionVersion: "role-semantics-v2",
                      jobId: e.jobId,
                      jobVersionId: e.jobVersionId,
                      key: e.atom.key,
                      section: e.atom.section,
                      sourceText: e.atom.sourceText,
                      start: e.atom.sourceSpan.start,
                      end: e.atom.sourceSpan.end,
                    },
            })
          }
        />
      )}
      {preparation && (
        <PlannerEditor
          initial={preparation}
          onClose={() => setPreparation(null)}
          onSaved={() => setPreparation(null)}
        />
      )}
      {saveOpen && (
        <ModalSurface ariaLabel="保存常用筛选" closeLabel="关闭" onClose={() => setSaveOpen(false)}>
          <h2>给这组筛选起个名字</h2>
          <p>下次应用时会重新查询最新岗位。</p>
          <label>
            筛选名称
            <input value={saveName} maxLength={100} onChange={(e) => setSaveName(e.target.value)} />
          </label>
          <button
            type="button"
            className="career-button career-button--primary"
            disabled={!saveName.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            保存
          </button>
          {save.isError && <p role="alert">保存失败，请重试。</p>}
        </ModalSurface>
      )}
      {saved && (
        <ModalSurface ariaLabel="常用筛选" closeLabel="关闭" onClose={() => setSaved(false)}>
          <h2>常用筛选</h2>
          {searches.isPending ? (
            <p>正在读取…</p>
          ) : searches.isError ? (
            <p role="alert">
              读取失败。
              <button type="button" onClick={() => void searches.refetch()}>
                重试
              </button>
            </p>
          ) : !searches.data?.items.length ? (
            <p>在选好方向与范围后，可以保存常用筛选。</p>
          ) : (
            searches.data.items.map((s) => (
              <div className="dg-saved-row" key={s.id}>
                <button
                  type="button"
                  className="career-button"
                  onClick={() => {
                    const next = new URLSearchParams();
                    next.set("dataset", s.dataset);
                    next.set("scope", JSON.stringify(s.scope));
                    setParams(next);
                    setSaved(false);
                  }}
                >
                  {s.label}
                </button>
                <button
                  type="button"
                  aria-label={`删除筛选 ${s.label}`}
                  onClick={() => remove.mutate(s.id)}
                >
                  删除
                </button>
              </div>
            ))
          )}
          {remove.isError && <p role="alert">删除未成功。</p>}
        </ModalSurface>
      )}
    </section>
  );
}
