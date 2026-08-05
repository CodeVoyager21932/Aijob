import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { careerCases } from "../domain";
import { getWorkspaceBreadcrumbs, workspaceNavigation } from "../navigation";
import { Icon } from "./Icon";

interface UtilityBarProps {
  onOpenMobileNavigation: () => void;
}

export function UtilityBar({ onOpenMobileNavigation }: UtilityBarProps) {
  const location = useLocation();
  const breadcrumbs = getWorkspaceBreadcrumbs(location.pathname);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [utilityPopover, setUtilityPopover] = useState<"notifications" | "account" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);

  const openSearch = useCallback(() => {
    searchReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : searchTriggerRef.current;
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    window.requestAnimationFrame(() => searchReturnFocusRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
      if (event.key === "Escape") {
        if (searchOpen) closeSearch();
        setUtilityPopover(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSearch, openSearch, searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    setQuery("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [searchOpen]);

  const normalizedQuery = query.trim().toLowerCase();
  const caseResults = useMemo(
    () =>
      careerCases.filter((careerCase) =>
        `${careerCase.companyName}${careerCase.roleTitle}${careerCase.location}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [normalizedQuery],
  );
  const navigationResults = useMemo(
    () => workspaceNavigation.filter((item) => item.label.toLowerCase().includes(normalizedQuery)),
    [normalizedQuery],
  );

  return (
    <>
      <header className="career-utility-bar">
        <div className="career-utility-bar__leading">
          <button
            className="career-icon-button career-mobile-menu"
            type="button"
            aria-label="打开全局导航"
            onClick={onOpenMobileNavigation}
          >
            <Icon name="menu" />
          </button>
          <nav className="career-breadcrumbs" aria-label="面包屑">
            <Link to="/today" aria-label="返回今日">
              <Icon name="home" size={17} />
            </Link>
            {breadcrumbs.map((item, index) => (
              <span key={`${item.label}-${index}`}>
                <span aria-hidden="true">/</span>
                {item.to ? <Link to={item.to}>{item.label}</Link> : <strong>{item.label}</strong>}
              </span>
            ))}
          </nav>
        </div>

        <div className="career-utility-bar__actions">
          <button
            ref={searchTriggerRef}
            className="career-command-trigger"
            type="button"
            aria-label="搜索岗位、求职项目或简历"
            onClick={openSearch}
          >
            <Icon name="search" size={18} />
            <span>搜索岗位、求职项目或简历</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="career-utility-popover-anchor">
            <button
              className="career-icon-button"
              type="button"
              aria-label="查看通知"
              aria-expanded={utilityPopover === "notifications"}
              onClick={() =>
                setUtilityPopover((current) =>
                  current === "notifications" ? null : "notifications",
                )
              }
            >
              <Icon name="bell" />
              <span className="career-notification-dot" aria-hidden="true" />
            </button>
            {utilityPopover === "notifications" ? (
              <output className="career-utility-popover">
                <strong>今天没有新的系统提醒</strong>
                <span>静态项目任务请在“今日”中查看。</span>
              </output>
            ) : null}
          </div>
          <div className="career-utility-popover-anchor">
            <button
              className="career-account-button"
              type="button"
              aria-label="打开本机会话菜单"
              aria-expanded={utilityPopover === "account"}
              onClick={() =>
                setUtilityPopover((current) => (current === "account" ? null : "account"))
              }
            >
              <span aria-hidden="true">本</span>
              <strong>本机会话</strong>
              <Icon name="chevron" size={15} />
            </button>
            {utilityPopover === "account" ? (
              <div className="career-utility-popover career-utility-popover--account">
                <strong>匿名本机会话</strong>
                <span>不收集手机号或邮箱。</span>
                <Link to="/settings/data" onClick={() => setUtilityPopover(null)}>
                  管理个人数据
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {searchOpen ? (
        <div className="career-command-overlay" role="presentation">
          <button
            className="career-command-backdrop"
            type="button"
            aria-label="关闭全局搜索"
            onClick={closeSearch}
          />
          <section
            className="career-command-menu"
            role="dialog"
            aria-modal="true"
            aria-label="全局搜索"
          >
            <label>
              <Icon name="search" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                placeholder="搜索岗位、公司或页面"
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd>Esc</kbd>
            </label>
            <div className="career-command-menu__results">
              {navigationResults.length > 0 ? (
                <div>
                  <p>页面</p>
                  {navigationResults.map((item) => (
                    <Link key={item.to} to={item.to} onClick={() => setSearchOpen(false)}>
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
              {caseResults.length > 0 ? (
                <div>
                  <p>求职项目</p>
                  {caseResults.map((careerCase) => (
                    <Link
                      key={careerCase.id}
                      to={`/applications/${careerCase.id}/overview`}
                      onClick={() => setSearchOpen(false)}
                    >
                      <Icon name="briefcase" />
                      <span>
                        <strong>{careerCase.companyName}</strong>
                        <small>{careerCase.roleTitle}</small>
                      </span>
                    </Link>
                  ))}
                </div>
              ) : null}
              {navigationResults.length === 0 && caseResults.length === 0 ? (
                <p className="career-command-menu__empty">没有找到对应页面或静态求职项目。</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
