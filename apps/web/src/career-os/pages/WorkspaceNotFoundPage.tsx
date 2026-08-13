import { Link, useLocation } from "react-router-dom";

export function WorkspaceNotFoundPage() {
  const location = useLocation();

  return (
    <section className="career-route-state" aria-labelledby="career-not-found-title">
      <p>404 · 工作区路径不存在</p>
      <h1 id="career-not-found-title">这里没有对应页面</h1>
      <span>
        路径 <code>{location.pathname}</code> 没有匹配到 Aijob 页面，导航和当前会话仍然保留。
      </span>
      <div>
        <Link className="career-button career-button--primary" to="/today">
          返回今日
        </Link>
        <Link className="career-button career-button--quiet" to="/jobs">
          查看岗位
        </Link>
        <Link className="career-button career-button--quiet" to="/applications">
          查看申请
        </Link>
      </div>
    </section>
  );
}
