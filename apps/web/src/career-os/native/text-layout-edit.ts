import {
  type NativeResumeDocument,
  type NativeTextLayout,
  setNativeTextRange,
} from "@aijob/resume-core";
import {
  type NativeTextRange,
  type NativeTextTarget,
  validNativeTextRange,
} from "./preview-text-targets";

export function nativeEffectiveTextLayout(
  document: NativeResumeDocument,
  target: NativeTextTarget,
) {
  const value = document.textLayout?.[target.targetId];
  return value?.sourceText === target.text ? value : undefined;
}

/** Stale character offsets never migrate to different text. The content itself is untouched. */
export function patchNativeTextLayout(
  document: NativeResumeDocument,
  target: NativeTextTarget,
  patch: Partial<NativeTextLayout>,
) {
  const previous = nativeEffectiveTextLayout(document, target);
  const next = { ...previous, sourceText: target.text, ...patch };
  if (patch.lineMode && patch.lineMode !== "manual") delete next.breakAfter;
  document.textLayout ??= {};
  document.textLayout[target.targetId] = next;
}

export function setNativeTextRangeSize(
  document: NativeResumeDocument,
  target: NativeTextTarget,
  range: NativeTextRange,
  fontSize: number,
) {
  if (!validNativeTextRange(target.text, range)) return;
  const previous = nativeEffectiveTextLayout(document, target);
  const ranges = setNativeTextRange(previous?.ranges ?? [], { ...range, fontSize });
  patchNativeTextLayout(document, target, { ranges });
}

export function nativeRangeFontSize(
  layout: NativeTextLayout | undefined,
  range: NativeTextRange | undefined,
  fallback: number,
): number | null {
  const base = layout?.fontSize ?? fallback;
  if (!range) return base;
  const points = new Set([range.start, range.end]);
  for (const item of layout?.ranges ?? []) {
    if (item.start > range.start && item.start < range.end) points.add(item.start);
    if (item.end > range.start && item.end < range.end) points.add(item.end);
  }
  const starts = [...points].sort((a, b) => a - b).slice(0, -1);
  const sizes = new Set(
    starts.map(
      (point) =>
        layout?.ranges?.find((item) => point >= item.start && point < item.end)?.fontSize ?? base,
    ),
  );
  return sizes.size === 1 ? ([...sizes][0] ?? base) : null;
}

export function resetNativeTextLayout(document: NativeResumeDocument, targetId: string) {
  delete document.textLayout?.[targetId];
  if (document.textLayout && !Object.keys(document.textLayout).length) delete document.textLayout;
}
