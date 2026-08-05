import { type CSSProperties, type PointerEvent, type ReactNode, useCallback } from "react";
import { clampInspectorWidth } from "../ui-preferences";

interface ResizablePaneProps {
  width: number;
  onWidthChange: (width: number) => void;
  children: ReactNode;
}

export function ResizablePane({ width, onWidthChange, children }: ResizablePaneProps) {
  const startResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;

      const move = (moveEvent: globalThis.PointerEvent) => {
        onWidthChange(clampInspectorWidth(startWidth + startX - moveEvent.clientX));
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop, { once: true });
    },
    [onWidthChange, width],
  );

  return (
    <div
      className="career-resizable-pane"
      style={{ "--career-inspector-width": `${width}px` } as CSSProperties}
    >
      <div
        className="career-resize-handle"
        role="separator"
        aria-label="调整右侧检查器宽度"
        aria-orientation="vertical"
        aria-valuemin={312}
        aria-valuemax={460}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onWidthChange(clampInspectorWidth(width + 16));
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            onWidthChange(clampInspectorWidth(width - 16));
          }
        }}
      />
      {children}
    </div>
  );
}
