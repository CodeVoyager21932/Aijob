/** Isolated, synthetic import → edit → PDF download browser check. */
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { strict as assert } from "node:assert";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("PLAYWRIGHT_MODULE is required");
const { chromium } = await import(pathToFileURL(modulePath).href);
const root = resolve(import.meta.dirname, "../..");
const source = resolve(root, ".data/resume-native-k1-20260912/matrix/gengar-cn-medium.docx");
const output = resolve(root, ".data/resume-native-public-specimens-20260923/browser-smoke");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function waitFor(check, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await check()) return; } catch { /* An import can replace the entire editor. */ }
    await page.waitForTimeout(250);
  }
  throw new Error("Timed out waiting for imported editor state");
}
try {
  await page.goto("http://127.0.0.1:5194/resumes/native", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /导入已有简历/ }).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(source);
  await waitFor(async () => await page.getByLabel("姓名", { exact: true }).inputValue() === "林知夏");
  assert.equal(await page.getByLabel("学校", { exact: true }).count(), 2);
  assert.equal(await page.getByLabel("企业／组织", { exact: true }).count(), 3);
  await page.getByLabel("姓名", { exact: true }).fill("导入后继续编辑");
  await waitFor(async () => await page.getByText("已保存", { exact: true }).isVisible(), 30_000);
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  const download = await downloadPromise;
  const pdf = resolve(output, "edited.pdf");
  await download.saveAs(pdf);
  await page.screenshot({ path: resolve(output, "edited.png"), fullPage: false });
  if (errors.length) throw new Error(`Browser page errors: ${errors.join(" | ")}`);
  await writeFile(resolve(output, "result.json"), JSON.stringify({
    source: "synthetic-docx", imported: true, educationCount: 2, experienceCount: 3,
    edited: true, downloadedPdf: true, pageErrors: errors,
  }, null, 2));
  console.log("SYNTHETIC_IMPORT_EDIT_PDF_OK");
} finally {
  await context.close();
  await browser.close();
}
