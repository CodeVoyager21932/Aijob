import { type PropsWithChildren, useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

const navigation = [
  { to: "/jobs", label: "找岗位" },
  { to: "/resume", label: "简历与画像" },
  { to: "/recommendations", label: "我的推荐" },
  { to: "/data-control", label: "数据控制" },
] as const;

export function ProductShell({ children }: PropsWithChildren) {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!location.pathname) return;
    mainRef.current?.focus();
  }, [location.pathname]);

  return (
    <>
      <a className="skip-link" href="#product-main">
        跳到主要内容
      </a>
      <header className="product-header">
        <div className="product-shell product-header__inner">
          <NavLink className="product-brand" to="/jobs" aria-label="Aijob 岗位首页">
            <span aria-hidden="true">A</span>
            <strong>Aijob</strong>
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
          <span className="environment-pill">本地 MVP</span>
        </div>
      </header>
      <aside className="local-notice" role="note">
        <div className="product-shell">
          本机匿名会话 · 未说明的岗位条件保持未知 · 投递始终在企业官方页面完成
        </div>
      </aside>
      <main ref={mainRef} className="product-shell product-main" id="product-main" tabIndex={-1}>
        {children ?? <Outlet />}
      </main>
      <footer className="product-shell product-footer">
        Aijob 不代替你投递，也不会用 AI 补写不存在的经历。
      </footer>
    </>
  );
}
