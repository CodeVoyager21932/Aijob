import type { NativeItemAnchor } from "@aijob/resume-renderer/browser";
import { expect, it } from "vitest";
import { nativeFieldAnchorLabel, nativeFieldAtPoint } from "./preview-field-targets";

const anchors: NativeItemAnchor[] = [
  { id: "entry-1", page: 1, x: 22, y: 240 },
  {
    id: "basics:headline",
    kind: "field",
    field: "headline",
    page: 1,
    x: 32,
    y: 80,
    width: 150,
    height: 24,
  },
  {
    id: "basics:email",
    kind: "field",
    field: "email",
    page: 1,
    x: 220,
    y: 110,
    width: 170,
    height: 14,
  },
];

it("targets only measured field rectangles, leaving other PDF text unhandled", () => {
  expect(nativeFieldAtPoint(anchors, 30, 90)).toBeUndefined();
  expect(nativeFieldAtPoint(anchors, 50, 90)?.id).toBe("basics:headline");
  expect(nativeFieldAtPoint(anchors, 230, 115)?.id).toBe("basics:email");
  expect(nativeFieldAtPoint(anchors, 230, 130)).toBeUndefined();
  expect(nativeFieldAtPoint(anchors, 22, 240)).toBeUndefined();
});

it("names header targets as the actual field, not as experience entries", () => {
  expect(anchors.map(nativeFieldAnchorLabel)).toEqual([
    "定位编辑此条经历",
    "调整求职方向排版",
    "调整邮箱排版",
  ]);
});
