import type { ElementInfo, RenderWithLayoutResult } from "@aijob/resume-forme/engine";

type TextRun = { content: string; [key: string]: unknown };
type Node = {
  kind?: { type: string; content?: string; runs?: TextRun[] };
  sourceLocation?: { file: string; line: number; column: number };
  children?: Node[];
};
type Render = (document: Record<string, unknown>) => Promise<RenderWithLayoutResult>;
const compact = (text: string) => text.replace(/\s/gu, "");
const visible = (text: string) => Array.from(compact(text));
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
const forbiddenStart = /^[，。？！、；：…％）】》”’.,;:!?%)}\]]/u;
const forbiddenEnd = /[（【《“‘({[]$/u;

export function isShortTail(text: string): boolean {
  const characters = visible(text);
  const han = characters.filter((character) => /\p{Script=Han}/u.test(character)).length;
  return (
    characters.length > 0 &&
    (characters.length <= 3 || (han > 0 && han <= 3 && characters.length <= 5))
  );
}

/** Return a source-string offset, never an offset in normalized/extracted text. */
export function tailBreakOffset(source: string, lines: string[]): number | undefined {
  if (lines.length < 2 || !isShortTail(lines.at(-1) ?? "")) return;
  if (compact(lines.join("")) !== compact(source)) return;
  const offsets: number[] = [];
  let offset = 0;
  for (const character of source) {
    if (!/\s/u.test(character)) offsets.push(offset);
    offset += character.length;
  }
  const beforeLast = visible(lines.slice(0, -1).join("")).length;
  const lastStart = offsets[beforeLast];
  const previousStart = offsets[visible(lines.slice(0, -2).join("")).length] ?? 0;
  if (lastStart === undefined) return;
  // A user-authored hard break is an intentional new line, not a typesetting widow.
  const precedingCharacter = offsets[beforeLast - 1];
  if (
    precedingCharacter === undefined ||
    /[\r\n]/u.test(source.slice(precedingCharacter, lastStart))
  )
    return;
  const protectedTokens = [
    ...source.matchAll(/(?:https?:\/\/|mailto:|tel:)\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu),
  ];
  const boundaries = [...segmenter.segment(source)].map((part) => part.index).reverse();
  for (const index of boundaries) {
    if (index >= lastStart || index <= previousStart) continue;
    const tail = source.slice(index).trimStart();
    const leading = source.slice(previousStart, index).trimEnd();
    if (/[\r\n]/u.test(source.slice(index, lastStart))) continue;
    if (visible(tail).length < 6 || visible(leading).length < 4) continue;
    if (visible(leading).length < visible(lines.at(-2) ?? "").length / 2) continue;
    if (forbiddenStart.test(tail) || forbiddenEnd.test(leading)) continue;
    if (
      protectedTokens.some((match) => index > match.index && index < match.index + match[0].length)
    )
      continue;
    if (
      /[\p{L}\p{N}_]/u.test(source[index - 1] ?? "") &&
      /[\p{L}\p{N}_]/u.test(source[index] ?? "") &&
      !/\p{Script=Han}/u.test((source[index - 1] ?? "") + (source[index] ?? ""))
    )
      continue;
    return index;
  }
}

export function insertRunBreak(runs: TextRun[], index: number): TextRun[] {
  let offset = 0;
  return runs.map((run) => {
    const end = offset + run.content.length;
    const content =
      index > offset && index <= end
        ? `${run.content.slice(0, index - offset)}\n${run.content.slice(index - offset)}`
        : run.content;
    offset = end;
    return { ...run, content };
  });
}

/** Reflow only measured short final lines. Font metrics, text, links and widths stay intact. */
export async function renderBalancedStudioText(
  document: Record<string, unknown>,
  render: Render,
): Promise<RenderWithLayoutResult> {
  const working = structuredClone(document);
  const nodes = new Map<number, Node>();
  const visit = (node: Node) => {
    const location = node.sourceLocation;
    if (
      node.kind?.type === "Text" &&
      (location?.file.startsWith("rr-in:") ||
        location?.file.startsWith("rr-node:page-1/local-text/")) &&
      (location.file.includes("/item-") ||
        location.file.endsWith("/header") ||
        location.file.includes("/local-text/")) &&
      location.column === 1
    ) {
      const id = nodes.size + 1;
      node.sourceLocation = { ...location, line: id };
      nodes.set(id, node);
    }
    node.children?.forEach(visit);
  };
  (working.children as Node[] | undefined)?.forEach(visit);
  // Forme resolves font buffers in place; give each pass its own disposable input.
  const first = await render(structuredClone(working));
  let changes = 0;
  const inspect = (element: ElementInfo) => {
    if (element.nodeType === "Text") {
      const node = nodes.get(element.sourceLocation?.line ?? -1);
      if (node?.kind && node.sourceLocation?.file === element.sourceLocation?.file) {
        const lines = element.children
          .filter((child) => child.nodeType === "TextLine")
          .map((child) => child.textContent ?? "");
        const source =
          node.kind.runs?.map((run) => run.content).join("") ?? node.kind.content ?? "";
        const index = tailBreakOffset(source, lines);
        if (index !== undefined) {
          if (node.kind.runs) node.kind.runs = insertRunBreak(node.kind.runs, index);
          else node.kind.content = `${source.slice(0, index)}\n${source.slice(index)}`;
          changes++;
        }
      }
    }
    element.children.forEach(inspect);
  };
  first.layout.pages.forEach((page) => page.elements.forEach(inspect));
  return changes ? render(structuredClone(working)) : first;
}
