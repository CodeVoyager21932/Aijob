import { type PropsWithChildren, useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

const navigation = [
  { to: "/jobs", label: "找岗位" },
  { to: "/insights", label: "岗位洞察" },
  { to: "/resume", label: "简历与画像" },
  { to: "/recommendations", label: "我的推荐" },
  { to: "/data-control", label: "数据控制" },
] as const;

export function ProductShell({ children }: PropsWithChildren) {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!location.pathname) return;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname]);

  return (
    <div className="product-app">
      <a className="skip-link" href="#product-main">
        跳到主要内容
      </a>
      <header className="product-header">
        <div className="product-shell product-header__inner">
          <NavLink className="product-brand" to="/jobs" aria-label="Aijob 岗位首页">
            <span className="product-brand__mark" aria-hidden="true">
              A
            </span>
            <span className="product-brand__wordmark">
              <strong>Aijob</strong>
              <small>向阳生长</small>
            </span>
          </NavLink>
          <nav className="product-nav" aria-label="主要导航">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? "is-active" : undefined)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <span className="environment-pill">
            {import.meta.env.MODE === "alpha" ? "Private Alpha" : "本地 MVP"}
          </span>
        </div>
      </header>
      <aside className="local-notice" role="note">
        <div className="product-shell local-notice__inner">
          <strong>证据优先</strong>
          <span>{import.meta.env.MODE === "alpha" ? "受邀邮箱会话" : "本机匿名会话"}</span>
          <span>未说明保持未知</span>
          <span>投递回到企业官方页面</span>
        </div>
      </aside>
      <main ref={mainRef} className="product-shell product-main" id="product-main" tabIndex={-1}>
        {children ?? <Outlet />}
      </main>
      <footer className="product-shell product-footer">
        Aijob 不代替你投递，也不会用 AI 补写不存在的经历。
      </footer>
    </div>
  );
}
