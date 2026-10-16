import type { NativeResumeDocument, NativeTextLayout } from "@aijob/resume-core";
import type { ElementInfo, RenderWithLayoutResult } from "@aijob/resume-forme/engine";
import type { NativeItemAnchor } from "./layout-anchors.js";
import { localTextPrefix } from "./studio-editable-text.js";

type Run = { content: string; style?: Record<string, unknown>; href?: string };
type Node = {
  kind?: { type: string; content?: string; runs?: Run[] };
  style?: Record<string, unknown>;
  sourceLocation?: { file: string; line: number; column: number };
  children?: Node[];
};
type Target = {
  id: string;
  label: string;
  text: string;
  defaultFontSize: number;
  stale: boolean;
  local?: NativeTextLayout;
  node: Node;
};
const tagPrefix = `rr-node:${localTextPrefix}`;
const clean = (s: string) => s.replace(/\s/gu, "");
export function readStudioTextTag(
  file?: string,
): { id: string; label: string; text: string } | undefined {
  if (!file?.startsWith(tagPrefix)) return;
  try {
    return JSON.parse(decodeURIComponent(file.slice(tagPrefix.length)));
  } catch {
    return;
  }
}
const textOf = (node: Node) =>
  node.kind?.runs?.map((run) => run.content).join("") ?? node.kind?.content ?? "";
const edges = (value: unknown) =>
  typeof value === "number"
    ? { top: value, right: value, bottom: value, left: value }
    : {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        ...(value && typeof value === "object" ? value : {}),
      };

/** Split existing runs at original UTF-16 boundaries, preserving their links and weight. */
export function formatStudioRuns(runs: Run[], source: string, local: NativeTextLayout): Run[] {
  const boundaries = new Set([0, source.length]);
  for (const range of local.ranges ?? []) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  if (local.lineMode === "manual") {
    const at = local.breakAfter;
    if (
      at === undefined ||
      at <= 0 ||
      at >= source.length ||
      !source.slice(0, at).trim() ||
      !source.slice(at).trim() ||
      ![...new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(source)].some(
        (part) => part.index === at,
      )
    )
      throw new Error("NATIVE_TEXT_BREAK_INVALID");
    boundaries.add(at);
  }
  const result: Run[] = [];
  let offset = 0;
  for (const run of runs) {
    const end = offset + run.content.length;
    const cuts = [
      offset,
      ...[...boundaries].filter((at) => at > offset && at < end).sort((a, b) => a - b),
      end,
    ];
    for (let i = 0; i < cuts.length - 1; i++) {
      const start = cuts[i] ?? 0,
        stop = cuts[i + 1] ?? end;
      let content = run.content.slice(start - offset, stop - offset);
      if (local.lineMode === "single") content = content.replace(/[\r\n]/gu, " ");
      const range = local.ranges?.find((range) => start >= range.start && stop <= range.end);
      const size = range?.fontSize ?? local.fontSize;
      if (local.lineMode === "manual" && start === local.breakAfter) content = `\n${content}`;
      result.push({
        ...run,
        content,
        ...(size === undefined ? {} : { style: { ...run.style, fontSize: size } }),
      });
    }
    offset = end;
  }
  return result;
}

/** All adjustments remain on the disposable rendering tree; source data is never changed. */
export function prepareStudioText(document: Record<string, unknown>, resume: NativeResumeDocument) {
  const working = structuredClone(document);
  const targets = new Map<string, Target>();
  const visit = (
    node: Node,
    fontSize = resume.data.metadata.typography.body.fontSize,
    parent?: Node,
  ) => {
    const size = typeof node.style?.fontSize === "number" ? node.style.fontSize : fontSize;
    const tag = readStudioTextTag(node.sourceLocation?.file);
    if (tag && node.kind?.type === "Text") {
      const saved = resume.textLayout?.[tag.id];
      const stale = !!saved && saved.sourceText !== tag.text;
      const local = stale ? undefined : saved;
      targets.set(tag.id, {
        ...tag,
        defaultFontSize: size,
        stale,
        ...(local ? { local } : {}),
        node,
      });
      if (local) {
        if (local.lineMode && local.lineMode !== "auto" && node.sourceLocation)
          node.sourceLocation.column = 2;
        // Legacy C formatting may have inserted a break; valid new overrides use the exact source.
        const actual = textOf(node);
        let runs = node.kind.runs ?? [{ content: node.kind.content ?? "" }];
        if (actual !== tag.text && clean(actual) === clean(tag.text) && !node.kind.runs)
          runs = [{ content: tag.text }];
        if (runs.map((run) => run.content).join("") !== tag.text)
          throw new Error("NATIVE_TEXT_BREAK_INVALID");
        node.kind = { type: "Text", content: "", runs: formatStudioRuns(runs, tag.text, local) };
        node.style = {
          ...node.style,
          ...(local.fontSize === undefined ? {} : { fontSize: local.fontSize }),
          ...(local.textAlign
            ? { textAlign: local.textAlign[0]?.toUpperCase() + local.textAlign.slice(1) }
            : {}),
        };
        // A fixed-width bullet text must surrender the inset from its width, not push past the page.
        const box = parent?.children?.length === 1 && parent.kind?.type === "View" ? parent : node;
        if (local.inset !== undefined) {
          const pad = edges(box.style?.padding);
          pad.left = Number(pad.left) + local.inset;
          box.style = { ...box.style, padding: pad };
        }
        if (local.spaceBefore !== undefined || local.spaceAfter !== undefined) {
          const margin = edges(box.style?.margin);
          if (local.spaceBefore !== undefined) margin.top = local.spaceBefore;
          if (local.spaceAfter !== undefined) margin.bottom = local.spaceAfter;
          box.style = { ...box.style, margin };
        }
      }
    }
    node.children?.forEach((child) => visit(child, size, node));
  };
  visit(working as Node);
  return { document: working, targets };
}

function lineOffsets(source: string, lines: ElementInfo[], initial = 0) {
  let cursor = initial;
  return lines.map((line) => {
    const start = cursor;
    const value = line.textContent ?? "";
    for (const char of value) {
      if (/\s/u.test(char)) {
        if (source.slice(cursor, cursor + char.length) === char) cursor += char.length;
        continue;
      }
      while (cursor < source.length && /\s/u.test(source[cursor] ?? "")) cursor++;
      if (source.slice(cursor, cursor + char.length) === char) cursor += char.length;
    }
    return { x: line.x, y: line.y, width: line.width, height: line.height, start, end: cursor };
  });
}

/** Coordinates and line boundaries are taken from the final rendered PDF layout. */
export function collectStudioTextAnchors(
  result: RenderWithLayoutResult,
  targets: Map<string, Target>,
): NativeItemAnchor[] {
  const anchors: NativeItemAnchor[] = [];
  const offsets = new Map<string, number>();
  const allLines = new Map<string, ElementInfo[]>();
  result.layout.pages.forEach((page, index) => {
    const visit = (element: ElementInfo) => {
      const tag = readStudioTextTag(element.sourceLocation?.file);
      const target = tag && targets.get(tag.id);
      if (target && element.nodeType === "Text") {
        const lines = element.children.filter(
          (line) => line.nodeType === "TextLine" && clean(line.textContent ?? ""),
        );
        if (lines.length) {
          const local = target.local;
          allLines.set(target.id, [...(allLines.get(target.id) ?? []), ...lines]);
          if (
            local &&
            lines.some(
              (line) =>
                line.x < page.contentX - 0.5 ||
                line.x + line.width > page.width + 0.5 ||
                line.x < element.x - 0.5 ||
                line.x + line.width > element.x + element.width + 0.5,
            )
          )
            throw new Error("NATIVE_TEXT_LAYOUT_OVERFLOW");
          const x = Math.min(...lines.map((line) => line.x)),
            y = Math.min(...lines.map((line) => line.y));
          const lineBoxes = lineOffsets(target.text, lines, offsets.get(target.id) ?? 0);
          offsets.set(target.id, lineBoxes.at(-1)?.end ?? 0);
          anchors.push({
            kind: "text",
            id: target.id,
            targetId: target.id,
            text: target.text,
            label: target.label,
            defaultFontSize: target.defaultFontSize,
            alignmentAvailable:
              lines.length > 1 || element.width > Math.max(...lines.map((line) => line.width)) + 1,
            stale: target.stale,
            page: index + 1,
            x,
            y,
            width: Math.max(...lines.map((line) => line.x + line.width)) - x,
            height: Math.max(...lines.map((line) => line.y + line.height)) - y,
            lineBoxes,
          });
        }
      }
      element.children.forEach(visit);
    };
    page.elements.forEach(visit);
  });
  for (const [id, lines] of allLines) {
    const target = targets.get(id);
    const local = target?.local;
    if (local?.lineMode === "single" && lines.length !== 1)
      throw new Error("NATIVE_TEXT_LAYOUT_OVERFLOW");
    if (local?.lineMode === "manual" && target) {
      const mandatory = clean(target.text.slice(0, local.breakAfter)).length;
      let count = 0;
      const boundaries = lines.slice(0, -1).map((line) => {
        count += clean(line.textContent ?? "").length;
        return count;
      });
      if (!boundaries.includes(mandatory)) throw new Error("NATIVE_TEXT_LAYOUT_OVERFLOW");
    }
  }
  return anchors;
}
