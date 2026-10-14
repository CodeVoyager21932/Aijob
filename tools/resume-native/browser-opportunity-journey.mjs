import { loadRegressionInputs, runOutput } from "./regression-inputs.mjs";
const inputs = await loadRegressionInputs();
await inputs.verify();
/** One complex pinned PDF, one opportunity direction, one independently retained submission. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const require = createRequire(resolve(root, "apps/platform/package.json"));
const { chromium } = require("playwright-core");
const tsx = require.resolve("tsx/cli");
const output = runOutput("opportunity-browser");
await mkdir(output, { recursive: true });
function seed(...args) {
  const result = execFileSync(
    process.execPath,
    [tsx, resolve(root, "tools/resume-native/opportunity-browser-seed.mts"), ...args],
    { cwd: root, encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(result.trim().split(/\r?\n/).at(-1));
}
const source = inputs.sample("typst-sidebar").file;
const manifest = inputs.cases;
const sha = (data) => createHash("sha256").update(data).digest("hex");
const sourceSha = sha(await readFile(source));
assert.equal(sourceSha, manifest.find((item) => item.id === "typst-sidebar").sha256);
const initial = seed("seed");
const directionLabel = `数据分析实习 · ${initial.marker}`;
const browser = await chromium.launch({
  ...(process.env.AIJOB_BROWSER_EXECUTABLE
    ? { executablePath: process.env.AIJOB_BROWSER_EXECUTABLE }
    : { channel: "chrome" }),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
  ...(process.env.AIJOB_BROWSER_STORAGE ? { storageState: process.env.AIJOB_BROWSER_STORAGE } : {}),
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.AIJOB_BROWSER_ORIGIN || "http://127.0.0.1:5194";
async function go(path) {
  await page.goto(base + path, { waitUntil: "networkidle" });
}
async function download(name, file) {
  const pending = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name, exact: true }).click();
  const downloaded = await pending;
  await downloaded.saveAs(resolve(output, file));
  return sha(await readFile(resolve(output, file)));
}
try {
  await go("/resumes");
  await page.getByRole("button", { name: /导入已有简历/ }).click();
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(source);
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 90_000 });
  await page.getByLabel("姓名", { exact: true }).waitFor();
  const baseId = new URL(page.url()).pathname.split("/").at(-1);
  const originalName = await page.getByLabel("姓名", { exact: true }).inputValue();
  assert.ok(await page.getByLabel("学校", { exact: true }).count(), "PDF education missing");
  const session = await (await context.request.get(`${base}/v1/session`)).json();
  await go("/jobs");
  await page.getByLabel("搜索岗位、公司或 JD 内容", { exact: true }).fill(initial.marker);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("button", { name: "＋ 设置求职方向", exact: true }).click();
  await page.getByLabel("方向名称", { exact: true }).fill(directionLabel);
  await page.getByRole("button", { name: "保存并订阅", exact: true }).click();
  await page
    .locator(".automatic-opportunities__directions article")
    .filter({ hasText: directionLabel })
    .getByRole("button", { name: "暂停", exact: true })
    .waitFor();
  seed("digest", session.owner.id);
  const added = seed("seed", initial.marker, "new");
  seed("digest", session.owner.id, "next");
  await go("/today");
  const newJob = page.getByRole("link", { name: added.title, exact: true });
  await newJob.waitFor();
  assert.equal(
    await page.getByRole("link", { name: initial.title, exact: true }).count(),
    1,
    "Baseline should appear only in initial digest",
  );
  await page.screenshot({ path: resolve(output, "01-direction-changes.png"), fullPage: false });
  await newJob.click();
  await page.getByRole("button", { name: "开始准备这份申请", exact: true }).click();
  await page.waitForURL(/\/applications\/[^/]+\/resume/);
  const caseId = new URL(page.url()).pathname.split("/")[2];
  await page.getByRole("combobox", { name: /基础简历/ }).selectOption(baseId);
  await page.getByRole("button", { name: "创建岗位简历", exact: true }).click();
  await page.getByRole("link", { name: "继续准备岗位简历", exact: true }).click();
  await page.getByLabel("姓名", { exact: true }).waitFor();
  const derivedId = new URL(page.url()).pathname.split("/").at(-1);
  assert.notEqual(derivedId, baseId);
  assert.equal(new URL(page.url()).searchParams.get("caseId"), caseId);
  assert.equal(await page.getByLabel("姓名", { exact: true }).inputValue(), originalName);
  await page.getByLabel("姓名", { exact: true }).fill("岗位稿已投递版本");
  const exportedSha = await download("下载 PDF", "exported.pdf");
  await go(`/applications/${caseId}/application`);
  await page.getByRole("button", { name: "我已在官方页面完成投递", exact: true }).click();
  await page.getByLabel("投递简历", { exact: true }).selectOption(derivedId);
  await page.getByLabel("实际投递文件", { exact: true }).waitFor();
  const fileOptions = page.getByLabel("实际投递文件", { exact: true }).locator("option");
  const artifactId = await fileOptions.nth(1).getAttribute("value");
  assert.ok(artifactId);
  await page.getByLabel("实际投递文件", { exact: true }).selectOption(artifactId);
  await page.getByRole("button", { name: "确认已投递", exact: true }).click();
  await page.getByRole("button", { name: "查看实际正文", exact: true }).waitFor();
  assert.equal(await download("下载 PDF", "retained-before.pdf"), exportedSha);
  await go(`/resumes/${derivedId}?caseId=${caseId}`);
  await page.getByLabel("姓名", { exact: true }).fill("投递后继续修改工作稿");
  await page.getByLabel("更多简历操作", { exact: true }).click();
  await page.getByRole("button", { name: "保存版本", exact: true }).click();
  await page.getByText(/^(✓ 已自动保存|已保存)$/).waitFor();
  await go(`/resumes/${baseId}`);
  assert.equal(
    await page.getByLabel("姓名", { exact: true }).inputValue(),
    originalName,
    "Independent draft modified base",
  );
  await go(`/applications/${caseId}/application`);
  assert.equal(
    await download("下载 PDF", "retained-after.pdf"),
    exportedSha,
    "Retained file was overwritten by later edits",
  );
  await page.getByRole("button", { name: "查看实际正文", exact: true }).click();
  await page.getByRole("dialog", { name: "实际投递正文" }).waitFor();
  await page
    .getByRole("dialog", { name: "实际投递正文" })
    .locator(".native-pdf-text")
    .filter({ hasText: "岗位稿已投递版本" })
    .first()
    .waitFor({ timeout: 60_000 });
  await page.screenshot({ path: resolve(output, "02-retained-submission.png"), fullPage: false });
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        sourceSha,
        importedComplexPdf: true,
        directionInitialThenNew: true,
        baseId,
        derivedId,
        caseId,
        independentBaseUnchanged: true,
        exportedSha,
        retainedFileUnchangedAfterWorkingEdit: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("OPPORTUNITY_PDF_CASE_SUBMISSION_OK");
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: false }).catch(() => {});
  await writeFile(
    resolve(output, "failure.txt"),
    `${error.stack}\n${(await page.locator("body").innerText()).slice(0, 14000)}`,
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
