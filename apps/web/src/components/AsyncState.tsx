interface LoadingStateProps {
  label?: string;
  cards?: number;
}

export function LoadingState({ label = "正在读取岗位", cards = 3 }: LoadingStateProps) {
  const skeletonKeys = ["skeleton-first", "skeleton-second", "skeleton-third"];
  return (
    <output className="async-state" aria-live="polite">
      <span className="sr-only">{label}，请稍候。</span>
      <div className="skeleton-grid" aria-hidden="true">
        {skeletonKeys.slice(0, cards).map((key) => (
          <div className="skeleton-card" key={key}>
            <span className="skeleton skeleton--short" />
            <span className="skeleton skeleton--title" />
            <span className="skeleton skeleton--line" />
            <span className="skeleton skeleton--line" />
          </div>
        ))}
      </div>
    </output>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title = "暂时无法读取岗位", message, onRetry }: ErrorStateProps) {
  return (
    <section className="state-panel state-panel--error" role="alert">
      <span className="state-panel__icon" aria-hidden="true">
        !
      </span>
      <div>
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="button-row">
          {onRetry ? (
            <button className="button button--primary" type="button" onClick={onRetry}>
              重新加载
            </button>
          ) : null}
          <a className="button button--secondary" href="/internal-preview/jobs">
            返回岗位列表
          </a>
        </div>
      </div>
    </section>
  );
}

interface EmptyStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function EmptyState({
  title = "数据库里还没有可预览岗位",
  message = "先运行一次来源探测和解析任务，再回到这里刷新。",
  onRetry,
}: EmptyStateProps) {
  return (
    <section className="state-panel" aria-labelledby="empty-state-title">
      <span className="state-panel__icon" aria-hidden="true">
        ○
      </span>
      <div>
        <h1 id="empty-state-title">{title}</h1>
        <p>{message}</p>
        {onRetry ? (
          <button className="button button--primary" type="button" onClick={onRetry}>
            再检查一次
          </button>
        ) : null}
      </div>
    </section>
  );
}
