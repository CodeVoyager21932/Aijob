import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ModalSurface } from "./ModalSurface";

interface NavigationDestinationLike {
  key?: string;
  url: string;
}

interface NavigateEventLike extends Event {
  canIntercept?: boolean;
  destination: NavigationDestinationLike;
  navigationType?: "push" | "replace" | "reload" | "traverse";
}

interface NavigationLike extends EventTarget {
  traverseTo?: (key: string) => unknown;
}

interface PendingNavigation {
  destinationKey: string | null;
  href: string;
  navigationType: NavigateEventLike["navigationType"];
  returnFocus: HTMLElement | null;
}

function browserNavigation(): NavigationLike | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { navigation?: NavigationLike }).navigation ?? null;
}

function relativeHref(href: string): string {
  const destination = new URL(href, window.location.href);
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

export function shouldGuardResumeNavigation(
  destinationHref: string,
  currentHref: string,
): boolean {
  const current = new URL(currentHref);
  const destination = new URL(destinationHref, current);
  return destination.origin === current.origin && destination.pathname !== current.pathname;
}

function shouldGuardDestination(href: string): boolean {
  return shouldGuardResumeNavigation(href, window.location.href);
}

export function ResumeDraftNavigationGuard({
  active,
  eyebrow = "未保存草稿",
  title = "要离开这份简历吗？",
  description = "当前正文、章节顺序或模板仍有本地修改。离开后这些草稿不会写入服务器。",
  stayLabel = "继续编辑",
  leaveLabel = "放弃草稿并离开",
}: {
  active: boolean;
  eyebrow?: string;
  title?: string;
  description?: string;
  stayLabel?: string;
  leaveLabel?: string;
}) {
  const navigate = useNavigate();
  const leaveButtonRef = useRef<HTMLButtonElement>(null);
  const bypassNextNavigationRef = useRef(false);
  const pendingRef = useRef<PendingNavigation | null>(null);
  const [pending, setPending] = useState<PendingNavigation | null>(null);

  const updatePending = useCallback((next: PendingNavigation | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  useEffect(() => {
    if (!active) {
      updatePending(null);
      return;
    }

    const navigation = browserNavigation();
    if (navigation) {
      const onNavigate = (rawEvent: Event) => {
        const event = rawEvent as NavigateEventLike;
        if (bypassNextNavigationRef.current) {
          bypassNextNavigationRef.current = false;
          return;
        }
        if (
          pendingRef.current ||
          !event.cancelable ||
          event.canIntercept === false ||
          !shouldGuardDestination(event.destination.url)
        ) {
          return;
        }
        event.preventDefault();
        updatePending({
          destinationKey: event.destination.key ?? null,
          href: event.destination.url,
          navigationType: event.navigationType,
          returnFocus:
            document.activeElement instanceof HTMLElement ? document.activeElement : null,
        });
      };
      navigation.addEventListener("navigate", onNavigate);
      return () => navigation.removeEventListener("navigate", onNavigate);
    }

    const onDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        pendingRef.current
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
      if (!shouldGuardDestination(target.href)) return;
      event.preventDefault();
      updatePending({
        destinationKey: null,
        href: target.href,
        navigationType: target.dataset.replace === "true" ? "replace" : "push",
        returnFocus: target,
      });
    };
    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, [active, updatePending]);

  if (!active || !pending) return null;

  const continueNavigation = () => {
    const navigation = browserNavigation();
    bypassNextNavigationRef.current = true;
    updatePending(null);
    if (
      pending.navigationType === "traverse" &&
      pending.destinationKey &&
      navigation?.traverseTo
    ) {
      navigation.traverseTo(pending.destinationKey);
      return;
    }
    navigate(relativeHref(pending.href), { replace: pending.navigationType === "replace" });
  };

  return (
    <ModalSurface
      className="career-resume-draft-guard"
      labelledBy="career-resume-draft-guard-title"
      describedBy="career-resume-draft-guard-description"
      initialFocusRef={leaveButtonRef}
      returnFocus={() => pending.returnFocus}
      closeLabel="继续留在简历工作室"
      onClose={() => updatePending(null)}
    >
      <p>{eyebrow}</p>
      <h2 id="career-resume-draft-guard-title">{title}</h2>
      <p id="career-resume-draft-guard-description">{description}</p>
      <div>
        <button
          className="career-button career-button--quiet"
          type="button"
          onClick={() => updatePending(null)}
        >
          {stayLabel}
        </button>
        <button
          ref={leaveButtonRef}
          className="career-button career-button--danger-quiet"
          type="button"
          onClick={continueNavigation}
        >
          {leaveLabel}
        </button>
      </div>
    </ModalSurface>
  );
}
