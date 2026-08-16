import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The workspace deliberately avoids rendering exception details or response payloads.
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="career-route-state" aria-labelledby="career-route-error-title">
        <p>工作区没有离开</p>
        <h1 id="career-route-error-title">这个页面暂时无法打开</h1>
        <span>当前路径和全局导航仍然保留。你可以重试，或安全返回“今日”。</span>
        <div>
          <button className="career-button career-button--primary" type="button" onClick={() => window.location.reload()}>
            重新加载当前页面
          </button>
          <Link className="career-button career-button--quiet" to="/today">
            返回今日
          </Link>
        </div>
      </section>
    );
  }
}

export function WorkspaceRouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <RouteErrorBoundary key={workspaceRouteBoundaryKey(location)}>{children}</RouteErrorBoundary>;
}

export function workspaceRouteBoundaryKey(location: { pathname: string; search?: string }): string {
  return location.pathname;
}

export function WorkspaceRouteLoading() {
  return (
    <output className="career-route-state career-route-state--loading" aria-live="polite">
      正在打开工作区页面…
    </output>
  );
}
