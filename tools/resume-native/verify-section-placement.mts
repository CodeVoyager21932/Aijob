import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyNativeTemplate,
  createNativeResumeDocument,
  newNativeItem,
} from "../../packages/resume-core/dist/index.js";
import { renderNativePdfIsolated } from "../../packages/resume-renderer/dist/isolated.mjs";

const require = createRequire(new URL("../../apps/platform/package.json", import.meta.url));
const { getDocument } = await import(
  pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href
);
const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, ".data/resume-native-k4-20260913/section-placement");
await mkdir(output, { recursive: true });
const results = [];
for (const kind of [
  "header",
  "later-page",
  "after-education",
  "sidebar",
  "hidden",
  "historical",
] as const) {
  const document = applyNativeTemplate(createNativeResumeDocument(), "leafish-cn");
  document.data.basics.name = "版式顺序核验";
  document.data.summary.content = "<p>SUMMARY_PLACEMENT_校验简介</p>";
  document.data.sections.education.items.push({
    ...newNativeItem("education", "school"),
    school: "EDUCATION_ORDER_校验学校",
  });
  const layout = document.data.metadata.layout;
  layout.pages = [{ fullWidth: true, main: ["summary", "education"], sidebar: [] }];
  if (kind === "later-page" || kind === "historical") {
    layout.pages = [
      { fullWidth: true, main: ["education"], sidebar: [] },
      { fullWidth: true, main: ["summary"], sidebar: [] },
    ];
  }
  if (kind === "historical") delete document.data.metadata.page.respectSectionPlacement;
  if (kind === "after-education")
    layout.pages = [{ fullWidth: true, main: ["education", "summary"], sidebar: [] }];
  if (kind === "sidebar")
    layout.pages = [{ fullWidth: false, main: ["education"], sidebar: ["summary"] }];
  if (kind === "hidden") document.data.summary.hidden = true;
  const bytes = await renderNativePdfIsolated(document, resolve(root, "apps/web/public/fonts"));
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  const texts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    texts.push(
      (await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join(""),
    );
  }
  const combined = texts.join(" ");
  assert.equal(
    combined.split("SUMMARY_PLACEMENT").length - 1,
    kind === "hidden" ? 0 : 1,
    `${kind}: summary count`,
  );
  assert.ok(combined.includes("EDUCATION_ORDER"), `${kind}: education retained`);
  if (kind === "later-page") {
    assert.equal(texts.length, 2);
    assert.ok(!texts[0]?.includes("SUMMARY_PLACEMENT"));
    assert.ok(texts[1]?.includes("SUMMARY_PLACEMENT"));
  }
  if (kind === "after-education")
    assert.ok(combined.indexOf("EDUCATION_ORDER") < combined.indexOf("SUMMARY_PLACEMENT"));
  if (kind === "header" || kind === "historical")
    assert.ok(texts[0]?.includes("SUMMARY_PLACEMENT"));
  await writeFile(resolve(output, `${kind}.pdf`), bytes);
  results.push({ kind, pages: pdf.numPages, status: "PASS" });
  await task.destroy();
  console.log(JSON.stringify(results.at(-1)));
}
await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
