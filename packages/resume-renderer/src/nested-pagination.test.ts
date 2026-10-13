import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Document, Page, renderToBuffer, Text, View } from "@react-pdf/renderer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

async function pages(marked: boolean, spacer: number, long = false, metadata = false, section = false, flowing = false) {
  const headingProps = { minPresenceAhead: 32, ...(marked ? { aijobKeepWithNext: true } : {}) };
  const body = long
    ? h(
        Text,
        null,
        Array.from({ length: 100 }, (_, i) => `TOKEN_${String(i).padStart(3, "0")}\n`).join(""),
      )
    : flowing ? h(Text, null, "BODY_A\nBODY_B\nBODY_C\nBODY_D")
    : h(View, { wrap: false, style: { height: 70 } }, h(Text, null, "BODY"));
  const bytes = await renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "A4", style: { padding: 30, fontSize: 12, fontFamily: "Helvetica" } },
        ...(spacer ? [h(View, { key: "space", style: { height: spacer } })] : []),
        h(View, marked ? { aijobKeepSmallItem: true } : {},
          section ? h(Text, headingProps, "SECTION") : null,
          h(View, null,
          metadata
            ? h(View, headingProps, h(Text, null, "HEADING"),
                ...Array.from({ length: 4 }, (_, i) => h(Text, { key: i }, `METADATA_${i}`)))
            : h(Text, headingProps, "HEADING"),
          body)),
      ),
    ),
  );
  const task = getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl:
      join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts").replace(
        /\\/g,
        "/",
      ) + "/",
  });
  const pdf = await task.promise;
  const result: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++)
    result.push(
      (await (await pdf.getPage(n)).getTextContent()).items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" "),
    );
  await task.destroy();
  return result;
}

describe("opt-in nested heading pagination", () => {
  it("keeps a measured small entry together instead of orphaning its final sentence", async () => {
    const next = await pages(true, 680, false, true, false, true);
    expect(next).toHaveLength(2);
    expect(next[0]).not.toContain("HEADING");
    for (const value of ["HEADING", "METADATA_3", "BODY_A", "BODY_D"]) expect(next[1]).toContain(value);
  });
  it("moves the section title too when its nested first header needs the next page", async () => {
    const next = await pages(true, 700, false, true, true);
    expect(next).toHaveLength(2);
    expect(next[0]).not.toContain("SECTION");
    expect(next[1]).toContain("SECTION");
    expect(next[1]).toContain("HEADING");
    expect(next[1]).toContain("BODY");
  });
  it("keeps a multi-line project header together when its metadata crosses the page edge", async () => {
    const next = await pages(true, 750, false, true);
    expect(next).toHaveLength(2);
    expect(next[0]).not.toContain("HEADING");
    expect(next[1]).toContain("HEADING");
    for (let i = 0; i < 4; i++) expect(next[1]).toContain(`METADATA_${i}`);
    expect(next[1]).toContain("BODY");
  });
  it("preserves unmarked upstream layout but moves a marked heading with its body", async () => {
    const historical = await pages(false, 750);
    expect(historical[0]).toContain("HEADING");
    expect(historical[0]).not.toContain("BODY");
    const next = await pages(true, 750);
    expect(next[0]).not.toContain("HEADING");
    expect(next[1]).toContain("HEADING");
    expect(next[1]).toContain("BODY");
  });
  it("does not move a first-page heading into an infinite blank-page loop", async () => {
    const next = await pages(true, 0);
    expect(next).toHaveLength(1);
    expect(next[0]).toContain("HEADING");
    expect(next[0]).toContain("BODY");
  });
  it("allows long body text to continue and keeps every numbered line exactly once", async () => {
    const next = await pages(true, 700, true);
    expect(next.length).toBeGreaterThan(1);
    const text = next.join(" ");
    for (let i = 0; i < 100; i++)
      expect(text.split(`TOKEN_${String(i).padStart(3, "0")}`)).toHaveLength(2);
  });
});
