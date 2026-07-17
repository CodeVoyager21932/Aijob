import { useQuery } from "@tanstack/react-query";
import { getInternalPreviewJobs } from "../api/jobs";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { JobCard } from "../components/JobCard";
import { toPreviewJobList } from "../domain/jobs";

export function InternalPreviewJobListPage() {
  const query = useQuery({
    queryKey: ["internal-preview", "jobs"],
    queryFn: ({ signal }) => getInternalPreviewJobs(signal),
  });

  if (query.isPending) {
    return (
      <>
        <PageHeading />
        <LoadingState />
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        <PageHeading />
        <ErrorState
          message="岗位 API 暂时不可用，已保存的岗位数据没有被修改。请确认 web-api 已启动后重试。"
          onRetry={() => void query.refetch()}
        />
      </>
    );
  }

  const result = toPreviewJobList(query.data);

  return (
    <>
      <PageHeading
        count={result.items.length}
        isRefreshing={query.isFetching}
        onRefresh={() => void query.refetch()}
      />
      <output className="sr-only" aria-live="polite">
        {query.isFetching ? "正在刷新岗位。" : `已显示 ${result.items.length} 个岗位。`}
      </output>
      {result.items.length === 0 ? (
        <EmptyState onRetry={() => void query.refetch()} />
      ) : (
        <ul className="job-grid" aria-label="内部预览岗位">
          {result.items.map((job) => (
            <li key={job.id}>
              <JobCard job={job} />
            </li>
          ))}
        </ul>
      )}
      {result.nextCursor ? (
        <p className="pagination-note">
          当前仅展示第一批岗位；后续游标已返回，分页操作将在下一切片接入。
        </p>
      ) : null}
    </>
  );
}

interface PageHeadingProps {
  count?: number;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}

function PageHeading({ count, isRefreshing, onRefresh }: PageHeadingProps) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">采集 → 解析 → 数据库 → 前端</p>
        <h1>本地岗位预览</h1>
        <p>查看数据库中的真实岗位、字段缺失和冲突，再决定是否通过发布复核。</p>
      </div>
      {count !== undefined ? (
        <div className="page-heading__actions">
          <span className="result-count">{count} 个岗位</span>
          {onRefresh ? (
            <button
              className="button button--secondary"
              type="button"
              disabled={isRefreshing}
              onClick={onRefresh}
            >
              {isRefreshing ? "刷新中…" : "刷新数据"}
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
