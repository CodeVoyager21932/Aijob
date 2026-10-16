import type { NativeItemAnchor } from "@aijob/resume-renderer/browser";

export interface NativeTextRange {
  start: number;
  end: number;
}
export interface NativeTextTarget {
  kind: "text";
  id: string;
  targetId: string;
  text: string;
  label: string;
  defaultFontSize: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  stale?: boolean;
  alignmentAvailable?: boolean;
  lineBoxes?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    start: number;
    end: number;
  }>;
}
export interface NativeTextSelection {
  target: NativeTextTarget;
  range?: NativeTextRange;
}
export interface NativeSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function nativeTextTargets(anchors: NativeItemAnchor[]): NativeTextTarget[] {
  return anchors.filter(isNativeTextTarget);
}

export function isNativeTextTarget(anchor: NativeItemAnchor): anchor is NativeTextTarget {
  return (
    anchor.kind === "text" &&
    typeof anchor.targetId === "string" &&
    typeof anchor.text === "string" &&
    typeof anchor.label === "string" &&
    typeof anchor.defaultFontSize === "number" &&
    (anchor.width ?? 0) > 0 &&
    (anchor.height ?? 0) > 0
  );
}

function contains(box: NativeSelectionRect, x: number, y: number, tolerance = 0) {
  return (
    x >= box.x - tolerance &&
    y >= box.y - tolerance &&
    x <= box.x + box.width + tolerance &&
    y <= box.y + box.height + tolerance
  );
}

export function nativeTextAtPoint(targets: NativeTextTarget[], x: number, y: number) {
  return targets
    .filter((target) =>
      (target.lineBoxes?.length ? target.lineBoxes : [target]).some((box) =>
        contains(box, x, y, 2),
      ),
    )
    .sort((a, b) => a.width * a.height - b.width * b.height)[0];
}

export function validNativeTextRange(
  text: string,
  range: NativeTextRange | undefined,
): range is NativeTextRange {
  if (
    !range ||
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end > text.length ||
    range.start >= range.end ||
    !text.slice(range.start, range.end).trim()
  )
    return false;
  const segments = new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text);
  return (
    (range.start === 0 || segments.containing(range.start)?.index === range.start) &&
    (range.end === text.length || segments.containing(range.end)?.index === range.end)
  );
}

function compact(value: string) {
  let text = "";
  const offsets: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character && !/\s/.test(character)) {
      text += character;
      offsets.push(index);
    }
  }
  return { text, offsets };
}

/** A PDF selection is accepted only when its text and every selected rectangle identify one block. */
export function nativeTextSelectionFromRects(
  targets: NativeTextTarget[],
  selectedText: string,
  rectangles: NativeSelectionRect[],
): NativeTextSelection | undefined {
  const needle = compact(selectedText).text;
  const rects = rectangles.filter((rect) => rect.width > 0.2 && rect.height > 0.2);
  if (!needle || !rects.length) return;
  const candidates = targets.filter((target) =>
    rects.every((rect) =>
      (target.lineBoxes?.length ? target.lineBoxes : [target]).some((box) =>
        contains(box, rect.x + rect.width / 2, rect.y + rect.height / 2, 3),
      ),
    ),
  );
  if (candidates.length !== 1) return;
  const target = candidates[0];
  if (!target) return;
  const source = compact(target.text);
  const selectedLines = target.lineBoxes?.filter((box) =>
    rects.some((rect) => contains(box, rect.x + rect.width / 2, rect.y + rect.height / 2, 3)),
  );
  const low = selectedLines?.length ? Math.min(...selectedLines.map((line) => line.start)) : 0;
  const high = selectedLines?.length
    ? Math.max(...selectedLines.map((line) => line.end))
    : target.text.length;
  const matches: NativeTextRange[] = [];
  for (
    let index = source.text.indexOf(needle);
    index >= 0;
    index = source.text.indexOf(needle, index + 1)
  ) {
    const start = source.offsets[index];
    const last = source.offsets[index + needle.length - 1];
    if (start === undefined || last === undefined) continue;
    const range = { start, end: last + 1 };
    if (range.start >= low && range.end <= high && validNativeTextRange(target.text, range))
      matches.push(range);
  }
  if (matches.length === 1) return { target, range: matches[0] as NativeTextRange };
}
