import type { NativeFieldLayout, NativeLayoutField } from "@aijob/resume-core";
import type { ElementInfo, RenderWithLayoutResult } from "@aijob/resume-forme/engine";
import { insertRunBreak } from "./studio-text-balance.js";

type Node = {
  kind?: { type: string; content?: string; runs?: { content: string; [key: string]: unknown }[] };
  style?: Record<string, unknown>;
  sourceLocation?: { file: string; line: number; column: number };
  children?: Node[];
};
type Render = (document: Record<string, unknown>) => Promise<RenderWithLayoutResult>;
type Field = {
  name: NativeLayoutField;
  mode: "auto" | "single" | "manual";
  position: "auto" | "sidebar" | "main";
  wrapper: Node;
  parent: Node;
  text: Node;
  source: string;
  main: boolean;
  flowingManual: boolean;
};

const mainKey = "rr-node:page-1/basics/fields-main";
const policyPrefix = "rr-node:page-1/field-policy/";
const compact = (text: string) => text.replace(/\s/gu, "");

/** Policy is carried in a non-interactive source tag; the inner field keeps its stable edit anchor. */
export function sidebarFieldPolicy(field: NativeLayoutField, layout?: NativeFieldLayout) {
  return `page-1/field-policy/${field}/${layout?.lineMode ?? "auto"}/${layout?.position ?? "auto"}`;
}

/** A manual break is presentation only. The saved basics string is never rewritten. */
export function sidebarFieldText(source: string, layout?: NativeFieldLayout): string {
  if (layout?.lineMode === "single") return source.replace(/\r?\n/gu, " ");
  if (layout?.lineMode !== "manual") return source;
  const index = layout.breakAfter;
  if (
    index === undefined ||
    index <= 0 ||
    index >= source.length ||
    // UTF-16 offsets must not cut a surrogate pair or a combining grapheme.
    ![...new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(source)].some(
      (part) => part.index === index,
    ) ||
    !source.slice(0, index).trim() ||
    !source.slice(index).trim()
  )
    throw new Error("NATIVE_FIELD_BREAK_INVALID");
  return `${source.slice(0, index)}\n${source.slice(index)}`;
}

/** Delimiters already authored by the user delimit complete role/discipline groups. */
function semanticLines(source: string): string {
  if (/[\r\n]/u.test(source)) return source;
  return source.replace(/([·•|｜/／]\s*)(?=\S)/gu, "$1\n");
}

function walk(node: Node, visit: (node: Node, parent?: Node) => void, parent?: Node) {
  visit(node, parent);
  node.children?.forEach((child) => walk(child, visit, node));
}

const nodeText = (node: Node) =>
  node.kind?.runs?.map((run) => run.content).join("") ?? node.kind?.content ?? "";
function setFieldText(node: Node, value: string) {
  if (!node.kind) return;
  if (!node.kind.runs) {
    node.kind.content = value;
    return;
  }
  const source = nodeText(node);
  if (source === value) return;
  // The policy adds only authored semantic breaks; font ranges stay attached to their original characters.
  if (source.replace(/\n/gu, "") !== value.replace(/\n/gu, ""))
    throw new Error("NATIVE_TEXT_BREAK_INVALID");
  let runs = node.kind.runs.map((run) => ({ ...run, content: run.content.replace(/\n/gu, "") }));
  for (let i = 0; i < value.length; i++) if (value[i] === "\n") runs = insertRunBreak(runs, i);
  node.kind.runs = runs;
}

function measuredField(result: RenderWithLayoutResult, name: NativeLayoutField) {
  const key = `page-1/basics/${name}`;
  const lines: ElementInfo[] = [];
  const boxes: ElementInfo[] = [];
  const inspect = (element: ElementInfo, owner = false) => {
    const current = owner || element.sourceLocation?.file === `rr-node:${key}`;
    if (element.sourceLocation?.file === `rr-node:${key}` && element.nodeType === "View")
      boxes.push(element);
    if (current && element.nodeType === "TextLine") lines.push(element);
    element.children.forEach((child) => inspect(child, current));
  };
  result.layout.pages.forEach((page) => page.elements.forEach((element) => inspect(element)));
  return { lines: lines.filter((line) => compact(line.textContent ?? "")), boxes };
}

function fits(result: RenderWithLayoutResult, field: Field) {
  const { lines, boxes } = measuredField(result, field.name);
  const expected = nodeText(field.text)
    .split(/\r?\n/u)
    .filter((line) => compact(line));
  if (
    !boxes.length ||
    compact(lines.map((line) => line.textContent ?? "").join("")) !== compact(expected.join(""))
  )
    return false;
  if (!field.flowingManual && lines.length !== expected.length) return false;
  if (
    !field.flowingManual &&
    lines.some((line, index) => compact(line.textContent ?? "") !== compact(expected[index] ?? ""))
  )
    return false;
  return lines.every((line) =>
    boxes.some(
      (box) =>
        line.x >= box.x - 0.25 &&
        line.x + line.width <= box.x + box.width + 0.25 &&
        line.y >= box.y - 0.25 &&
        line.y + line.height <= box.y + box.height + 0.25,
    ),
  );
}

/**
 * Use the actual PDF engine's font advances and line layout to place the two C fields.
 * The only repairs are authored-group line breaks and moving to the wider header.
 * Every final line is verified; locked layouts that cannot fit fail instead of
 * shrinking fonts, clipping text, or silently changing the user's placement.
 */
export async function renderSidebarFields(
  document: Record<string, unknown>,
  render: Render,
): Promise<RenderWithLayoutResult> {
  const working = structuredClone(document);
  const fields: Field[] = [];
  let destination: Node | undefined;
  walk(working as Node, (node, parent) => {
    if (node.sourceLocation?.file === mainKey) destination = node;
    const policy = node.sourceLocation?.file;
    if (!policy?.startsWith(policyPrefix) || !parent) return;
    const [name, mode, position, flow] = policy.slice(policyPrefix.length).split("/");
    if (name !== "headline" && name !== "email") return;
    let text: Node | undefined;
    walk(node, (child) => {
      if (child.kind?.type === "Text" && !text) text = child;
    });
    if (!text) return;
    fields.push({
      name,
      mode: mode as Field["mode"],
      position: position as Field["position"],
      wrapper: node,
      parent,
      text,
      source: nodeText(text),
      main: position === "main",
      flowingManual: flow === "flow",
    });
  });
  if (!fields.length) return render(working);
  let result = await render(structuredClone(working));
  // A field can acquire semantic breaks, move once, and acquire main-column
  // breaks. A bounded final pass then verifies those exact line boundaries.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const field of fields) {
      if (fits(result, field)) continue;
      const grouped =
        field.name === "headline" && field.mode === "auto"
          ? semanticLines(field.source)
          : field.source;
      if (nodeText(field.text) !== grouped) {
        setFieldText(field.text, grouped);
        changed = true;
        continue;
      }
      if (field.position === "auto" && !field.main && destination) {
        field.parent.children = (field.parent.children ?? []).filter(
          (child) => child !== field.wrapper,
        );
        destination.children ??= [];
        destination.children.push(field.wrapper);
        // Keep headline above email even if each field moved in a different pass.
        destination.children.sort((left, right) => {
          const rank = (node: Node) => (node.sourceLocation?.file?.includes("/headline/") ? 0 : 1);
          return rank(left) - rank(right);
        });
        field.wrapper.style = {
          ...field.wrapper.style,
          margin: { top: 0, right: 0, bottom: 6, left: 0 },
        };
        destination.style = {
          ...destination.style,
          margin: { top: 0, right: 0, bottom: 10, left: 0 },
        };
        const color = destination.style.color;
        walk(field.wrapper, (node) => {
          if (node.kind?.type === "Text") node.style = { ...node.style, color };
        });
        // The wider placement may fit the complete original field on one line.
        setFieldText(field.text, field.source);
        field.main = true;
        changed = true;
        continue;
      }
      throw new Error(`NATIVE_FIELD_${field.name.toUpperCase()}_TOO_WIDE`);
    }
    if (!changed) return result;
    result = await render(structuredClone(working));
  }
  for (const field of fields)
    if (!fits(result, field)) throw new Error(`NATIVE_FIELD_${field.name.toUpperCase()}_TOO_WIDE`);
  return result;
}
