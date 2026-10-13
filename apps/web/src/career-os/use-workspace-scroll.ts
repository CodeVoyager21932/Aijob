import { type RefObject, useLayoutEffect } from "react";
import { subscribeToSessionBoundary } from "../api/client";

const positions = new Map<string, number>();
subscribeToSessionBoundary(() => positions.clear());

/** Keep task locations in memory, including while a lazy route or its data is loading. */
export function useWorkspaceScroll(mainRef: RefObject<HTMLElement | null>, route: string) {
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const target = positions.get(route) ?? 0;
    let restoring = true;
    let frame = 0;
    let observed: Element | null = null;
    const remember = () => {
      if (restoring) return;
      positions.delete(route);
      positions.set(route, main.scrollTop);
      if (positions.size > 100) positions.delete(positions.keys().next().value!);
    };
    const stop = () => {
      restoring = false;
      remember();
    };
    const restore = () => {
      if (!restoring) return;
      // Bypass CSS smooth scrolling so returning to a task does not animate past it.
      main.scrollTo({ top: target, behavior: "instant" });
      if (main.scrollHeight - main.clientHeight >= target - 1) stop();
    };
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(restore);
    });
    const watchContent = () => {
      const child = main.firstElementChild;
      if (observed !== child) {
        if (observed) resize.unobserve(observed);
        observed = child;
        if (child) resize.observe(child);
      }
      restore();
    };
    const mutations = new MutationObserver(watchContent);
    mutations.observe(main, { childList: true, subtree: true });
    resize.observe(main);
    main.addEventListener("scroll", remember, { passive: true });
    // A deliberate user action takes priority over delayed restoration.
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
      main.addEventListener(event, stop, { passive: true });
    const timeout = window.setTimeout(stop, 10000);
    main.focus({ preventScroll: true });
    watchContent();
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      main.removeEventListener("scroll", remember);
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
        main.removeEventListener(event, stop);
    };
  }, [mainRef, route]);
}
