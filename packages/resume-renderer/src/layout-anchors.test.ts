import { expect, it } from "vitest";
import { collectNativeItemAnchors } from "./layout-anchors.js";

it("uses final page-local offsets, including nested columns and continuation pages", () => {
  const node = (id: string, left: number, top: number) => ({
    props: { id: `aijob-item:${id}` },
    box: { left, top },
  });
  expect(
    collectNativeItemAnchors({
      _INTERNAL__LAYOUT__DATA_: {
        children: [
          {
            box: { top: 0 },
            children: [{ box: { left: 40, top: 30 }, children: [node("first", 5, 100)] }],
          },
          {
            box: { top: 900 },
            children: [
              {
                box: { left: 220, top: 30 },
                children: [node("first", 0, 0), node("second", 0, 100)],
              },
            ],
          },
        ],
      },
    }),
  ).toEqual([
    { page: 1, id: "first", x: 45, y: 130 },
    { page: 2, id: "first", x: 220, y: 30 },
    { page: 2, id: "second", x: 220, y: 130 },
  ]);
  expect(collectNativeItemAnchors({})).toEqual([]);
});
