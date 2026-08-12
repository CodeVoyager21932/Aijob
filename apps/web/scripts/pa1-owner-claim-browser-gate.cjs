const assert = require("node:assert/strict");
const path = require("node:path");

const runtimeModules = process.env.CODEX_RUNTIME_NODE_MODULES;
if (!runtimeModules) throw new Error("CODEX_RUNTIME_NODE_MODULES is required");
const { chromium } = require(path.join(runtimeModules, "playwright"));

const baseUrl = "http://127.0.0.1:5173/settings/data";
const claimEmail = `claim.pa1.${Date.now()}@example.test`;
const verificationCode = "135790";

async function main() {
  const unexpectedConsoleErrors = [];
  const requests = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CODEX_BROWSER_EXECUTABLE || chromium.executablePath(),
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") unexpectedConsoleErrors.push(message.text());
    });
    page.on("request", (request) => requests.push(request.url()));

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "用邮箱认领这个本机身份" }).waitFor();
    const ownerBefore = (await context.cookies()).find((cookie) => cookie.name === "aijob_session");
    assert.ok(ownerBefore, "anonymous owner session was not bootstrapped");

    const emailInput = page.getByRole("textbox", { name: "邮箱", exact: true });
    assert.equal(await emailInput.evaluate((element) => element === document.activeElement), true);
    await emailInput.fill(claimEmail);
    await page.getByRole("button", { name: "发送验证码" }).click();

    const codeInput = page.getByRole("textbox", { name: "6 位验证码" });
    await codeInput.waitFor();
    assert.equal((await page.locator("body").innerText()).includes(claimEmail), false);
    await codeInput.fill(verificationCode);
    await page.getByRole("button", { name: "验证并认领" }).click();
    await page.getByRole("heading", { name: "长期账号管理" }).waitFor();
    await page.getByRole("heading", { name: "用邮箱认领这个本机身份" }).waitFor({ state: "detached" });
    await page.waitForLoadState("networkidle");

    const ownerAfter = (await context.cookies()).find((cookie) => cookie.name === "aijob_session");
    assert.ok(ownerAfter, "account-managed session cookie is missing");
    assert.notEqual(ownerAfter.value, ownerBefore.value, "claim did not rotate the session token");

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "长期账号管理" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "用邮箱认领这个本机身份" }).count(), 0);

    for (const rawUrl of requests) {
      const url = new URL(rawUrl);
      if (url.protocol === "data:" || url.protocol === "blob:") continue;
      assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), `external request: ${rawUrl}`);
    }
    assert.deepEqual(unexpectedConsoleErrors, []);
  } finally {
    await browser.close();
  }

  console.log(
    "PA-1 owner-claim browser gate passed: current owner, session rotation, account-managed reload, and local-only network",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
