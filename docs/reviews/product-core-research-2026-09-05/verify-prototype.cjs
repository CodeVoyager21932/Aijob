// Read-only browser verification of the standalone synthetic prototype.
// Pass the installed Playwright module directory as the first argument.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.argv[2] || "playwright");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const checks = [];
  const errors = [];
  const remoteRequests = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
    });
    const url = pathToFileURL(path.join(__dirname, "role-map.html")).href;
    await page.goto(url, { waitUntil: "networkidle" });
    assert.equal(await page.locator("#job-count").innerText(), "8");
    assert.equal(await page.locator("#company-count").innerText(), "4");
    assert.match(await page.locator("#parsed-count").innerText(), /7\s*\/\s*8/);
    assert.match(await page.locator('[data-skill="sql"] .bar-value').innerText(), /88%/);
    await page.screenshot({ path: path.join(__dirname, "prototype-desktop.png"), fullPage: true });
    checks.push("Default sample: 8 jobs, 4 companies, 7 parsed; SQL mention 7/8 (88% rounded).");
    await page.getByRole("button", { name: "按企业", exact: true }).click();
    assert.match(await page.locator('[data-skill="sql"] .bar-value').innerText(), /75%/);
    checks.push("Denominator switch: SQL coverage 3/4 companies (75%); jobs remain untruncated.");
    await page.locator('[data-skill="analysis"]').click();
    assert.match(await page.locator("#evidence-heading").innerText(), /分析/);
    await page.locator("#sources summary").first().click();
    assert.match(await page.locator("#sources details[open]").innerText(), /DEMO-/);
    await page.locator("#add-plan").click();
    assert.equal(await page.locator("#plan-count").innerText(), "1");
    await page.locator("[data-plan]").check();
    assert.equal(await page.locator("#plans label.done").count(), 1);
    checks.push(
      "Requirement selection exposes job context and adds a separately marked preparation action.",
    );
    await page.locator("#degree").selectOption("2");
    await page.locator("#kind").selectOption("实习");
    await page.locator("#city").selectOption("上海");
    assert.equal(await page.locator("#job-count").innerText(), "1");
    assert.ok((await page.locator(".bar-row").count()) > 0);
    await page.locator("#city").selectOption("北京");
    assert.equal(await page.locator("#job-count").innerText(), "0");
    assert.equal(await page.locator("#add-plan").isDisabled(), true);
    assert.equal(await page.locator("#plan-count").innerText(), "1");
    checks.push(
      "Combined filters preserve a one-job sample, handle empty results, and retain the temporary plan.",
    );
    await page.locator("#reset").click();
    await page.locator("#role").selectOption("all");
    assert.equal(await page.locator("#job-count").innerText(), "32");
    assert.equal(await page.locator("#company-count").innerText(), "4");
    const percentages = await page
      .locator(".bar-row")
      .evaluateAll((rows) =>
        rows.map((row) => Number.parseFloat(row.style.getPropertyValue("--bar"))),
      );
    assert.ok(percentages.every((value) => value >= 0 && value <= 100));
    for (const role of ["product", "operations", "research"]) {
      await page.locator("#role").selectOption(role);
      assert.equal(await page.locator("#job-count").innerText(), "8");
      assert.ok((await page.locator("#sources .source").count()) > 0);
    }
    checks.push("All four role filters and the combined 32-job scope update counts and evidence.");
    await page.locator("[data-remove]").click();
    assert.equal(await page.locator("#plan-count").innerText(), "0");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#plan-count").innerText(), "0");
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: path.join(__dirname, "prototype-mobile.png"), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.locator('[data-mode="companies"]').focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator('[data-mode="companies"]').getAttribute("aria-pressed"),
      "true",
    );
    await page.locator('[data-skill="sql"]').focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator('[data-skill="sql"]').getAttribute("aria-pressed"), "true");
    checks.push(
      "360px layout has no horizontal overflow; keyboard toggles and requirement selection work.",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(remoteRequests, []);
    checks.push("No browser errors or HTTP(S) requests; all content is local and synthetic.");
    fs.writeFileSync(
      path.join(__dirname, "prototype-checks.json"),
      `${JSON.stringify({ checkedAt: new Date().toISOString(), scope: "Standalone synthetic prototype only; not the production application", status: "passed", checks }, null, 2)}\n`,
    );
    process.stdout.write(`${checks.length} prototype checks passed.\n`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
