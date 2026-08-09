import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { careerOsQueryKeys, getApplicationCase } from "../api/career-os";
import { ProductApiError } from "../api/client";
import { toApplicationCaseView } from "./application-case-view";
import { ContextInspector } from "./components/ContextInspector";
import { ContextInspectorFrame } from "./components/ContextInspector";
import { GlobalSidebar } from "./components/GlobalSidebar";
import { ResizablePane } from "./components/ResizablePane";
import { UtilityBar } from "./components/UtilityBar";
import { readWorkspacePreferences, writeWorkspacePreferences } from "./ui-preferences";
import "./career-os.css";

export function WorkspaceShell() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [preferences, setPreferences] = useState(readWorkspacePreferences);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousPeekRef = useRef<string | null>(null);
  const peekCaseId = location.pathname === "/applications" ? searchParams.get("peek") : null;
  const peekQuery = useQuery({
    queryKey: careerOsQueryKeys.caseDetail(peekCaseId ?? ""),
    queryFn: ({ signal }) => getApplicationCase(peekCaseId ?? "", signal),
    enabled: Boolean(peekCaseId),
    retry: (failureCount, error) =>
      error instanceof ProductApiError && error.status === 404 ? false : failureCount < 1,
  });
  const peekCase = peekQuery.data ? toApplicationCaseView(peekQuery.data) : null;

  useEffect(() => {
    writeWorkspacePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    if (!location.pathname) return;
    setMobileNavigationOpen(false);
    mainRef.current?.focus({ preventScroll: true });
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname]);

  useEffect(() => {
    const previousPeek = previousPeekRef.current;
    if (previousPeek && !peekCaseId && location.pathname === "/applications") {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-case-trigger="${previousPeek}"]`)?.focus({
          preventScroll: true,
        });
      });
    }
    previousPeekRef.current = peekCaseId;
  }, [location.pathname, peekCaseId]);

  useEffect(() => {
    if (!peekCaseId || !(peekQuery.error instanceof ProductApiError)) return;
    if (peekQuery.error.status !== 404) return;
    const next = new URLSearchParams(searchParams);
    next.delete("peek");
    setSearchParams(next, { replace: true });
  }, [peekCaseId, peekQuery.error, searchParams, setSearchParams]);

  const closeInspector = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("peek");
    setSearchParams(next);
  };

  return (
    <div
      className={`product-app career-os${preferences.sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
      data-inspector-open={peekCaseId ? "true" : "false"}
    >
      <a className="skip-link" href="#career-main">
        跳到主要内容
      </a>
      <GlobalSidebar
        collapsed={preferences.sidebarCollapsed}
        mobileOpen={mobileNavigationOpen}
        onCloseMobile={() => setMobileNavigationOpen(false)}
        onToggleCollapsed={() =>
          setPreferences((current) => ({
            ...current,
            sidebarCollapsed: !current.sidebarCollapsed,
          }))
        }
      />
      <div className="career-workspace">
        <UtilityBar onOpenMobileNavigation={() => setMobileNavigationOpen(true)} />
        <div className="career-workspace__body">
          <main ref={mainRef} className="career-main product-main" id="career-main" tabIndex={-1}>
            <Outlet />
          </main>
          {peekCaseId ? (
            <>
              <button
                className="career-inspector-backdrop"
                type="button"
                aria-label="关闭岗位侧览背景"
                onClick={closeInspector}
              />
              <ResizablePane
                width={preferences.inspectorWidth}
                onWidthChange={(inspectorWidth) =>
                  setPreferences((current) => ({ ...current, inspectorWidth }))
                }
              >
                {peekCase ? (
                  <ContextInspector applicationCase={peekCase} onClose={closeInspector} />
                ) : (
                  <ContextInspectorFrame
                    ariaLabel="岗位侧览"
                    eyebrow="求职项目"
                    title={peekQuery.isError ? "侧览暂时不可用" : "正在读取…"}
                    meta="真实 Case 数据"
                    closeLabel="关闭岗位侧览"
                    onClose={closeInspector}
                  >
                    {peekQuery.isError ? (
                      <div className="career-inline-error" role="alert">
                        <span>
                          {peekQuery.error instanceof Error
                            ? peekQuery.error.message
                            : "请关闭后重试。"}
                        </span>
                      </div>
                    ) : (
                      <output className="career-inspector__copy">正在加载固定岗位信息…</output>
                    )}
                  </ContextInspectorFrame>
                )}
              </ResizablePane>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
