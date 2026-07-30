import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="state-panel" aria-labelledby="not-found-title">
      <span className="state-panel__icon" aria-hidden="true">
        404
      </span>
      <div>
        <h1 id="not-found-title">没有找到这个页面</h1>
        <p>请检查地址，或回到本地岗位预览继续。</p>
        <Link className="button button--primary" to="/internal-preview/jobs">
          返回岗位列表
        </Link>
      </div>
    </section>
  );
}
