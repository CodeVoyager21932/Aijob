const assert = require("node:assert/strict");
const path = require("node:path");

const runtimeModules = process.env.CODEX_RUNTIME_NODE_MODULES;
if (!runtimeModules) throw new Error("CODEX_RUNTIME_NODE_MODULES is required");
const { chromium } = require(path.join(runtimeModules, "playwright"));

const baseUrl = "http://127.0.0.1:5173";
const invitedEmail = "coco.pa1@example.test";
const verificationCode = "246810";

function assertLocalRequest(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol === "data:" || url.protocol === "blob:") return;
  assert.ok(
    url.hostname === "127.0.0.1" || url.hostname === "localhost",
    `external request observed: ${rawUrl}`,
  );
}

async function main() {
  const consoleErrors = [];
  const pageErrors = [];
  const requests = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CODEX_BROWSER_EXECUTABLE || chromium.executablePath(),
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("request", (request) => requests.push(request.url()));

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "验证受邀邮箱继续" }).waitFor();
    const emailInput = page.getByRole("textbox", { name: "受邀邮箱" });
    assert.equal(await emailInput.evaluate((element) => element === document.activeElement), true);
    await emailInput.fill(invitedEmail);
    await page.getByRole("button", { name: "发送验证码" }).click();

    const codeInput = page.getByRole("textbox", { name: "6 位验证码" });
    await codeInput.waitFor();
    assert.equal(await codeInput.evaluate((element) => element === document.activeElement), true);
    assert.equal((await page.locator("body").innerText()).includes(invitedEmail), false);

    await codeInput.fill("000000");
    await page.getByRole("button", { name: "验证并进入 Aijob" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await codeInput.evaluate((element) => element === document.activeElement), true);
    assert.ok(
      consoleErrors.every((message) => message.includes("403")),
      `unexpected console errors during the deliberate rejection: ${JSON.stringify(consoleErrors)}`,
    );
    consoleErrors.length = 0;

    await codeInput.fill(verificationCode);
    const completionResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/v1/email-verification-challenges/complete"),
    );
    await page.getByRole("button", { name: "验证并进入 Aijob" }).click();
    const completionResponse = await completionResponsePromise;
    await page
      .getByRole("heading", { name: "验证受邀邮箱继续" })
      .waitFor({ state: "detached" });
    await page.waitForLoadState("networkidle");
    const cookies = await context.cookies();
    assert.ok(
      cookies.some((cookie) => cookie.name === "aijob_session"),
      `session cookie missing; response headers=${JSON.stringify(await completionResponse.allHeaders())}; cookies=${JSON.stringify(cookies)}`,
    );

    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.getByRole("heading", { name: "验证受邀邮箱继续" }).count(), 0);

    await page.setViewportSize({ width: 320, height: 720 });
    await page.reload({ waitUntil: "networkidle" });
    const widths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    assert.ok(widths.document <= widths.viewport, `document overflow: ${JSON.stringify(widths)}`);
    assert.ok(widths.body <= widths.viewport, `body overflow: ${JSON.stringify(widths)}`);
    await page.keyboard.press("Tab");
    const activeTag = await page.evaluate(() => document.activeElement?.tagName);
    assert.ok(![undefined, "BODY", "HTML"].includes(activeTag), "keyboard focus is not interactive");

    for (const url of requests) assertLocalRequest(url);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }

  console.log(
    "PA-1 browser gate passed: invited email, rejected-code focus recovery, session reload, " +
      "320px overflow, keyboard focus, and local-only network",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
