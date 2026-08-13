const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
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

const baseUrl = loopbackUrl(process.env.OS2_BASE_URL || "http://127.0.0.1:5173", "OS2_BASE_URL");
const flagOffBaseUrl = loopbackUrl(
  process.env.OS2_FLAG_OFF_BASE_URL || "http://127.0.0.1:5174",
  "OS2_FLAG_OFF_BASE_URL",
);
const databaseUrl = process.env.OS2_DATABASE_URL;
const jobId = process.env.OS2_JOB_ID;
const browserExecutable = process.env.OS2_BROWSER_EXECUTABLE;
const pnpmExecutable = process.env.OS2_PNPM_EXECUTABLE || "pnpm";
const workspaceRoot = process.env.OS2_WORKSPACE_ROOT || process.cwd();
const runtimeRoot = process.env.OS2_RUNTIME_ROOT || workspaceRoot;

assert.match(jobId || "", /^[0-9a-f-]{36}$/i, "OS2_JOB_ID must be a UUID");
assert(databaseUrl, "OS2_DATABASE_URL is required");
const parsedDatabaseUrl = new URL(databaseUrl);
assert(
  ["127.0.0.1", "localhost", "[::1]"].includes(parsedDatabaseUrl.hostname) &&
    /^aijob_.+_test(?:_|$)/.test(decodeURIComponent(parsedDatabaseUrl.pathname.slice(1))),
  "OS2_DATABASE_URL must point to a loopback aijob_*_test_* database",
);

function step(label) {
  process.stdout.write(`OS2_GATE_STEP:${label}\n`);
}

async function assertNoDocumentOverflow(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert(overflow <= 1, `${label} must not create document overflow (received ${overflow}px)`);
}

async function assertStableTypography(page, selector) {
  const typography = await page.locator(selector).evaluate((node) => {
    const style = getComputedStyle(node);
    return { fontSize: style.fontSize, letterSpacing: style.letterSpacing };
  });
  assert(
    typography.letterSpacing === "normal" || Number.parseFloat(typography.letterSpacing) === 0,
    `${selector} must not inherit negative tracking`,
  );
  assert.match(typography.fontSize, /^\d+(\.\d+)?px$/);
}

async function assertFocused(page, selector) {
  await page.waitForFunction((expected) => document.activeElement?.matches(expected), selector);
  const outline = await page.locator(selector).evaluate((node) => getComputedStyle(node).outlineStyle);
  assert.notEqual(outline, "none", `${selector} must have a visible focus outline`);
}

function runOwnerTasks() {
  const output = execFileSync(
    pnpmExecutable,
    [
      "--filter",
      "@aijob/platform",
      "exec",
      "tsx",
      "scripts/isolated-owner-task-runner.ts",
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(pnpmExecutable),
      env: {
        ...process.env,
        OS2_DATABASE_URL: databaseUrl,
        OS2_RUNTIME_ROOT: runtimeRoot,
      },
    },
  );
  assert.match(output, /OS2_OWNER_TASKS_PROCESSED:\d+/);
}

async function installProfile(page) {
  const sectionId = randomUUID();
  const blockId = randomUUID();
  const evidenceId = randomUUID();
  const response = await page.evaluate(
    async ({ sectionId: section, blockId: block, evidenceId: evidence }) => {
      const csrf = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("aijob_csrf="))
        ?.slice("aijob_csrf=".length);
      if (!csrf) throw new Error("OS2_CSRF_COOKIE_MISSING");
      const request = await fetch("/v1/profile/confirmation", {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrf),
        },
        body: JSON.stringify({
          facts: {
            expectedRevision: 0,
            facts: [
              { key: "current_student", value: true },
              { key: "graduation_year", value: 2027 },
              { key: "current_city", value: "上海" },
              { key: "weekly_attendance_days", value: 5 },
              { key: "duration_months", value: 6 },
              { key: "skills", value: ["SQL", "用户研究"] },
            ],
          },
          preferences: {
            expectedRevision: 0,
            preferences: {
              cities: ["上海"],
              jobFamilies: ["product"],
              companyNames: [],
              workModes: ["线下"],
            },
          },
          evidence: {
            expectedRevision: 0,
            resumeAnalysisId: null,
            document: {
              schemaVersion: "resume-document-v1",
              sections: [
                {
                  id: section,
                  ordinal: 0,
                  title: "项目经历",
                  blocks: [
                    {
                      id: block,
                      ordinal: 0,
                      text: "在合成课程项目中完成用户访谈与 SQL 数据分析，并基于证据复盘方案。",
                    },
                  ],
                },
              ],
            },
            evidence: [
              {
                id: evidence,
                resumeAnalysisId: null,
                sourceBlockId: block,
                section: "项目经历",
                evidenceType: "project",
                statement: "完成合成用户研究、SQL 数据分析与方案复盘。",
                skills: ["用户研究", "SQL"],
                outcomes: ["形成可追溯复盘"],
                confirmed: true,
              },
            ],
          },
        }),
      });
      return { status: request.status, body: await request.text() };
    },
    { sectionId, blockId, evidenceId },
  );
  assert.equal(response.status, 200, `profile confirmation failed: ${response.body}`);
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
    page.setDefaultTimeout(12_000);
    page.setDefaultNavigationTimeout(25_000);
    const consoleProblems = [];
    const externalRequests = [];
    const unexpectedHttp = [];
    const deliberateHttp = [];
    const resourcePaths = [];
    let expectedStatus = null;

    page.on("console", (message) => {
      if (!["warning", "error"].includes(message.type())) return;
      if (expectedStatus && message.text().includes(`status of ${expectedStatus}`)) return;
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
    page.on("request", (request) => {
      const url = new URL(request.url());
      resourcePaths.push(url.pathname);
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

    step("catalog-1536");
    await page.goto(`${baseUrl}/jobs?cities=%E4%B8%8A%E6%B5%B7&jobFamilies=product`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("heading", { name: "发现岗位" }).waitFor();
    await page.getByRole("heading", { name: "M4 合成产品实习生" }).waitFor();
    await assertNoDocumentOverflow(page, "1536 catalog");
    await assertStableTypography(page, "#job-discovery-title");
    assert.equal(
      resourcePaths.some((value) => /ResumeDocumentEditor|CaseInterviewWorkspace/.test(value)),
      false,
      "catalog first view must not load Resume Editor or Interview",
    );

    const searchInput = page.getByPlaceholder("搜索岗位、公司或 JD 内容");
    await searchInput.focus();
    await assertFocused(page, ".career-job-searchbar input");
    await searchInput.fill("合成产品");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.waitForURL(/keyword=/);
    assert(page.url().includes("cities="), "search must preserve city URL state");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "M4 合成产品实习生" }).waitFor();

    step("catalog-api-retry");
    await page.route("**/v1/jobs?**", async (route) => {
      expectedStatus = 503;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "SYNTHETIC_RETRY", detail: "合成目录暂时不可用" }),
      });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("合成目录暂时不可用").waitFor();
    expectedStatus = null;
    await page.unroute("**/v1/jobs?**");
    await page.getByRole("button", { name: "重试" }).click();
    await page.getByRole("heading", { name: "M4 合成产品实习生" }).waitFor();

    step("detail-history-case");
    const catalogUrl = page.url();
    await page.getByRole("link", { name: "M4 合成产品实习生" }).click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}`));
    assert(page.url().includes("from="), "job detail must retain a safe return URL");
    await page.getByRole("heading", { name: "岗位事实" }).waitFor();
    await assertStableTypography(page, "#job-workspace-title");
    await assertNoDocumentOverflow(page, "1536 job detail");
    assert.equal(
      resourcePaths.some((value) => /ResumeDocumentEditor|CaseInterviewWorkspace/.test(value)),
      false,
      "job detail first view must not load Resume Editor or Interview",
    );
    await page.goBack({ waitUntil: "networkidle" });
    assert.equal(page.url(), catalogUrl, "browser back must restore filtered catalog URL");
    await page.goForward({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "岗位事实" }).waitFor();

    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/application-cases",
    );
    await page.getByRole("button", { name: "加入我的求职" }).click();
    assert((await createResponsePromise).ok(), "Case creation must succeed through the real API");
    await page.waitForURL(/\/applications\/[0-9a-f-]{36}\/requirements/i);
    const caseId = page.url().match(/\/applications\/([0-9a-f-]{36})\//i)?.[1];
    assert.match(caseId || "", /^[0-9a-f-]{36}$/i);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "逐项理解岗位要求" }).waitFor();

    step("confirmed-profile-import");
    await installProfile(page);
    await page.goto(`${baseUrl}/resumes/import`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "上传简历，先确认事实与证据" }).waitFor();
    await page.getByRole("heading", { name: "不用重复上传昨天的简历" }).waitFor();
    await assertStableTypography(page, ".career-profile-import .product-hero h1");
    await assertNoDocumentOverflow(page, "1536 profile import");

    step("recommendation-session-boundary");
    await page.goto(
      `${baseUrl}/jobs/recommended?cities=%E4%B8%8A%E6%B5%B7&jobFamilies=product`,
      { waitUntil: "networkidle" },
    );
    await page.getByRole("heading", { name: "证据推荐" }).waitFor();
    let interceptedRecommendationPosts = 0;
    await page.route("**/v1/recommendation-runs/from-search", async (route) => {
      interceptedRecommendationPosts += 1;
      expectedStatus = 403;
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "SESSION_REQUIRED", detail: "合成会话边界" }),
      });
    });
    await page.getByRole("button", { name: "生成推荐", exact: true }).first().click();
    await page.getByText(/系统没有自动重放刚才的修改/).waitFor();
    assert.equal(interceptedRecommendationPosts, 1, "mutation must not replay after session recovery");
    expectedStatus = null;
    await page.unroute("**/v1/recommendation-runs/from-search");

    const recommendationResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/recommendation-runs/from-search",
    );
    await page.getByRole("button", { name: "重试" }).click();
    const recommendationResponse = await recommendationResponsePromise;
    assert.equal(recommendationResponse.status(), 202);
    await page.waitForURL(/\/jobs\/recommended\/[0-9a-f-]{36}/i);
    const recommendationUrl = page.url();
    const recommendationRunId = recommendationUrl.match(/\/recommended\/([0-9a-f-]{36})/i)?.[1];
    assert.match(recommendationRunId || "", /^[0-9a-f-]{36}$/i);
    runOwnerTasks();
    await page.getByRole("heading", { name: "1 个岗位依据" }).waitFor();
    await assertNoDocumentOverflow(page, "1536 recommendation");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "1 个岗位依据" }).waitFor();

    step("recommendation-cross-owner-404");
    const otherContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const otherPage = await otherContext.newPage();
    otherPage.on("request", (request) => {
      const url = new URL(request.url());
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
        externalRequests.push(`${request.method()} ${request.url()}`);
      }
    });
    expectedStatus = 404;
    await otherPage.goto(`${baseUrl}/jobs/recommended/${recommendationRunId}`, {
      waitUntil: "domcontentloaded",
    });
    await otherPage.getByText("这组推荐不可读取").waitFor();
    await otherContext.close();
    expectedStatus = null;

    step("insight-deep-link");
    await page.goto(`${baseUrl}/jobs/insights`, { waitUntil: "networkidle" });
    await page.getByLabel("岗位方向").selectOption("product");
    await page.getByLabel("城市").fill("上海");
    assert.equal(await page.getByLabel("对照最新已确认经历证据").isChecked(), true);
    const insightResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/job-insight-runs",
    );
    await page.getByRole("button", { name: "生成市场洞察" }).click();
    assert((await insightResponsePromise).ok(), "insight creation must succeed");
    await page.waitForURL(/\/jobs\/insights\/[0-9a-f-]{36}/i);
    const insightUrl = page.url();
    await page.getByRole("heading", { name: "产品岗位要求概览" }).waitFor();
    await page.getByText("当前样本不足，不生成高频排名").waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "产品岗位要求概览" }).waitFor();
    await page.goBack({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "岗位市场洞察" }).waitFor();
    await page.goForward({ waitUntil: "networkidle" });
    assert.equal(page.url(), insightUrl, "browser forward must restore the fixed insight run");

    step("four-viewports");
    const viewportCases = [
      { width: 1280, height: 900, label: "1280" },
      { width: 768, height: 900, label: "768-equivalent-200-percent" },
      { width: 320, height: 800, label: "320" },
    ];
    for (const viewport of viewportCases) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const target of [
        `${baseUrl}/jobs`,
        `${baseUrl}/jobs/${jobId}`,
        recommendationUrl,
        insightUrl,
        `${baseUrl}/resumes/import`,
      ]) {
        await page.goto(target, { waitUntil: "networkidle" });
        await assertNoDocumentOverflow(page, `${viewport.label} ${new URL(target).pathname}`);
      }
    }

    step("mobile-keyboard");
    await page.goto(`${baseUrl}/jobs`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "打开全局导航" }).click();
    await page.getByRole("dialog", { name: "全局导航" }).waitFor();
    await page.keyboard.press("Escape");
    await assertFocused(page, "[data-mobile-navigation-trigger]");
    await page.getByPlaceholder("搜索岗位、公司或 JD 内容").focus();
    await assertFocused(page, ".career-job-searchbar input");

    step("flag-off");
    const flagOff = await context.newPage();
    await flagOff.goto(`${flagOffBaseUrl}/jobs/${jobId}`, { waitUntil: "domcontentloaded" });
    await flagOff.locator("main.product-shell").waitFor();
    assert.equal(await flagOff.locator(".career-os").count(), 0);
    await flagOff.close();

    assert.deepEqual(externalRequests, [], `network must remain loopback: ${externalRequests.join(" | ")}`);
    assert.deepEqual(unexpectedHttp, [], `unexpected HTTP responses: ${unexpectedHttp.join(" | ")}`);
    assert(
      deliberateHttp.some((problem) => problem.startsWith("503 ")),
      "the deliberate catalog retry check must execute",
    );
    assert.deepEqual(consoleProblems, [], `console must stay clean: ${consoleProblems.join(" | ")}`);
    await context.close();
    process.stdout.write(
      `${JSON.stringify({
        passed: true,
        caseId,
        recommendationRunId,
        insightUrl,
        viewports: [1536, 1280, 768, 320],
      })}\n`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
