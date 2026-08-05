import { NavLink } from "react-router-dom";
import { workspaceNavigation } from "../navigation";
import { Icon } from "./Icon";

interface GlobalSidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
}

export function GlobalSidebar({
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onCloseMobile,
}: GlobalSidebarProps) {
  return (
    <>
      <button
        className={`career-sidebar-backdrop${mobileOpen ? " is-visible" : ""}`}
        type="button"
        aria-label="关闭全局导航"
        tabIndex={mobileOpen ? 0 : -1}
        onClick={onCloseMobile}
      />
      <aside
        className={`career-sidebar${collapsed ? " is-collapsed" : ""}${
          mobileOpen ? " is-mobile-open" : ""
        }`}
        aria-label="全局导航"
      >
        <div className="career-sidebar__brand-row">
          <NavLink className="career-brand" to="/today" aria-label="Aijob" onClick={onCloseMobile}>
            <span className="career-brand__mark" aria-hidden="true">
              A
            </span>
            <span className="career-brand__name">Aijob</span>
          </NavLink>
          <button
            className="career-icon-button career-sidebar__collapse"
            type="button"
            aria-label={collapsed ? "展开全局侧栏" : "收起全局侧栏"}
            aria-pressed={collapsed}
            onClick={onToggleCollapsed}
          >
            <Icon name="collapse" />
          </button>
        </div>

        <nav className="career-sidebar__nav" aria-label="主要导航">
          {workspaceNavigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={item.label}
              onClick={onCloseMobile}
              className={({ isActive }) => (isActive ? "is-active" : undefined)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <NavLink
          className={({ isActive }) => `career-sidebar__settings${isActive ? " is-active" : ""}`}
          to="/settings/data"
          aria-label="数据与设置"
          onClick={onCloseMobile}
        >
          <Icon name="settings" />
          <span>数据与设置</span>
        </NavLink>
      </aside>
    </>
  );
}
