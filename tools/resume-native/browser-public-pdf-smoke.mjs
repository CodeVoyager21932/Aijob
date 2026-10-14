import { loadRegressionInputs, runOutput } from "./regression-inputs.mjs";
const inputs = await loadRegressionInputs();
await inputs.verify();
/** Import one pinned public PDF through the real UI in an isolated test owner. */
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("PLAYWRIGHT_MODULE is required");
const { chromium } = await import(pathToFileURL(modulePath).href);
const specimen = "typst-sidebar";
const item = inputs.sample(specimen);
if (!item) throw new Error("Pinned public specimen missing");
const source = item.file;
const bytes = await readFile(source);
if (createHash("sha256").update(bytes).digest("hex") !== item.sha256)
  throw new Error("Source PDF changed");
const output = runOutput("browser-public-pdf");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://127.0.0.1:5194/resumes/native", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /导入已有简历/ }).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(source);
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 60_000 });
  if ((await page.getByLabel("学校", { exact: true }).count()) < 1)
    throw new Error("Education missing after public PDF import");
  await page.getByRole("button", { name: "导入与原件", exact: true }).click();
  await page.getByRole("button", { name: `${specimen}.pdf`, exact: true }).click();
  await page
    .getByRole("heading", { name: "文件中的内容", exact: true })
    .waitFor({ state: "visible" });
  const sourceBlocks = await page.locator(".native-import-block").count();
  if (sourceBlocks < 10) throw new Error("Source inspection lacks extracted blocks");
  await page.screenshot({ path: resolve(output, "source-inspection.png"), fullPage: false });
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  if (errors.length) throw new Error(`Browser page errors: ${errors.join(" | ")}`);
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        specimen,
        sourceSha256: item.sha256,
        imported: true,
        educationVisible: true,
        sourceBlocks,
        sourceInspectionVisible: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("PUBLIC_PDF_IMPORT_INSPECTION_OK");
} finally {
  await context.close();
  await browser.close();
}
