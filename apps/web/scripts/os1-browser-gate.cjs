const assert = require("node:assert/strict");
const path = require("node:path");

function loadPlaywright() {
  const bundledModules = process.env.CODEX_NODE_MODULES;
  return bundledModules
    ? require(path.join(bundledModules, "playwright"))
    : require("playwright");
}

function loopbackUrl(value, label) {
  const parsed = new URL(value);
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname),
    `${label} must stay on loopback`,
  );
  return parsed.origin;
}

const baseUrl = loopbackUrl(process.env.OS1_BASE_URL || "http://127.0.0.1:5173", "OS1_BASE_URL");
const flagOffBaseUrl = loopbackUrl(
  process.env.OS1_FLAG_OFF_BASE_URL || "http://127.0.0.1:5174",
  "OS1_FLAG_OFF_BASE_URL",
);
const jobId = process.env.OS1_JOB_ID;
assert.match(jobId || "", /^[0-9a-f-]{36}$/i, "OS1_JOB_ID must be a UUID");

const browserExecutable = process.env.OS1_BROWSER_EXECUTABLE;

function step(label) {
  process.stdout.write(`OS1_GATE_STEP:${label}\n`);
}

async function expectFocus(page, selector) {
  try {
    await page.waitForFunction(
      (expected) => document.activeElement?.matches(expected),
      selector,
    );
  } catch (error) {
    const active = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      className: document.activeElement?.className,
      ariaLabel: document.activeElement?.getAttribute("aria-label"),
      text: document.activeElement?.textContent?.trim().slice(0, 80),
    }));
    throw new Error(`focus did not reach ${selector}; active=${JSON.stringify(active)}`, {
      cause: error,
    });
  }
}

async function assertNoDocumentOverflow(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert(overflow <= 1, `${label} must not create document overflow (received ${overflow}px)`);
}

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    executablePath: browserExecutable || undefined,
    headless: true,
  });
  try {
  const context = await browser.newContext({ viewport: { width: 1536, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(20_000);
  const consoleProblems = [];
  const externalRequests = [];
  const unexpectedHttp = [];
  const deliberateHttp = [];
  let expectedStatus = null;

  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) {
      if (expectedStatus && message.text().includes(`status of ${expectedStatus}`)) return;
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      externalRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const problem = `${response.status()} ${new URL(response.url()).pathname}`;
    if (response.status() === expectedStatus) deliberateHttp.push(problem);
    else unexpectedHttp.push(problem);
  });

  step("create-case");
  await page.goto(`${baseUrl}/jobs/${jobId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "加入我的求职" }).click();
  await page.waitForURL(/\/applications\/[0-9a-f-]{36}\/requirements/i);
  const caseId = page.url().match(/\/applications\/([0-9a-f-]{36})\//i)?.[1];
  assert.match(caseId || "", /^[0-9a-f-]{36}$/i);
  await page.getByText(/岗位版本 [0-9a-f-]{36}/i).waitFor();
  await page.getByRole("button", { name: /掌握 SQL/ }).first().click();
  await page.waitForURL(/[?&]requirement=/);
  assert.equal(await page.locator("[role='dialog']").count(), 0, "wide inspector must stay inline");
  assert.equal(await page.getByRole("button", { name: "关闭要求检查器" }).count(), 1);
  await assertNoDocumentOverflow(page, "1536 requirements");

  step("workspace-404");
  await page.goto(`${baseUrl}/route-that-does-not-exist`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "这里没有对应页面" }).waitFor();
  assert.equal(await page.locator(".career-os").count(), 1, "V2 404 must keep WorkspaceShell");
  assert.equal(await page.locator(".product-shell").count(), 0, "V2 404 must not fall back to ProductShell");

  step("wide-peek");
  await page.goto(`${baseUrl}/applications/${caseId}/requirements`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "逐项理解岗位要求" }).waitFor();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/applications`, { waitUntil: "domcontentloaded" });
  const caseTrigger = page.locator(`[data-case-trigger="${caseId}"]`);
  await caseTrigger.click();
  await page.getByRole("button", { name: "关闭岗位侧览" }).waitFor();
  assert.equal(await page.locator("[role='dialog']").count(), 0, "1280 Peek must stay complementary");
  await page.getByRole("button", { name: "关闭岗位侧览" }).click();
  await expectFocus(page, `[data-case-trigger="${caseId}"]`);

  step("runtime-schema-failure");
  await page.route(`**/v1/application-cases/${caseId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{\"invalid\":true}" });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(`[data-case-trigger="${caseId}"]`).click();
  await page.getByText("服务返回了无法验证的数据，请刷新后重试。").waitFor();
  await page.getByRole("button", { name: "关闭岗位侧览" }).click();
  await page.unroute(`**/v1/application-cases/${caseId}`);

  expectedStatus = 404;
  await page.goto(`${baseUrl}/applications/00000000-0000-4000-8000-000000000099/overview`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "没有找到这个求职项目" }).waitFor();
  await page.waitForTimeout(100);
  expectedStatus = null;

  await page.setViewportSize({ width: 768, height: 900 });
  step("768-overlays");
  await page.goto(`${baseUrl}/applications`, { waitUntil: "domcontentloaded" });
  await page.locator(`[data-case-trigger="${caseId}"]`).click();
  const peekDialog = page.locator(
    ".career-modal-surface--inspector[role='dialog'][aria-labelledby='career-case-inspector-title']",
  );
  await peekDialog.waitFor();
  await expectFocus(page, ".career-modal-surface--inspector [aria-label='关闭岗位侧览']");
  assert.equal(await page.locator(".career-workspace[inert]").count(), 1, "overlay must inert workspace");
  await page.keyboard.press("Escape");
  await expectFocus(page, `[data-case-trigger="${caseId}"]`);

  await page.goto(`${baseUrl}/applications/${caseId}/requirements`, { waitUntil: "domcontentloaded" });
  const requirementTrigger = page.getByRole("button", { name: /掌握 SQL/ }).first();
  await requirementTrigger.click();
  await page
    .locator(
      ".career-modal-surface--inspector[role='dialog'][aria-labelledby='career-requirement-inspector-title']",
    )
    .waitFor();
  await expectFocus(page, ".career-modal-surface--inspector [aria-label='关闭要求检查器']");
  await page.keyboard.press("Escape");
  await expectFocus(page, "[data-requirement-trigger]");
  await assertNoDocumentOverflow(page, "768 requirements shell");

  await page.setViewportSize({ width: 320, height: 800 });
  step("320-overlays");
  await page.goto(`${baseUrl}/applications`, { waitUntil: "domcontentloaded" });
  const navigationTrigger = page.getByRole("button", { name: "打开全局导航" });
  await navigationTrigger.click();
  const navigationDialog = page.getByRole("dialog", { name: "全局导航" });
  await navigationDialog.waitFor();
  await expectFocus(page, ".career-sidebar__mobile-close");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await navigationDialog.evaluate((node) => node.contains(document.activeElement)), true);
  await page.keyboard.press("Escape");
  await expectFocus(page, "[data-mobile-navigation-trigger]");

  await page.keyboard.press("Control+K");
  const commandDialog = page.getByRole("dialog", { name: "全局搜索" });
  await commandDialog.waitFor();
  await expectFocus(page, ".career-command-menu input[type='search']");
  await page.keyboard.press("Escape");
  await expectFocus(page, "[data-command-search-trigger]");

  const privateJdTrigger = page.getByRole("button", { name: "导入私有 JD" }).first();
  await privateJdTrigger.click();
  await page.getByRole("dialog", { name: "导入私有 JD" }).waitFor();
  await expectFocus(page, ".career-private-jd-form input[required]");
  await page.keyboard.press("Escape");
  await expectFocus(page, "[data-private-jd-trigger]");
  await assertNoDocumentOverflow(page, "320 applications shell");

  step("delete-dialog");
  await page.goto(`${baseUrl}/applications/${caseId}/overview`, { waitUntil: "domcontentloaded" });
  const deleteTrigger = page.getByRole("button", { name: "删除求职项目" });
  await deleteTrigger.click();
  await page.getByRole("dialog", { name: /分别决定关联资产如何处理/ }).waitFor();
  await expectFocus(page, ".career-deletion-dialog footer button:first-child");
  await page.keyboard.press("Escape");
  await expectFocus(page, "[data-case-delete-trigger]");

  step("flag-off");
  const flagOff = await context.newPage();
  flagOff.setDefaultTimeout(10_000);
  await flagOff.goto(`${flagOffBaseUrl}/jobs/${jobId}`, { waitUntil: "domcontentloaded" });
  await flagOff.locator("main.product-shell").waitFor();
  assert.equal(await flagOff.locator(".career-os").count(), 0, "flag-off must preserve ProductShell");
  await flagOff.close();

  assert.deepEqual(externalRequests, [], `network must remain loopback: ${externalRequests.join(" | ")}`);
  assert.deepEqual(unexpectedHttp, [], `unexpected HTTP responses: ${unexpectedHttp.join(" | ")}`);
  assert(
    deliberateHttp.some((problem) => problem.startsWith("404 ")),
    "the deliberate real-API 404 check must execute",
  );
  assert.deepEqual(consoleProblems, [], `console must stay clean: ${consoleProblems.join(" | ")}`);
  await context.close();
  process.stdout.write(`${JSON.stringify({ passed: true, caseId, viewports: [1536, 1280, 768, 320] })}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
