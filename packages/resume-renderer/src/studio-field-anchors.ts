import type { ElementInfo, RenderWithLayoutResult } from "@aijob/resume-forme/engine";
import type { NativeItemAnchor } from "./layout-anchors.js";

/** Field hit targets come from the final PDF text lines, after reflow and pagination. */
export function collectStudioFieldAnchors(
  layout: RenderWithLayoutResult["layout"],
): NativeItemAnchor[] {
  return layout.pages.flatMap((page, index) => {
    const fields = new Map<string, NativeItemAnchor>();
    const visit = (element: ElementInfo, owner?: "headline" | "email") => {
      const match = /^rr-(?:node|in):page-1\/basics\/(headline|email)$/.exec(
        element.sourceLocation?.file ?? "",
      );
      const field = (match?.[1] as "headline" | "email" | undefined) ?? owner;
      if (
        field &&
        element.nodeType === "TextLine" &&
        [element.x, element.y, element.width, element.height].every(
          (value) => Number.isFinite(value) && Math.abs(value) < 1e6,
        ) &&
        element.width > 0 &&
        element.height > 0
      ) {
        const previous = fields.get(field);
        const x = Math.min(previous?.x ?? element.x, element.x);
        const y = Math.min(previous?.y ?? element.y, element.y);
        const right = Math.max(
          previous ? previous.x + (previous.width ?? 0) : 0,
          element.x + element.width,
        );
        const bottom = Math.max(
          previous ? previous.y + (previous.height ?? 0) : 0,
          element.y + element.height,
        );
        fields.set(field, {
          kind: "field",
          field,
          id: `basics:${field}`,
          page: index + 1,
          x,
          y,
          width: right - x,
          height: bottom - y,
        });
      }
      element.children.forEach((child) => visit(child, field));
    };
    page.elements.forEach((element) => visit(element));
    return [...fields.values()];
  });
}
