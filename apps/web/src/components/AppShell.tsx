import type { PropsWithChildren } from "react";
import { Link } from "react-router-dom";

export function AppShell({ children }: PropsWithChildren) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="site-header">
        <div className="shell site-header__inner">
          <Link className="brand" to="/internal-preview/jobs" aria-label="Aijob 本地岗位预览首页">
            <span className="brand__mark" aria-hidden="true">
              A
            </span>
            <span>
              <strong>Aijob</strong>
              <small>官方岗位决策助手</small>
            </span>
          </Link>
          <span className="environment-pill">LOCAL</span>
        </div>
      </header>
      <div className="preview-banner" role="note">
        <div className="shell preview-banner__inner">
          <span className="preview-banner__icon" aria-hidden="true">
            ◇
          </span>
          <span>
            <strong>内部预览：</strong>
            此处岗位用于采集和解析复核，尚未正式发布。
          </span>
        </div>
      </div>
      <main className="shell main-content" id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="shell site-footer">
        岗位申请始终在企业官方页面完成。本站不会自动填写或代替投递。
      </footer>
    </>
  );
}
