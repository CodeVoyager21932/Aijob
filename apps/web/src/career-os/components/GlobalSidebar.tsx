import { useRef } from "react";
import { NavLink } from "react-router-dom";
import { workspaceNavigation } from "../navigation";
import { useMediaQuery } from "../use-media-query";
import { Icon } from "./Icon";
import { ModalSurface } from "./ModalSurface";

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
  const mobile = useMediaQuery("(max-width: 767px)");
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const navigation = (
    <aside
      className={`career-sidebar${collapsed ? " is-collapsed" : ""}${
        mobileOpen ? " is-mobile-open" : ""
      }`}
      aria-label="全局导航"
    >
      {mobile ? (
        <h2 className="sr-only" id="career-mobile-navigation-title">
          全局导航
        </h2>
      ) : null}
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
          {mobile ? (
            <button
              ref={mobileCloseRef}
              className="career-icon-button career-sidebar__mobile-close"
              type="button"
              aria-label="关闭全局导航"
              onClick={onCloseMobile}
            >
              <Icon name="close" />
            </button>
          ) : null}
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
  );

  if (!mobile) return navigation;
  if (!mobileOpen) return null;
  return (
    <ModalSurface
      className="career-modal-surface--navigation"
      layerClassName="career-modal-layer--navigation"
      labelledBy="career-mobile-navigation-title"
      initialFocusRef={mobileCloseRef}
      closeLabel="关闭全局导航"
      onClose={onCloseMobile}
      returnFocus={() => document.querySelector<HTMLElement>("[data-mobile-navigation-trigger]")}
    >
      {navigation}
    </ModalSurface>
  );
}
