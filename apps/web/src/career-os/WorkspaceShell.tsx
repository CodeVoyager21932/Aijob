import { useQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { careerOsQueryKeys, getApplicationCase } from "../api/career-os";
import { ProductApiError } from "../api/client";
import { AlphaAccessGate } from "../components/AlphaAccessGate";
import { toApplicationCaseView } from "./application-case-view";
import { ContextInspector, ContextInspectorFrame } from "./components/ContextInspector";
import { GlobalSidebar } from "./components/GlobalSidebar";
import { ModalSurface } from "./components/ModalSurface";
import { ResizablePane } from "./components/ResizablePane";
import { UtilityBar } from "./components/UtilityBar";
import { WorkspaceRouteBoundary, WorkspaceRouteLoading } from "./components/WorkspaceRouteBoundary";
import { readWorkspacePreferences, writeWorkspacePreferences } from "./ui-preferences";
import { useMediaQuery } from "./use-media-query";
import "./career-os.css";

export function WorkspaceShell({ accessRequired = false }: { accessRequired?: boolean }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [preferences, setPreferences] = useState(readWorkspacePreferences);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [accessGranted, setAccessGranted] = useState(!accessRequired);
  const [inspectorMutationPending, setInspectorMutationPending] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const inspectorCloseRef = useRef<HTMLButtonElement>(null);
  const previousPeekRef = useRef<string | null>(null);
  const peekCaseId = location.pathname === "/applications" ? searchParams.get("peek") : null;
  const inspectorIsOverlay = useMediaQuery("(max-width: 1439px)");
  const peekQuery = useQuery({
    queryKey: careerOsQueryKeys.caseDetail(peekCaseId ?? ""),
    queryFn: ({ signal }) => getApplicationCase(peekCaseId ?? "", signal),
    enabled: Boolean(peekCaseId && accessGranted),
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
    setInspectorMutationPending(false);
  }, [location.pathname, peekCaseId]);

  const closeInspector = () => {
    if (inspectorMutationPending) return;
    const next = new URLSearchParams(searchParams);
    next.delete("peek");
    setSearchParams(next);
  };
  const showInspector = Boolean(peekCaseId && accessGranted);
  const inspectorTitleId = "career-case-inspector-title";
  const peekNotFound = peekQuery.error instanceof ProductApiError && peekQuery.error.status === 404;
  const inspectorContent = peekCase ? (
    <ContextInspector
      applicationCase={peekCase}
      onClose={closeInspector}
      titleId={inspectorTitleId}
      closeButtonRef={inspectorCloseRef}
      onMutationPendingChange={setInspectorMutationPending}
    />
  ) : (
    <ContextInspectorFrame
      ariaLabel="岗位侧览"
      eyebrow="求职项目"
      title={peekQuery.isError ? "侧览暂时不可用" : "正在读取…"}
      titleId={inspectorTitleId}
      meta="真实 Case 数据"
      closeLabel="关闭岗位侧览"
      closeButtonRef={inspectorCloseRef}
      onClose={closeInspector}
    >
      {peekQuery.isError ? (
        <div className="career-inline-error" role="alert">
          <strong>{peekNotFound ? "没有找到该求职项目" : "侧览暂时无法读取"}</strong>
          <span>
            {peekNotFound
              ? "记录不存在、已删除或不属于当前账户。你可以关闭侧览并继续查看当前集合。"
              : peekQuery.error instanceof Error
                ? peekQuery.error.message
                : "请关闭后重试。"}
          </span>
          {!peekNotFound ? (
            <button type="button" onClick={() => void peekQuery.refetch()}>
              重新读取
            </button>
          ) : null}
        </div>
      ) : (
        <output className="career-inspector__copy">正在加载固定岗位信息…</output>
      )}
    </ContextInspectorFrame>
  );

  return (
    <div
      className={`product-app career-os${preferences.sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
      data-inspector-open={showInspector ? "true" : "false"}
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
            <AlphaAccessGate
              enabled={accessRequired}
              variant="workspace"
              onAccessChange={setAccessGranted}
            >
              <WorkspaceRouteBoundary>
                <Suspense fallback={<WorkspaceRouteLoading />}>
                  <Outlet />
                </Suspense>
              </WorkspaceRouteBoundary>
            </AlphaAccessGate>
          </main>
          {showInspector && !inspectorIsOverlay ? (
            <ResizablePane
              width={preferences.inspectorWidth}
              onWidthChange={(inspectorWidth) =>
                setPreferences((current) => ({ ...current, inspectorWidth }))
              }
            >
              {inspectorContent}
            </ResizablePane>
          ) : null}
        </div>
      </div>
      <div id="career-overlay-root" className="career-overlay-root" />
      {showInspector && inspectorIsOverlay ? (
        <ModalSurface
          className="career-modal-surface--inspector"
          layerClassName="career-modal-layer--inspector"
          labelledBy={inspectorTitleId}
          initialFocusRef={inspectorCloseRef}
          closeLabel="关闭岗位侧览"
          dismissible={!inspectorMutationPending}
          onClose={closeInspector}
          returnFocus={() =>
            peekCaseId
              ? document.querySelector<HTMLElement>(
                  `[data-case-trigger="${CSS.escape(peekCaseId)}"]`,
                )
              : null
          }
        >
          {inspectorContent}
        </ModalSurface>
      ) : null}
    </div>
  );
}
