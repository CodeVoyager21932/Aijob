import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { nativeOutputText } from "../../apps/platform/src/resume-documents/native-output-content.ts";
import {
  applyNativeTemplate,
  type NativeTemplateId,
} from "../../packages/resume-core/dist/index.js";
import {
  nativeRendererVersions,
  renderNativePdfArtifactIsolated,
} from "../../packages/resume-renderer/dist/isolated.mjs";
import { getDocument } from "../../packages/resume-renderer/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { coverageFixtures } from "./coverage-fixtures.mts";

// Synthetic fixtures only. No database access, gallery updates or user-draft writes.
const root = resolve(import.meta.dirname, "../..");
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const output = resolve(root, arg("--out") ?? ".data/runs/template-coverage/20261015");
const rasterizer = arg("--rasterizer");
const selected = arg("--fixtures")?.split(",");
const selectedTemplates = arg("--templates")?.split(",");
const templates = [
  "studio-campus-cn",
  "studio-banner-cn",
  "studio-index-cn",
  "studio-sidebar-cn",
  "studio-layered-cn",
  "studio-cards-cn",
].filter((id) => !selectedTemplates || selectedTemplates.includes(id));
const norm = (value: string) => value.normalize("NFKC").replace(/\s/gu, "");
function sourceLinks(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(sourceLinks);
  const record = value as Record<string, unknown>;
  if (record.hidden === true) return [];
  return Object.entries(record).flatMap(([key, item]) => {
    if (typeof item !== "string") return sourceLinks(item);
    if (["url", "link"].includes(key) && /^https?:\/\//i.test(item)) return [item];
    return [...item.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((match) =>
      match[1].replace(/&amp;/g, "&"),
    );
  });
}
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const run = promisify(execFile);
await mkdir(output, { recursive: true });
const report = [];
const photo = `data:image/png;base64,${(await readFile(resolve(root, "apps/web/public/resume-templates/sample-photo.png"))).toString("base64")}`;
for (const fixture of coverageFixtures().filter(
  (item) => !selected || selected.includes(item.id),
)) {
  const input = structuredClone(fixture.document);
  if (!input.data.picture.hidden) input.data.picture.url = photo;
  const sourceJson = JSON.stringify(input);
  await writeFile(resolve(output, `${fixture.id}-source.json`), JSON.stringify(input, null, 2));
  const expected = nativeOutputText(input);
  const expectedLinks = [...new Set(sourceLinks(input.data))];
  for (const id of templates) {
    const document = applyNativeTemplate(input, id as NativeTemplateId);
    const documentBefore = JSON.stringify(document);
    const result = await renderNativePdfArtifactIsolated(
      document,
      resolve(root, "apps/web/public/fonts"),
    );
    const stem = `${fixture.id}--${id}`;
    await writeFile(resolve(output, `${stem}.pdf`), result.bytes);
    await writeFile(resolve(output, `${stem}-document.json`), JSON.stringify(document, null, 2));
    const task = getDocument({ data: new Uint8Array(result.bytes), useSystemFonts: false });
    const pdf = await task.promise;
    let text = "";
    const sizes: number[][] = [],
      outside: unknown[] = [],
      links: string[] = [],
      lines: unknown[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      sizes.push(page.view);
      const view = page.getViewport({ scale: 1 });
      for (const item of (await page.getTextContent()).items)
        if ("str" in item) {
          text += item.str;
          if (!item.str.trim()) continue;
          const [x, y, w, h] = [item.transform[4], item.transform[5], item.width, item.height];
          lines.push({ p, x, y, w, h, text: item.str });
          if (x < -1 || y < -1 || x + w > view.width + 1 || y > view.height + 1)
            outside.push({ p, x, y, w, h, text: item.str });
        }
      for (const annotation of await page.getAnnotations())
        if (annotation.url) links.push(annotation.url);
    }
    const missing = expected.filter((fragment) => !norm(text).includes(norm(fragment)));
    const missingLinks = expectedLinks.filter((url) => !links.includes(url));
    const unchanged =
      sourceJson === JSON.stringify(input) && documentBefore === JSON.stringify(document);
    const singleA4 =
      pdf.numPages === 1 &&
      sizes.every((s) => Math.abs(s[2] - 595.28) < 0.1 && Math.abs(s[3] - 841.89) < 0.1);
    const entry = {
      fixtureId: fixture.id,
      label: fixture.label,
      major: fixture.major,
      density: fixture.density,
      coverage: fixture.coverage,
      synthetic: true,
      templateId: id,
      pages: pdf.numPages,
      sizes,
      singleA4,
      expectedFragments: expected.length,
      missingFragments: missing.length,
      missing,
      outsidePaperCount: outside.length,
      outside,
      links,
      expectedLinks,
      missingLinks,
      sourceUnchanged: unchanged,
      sourceSha256: sha(sourceJson),
      pdfSha256: sha(result.bytes),
      fit: result.fit,
      diagnostics: result.diagnostics,
      visualReview: "pending",
      ...nativeRendererVersions(document),
    };
    await writeFile(
      resolve(output, `${stem}.json`),
      JSON.stringify({ ...entry, lines, nodes: result.pageMap?.nodes }, null, 2),
    );
    report.push(entry);
    await task.destroy();
    if (rasterizer)
      await run(
        rasterizer,
        [
          "-f",
          "1",
          "-singlefile",
          "-scale-to",
          "1600",
          "-png",
          resolve(output, `${stem}.pdf`),
          resolve(output, stem),
        ],
        { windowsHide: true },
      );
    console.log(
      JSON.stringify({
        fixture: fixture.id,
        template: id,
        pages: entry.pages,
        missing: missing.length,
        outside: outside.length,
        font: entry.fit?.bodyFontSize,
        fit: entry.fit?.level,
      }),
    );
    await writeFile(resolve(output, "render-report.json"), JSON.stringify(report, null, 2));
  }
}
if (
  report.some(
    (item) =>
      !item.singleA4 ||
      item.missingFragments ||
      item.missingLinks.length ||
      item.outsidePaperCount ||
      !item.sourceUnchanged,
  )
)
  process.exitCode = 1;
