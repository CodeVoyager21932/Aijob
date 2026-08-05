import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { ContextInspector } from "./components/ContextInspector";
import { GlobalSidebar } from "./components/GlobalSidebar";
import { ResizablePane } from "./components/ResizablePane";
import { UtilityBar } from "./components/UtilityBar";
import { getCareerCase } from "./domain";
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
  const peekCase = getCareerCase(peekCaseId ?? undefined);

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

  const closeInspector = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("peek");
    setSearchParams(next);
  };

  return (
    <div
      className={`product-app career-os${preferences.sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
      data-inspector-open={peekCase ? "true" : "false"}
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
          {peekCase ? (
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
                <ContextInspector careerCase={peekCase} onClose={closeInspector} />
              </ResizablePane>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
