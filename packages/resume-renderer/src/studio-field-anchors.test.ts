import type { RenderWithLayoutResult } from "@aijob/resume-forme/engine";
import { expect, it } from "vitest";
import { collectStudioFieldAnchors } from "./studio-field-anchors.js";

it("maps final multiline field geometry separately from neighbouring text", () => {
  const line = (x: number, y: number, width: number) => ({
    nodeType: "TextLine",
    x,
    y,
    width,
    height: 12,
    children: [],
  });
  const layout = {
    pages: [
      {
        elements: [
          {
            nodeType: "View",
            sourceLocation: { file: "rr-node:page-1/basics/headline" },
            children: [line(180, 40, 100), line(180, 55, 70)],
          },
          {
            nodeType: "View",
            sourceLocation: { file: "rr-node:page-1/basics/email" },
            children: [line(180, 80, 130)],
          },
          line(30, 30, 60),
        ],
      },
    ],
  } as unknown as RenderWithLayoutResult["layout"];
  expect(collectStudioFieldAnchors(layout)).toEqual([
    {
      kind: "field",
      field: "headline",
      id: "basics:headline",
      page: 1,
      x: 180,
      y: 40,
      width: 100,
      height: 27,
    },
    {
      kind: "field",
      field: "email",
      id: "basics:email",
      page: 1,
      x: 180,
      y: 80,
      width: 130,
      height: 12,
    },
  ]);
});
