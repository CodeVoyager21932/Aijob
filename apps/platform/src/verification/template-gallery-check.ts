/** One-page browsing fixtures are separate from the 90 long-content stress cases. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth";
import {
  RESUME_TEMPLATES,
  RESUME_SAMPLE_PHOTO,
  resumeGallerySample,
  chineseResumeSample,
  resumeTemplateLayout,
  resumePaginationScript,
  studioV2Html,
} from "@aijob/contracts";
import { createStudioDocx } from "../resume-documents/studio-docx.js";
const root = resolve(import.meta.dirname, "../../../.."),
  out = resolve(root, "docs/evidence/resume-template-ux-2026-09-10/templates");
await mkdir(out, { recursive: true });
const fontCss = new Map<string, string>();
for (const family of ["sans", "serif"]) {
  const name = family === "serif" ? "AijobSerifCJK" : "AijobCJK";
  fontCss.set(
    family,
    `@font-face{font-family:AijobPrint;src:url(data:font/woff2;base64,${(await readFile(resolve(root, `apps/web/public/fonts/${name}.woff2`))).toString("base64")});font-weight:400;}`,
  );
}
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const rows: Record<string, unknown>[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 850, height: 1180 } });
  await page.route("**/*", (r) => r.abort());
  const only = process.argv.find((a) => a.startsWith("--template="))?.split("=")[1];
  for (const t of RESUME_TEMPLATES.filter((t) => !only || only.split(',').includes(t.id))) {
    try {
      const layout = resumeTemplateLayout(t.id),
        content = resumeGallerySample();
      await page.emulateMedia({ media: "screen" });
      await page.setContent(
        studioV2Html("一页中文模板样稿", content, layout, fontCss.get(layout.fontFamily), {
          photoDataUrl: RESUME_SAMPLE_PHOTO,
        }),
      );
      await page.evaluate(() => document.fonts.ready);
      const result = await page.evaluate<{ pageCount: number }>(resumePaginationScript());
      if (result.pageCount !== 1) {
        await page.screenshot({path:resolve(out,`${t.id}-overflow.png`),fullPage:true});
        throw new Error(`Gallery sample has ${result.pageCount} pages`);
      }
      const normalized = (s: string | null) => s?.replace(/\s/g, "") ?? "";
      // A sidebar identity renders after the main column in DOM order. Compare
      // each complete entry, not a concatenation that assumes a single column.
      const galleryIntact = await page.evaluate(()=>Array.from(document.querySelectorAll<HTMLElement>('.rs-source .rs-entry')).every(source=>{
        const copies=document.querySelectorAll(`.rs-page [data-entry-id="${source.dataset.entryId}"]`);
        return copies.length===1&&(source.textContent??'').replace(/\s/g,'')===(copies[0]?.textContent??'').replace(/\s/g,'');
      }));
      if (!galleryIntact)
        throw new Error("Gallery content changed during pagination");
      await page
        .locator(".rs-page")
        .screenshot({ path: resolve(root, `apps/web/public/resume-templates/${t.id}.png`) });
      await page.locator(".rs-page").screenshot({ path: resolve(out, `${t.id}.png`) });
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true });
      await writeFile(resolve(out, `${t.id}.pdf`), pdf);
      const loading = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }),
        parsed = await loading.promise;
      if (parsed.numPages !== 1) throw new Error(`PDF has ${parsed.numPages} pages`);
      const text = (await (await parsed.getPage(1)).getTextContent()).items
        .map((i) => ("str" in i ? i.str : ""))
        .join("");
      for (const value of [
        content.basics.name,
        content.basics.email,
        content.basics.phone,
        "校园学习空间调研",
      ])
        if (!normalized(text).includes(value)) throw new Error("PDF text readback failed");
      await loading.destroy();
      const docx = await createStudioDocx(content, layout, { photoDataUrl: RESUME_SAMPLE_PHOTO });
      await writeFile(resolve(out, `${t.id}.docx`), docx);
      const docxText = (await mammoth.extractRawText({ buffer: docx })).value;
      if (!docxText.includes("校园学习空间调研")) throw new Error("DOCX content missing");
      // Existing long-content material must remain complete, with natural continuation.
      const long = chineseResumeSample("long");
      await page.emulateMedia({ media: "screen" });
      await page.setContent(
        studioV2Html("长材料回归", long, layout, fontCss.get(layout.fontFamily)),
      );
      await page.evaluate(() => document.fonts.ready);
      const longPages = await page.evaluate<{ pageCount: number }>(resumePaginationScript());
      const intact = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".rs-source .rs-entry")).every(
          (source) => {
            return (
              (source.querySelector(".rs-entry-content")?.textContent ?? "").replace(/\s/g, "") ===
              Array.from(
                document.querySelectorAll(
                  `.rs-page [data-entry-id="${source.dataset.entryId}"] .rs-entry-content`,
                ),
              )
                .map((e) => e.textContent)
                .join("")
                .replace(/\s/g, "")
            );
          },
        ),
      );
      if (!intact || longPages.pageCount <= 1)
        throw new Error("Long-content continuation lost content");
      const row = {
        id: t.id,
        passed: true,
        galleryPages: 1,
        pdfPages: 1,
        pdfText: true,
        docxContent: true,
        longPages: longPages.pageCount,
        longContentIntact: true,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    } catch (e) {
      const row = { id: t.id, passed: false, error: String(e) };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
} finally {
  await browser.close();
  await writeFile(
    resolve(out, "report.json"),
    JSON.stringify({ at: new Date().toISOString(), results: rows }, null, 2),
  );
}
if (rows.some((r) => !r.passed)) process.exitCode = 1;
