import { type CSSProperties, type ReactNode, useState } from "react";

const key = "aijob:native-editor-width";
const clamp = (value: number) => Math.min(58, Math.max(32, value));
export function NativeSplit({ children }: { children: [ReactNode, ReactNode] }) {
  const [ratio, setRatio] = useState(() => {
    try {
      const value = Number(localStorage.getItem(key));
      return value ? clamp(value) : 46;
    } catch {
      return 46;
    }
  });
  const update = (value: number) => {
    const next = clamp(value);
    setRatio(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      /* Layout preference is optional. */
    }
  };
  return (
    <div className="native-split" style={{ "--native-editor-ratio": `${ratio}%` } as CSSProperties}>
      {children[0]}
      <div
        className="native-split-handle"
        role="separator"
        aria-label="调整编辑与预览宽度"
        aria-orientation="vertical"
        aria-valuemin={32}
        aria-valuemax={58}
        aria-valuenow={Math.round(ratio)}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
          if (bounds?.width) update(((event.clientX - bounds.left) / bounds.width) * 100);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            update(ratio + (event.key === "ArrowRight" ? 2 : -2));
          } else if (event.key === "Home") {
            event.preventDefault();
            update(46);
          }
        }}
      />
      {children[1]}
    </div>
  );
}
