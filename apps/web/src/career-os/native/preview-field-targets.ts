import type { NativeItemAnchor } from "@aijob/resume-renderer/browser";

export function nativeFieldAnchorLabel(anchor: NativeItemAnchor) {
  if (anchor.kind !== "field") return "定位编辑此条经历";
  return anchor.id === "basics:email" ? "调整邮箱排版" : "调整求职方向排版";
}

/** Use measured PDF coordinates so zoom and text selection retain their normal behavior. */
export function nativeFieldAtPoint(anchors: NativeItemAnchor[], x: number, y: number) {
  return anchors.find(
    (anchor) =>
      anchor.kind === "field" &&
      (anchor.width ?? 0) > 0 &&
      (anchor.height ?? 0) > 0 &&
      x >= anchor.x &&
      y >= anchor.y &&
      x <= anchor.x + (anchor.width ?? 0) &&
      y <= anchor.y + (anchor.height ?? 0),
  );
}
