import { loadRegressionInputs, runOutput } from "./regression-inputs.mjs";
const inputs = await loadRegressionInputs();
await inputs.verify();
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(new URL("../../apps/platform/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const out = runOutput("browser-resume");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.AIJOB_BROWSER_EXECUTABLE || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1050 },
  acceptDownloads: true,
  ...(process.env.AIJOB_BROWSER_STORAGE ? { storageState: process.env.AIJOB_BROWSER_STORAGE } : {}),
});
const page = await context.newPage();
const errors = [];
const previews = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.url().endsWith("/native/preview") && response.ok())
    void response.json().then((value) => previews.push(value));
});
const origin = process.env.AIJOB_BROWSER_ORIGIN || "http://127.0.0.1:5194";
const waitSaved = () => page.getByText(/^(✓ 已自动保存|已保存)$/).waitFor({ timeout: 30000 });
try {
  await page.goto(`${origin}/resumes`);
  await page.getByRole("button", { name: /导入已有简历/ }).click();
  await page
    .getByRole("dialog")
    .locator('input[type="file"]')
    .setInputFiles(inputs.sample("word-table-case20").file);
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 45000 });
  await page.getByLabel("姓名", { exact: true }).fill("系统升级验证同学");
  await waitSaved();
  const id = new URL(page.url()).pathname.split("/").at(-1);
  const read = async () => {
    const response = await page.request.get(`${origin}/v2/resume-documents/${id}/native`);
    assert(response.ok());
    return response.json();
  };
  const before = await read();
  assert(before.document.sourceBindings?.length > 0);
  const section = Object.entries(before.document.data.sections).find(
    ([key, value]) => ["experience", "projects", "education"].includes(key) && value.items.length,
  );
  assert(section);
  const item = section[1].items[0];
  const target = section[0] === "projects" ? "experience" : "projects";
  await page.getByLabel("更多简历操作", { exact: true }).click();
  await page.getByRole("button", { name: "查看原件与导入纠错", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "case-20.docx", exact: true }).click();
  await dialog.getByText("调整条目归属或拆开合并的经历", { exact: true }).click();
  await dialog.getByLabel("当前稿中的条目").selectOption(item.id);
  await dialog.getByLabel("移至模块").selectOption(target);
  await dialog.getByRole("button", { name: "移动这个条目", exact: true }).click();
  await dialog.getByRole("button", { name: "返回编辑", exact: true }).click();
  await waitSaved();
  const moved = await read();
  assert.equal(moved.document.data.basics.name, "系统升级验证同学");
  assert(moved.document.data.sections[target].items.some((entry) => entry.id === item.id));
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await waitSaved();
  assert(
    (await read()).document.data.sections[section[0]].items.some((entry) => entry.id === item.id),
  );
  await page.getByRole("button", { name: "更换模板", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: /紧凑单栏/ })
    .first()
    .click();
  await dialog.getByRole("button", { name: "应用这套模板", exact: true }).click();
  await page.getByLabel("姓名", { exact: true }).fill("立即下载的当前正文");
  const downloaded = page.waitForEvent("download", { timeout: 60000 });
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  const file = await downloaded;
  await file.saveAs(resolve(out, "current.pdf"));
  await page
    .locator(".native-pdf-text")
    .filter({ hasText: "立即下载的当前正文" })
    .first()
    .waitFor({ timeout: 60000 });
  const latest = await read();
  assert.equal(latest.document.presentation.id, "studio-compact-cn");
  const artifact = previews.findLast((value) => value.draftRevision === latest.revision)?.artifact;
  assert(artifact);
  const savedFile = await page.request.get(`${origin}/v2/resume-exports/${artifact.id}/file`);
  const { readFile } = await import("node:fs/promises");
  assert((await savedFile.body()).equals(await readFile(resolve(out, "current.pdf"))));
  // A delayed successful older request must not repaint newer input.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  let started;
  let finished;
  const oldFinished = new Promise((resolve) => {
    finished = resolve;
  });
  const firstStarted = new Promise((resolve) => {
    started = resolve;
  });
  await page.route("**/native/preview", async (route) => {
    if (intercepted) return route.continue();
    intercepted = true;
    const response = await route.fetch();
    started();
    await held;
    await route.fulfill({ response });
    finished();
  });
  await page.getByLabel("姓名", { exact: true }).fill("迟到的旧稿");
  await Promise.race([
    firstStarted,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Delayed preview did not start")), 60000).unref(),
    ),
  ]);
  await page.getByLabel("姓名", { exact: true }).fill("保留最新稿件");
  await page
    .locator(".native-pdf-text")
    .filter({ hasText: "保留最新稿件" })
    .first()
    .waitFor({ timeout: 60000 });
  release();
  await oldFinished;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert(
    (await page.locator(".native-pdf-text").allTextContents()).join("").includes("保留最新稿件"),
  );
  await page.getByText("当前稿预览 · 与下载使用同一文件", { exact: true }).waitFor();
  await page.unroute("**/native/preview");
  await page.reload();
  await page.getByLabel("姓名", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("姓名", { exact: true }).inputValue(), "保留最新稿件");
  await page
    .locator(".native-pdf-text")
    .filter({ hasText: "保留最新稿件" })
    .first()
    .waitFor({ timeout: 60000 });
  await page.screenshot({ path: resolve(out, "resume-current.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(out, "result.json"),
    JSON.stringify(
      {
        documentId: id,
        checks: [
          "docx-import",
          "source-bindings",
          "local-correction-preserves-name-and-id",
          "undo",
          "template-switch",
          "immediate-download-current-artifact",
          "late-preview-discard",
          "save-reopen",
        ],
        artifactId: artifact.id,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("RESUME_BROWSER_FLOW_PASSED", id);
} catch (error) {
  await page.screenshot({ path: resolve(out, "failure.png"), fullPage: true });
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
