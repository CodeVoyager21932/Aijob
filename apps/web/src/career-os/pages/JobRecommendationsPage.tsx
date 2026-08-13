import type { JobRecommendationRunView, RecommendationItem } from "@aijob/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createIdempotencyKey, ProductApiError } from "../../api/client";
import { createRecommendationRunFromSearch, getRecommendationRunView } from "../../api/product";
import { formatDateTime } from "../../product/domain";
import { Icon } from "../components/Icon";
import {
  jobDetailPath,
  jobFiltersFromSearchParams,
  jobFiltersToSearchParams,
  recommendationRequestFromFilters,
} from "../job-navigation";

const evidenceLabels: Record<RecommendationItem["evidence"], string> = {
  explicit_evidence: "已有证据",
  partial_evidence: "证据待补充",
  not_in_resume: "证据待补充",
  insufficient_information: "用户尚未确认",
};

const eligibilityLabels: Record<RecommendationItem["eligibility"], string> = {
  no_explicit_conflict: "未发现明确资格冲突",
  needs_information: "资格信息待补充",
  explicit_conflict: "存在明确资格冲突",
};

export function JobRecommendationsPage() {
  const { runId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filters = useMemo(
    () => jobFiltersFromSearchParams(new URLSearchParams(searchParams)),
    [searchParams],
  );
  const commandRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);
  const viewQuery = useQuery({
    queryKey: ["career-os", "recommendation", runId],
    queryFn: ({ signal }) => getRecommendationRunView(runId ?? "", signal),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      ["queued", "processing"].includes(query.state.data?.run.status ?? "") ? 800 : false,
    retry: (failureCount, error) =>
      error instanceof ProductApiError && error.status === 404 ? false : failureCount < 1,
  });
  const createMutation = useMutation({
    mutationFn: () => {
      const request = recommendationRequestFromFilters(filters);
      const signature = JSON.stringify(request);
      if (!commandRef.current || commandRef.current.signature !== signature) {
        commandRef.current = {
          signature,
          idempotencyKey: createIdempotencyKey("career-recommendation"),
        };
      }
      return createRecommendationRunFromSearch(request, commandRef.current.idempotencyKey);
    },
    retry: false,
    onSuccess: (view) => {
      const query = jobFiltersToSearchParams(filters).toString();
      navigate(`/jobs/recommended/${encodeURIComponent(view.run.id)}${query ? `?${query}` : ""}`, {
        replace: false,
      });
    },
  });

  const currentPath = `${location.pathname}${location.search}`;
  const filterQuery = jobFiltersToSearchParams(filters).toString();
  const catalogPath = filterQuery ? `/jobs?${filterQuery}` : "/jobs";

  return (
    <section className="career-recommendations" aria-labelledby="recommendation-title">
      <header className="career-page-heading career-recommendations__heading">
        <div>
          <p>三轴核对</p>
          <h1 id="recommendation-title">证据推荐</h1>
          <span>资格、经历证据与偏好分别判断，不生成匹配百分比，也不隐藏冲突岗位。</span>
        </div>
        <div className="career-recommendations__actions">
          <Link className="career-button career-button--quiet" to={catalogPath}>
            返回岗位目录
          </Link>
          <button
            className="career-button career-button--primary"
            type="button"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Icon name="check" size={16} />
            {createMutation.isPending ? "正在建立推荐…" : runId ? "按当前筛选重新生成" : "生成推荐"}
          </button>
        </div>
      </header>

      <div className="career-recommendations__basis">
        <div>
          <span>岗位范围</span>
          <strong>{filterQuery ? "使用地址中的当前筛选" : "全部当前可信岗位"}</strong>
        </div>
        <div>
          <span>用户资料</span>
          <strong>服务器读取最新已确认修订</strong>
        </div>
        <div>
          <span>排序规则</span>
          <strong>资格 → 完整度 → 偏好 → 证据 → 新鲜度</strong>
        </div>
      </div>

      {createMutation.isError ? (
        <RecommendationError error={createMutation.error} onRetry={() => createMutation.mutate()} />
      ) : null}

      {!runId ? (
        <div className="career-empty-state career-recommendations__empty">
          <Icon name="check" size={30} />
          <strong>基于当前筛选生成一组可复现推荐</strong>
          <p>
            系统会在服务器内固定候选岗位版本和已确认资料修订。刷新、深链或浏览器返回后，仍能恢复同一组依据。
          </p>
          <button type="button" onClick={() => createMutation.mutate()}>
            生成第一组推荐
          </button>
        </div>
      ) : viewQuery.isPending ? (
        <output className="career-request-state">正在读取推荐运行与固定岗位版本…</output>
      ) : viewQuery.isError ? (
        <RecommendationError
          error={viewQuery.error}
          onRetry={() => viewQuery.refetch()}
          notFound={viewQuery.error instanceof ProductApiError && viewQuery.error.status === 404}
        />
      ) : viewQuery.data ? (
        <RecommendationView view={viewQuery.data} currentPath={currentPath} />
      ) : null}
    </section>
  );
}

function RecommendationError({
  error,
  onRetry,
  notFound = false,
}: {
  error: Error;
  onRetry: () => void;
  notFound?: boolean;
}) {
  const profileMissing =
    error instanceof ProductApiError && error.code === "RECOMMENDATION_PROFILE_INCOMPLETE";
  return (
    <div className="career-inline-error" role="alert">
      <strong>
        {notFound
          ? "这组推荐不可读取"
          : profileMissing
            ? "还没有完整的已确认资料"
            : "推荐暂时无法完成"}
      </strong>
      <span>{error.message}</span>
      {profileMissing ? (
        <Link to="/resumes/import">准备并确认简历资料</Link>
      ) : !notFound ? (
        <button type="button" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

function RecommendationView({
  view,
  currentPath,
}: {
  view: JobRecommendationRunView;
  currentPath: string;
}) {
  if (view.run.status === "queued" || view.run.status === "processing") {
    return <output className="career-request-state">正在逐个核对岗位要求与已确认资料…</output>;
  }
  if (view.run.status !== "succeeded") {
    return (
      <div className="career-inline-error" role="alert">
        <strong>本次推荐没有完成</strong>
        <span>{view.run.failureCode ?? "请确认本机匹配 Worker 正常运行后重新生成。"}</span>
      </div>
    );
  }
  if (view.jobs.length === 0) {
    return (
      <div className="career-empty-state">
        <strong>本次没有生成推荐项</strong>
        <p>候选岗位可能尚未完成 Requirements 拆解，请缩小范围或稍后重试。</p>
      </div>
    );
  }
  const pairs = view.run.items.map((item, index) => ({ item, job: view.jobs[index] }));
  const groups = [
    { key: "explicit_evidence", title: "已有证据", note: "简历中存在已确认经历证据。" },
    { key: "partial", title: "证据待补充", note: "现有经历只覆盖部分要求，或简历暂未体现。" },
    { key: "unconfirmed", title: "用户尚未确认", note: "资料或岗位字段不足，系统不作符合判断。" },
  ] as const;
  return (
    <div className="career-recommendations__results">
      <header>
        <div>
          <p>固定运行 {view.run.id.slice(0, 8)}</p>
          <h2>{view.jobs.length} 个岗位依据</h2>
        </div>
        <span>
          {view.run.catalogState === "current"
            ? "候选版本仍在当前目录"
            : "包含已变化或不可用的历史岗位版本"}
        </span>
      </header>
      {groups.map((group) => {
        const items = pairs.filter(({ item }) =>
          group.key === "explicit_evidence"
            ? item.evidence === "explicit_evidence"
            : group.key === "partial"
              ? item.evidence === "partial_evidence" || item.evidence === "not_in_resume"
              : item.evidence === "insufficient_information",
        );
        if (items.length === 0) return null;
        return (
          <section className="career-recommendation-group" key={group.key}>
            <header>
              <div>
                <h3>{group.title}</h3>
                <p>{group.note}</p>
              </div>
              <span>{items.length} 个</span>
            </header>
            <ol>
              {items.map(({ item, job }) => {
                if (!job) return null;
                return (
                  <li key={item.publishedJobVersionId}>
                    <article className="career-recommendation-card">
                      <div className="career-recommendation-card__identity">
                        <span className={`is-${group.key}`}>{evidenceLabels[item.evidence]}</span>
                        <h4>
                          <Link to={jobDetailPath(job.publishedJobId, currentPath)}>
                            {job.display.title}
                          </Link>
                        </h4>
                        <p>{job.display.companyName}</p>
                      </div>
                      <dl>
                        <div>
                          <dt>资格</dt>
                          <dd>{eligibilityLabels[item.eligibility]}</dd>
                        </div>
                        <div>
                          <dt>证据</dt>
                          <dd>{evidenceLabels[item.evidence]}</dd>
                        </div>
                        <div>
                          <dt>依据完整度</dt>
                          <dd>
                            {item.basisState === "complete"
                              ? "完整"
                              : item.basisState === "partial"
                                ? "部分完整"
                                : "信息不足"}
                          </dd>
                        </div>
                      </dl>
                      {item.gaps.length > 0 ? (
                        <ul className="career-recommendation-card__gaps">
                          {item.gaps.slice(0, 2).map((gap, index) => (
                            <li key={`${gap.type}-${index}`}>{gap.explanation}</li>
                          ))}
                        </ul>
                      ) : null}
                      <footer>
                        <span>
                          {job.catalogState === "current"
                            ? `核验 ${formatDateTime(job.display.lastVerifiedAt)}`
                            : job.catalogState === "stale"
                              ? "固定版本已不是当前版本"
                              : "固定版本已不可作为当前投递依据"}
                        </span>
                        <Link to={jobDetailPath(job.publishedJobId, currentPath)}>
                          查看岗位 <Icon name="chevron" size={14} />
                        </Link>
                      </footer>
                    </article>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
