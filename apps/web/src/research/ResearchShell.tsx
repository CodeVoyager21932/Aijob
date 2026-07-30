import { Link, NavLink, Outlet } from "react-router-dom";
import "./research.css";

export function ResearchShell() {
  return (
    <div className="research-app">
      <a className="skip-link" href="#research-main">
        跳到岗位结果
      </a>
      <header className="research-header">
        <div className="research-shell research-header__inner">
          <Link className="research-brand" to="/research/jobs" aria-label="Aijob 研究原型首页">
            <span className="research-brand__mark" aria-hidden="true">
              A
            </span>
            <span>
              <strong>Aijob</strong>
              <small>官方岗位决策助手</small>
            </span>
          </Link>
          <nav className="research-nav" aria-label="研究原型导航">
            <NavLink to="/research/jobs">找岗位</NavLink>
          </nav>
          <span className="research-mode-pill">研究原型</span>
        </div>
      </header>
      <div className="research-boundary" role="note">
        <div className="research-shell research-boundary__inner">
          这里用于校准搜索与筛选流程，不是公开服务；只有人工确认的岗位才能进入研究目录。
        </div>
      </div>
      <main className="research-shell research-main" id="research-main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="research-shell research-footer">
        岗位申请始终在企业官方页面完成；研究原型不会自动填写或代替投递。
      </footer>
    </div>
  );
}
