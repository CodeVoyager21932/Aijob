import { useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { workspaceNavigationGroups,isWorkspaceItemActive } from "../navigation";
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
  const location=useLocation();
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
          {workspaceNavigationGroups.map((group)=><div className="career-nav-group" key={group.label}>
            {group.label?<p className="career-nav-group__label">{group.label}</p>:null}
            {group.items.map((item)=><NavLink key={item.to} to={item.to} aria-label={item.label} title={collapsed?item.label:undefined} onClick={onCloseMobile} className={()=>isWorkspaceItemActive(item.to,location.pathname)?"is-active":undefined}><Icon name={item.icon}/><span>{item.label}</span>{item.to === "/jobs" || item.to === "/resumes" ? <small className="career-nav-short" aria-hidden="true">{item.to === "/jobs" ? "找岗位" : "简历"}</small> : null}</NavLink>)}
          </div>)}
        </nav>

        <NavLink to="/guides" className="career-sidebar__guide" onClick={onCloseMobile} aria-label="求职指南"><Icon name="book"/><span>求职指南</span></NavLink>
        <NavLink
          className={({ isActive }) => `career-sidebar__settings${isActive ? " is-active" : ""}`}
          to="/settings/data"
          aria-label="资料与设置"
          onClick={onCloseMobile}
        >
          <Icon name="settings" />
          <span>资料与设置</span>
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
