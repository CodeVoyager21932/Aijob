import type { ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface InertRecord {
  count: number;
  inert: boolean;
  ariaHidden: string | null;
}

const inertRecords = new Map<HTMLElement, InertRecord>();
const modalStack: symbol[] = [];
let scrollLockCount = 0;
let previousBodyOverflow = "";

function setWorkspaceInert(host: HTMLElement, inert: boolean) {
  const workspace = host.closest<HTMLElement>(".career-os");
  const siblings = workspace
    ? Array.from(workspace.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement && child !== host,
      )
    : [];

  for (const element of siblings) {
    const current = inertRecords.get(element);
    if (inert) {
      if (current) {
        current.count += 1;
        continue;
      }
      inertRecords.set(element, {
        count: 1,
        inert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden"),
      });
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
      continue;
    }
    if (!current) continue;
    current.count -= 1;
    if (current.count > 0) continue;
    element.inert = current.inert;
    if (current.ariaHidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", current.ariaHidden);
    inertRecords.delete(element);
  }
}

function lockDocumentScroll(lock: boolean) {
  if (lock) {
    if (scrollLockCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    scrollLockCount += 1;
    return;
  }
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) document.body.style.overflow = previousBodyOverflow;
}

function focusableElements(surface: HTMLElement): HTMLElement[] {
  return Array.from(surface.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    const style = window.getComputedStyle(element);
    return (
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  });
}

export interface ModalSurfaceProps {
  children: ReactNode;
  className?: string;
  layerClassName?: string;
  ariaLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocus?: () => HTMLElement | null;
  dismissible?: boolean;
  closeLabel: string;
  onClose: () => void;
}

export function ModalSurface({
  children,
  className,
  layerClassName,
  ariaLabel,
  labelledBy,
  describedBy,
  initialFocusRef,
  returnFocus,
  dismissible = true,
  closeLabel,
  onClose,
}: ModalSurfaceProps) {
  const [host, setHost] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.getElementById("career-overlay-root"),
  );
  const surfaceRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef(returnFocus);
  const dismissibleRef = useRef(dismissible);
  const modalIdRef = useRef(Symbol("career-modal"));

  useEffect(() => {
    onCloseRef.current = onClose;
    returnFocusRef.current = returnFocus;
    dismissibleRef.current = dismissible;
  }, [dismissible, onClose, returnFocus]);

  useEffect(() => {
    if (!host) setHost(document.getElementById("career-overlay-root"));
  }, [host]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!host || !surface) return;

    const modalId = modalIdRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalStack.push(modalId);
    setWorkspaceInert(host, true);
    lockDocumentScroll(true);

    const focusInside = () => {
      const requested = initialFocusRef?.current;
      const target =
        requested && surface.contains(requested)
          ? requested
          : (focusableElements(surface)[0] ?? surface);
      target.focus({ preventScroll: true });
    };
    const focusFrame = window.requestAnimationFrame(focusInside);
    const observer = new MutationObserver(() => {
      if (modalStack.at(-1) !== modalId || surface.contains(document.activeElement)) return;
      window.requestAnimationFrame(focusInside);
    });
    observer.observe(surface, { childList: true, subtree: true });

    const onFocusIn = (event: FocusEvent) => {
      if (modalStack.at(-1) !== modalId || surface.contains(event.target as Node)) return;
      focusInside();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== modalId) return;
      if (event.key === "Escape" && dismissibleRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(surface);
      if (focusable.length === 0) {
        event.preventDefault();
        surface.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !surface.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (active === last || !surface.contains(active))) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      const stackIndex = modalStack.lastIndexOf(modalId);
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1);
      setWorkspaceInert(host, false);
      lockDocumentScroll(false);
      const explicitReturn = returnFocusRef.current?.();
      const target =
        (explicitReturn?.isConnected ? explicitReturn : null) ??
        (previousFocus?.isConnected ? previousFocus : null) ??
        document.querySelector<HTMLElement>(".career-os h1") ??
        document.getElementById("career-main");
      window.requestAnimationFrame(() => target?.focus({ preventScroll: true }));
    };
  }, [host, initialFocusRef]);

  const surface = (
    <section
      ref={surfaceRef}
      className={`career-modal-surface${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      tabIndex={-1}
    >
      {children}
    </section>
  );

  if (!host) return typeof document === "undefined" ? surface : null;

  return createPortal(
    <div className={`career-modal-layer${layerClassName ? ` ${layerClassName}` : ""}`}>
      <button
        className="career-modal-backdrop"
        type="button"
        tabIndex={-1}
        aria-label={closeLabel}
        disabled={!dismissible}
        onClick={() => {
          if (modalStack.at(-1) === modalIdRef.current && dismissibleRef.current) {
            onCloseRef.current();
          }
        }}
      />
      {surface}
    </div>,
    host,
  );
}
