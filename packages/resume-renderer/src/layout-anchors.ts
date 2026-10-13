export interface NativeItemAnchor {
  page: number;
  id: string;
  x: number;
  y: number;
}
type LayoutNode = {
  type?: string;
  box?: { left?: number; top?: number };
  props?: { id?: string };
  children?: LayoutNode[];
};
/** Coordinates from the pinned React PDF 4.9 final layout, after pagination; no independent measurement. */
export function collectNativeItemAnchors(payload: unknown): NativeItemAnchor[] {
  if (!payload || typeof payload !== "object" || !("_INTERNAL__LAYOUT__DATA_" in payload))
    return [];
  const root = payload._INTERNAL__LAYOUT__DATA_ as LayoutNode;
  const result: NativeItemAnchor[] = [];
  for (const [index, page] of (root.children ?? []).entries()) {
    const seen = new Set<string>();
    function visit(node: LayoutNode, left: number, top: number) {
      const x = left + (node.box?.left ?? 0),
        y = top + (node.box?.top ?? 0),
        id = node.props?.id;
      if (
        id?.startsWith("aijob-item:") &&
        !seen.has(id) &&
        Number.isFinite(x) &&
        Number.isFinite(y)
      ) {
        seen.add(id);
        result.push({ page: index + 1, id: id.slice(11), x, y });
      }
      for (const child of node.children ?? []) visit(child, x, y);
    }
    // Page offsets are presentation bookkeeping, not part of the page coordinate system.
    for (const child of page.children ?? []) visit(child, 0, 0);
  }
  return result;
}
