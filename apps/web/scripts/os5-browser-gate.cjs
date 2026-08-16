const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { Client } = require("../../../packages/database/node_modules/pg");

process.env.M1_PUBLIC_TITLE ||= "OS-5 合成产品策略实习生";
const { seedBaseResume, seedCatalog } = require("./m1-browser-gate.cjs");

function loadPlaywright() {
  const bundledModules = process.env.CODEX_NODE_MODULES;
  return bundledModules
    ? require(path.join(bundledModules, "playwright"))
    : require("playwright");
}

function loopbackOrigin(value, label) {
  const parsed = new URL(value);
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname),
    `${label} must stay on loopback`,
  );
  return parsed.origin;
}

function safeDatabaseUrl(value) {
  assert(value, "OS5_DATABASE_URL is required");
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
      /^aijob_.+_test(?:_|$)/.test(databaseName),
    "OS5_DATABASE_URL must point to a loopback aijob_*_test_* database",
  );
  return value;
}

const baseUrl = loopbackOrigin(process.env.OS5_BASE_URL || "http://127.0.0.1:5173", "OS5_BASE_URL");
const flagOffBaseUrl = loopbackOrigin(
  process.env.OS5_FLAG_OFF_BASE_URL || "http://127.0.0.1:5174",
  "OS5_FLAG_OFF_BASE_URL",
);
const databaseUrl = safeDatabaseUrl(process.env.OS5_DATABASE_URL);
const browserExecutable = process.env.OS5_BROWSER_EXECUTABLE || undefined;
const pnpmExecutable = process.env.OS5_PNPM_EXECUTABLE || "pnpm";
const workspaceRoot = process.env.OS5_WORKSPACE_ROOT || process.cwd();
const runtimeRoot = process.env.OS5_RUNTIME_ROOT || workspaceRoot;
const publicTitle = process.env.M1_PUBLIC_TITLE;

function step(label) {
  process.stdout.write(`OS5_GATE_STEP:${label}\n`);
}

async function assertNoDocumentOverflow(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert(overflow <= 1, `${label} must not create document overflow (received ${overflow}px)`);
}

async function assertFocused(page, selector) {
  await page.waitForFunction((expected) => document.activeElement?.matches(expected), selector);
  const focus = await page.locator(selector).evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      outline: style.outlineStyle !== "none" && style.outlineWidth !== "0px",
      ring: style.boxShadow !== "none",
    };
  });
  assert(focus.outline || focus.ring, `${selector} must expose a visible focus indicator`);
}

function runOwnerTasks() {
  const output = execFileSync(
    pnpmExecutable,
    ["--filter", "@aijob/platform", "exec", "tsx", "scripts/isolated-owner-task-runner.ts"],
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
  assert.match(output, /OS2_OWNER_TASKS_PROCESSED:[1-9]\d*/);
}

async function browserRequest(page, input) {
  const result = await page.evaluate(async ({ method, requestPath, body, idempotencyKey }) => {
    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("aijob_csrf="))
      ?.slice("aijob_csrf=".length);
    if (!csrf) throw new Error("OS5_CSRF_COOKIE_MISSING");
    const response = await fetch(requestPath, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "x-csrf-token": decodeURIComponent(csrf),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, text: await response.text() };
  }, input);
  assert.equal(
    result.status,
    input.expectedStatus ?? result.status,
    `${input.method} ${input.requestPath} returned ${result.status}: ${result.text}`,
  );
  if (input.expectedStatus === undefined) {
    assert(result.status >= 200 && result.status < 300, result.text);
  }
  return { status: result.status, body: result.text ? JSON.parse(result.text) : null };
}

async function openPrivateCase(page) {
  await page.goto(`${baseUrl}/applications`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "导入私有 JD" }).first().click();
  await page.getByLabel("岗位名称").fill("OS-5 私有产品运营实习生");
  await page.getByLabel("公司名称（可不填）").fill("OS-5 私有合成公司");
  await page
    .getByLabel("JD 原文")
    .fill(
      "岗位职责\n负责用户访谈、SQL 数据核验与方案复盘。\n任职要求\n掌握 SQL 与用户研究；每周到岗四天；其他安排未说明。",
    );
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/application-cases",
  );
  await page.getByRole("button", { name: "加入我的求职" }).last().click();
  const response = await responsePromise;
  assert.equal(response.status(), 201);
  const caseId = (await response.json()).applicationCase.id;
  await page.waitForURL(new RegExp(`/applications/${caseId}/requirements`));
  return caseId;
}

async function createDerivedResume(page, caseId) {
  await page.goto(`${baseUrl}/applications/${caseId}/resume`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "创建这份岗位派生简历" }).waitFor();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/resume-documents",
  );
  await page.getByRole("button", { name: "创建岗位简历" }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 201);
  const documentId = (await response.json()).resumeDocument.id;
  await page.locator(".career-resume-editor").waitFor();
  return documentId;
}

async function decideSuggestion(page, action, editedText) {
  const card = page
    .locator(".career-resume-review__suggestions > li")
    .filter({ has: page.getByRole("button", { name: action, exact: true }) })
    .first();
  await card.waitFor();
  await card.getByRole("button", { name: action, exact: true }).click();
  const decisionDraft = page.locator(".career-resume-review__decision-draft").first();
  await decisionDraft.waitFor();
  if (editedText) await decisionDraft.locator("textarea").fill(editedText);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/suggestions\/[0-9a-f-]+\/decisions$/i.test(new URL(response.url()).pathname),
  );
  await decisionDraft.getByRole("button", { name: "确认保存决定" }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  await page.waitForTimeout(120);
}

async function addEvidenceBackedBlock(page, text) {
  await page.getByRole("button", { name: "+ 添加内容区块" }).click();
  const block = page.locator(".career-resume-editor__block").last();
  const blockId = await block
    .locator("[data-resume-editor-block]")
    .getAttribute("data-resume-editor-block");
  assert(blockId, "the added block must expose a stable URL identifier");
  await block.locator("textarea").fill(text);
  await page.waitForTimeout(250);
  const selectionState = await page.evaluate(() => ({
    activeBlockId:
      document.activeElement
        ?.closest(".career-resume-editor__block")
        ?.querySelector("[data-resume-editor-block]")
        ?.getAttribute("data-resume-editor-block") ?? null,
    blocks: Array.from(document.querySelectorAll("[data-resume-editor-block]")).map((node) => ({
      id: node.getAttribute("data-resume-editor-block"),
      pressed: node.getAttribute("aria-pressed"),
    })),
  }));
  assert.equal(
    new URL(page.url()).searchParams.get("block"),
    blockId,
    `the added block must become the active deep-link (${page.url()}; ${JSON.stringify(selectionState)})`,
  );
  const evidenceInput = page.locator('.career-resume-editor__evidence input[type="checkbox"]').first();
  assert.equal(await evidenceInput.count(), 1, "the fixed evidence revision must stay visible");
  if (!(await evidenceInput.isChecked())) await evidenceInput.check();
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const jobId = await seedCatalog(client);
  const { chromium } = loadPlaywright();
  let browser = null;

  const allowedHttp = [];
  const deliberateHttp = [];
  const unexpectedHttp = [];
  const consoleProblems = [];
  const externalRequests = [];
  const resourcePaths = [];
  const reviewPosts = [];
  const allowHttp = (status, pattern) => allowedHttp.push({ status, pattern });
  const trackPage = (page) => {
    page.on("console", (message) => {
      if (!["warning", "error"].includes(message.type())) return;
      if ([403, 404, 409, 422, 503].some((status) => message.text().includes(`status of ${status}`))) {
        return;
      }
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
    page.on("request", (request) => {
      const url = new URL(request.url());
      resourcePaths.push(url.pathname);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
        externalRequests.push(`${request.method()} ${request.url()}`);
      }
      if (request.method() === "POST" && /\/resume-documents\/[0-9a-f-]+\/reviews$/i.test(url.pathname)) {
        reviewPosts.push({
          path: url.pathname,
          idempotencyKey: request.headers()["idempotency-key"] || null,
          body: request.postData(),
        });
      }
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      const url = new URL(response.url());
      const problem = `${response.status()} ${url.pathname}${url.search}`;
      const allowed = allowedHttp.some(
        ({ status, pattern }) => status === response.status() && pattern.test(url.pathname),
      );
      if (allowed) deliberateHttp.push(problem);
      else unexpectedHttp.push(problem);
    });
  };

  try {
    browser = await chromium.launch({
      executablePath: browserExecutable,
      headless: true,
      timeout: 30_000,
    });
    const context = await browser.newContext({ viewport: { width: 1536, height: 960 } });
    const page = await context.newPage();
    page.setDefaultTimeout(18_000);
    page.setDefaultNavigationTimeout(30_000);
    trackPage(page);

    step("public-case-base-resume-and-lazy-entry");
    await page.goto(`${baseUrl}/jobs/${jobId}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: publicTitle }).waitFor();
    const caseResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/application-cases",
    );
    await page.getByRole("button", { name: "加入我的求职" }).click();
    const caseResponse = await caseResponsePromise;
    assert.equal(caseResponse.status(), 201);
    const publicCaseId = (await caseResponse.json()).applicationCase.id;
    await page.goto(`${baseUrl}/applications/${publicCaseId}/overview`, {
      waitUntil: "networkidle",
    });
    assert.equal(
      resourcePaths.some((value) =>
        /CaseResumeWorkspace|ResumeDocumentEditor|ResumeReviewPanel|CaseInterviewWorkspace/.test(value),
      ),
      false,
      "Case first paint must not load Resume Studio or Interview",
    );
    await seedBaseResume(client, publicCaseId);
    const publicDocumentId = await createDerivedResume(page, publicCaseId);
    assert(
      resourcePaths.some((value) => /ResumeDocumentEditor/.test(value)),
      "opening the resume tab must lazy-load Resume Studio",
    );
    assert.equal(
      resourcePaths.some((value) => /CaseInterviewWorkspace/.test(value)),
      false,
      "Resume Studio must not load Interview",
    );

    const editor = page.locator(".career-resume-editor");
    await editor.getByText("岗位要求", { exact: true }).waitFor();
    await editor.locator(".career-resume-review__requirements li").nth(2).waitFor();
    assert.equal(await editor.locator(".career-resume-review__requirements li").count(), 3);
    assert.equal(await editor.locator(".career-resume-editor__rail").isVisible(), true);
    assert.equal(await editor.locator(".career-resume-editor__document").isVisible(), true);
    assert.equal(await editor.locator(".career-resume-editor__review-pane").isVisible(), true);
    assert.doesNotMatch(await editor.innerText(), /匹配良好|匹配度|总分/);

    step("requirements-deeplink-refresh-history-and-draft-navigation");
    await editor.getByRole("button", { name: /掌握 SQL，并能完成用户研究与数据分析/ }).click();
    await page.waitForURL(/studio=review.*requirement=m1-sql|requirement=m1-sql.*studio=review/);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".career-resume-review__requirements li.is-selected").waitFor();
    await page.goBack({ waitUntil: "networkidle" });
    assert.equal(await page.locator(".career-resume-review__requirements li.is-selected").count(), 0);
    await page.goForward({ waitUntil: "networkidle" });
    await page.locator(".career-resume-review__requirements li.is-selected").waitFor();

    await addEvidenceBackedBlock(
      page,
      "负责 SQL 数据分析，并根据用户访谈整理复盘结论。",
    );
    await addEvidenceBackedBlock(
      page,
      "参与用户研究并核对 SQL 数据，结论仍由证据确认。",
    );
    const textareas = page.locator(".career-resume-editor__block textarea");

    await page.getByRole("link", { name: "JD能力" }).click();
    await page.getByRole("heading", { name: "要离开这份简历吗？" }).waitFor();
    await assertFocused(page, ".career-resume-draft-guard .career-button--danger-quiet");
    await page.getByRole("button", { name: "继续编辑" }).click();
    assert.match(page.url(), new RegExp(`/applications/${publicCaseId}/resume`));
    assert.equal(
      await textareas.last().inputValue(),
      "参与用户研究并核对 SQL 数据，结论仍由证据确认。",
    );

    const saveInitialPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/resume-documents/${publicDocumentId}/revisions`,
    );
    await page.getByRole("button", { name: "保存正文修订" }).click();
    assert.equal((await saveInitialPromise).status(), 201);
    await page.getByText(/正文已保存为内容修订/).waitFor();

    await page.goto(`${baseUrl}/applications/${publicCaseId}/requirements`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("link", { name: "定制简历" }).click();
    await page.locator(".career-resume-editor").waitFor();
    const guardedDraft = page.locator(".career-resume-editor__block textarea").first();
    await guardedDraft.fill("浏览器后退前仍应保留的 OS-5 草稿");
    await page.evaluate(() => history.back());
    await page.getByRole("heading", { name: "要离开这份简历吗？" }).waitFor();
    await page.getByRole("button", { name: "继续编辑" }).click();
    assert.equal(await guardedDraft.inputValue(), "浏览器后退前仍应保留的 OS-5 草稿");
    await page.getByRole("button", { name: "放弃修改" }).click();

    step("revision-conflict-preserves-draft");
    const secondPage = await context.newPage();
    secondPage.setDefaultTimeout(18_000);
    trackPage(secondPage);
    await secondPage.goto(page.url(), { waitUntil: "networkidle" });
    const secondDraft = secondPage.locator(".career-resume-editor__block textarea").first();
    await secondDraft.fill("标签页二必须保留的冲突草稿");
    const firstDraft = page.locator(".career-resume-editor__block textarea").first();
    await firstDraft.fill("OS-5 标签页一：完成 SQL 用户研究并形成证据复盘。");
    const tabOneSave = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/resume-documents/${publicDocumentId}/revisions`,
    );
    await page.getByRole("button", { name: "保存正文修订" }).click();
    assert.equal((await tabOneSave).status(), 201);
    allowHttp(409, new RegExp(`/resume-documents/${publicDocumentId}/revisions$`));
    const conflictResponsePromise = secondPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/resume-documents/${publicDocumentId}/revisions`,
    );
    await secondPage.getByRole("button", { name: "保存正文修订" }).click();
    const conflictResponse = await conflictResponsePromise;
    assert.equal(conflictResponse.status(), 409);
    await secondPage.getByText("服务器已有更新，本地草稿没有被覆盖").waitFor();
    assert.equal(await secondDraft.inputValue(), "标签页二必须保留的冲突草稿");
    await secondPage.getByRole("button", { name: "放弃草稿，加载最新" }).click();
    await secondPage.close();

    step("session-no-replay-template-review-and-three-decisions");
    allowHttp(403, new RegExp(`/resume-documents/${publicDocumentId}/reviews$`));
    let interceptReview = true;
    let interceptedReviewPosts = 0;
    const reviewMutationPattern = `**/v1/resume-documents/${publicDocumentId}/reviews`;
    const sessionRoute = async (route) => {
      if (!interceptReview) return route.continue();
      interceptedReviewPosts += 1;
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "SESSION_REQUIRED", detail: "OS-5 合成会话边界" }),
      });
    };
    await page.route(reviewMutationPattern, sessionRoute);
    await page.getByRole("button", { name: "运行确定性模板" }).click();
    await page
      .locator(".career-session-mutation-notice")
      .getByText(/系统没有自动重放刚才的修改/)
      .waitFor();
    assert.equal(interceptedReviewPosts, 1);
    interceptReview = false;
    const reviewQueuedPromise = page.waitForResponse(
      (response) =>
        response.status() === 202 &&
        new URL(response.url()).pathname === `/v1/resume-documents/${publicDocumentId}/reviews`,
    );
    await page.getByRole("button", { name: "运行确定性模板" }).click();
    await reviewQueuedPromise;
    assert.equal(interceptedReviewPosts, 1, "session recovery must not replay the mutation");
    assert.equal(reviewPosts.length, 2);
    assert.equal(reviewPosts[0].idempotencyKey, reviewPosts[1].idempotencyKey);
    await page.unroute(reviewMutationPattern, sessionRoute);
    runOwnerTasks();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("审阅已完成", { exact: true }).waitFor();
    await page.getByText(/确定性模板 · resume-review-template-v2/).waitFor();
    const suggestionCount = await page.locator(".career-resume-review__suggestions > li").count();
    assert(suggestionCount >= 3, `expected at least three review suggestions, received ${suggestionCount}`);
    assert(
      (await page.locator(".career-resume-review__requirement-refs button").count()) >= 3,
      "v2 rewrite suggestions must expose fixed requirement citations",
    );
    await decideSuggestion(page, "采用建议");
    await decideSuggestion(page, "编辑后采用", "完成用户研究、SQL 分析与方案复盘。");
    await decideSuggestion(page, "保留原文");

    step("controlled-ai-consent-and-explicit-template-fallback");
    await page.getByLabel("本次同意去标识化处理").check();
    const aiReviewQueued = page.waitForResponse(
      (response) =>
        response.status() === 202 &&
        new URL(response.url()).pathname === `/v1/resume-documents/${publicDocumentId}/reviews`,
    );
    await page.getByRole("button", { name: "使用受控 AI 审阅" }).click();
    await aiReviewQueued;
    runOwnerTasks();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText(/受控 AI 未启用，已改用确定性模板/).first().waitFor();
    const firstControlledAiPost = reviewPosts.findLast((request) =>
      request.body?.includes('"mode":"controlled_ai"'),
    );
    assert(firstControlledAiPost?.idempotencyKey, "controlled AI command must have an idempotency key");

    step("successful-review-starts-a-new-explicit-command");
    await page.getByLabel("本次同意去标识化处理").check();
    const repeatedAiReviewQueued = page.waitForResponse(
      (response) =>
        response.status() === 202 &&
        new URL(response.url()).pathname === `/v1/resume-documents/${publicDocumentId}/reviews`,
    );
    await page.getByRole("button", { name: "使用受控 AI 审阅" }).click();
    await repeatedAiReviewQueued;
    const controlledAiPosts = reviewPosts.filter((request) =>
      request.body?.includes('"mode":"controlled_ai"'),
    );
    assert.equal(controlledAiPosts.length, 2);
    assert.notEqual(
      controlledAiPosts[0].idempotencyKey,
      controlledAiPosts[1].idempotencyKey,
      "a successful Review must release the prior command key before an explicit rerun",
    );
    runOwnerTasks();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText(/受控 AI 未启用，已改用确定性模板/).first().waitFor();
    const controlledRun = await client.query(
      `SELECT schema_version, mode, privacy_consent_at, provider_adapter, model,
              used_template_fallback, fallback_reason_code
         FROM profile.resume_review_runs
        WHERE document_id = $1 AND mode = 'controlled_ai'
        ORDER BY created_at DESC LIMIT 1`,
      [publicDocumentId],
    );
    assert.equal(controlledRun.rowCount, 1);
    assert.equal(controlledRun.rows[0].schema_version, "resume-review-run-v2");
    assert(controlledRun.rows[0].privacy_consent_at, "controlled AI consent must be persisted");
    assert.equal(controlledRun.rows[0].provider_adapter, null);
    assert.equal(controlledRun.rows[0].model, null);
    assert.equal(controlledRun.rows[0].used_template_fallback, true);
    assert.equal(controlledRun.rows[0].fallback_reason_code, "AI_DISABLED");

    step("review-read-failure-docx-and-print");
    allowHttp(503, new RegExp(`/resume-documents/${publicDocumentId}/review$`));
    let failReviewRead = true;
    const reviewReadPattern = `**/v1/resume-documents/${publicDocumentId}/review`;
    const reviewReadRoute = async (route) => {
      if (!failReviewRead) return route.continue();
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "OS5_REVIEW_READ_FAILED", detail: "OS-5 合成读取失败" }),
      });
    };
    await page.route(reviewReadPattern, reviewReadRoute);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("审阅记录暂时无法读取").waitFor();
    failReviewRead = false;
    await page.locator(".career-resume-review").getByRole("button", { name: "重新读取" }).click();
    await page.getByText(/受控 AI 未启用，已改用确定性模板/).first().waitFor();
    await page.unroute(reviewReadPattern, reviewReadRoute);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 DOCX" }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.docx$/i);
    const stream = await download.createReadStream();
    const firstChunk = await new Promise((resolve, reject) => {
      stream.once("data", resolve);
      stream.once("error", reject);
    });
    assert.equal(Buffer.from(firstChunk).subarray(0, 2).toString("ascii"), "PK");
    await download.cancel();
    await page.evaluate(() => {
      window.__os5PrintCalled = false;
      window.print = () => {
        window.__os5PrintCalled = true;
      };
    });
    assert.equal(await page.locator("body > .career-resume-print-document").count(), 1);
    await page.getByRole("button", { name: "浏览器打印" }).click();
    assert.equal(await page.evaluate(() => window.__os5PrintCalled), true);

    step("public-private-requirements-and-four-viewports");
    const privateCaseId = await openPrivateCase(page);
    const privateDocumentId = await createDerivedResume(page, privateCaseId);
    await page.getByText(/掌握 SQL 与用户研究/).first().waitFor();
    const privateReviewQueued = page.waitForResponse(
      (response) =>
        response.status() === 202 &&
        new URL(response.url()).pathname === `/v1/resume-documents/${privateDocumentId}/reviews`,
    );
    await page.getByRole("button", { name: "运行确定性模板" }).click();
    await privateReviewQueued;
    runOwnerTasks();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("审阅已完成", { exact: true }).waitFor();
    assert(
      (await page.locator(".career-resume-review__requirement-refs button").count()) > 0,
      "private fixed requirements must be cited by Review v2",
    );

    const publicResumeUrl = `${baseUrl}/applications/${publicCaseId}/resume?studio=review&requirement=m1-sql`;
    for (const viewport of [
      { width: 1536, height: 960, label: "1536" },
      { width: 1280, height: 900, label: "1280" },
      { width: 768, height: 900, label: "768-200-percent-equivalent" },
      { width: 320, height: 800, label: "320" },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(publicResumeUrl, { waitUntil: "networkidle" });
      await page.locator(".career-resume-editor").waitFor();
      if (viewport.width <= 1023) {
        for (const [label, selector] of [
          ["结构", ".career-resume-editor__rail"],
          ["文稿", ".career-resume-editor__document"],
          ["建议", ".career-resume-editor__review-pane"],
        ]) {
          const modeButton = page
            .locator(".career-resume-editor__mode-switch")
            .getByRole("button", { name: label });
          await modeButton.click();
          await page.waitForFunction(
            ({ expectedLabel }) =>
              Array.from(document.querySelectorAll(".career-resume-editor__mode-switch button")).some(
                (button) =>
                  button.textContent?.trim() === expectedLabel &&
                  button.getAttribute("aria-pressed") === "true",
              ),
            { expectedLabel: label },
          );
          await page.locator(selector).waitFor({ state: "visible" });
          assert.equal(await page.locator(selector).isVisible(), true, `${viewport.label} ${label}`);
          await assertNoDocumentOverflow(page, `${viewport.label} ${label}`);
        }
      } else {
        assert.equal(await page.locator(".career-resume-editor__rail").isVisible(), true);
        assert.equal(await page.locator(".career-resume-editor__document").isVisible(), true);
        assert.equal(await page.locator(".career-resume-editor__review-pane").isVisible(), true);
        await assertNoDocumentOverflow(page, `${viewport.label} three-pane Studio`);
      }
    }
    await page.locator(".career-resume-editor__mode-switch").getByRole("button", { name: "建议" }).focus();
    await assertFocused(page, '.career-resume-editor__mode-switch button[aria-pressed="true"]');

    step("owner-404-delete-flag-off-and-network-boundary");
    allowHttp(404, /\/resume-documents\//);
    const otherContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const otherPage = await otherContext.newPage();
    trackPage(otherPage);
    await otherPage.goto(`${baseUrl}/today`, { waitUntil: "networkidle" });
    await browserRequest(otherPage, {
      method: "GET",
      requestPath: `/v1/resume-documents/${publicDocumentId}/review`,
      expectedStatus: 404,
    });
    await otherContext.close();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(publicResumeUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "删除这份岗位简历" }).click();
    await page.getByRole("heading", { name: "删除这份岗位简历？" }).waitFor();
    await assertFocused(page, ".career-deletion-dialog footer .career-button--quiet");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "删除这份岗位简历" }).click();
    const deletePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname === `/v1/resume-documents/${publicDocumentId}`,
    );
    await page.getByRole("button", { name: "确认删除" }).click();
    assert.equal((await deletePromise).status(), 200);
    await browserRequest(page, {
      method: "GET",
      requestPath: `/v1/resume-documents/${publicDocumentId}/review`,
      expectedStatus: 404,
    });

    const flagOff = await context.newPage();
    trackPage(flagOff);
    await flagOff.goto(`${flagOffBaseUrl}/jobs/${jobId}`, { waitUntil: "networkidle" });
    await flagOff.locator("main.product-shell").waitFor();
    assert.equal(await flagOff.locator(".career-os").count(), 0);
    await flagOff.close();

    assert.equal(externalRequests.length, 0, `external requests: ${externalRequests.join(" | ")}`);
    assert.equal(consoleProblems.length, 0, `console problems: ${consoleProblems.join(" | ")}`);
    assert.equal(unexpectedHttp.length, 0, `unexpected HTTP: ${unexpectedHttp.join(" | ")}`);
    assert(
      deliberateHttp.some((item) => item.startsWith("403 ")) &&
        deliberateHttp.some((item) => item.startsWith("409 ")) &&
        deliberateHttp.some((item) => item.startsWith("503 ")) &&
        deliberateHttp.some((item) => item.startsWith("404 ")),
      `expected 403/409/503/404 checks: ${deliberateHttp.join(" | ")}`,
    );

    await context.close();
    process.stdout.write(
      `${JSON.stringify({
        passed: true,
        jobId,
        publicCaseId,
        publicDocumentId,
        privateCaseId,
        privateDocumentId,
        decisions: 3,
        controlledAiFallback: "AI_DISABLED",
        viewports: [1536, 1280, 768, 320],
      })}\n`,
    );
  } finally {
    await browser?.close();
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
