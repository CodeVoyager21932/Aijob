import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getSessionStatus } from "../../api/client";
import {
  getWorkspaceBreadcrumbs,
  isDeletionReceiptRoute,
  workspaceNavigation,
} from "../navigation";
import { Icon } from "./Icon";
import { ModalSurface } from "./ModalSurface";

interface UtilityBarProps {
  onOpenMobileNavigation: () => void;
}

export function UtilityBar({ onOpenMobileNavigation }: UtilityBarProps) {
  const location = useLocation();
  const breadcrumbs = getWorkspaceBreadcrumbs(location.pathname);
  const deletionReceiptOnly = isDeletionReceiptRoute(location.pathname);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [utilityPopover, setUtilityPopover] = useState<"notifications" | "account" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionQuery = useQuery({
    queryKey: ["identity", "session"],
    queryFn: ({ signal }) => getSessionStatus(signal),
    enabled: !deletionReceiptOnly,
    staleTime: 30_000,
    retry: 1,
  });

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!document.querySelector("#career-overlay-root [role='dialog']")) openSearch();
      }
      if (event.key === "Escape" && !searchOpen) setUtilityPopover(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch, searchOpen]);

  useEffect(() => {
    if (searchOpen) setQuery("");
  }, [searchOpen]);

  const normalizedQuery = query.trim().toLowerCase();
  const navigationResults = useMemo(
    () => workspaceNavigation.filter((item) => item.label.toLowerCase().includes(normalizedQuery)),
    [normalizedQuery],
  );
  const sessionLabel = deletionReceiptOnly
    ? "删除回执"
    : sessionQuery.isPending
    ? "会话检查中"
    : sessionQuery.isError
      ? "状态未知"
      : !sessionQuery.data.authenticated
        ? "需要验证"
        : sessionQuery.data.owner.retentionMode === "account_managed"
          ? "长期账号"
          : "本机会话";
  const sessionDescription = deletionReceiptOnly
    ? "当前只读取删除回执，不会建立新的 owner 会话。"
    : sessionQuery.isPending
    ? "正在读取当前访问与数据保留状态。"
    : sessionQuery.isError
      ? "当前无法确认会话状态，请刷新后重试。"
      : !sessionQuery.data.authenticated
        ? "当前没有建立可访问的用户会话。"
        : sessionQuery.data.owner.retentionMode === "account_managed"
          ? "职业资产由已验证账号长期管理。"
          : "匿名职业资产按本机保留期限管理。";

  return (
    <>
      <header className="career-utility-bar">
        <div className="career-utility-bar__leading">
          <button
            data-mobile-navigation-trigger
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
            data-command-search-trigger
            className="career-command-trigger"
            type="button"
            aria-label="搜索工作区页面"
            onClick={openSearch}
          >
            <Icon name="search" size={18} />
            <span>搜索工作区页面</span>
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
            </button>
            {utilityPopover === "notifications" ? (
              <output className="career-utility-popover">
                <strong>今天没有新的系统提醒</strong>
                <span>下一步任务请在“今日”中查看。</span>
              </output>
            ) : null}
          </div>
          <div className="career-utility-popover-anchor">
            <button
              className="career-account-button"
              type="button"
              aria-label={`打开会话菜单：${sessionLabel}`}
              aria-expanded={utilityPopover === "account"}
              onClick={() =>
                setUtilityPopover((current) => (current === "account" ? null : "account"))
              }
            >
              <span aria-hidden="true">本</span>
              <strong>{sessionLabel}</strong>
              <Icon name="chevron" size={15} />
            </button>
            {utilityPopover === "account" ? (
              <div className="career-utility-popover career-utility-popover--account">
                <strong>{sessionLabel}</strong>
                <span>{sessionDescription}</span>
                {!deletionReceiptOnly && sessionQuery.data?.authenticated ? (
                  <Link to="/settings/data" onClick={() => setUtilityPopover(null)}>
                    管理个人数据
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {searchOpen ? (
        <ModalSurface
          className="career-command-menu"
          layerClassName="career-modal-layer--command"
          labelledBy="career-command-title"
          initialFocusRef={inputRef}
          closeLabel="关闭全局搜索"
          onClose={closeSearch}
          returnFocus={() => document.querySelector<HTMLElement>("[data-command-search-trigger]")}
        >
          <h2 className="sr-only" id="career-command-title">
            全局搜索
          </h2>
            <label>
              <Icon name="search" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                placeholder="搜索工作区页面"
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd>Esc</kbd>
            </label>
            <div className="career-command-menu__results">
              {navigationResults.length > 0 ? (
                <div>
                  <p>页面</p>
                  {navigationResults.map((item) => (
                    <Link key={item.to} to={item.to} onClick={closeSearch}>
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
              {navigationResults.length === 0 ? (
                <p className="career-command-menu__empty">没有找到对应页面。</p>
              ) : null}
            </div>
        </ModalSurface>
      ) : null}
    </>
  );
}
