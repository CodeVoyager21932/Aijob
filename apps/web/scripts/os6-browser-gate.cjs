const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { Client } = require("../../../packages/database/node_modules/pg");

process.env.M1_PUBLIC_TITLE ||= "OS-6 合成产品策略实习生";
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
  assert(value, "OS6_DATABASE_URL is required");
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
      /^aijob_.+_test(?:_|$)/.test(databaseName),
    "OS6_DATABASE_URL must point to a loopback aijob_*_test_* database",
  );
  return value;
}

const baseUrl = loopbackOrigin(process.env.OS6_BASE_URL || "http://127.0.0.1:5173", "OS6_BASE_URL");
const flagOffBaseUrl = loopbackOrigin(
  process.env.OS6_FLAG_OFF_BASE_URL || "http://127.0.0.1:5174",
  "OS6_FLAG_OFF_BASE_URL",
);
const databaseUrl = safeDatabaseUrl(process.env.OS6_DATABASE_URL);
const browserExecutable = process.env.OS6_BROWSER_EXECUTABLE || undefined;
const pnpmExecutable = process.env.OS6_PNPM_EXECUTABLE || "pnpm";
const workspaceRoot = process.env.OS6_WORKSPACE_ROOT || process.cwd();
const runtimeRoot = process.env.OS6_RUNTIME_ROOT || workspaceRoot;
const publicTitle = process.env.M1_PUBLIC_TITLE;

function step(label) {
  process.stdout.write(`OS6_GATE_STEP:${label}\n`);
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
    if (!csrf) throw new Error("OS6_CSRF_COOKIE_MISSING");
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
  const result = await response.json();
  await page.locator(".career-resume-editor").waitFor();
  return result.resumeDocument.id;
}

async function seedLegacyTailoring(client, caseId) {
  const context = await client.query(
    `SELECT c.owner_id, c.owner_epoch, c.published_job_version_id, c.requirement_set_id,
            d.current_content_revision_id, d.evidence_revision_id
       FROM application.application_cases AS c
       JOIN profile.resume_documents AS d
         ON d.case_id = c.id AND d.kind = 'case_derived' AND d.deleted_at IS NULL
      WHERE c.id = $1`,
    [caseId],
  );
  const row = context.rows[0];
  assert(row, "OS-6 legacy tailoring fixture requires a Case-derived Resume");
  const runId = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO matching.resume_tailoring_runs
        (id, owner_id, owner_epoch, resume_analysis_id, resume_document_revision_id,
         published_job_version_id, requirement_set_id, evidence_revision_id,
         provider_adapter, model, prompt_version, schema_version, template_version,
         privacy_consent_at, used_template_fallback, status, request_hash,
         idempotency_key, failure_code, created_at, completed_at)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7,
         'deterministic_template', 'legacy-template', 'legacy-prompt-v1',
         'resume-tailoring-v1', 'legacy-template-v1', now(), true, 'succeeded',
         $8, $9, NULL, now(), now())`,
      [
        runId,
        row.owner_id,
        row.owner_epoch,
        row.current_content_revision_id,
        row.published_job_version_id,
        row.requirement_set_id,
        row.evidence_revision_id,
        "c".repeat(64),
        `os6-legacy-${runId}`,
      ],
    );
    await client.query(
      `INSERT INTO matching.resume_tailoring_segments
        (id, tailoring_run_id, ordinal, original_text, suggested_text, reason,
         requirement_ids, evidence_ids, decision, edited_text, source_block_id,
         section_id, section_title, updated_at)
       VALUES ($1, $2, 0, $3, $4, $5, $6::jsonb, $7::jsonb,
         'accepted', NULL, $8, $9, '项目经历', now())`,
      [
        randomUUID(),
        runId,
        "完成合成用户研究与 SQL 数据核验。",
        "完成合成用户研究、SQL 数据核验与方案复盘。",
        "OS-6 只读兼容 fixture，不允许产生新写入。",
        JSON.stringify(["m1-sql"]),
        JSON.stringify(["m1-evidence-product-research"]),
        randomUUID(),
        randomUUID(),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return runId;
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
  const answerPosts = [];
  const applicationPosts = [];
  const sessionRequests = [];
  const allowHttp = (status, pattern) => allowedHttp.push({ status, pattern });
  const trackPage = (page) => {
    page.on("console", (message) => {
      if (!["warning", "error"].includes(message.type())) return;
      if ([403, 404, 409].some((status) => message.text().includes(`status of ${status}`))) return;
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
    page.on("request", (request) => {
      const url = new URL(request.url());
      resourcePaths.push(url.pathname);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
        externalRequests.push(`${request.method()} ${request.url()}`);
      }
      if (url.pathname === "/v1/session") sessionRequests.push(request.method());
      if (
        request.method() === "POST" &&
        /\/interview-sessions\/[0-9a-f-]+\/answers$/i.test(url.pathname)
      ) {
        answerPosts.push({
          path: url.pathname,
          idempotencyKey: request.headers()["idempotency-key"] || null,
          body: request.postData(),
        });
      }
      if (request.method() === "POST" && /\/manual-applications$/i.test(url.pathname)) {
        applicationPosts.push({ path: url.pathname, body: request.postData() });
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
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(30_000);
    trackPage(page);

    step("today-lazy-entry-and-case-resume");
    await page.goto(`${baseUrl}/today`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "今日", exact: true }).waitFor();
    assert.equal(
      resourcePaths.some((value) =>
        /CaseInterviewWorkspace|ResumeDocumentEditor|CareerDataControlPage/.test(value),
      ),
      false,
      "Today first paint must not load Interview, Resume Studio or Data Control",
    );
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
    const caseId = (await caseResponse.json()).applicationCase.id;
    await seedBaseResume(client, caseId);
    const documentId = await createDerivedResume(page, caseId);
    const owner = await client.query(
      "SELECT owner_id, owner_epoch FROM application.application_cases WHERE id = $1",
      [caseId],
    );
    const ownerId = owner.rows[0].owner_id;
    const legacyTailoringId = await seedLegacyTailoring(client, caseId);

    step("explicit-application-url-refresh-history-and-timeline");
    await page.goto(`${baseUrl}/applications/${caseId}/application`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "由你完成最后提交" }).waitFor();
    const handoff = page.getByRole("link", { name: "打开官方投递页面" });
    assert.match(await handoff.getAttribute("href"), /^https:\/\/.+\.example\.test\//);
    assert.equal(applicationPosts.length, 0, "opening the application workspace must not record an application");
    await page.getByRole("button", { name: "我已在官方页面完成投递" }).click();
    await page.waitForURL(/confirm=application/);
    await assertFocused(page, '[aria-label="确认投递状态"]');
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("group", { name: "确认投递状态" }).waitFor();
    await page.goBack({ waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).searchParams.has("confirm"), false);
    await page.goForward({ waitUntil: "networkidle" });
    await page.getByRole("group", { name: "确认投递状态" }).waitFor();
    const applicationResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/application-cases/${caseId}/manual-applications`,
    );
    await page.getByRole("button", { name: "确认已投递" }).click();
    assert.equal((await applicationResponsePromise).status(), 200);
    await page.getByText("确认完成投递", { exact: true }).waitFor();
    assert.equal(applicationPosts.length, 1, "application must be recorded by one explicit command");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("确认完成投递", { exact: true }).waitFor();

    step("today-read-model-and-interview-session-no-replay");
    const todayRequestsStart = resourcePaths.length;
    const boardRequestsBefore = resourcePaths.filter((value) => value === "/v1/application-cases/board").length;
    await page.goto(`${baseUrl}/today`, { waitUntil: "networkidle" });
    await page.getByText(publicTitle).first().waitFor();
    const boardRequestsAfter = resourcePaths.filter((value) => value === "/v1/application-cases/board").length;
    assert(
      boardRequestsAfter - boardRequestsBefore >= 1 && boardRequestsAfter - boardRequestsBefore <= 2,
      "Today must use only the board read model, allowing one dev-mode remount",
    );
    assert.equal(
      resourcePaths
        .slice(todayRequestsStart)
        .some((value) => /^\/v1\/application-cases\/[0-9a-f-]{36}$/i.test(value)),
      false,
      "Today must not issue per-Case N+1 reads",
    );
    assert.equal(
      resourcePaths.some((value) => /CaseInterviewWorkspace/.test(value)),
      false,
      "Today must not eager-load Interview",
    );
    await page.goto(`${baseUrl}/applications/${caseId}/interview`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "模板面试", exact: true }).waitFor();
    assert(resourcePaths.some((value) => /CaseInterviewWorkspace/.test(value)));
    const createSessionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/application-cases/${caseId}/interview-sessions`,
    );
    await page.getByRole("button", { name: "开始一轮模板面试" }).click();
    const createdSession = await createSessionResponse;
    assert.equal(createdSession.status(), 201);
    const sessionId = (await createdSession.json()).sessionId;
    await page.waitForURL(new RegExp(`session=${sessionId}`));
    const answerInput = page.getByLabel("你的回答");
    await answerInput.fill("这是仅用于 OS-6 离线验收的合成回答，不代表任何真实候选人经历。");
    allowHttp(403, new RegExp(`/interview-sessions/${sessionId}/answers$`));
    let interceptAnswer = true;
    const answerPattern = `**/v1/application-cases/${caseId}/interview-sessions/${sessionId}/answers`;
    const sessionRoute = async (route) => {
      if (!interceptAnswer) return route.continue();
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "SESSION_REQUIRED", detail: "OS-6 合成会话边界" }),
      });
    };
    await page.route(answerPattern, sessionRoute);
    await page.getByRole("button", { name: "保存并进入下一题" }).click();
    await page
      .locator(".career-session-mutation-notice")
      .getByText(/系统没有自动重放刚才的修改/)
      .waitFor();
    await page.waitForTimeout(250);
    assert.equal(answerPosts.length, 1, "session recovery must not replay the answer mutation");
    assert.match(await answerInput.inputValue(), /OS-6 离线验收/);
    interceptAnswer = false;

    step("interview-revision-conflict-preserves-draft-and-completes");
    const stalePage = await context.newPage();
    stalePage.setDefaultTimeout(20_000);
    trackPage(stalePage);
    await stalePage.goto(page.url(), { waitUntil: "networkidle" });
    const staleDraft = stalePage.getByLabel("你的回答");
    await staleDraft.fill("标签页二的 OS-6 冲突草稿必须保留。 ");
    const explicitRetryResponse = page.waitForResponse(
      (response) =>
        response.status() === 200 && new URL(response.url()).pathname.endsWith("/answers"),
    );
    await page.getByRole("button", { name: "保存并进入下一题" }).click();
    await explicitRetryResponse;
    assert.equal(answerPosts.length, 2);
    assert.equal(answerPosts[0].idempotencyKey, answerPosts[1].idempotencyKey);
    await page.unroute(answerPattern, sessionRoute);
    allowHttp(409, new RegExp(`/interview-sessions/${sessionId}/answers$`));
    const staleResponsePromise = stalePage.waitForResponse(
      (response) => new URL(response.url()).pathname.endsWith("/answers"),
    );
    await stalePage.getByRole("button", { name: "保存并进入下一题" }).click();
    const staleResponse = await staleResponsePromise;
    assert.equal(staleResponse.status(), 409);
    const staleProblem = await staleResponse.json();
    assert.equal(staleProblem.code, "INTERVIEW_SESSION_REVISION_CONFLICT");
    try {
      await stalePage
        .getByText(/服务器已有更新，本地草稿仍保留且没有重新提交/)
        .waitFor();
    } catch (error) {
      const state = await stalePage.evaluate(() => ({
        alerts: [...document.querySelectorAll('[role="alert"]')].map((node) =>
          node.textContent?.trim(),
        ),
        answerEditors: [...document.querySelectorAll('textarea')].map((node) => ({
          label: node.getAttribute("aria-label") ?? node.id,
          readOnly: node.readOnly,
          value: node.value,
        })),
      }));
      throw new Error(`OS6_STALE_DRAFT_UI_MISSING:${JSON.stringify(state)}`, { cause: error });
    }
    assert.match(await staleDraft.inputValue(), /冲突草稿必须保留/);
    await stalePage.close();
    for (let index = 0; index < 5; index += 1) {
      await page.waitForFunction(() => {
        const input = document.querySelector("#interview-answer-draft");
        return (
          document.body.innerText.includes("本轮模板面试已完成") ||
          (input instanceof HTMLTextAreaElement && !input.disabled)
        );
      });
      if (await page.getByText("本轮模板面试已完成", { exact: true }).count()) break;
      const input = page.locator("textarea#interview-answer-draft:not([disabled])");
      await input.fill(`OS-6 第 ${index + 3} 题合成回答：明确目标、执行、协作与复盘；仅用于离线验收。`);
      const responsePromise = page.waitForResponse(
        (response) =>
          response.status() === 200 && new URL(response.url()).pathname.endsWith("/answers"),
      );
      await page.getByRole("button", { name: "保存并进入下一题" }).click();
      await responsePromise;
      await page.waitForTimeout(100);
    }
    await page.getByText("本轮模板面试已完成", { exact: true }).waitFor();

    step("separate-debrief-draft-guard-confirmation-and-backflow");
    await page.getByRole("link", { name: "进入复盘工作区" }).click();
    await page.waitForURL(new RegExp(`/applications/${caseId}/debrief.*session=${sessionId}`));
    await page.getByRole("heading", { name: "面试复盘", exact: true }).waitFor();
    assert.equal(
      await page.locator("textarea#interview-answer-draft").count(),
      0,
      "Debrief must not render an answer editor",
    );
    const prepareResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/v1/application-cases/${caseId}/debrief`,
    );
    await page.getByRole("button", { name: "生成反馈与复盘" }).click();
    assert.equal((await prepareResponse).status(), 201);
    await page.getByRole("heading", { name: "逐项决定是否采用" }).waitFor();
    assert.equal(await page.getByRole("link", { name: /去修改岗位简历|去补证据/ }).count(), 0);
    const decisionItems = page.locator(".career-debrief-decision-list > li");
    const decisionCount = await decisionItems.count();
    assert(decisionCount > 0, "deterministic Debrief must expose at least one explicit decision");
    for (let index = 0; index < decisionCount; index += 1) {
      const item = decisionItems.nth(index);
      await item.getByRole("button", { name: index === 0 ? "采用" : "稍后处理", exact: true }).click();
    }
    await page.getByRole("link", { name: "投递" }).click();
    await page.getByRole("heading", { name: "要离开当前练习吗？" }).waitFor();
    await assertFocused(page, ".career-resume-draft-guard .career-button--danger-quiet");
    await page.getByRole("button", { name: "继续处理" }).click();
    assert.match(page.url(), new RegExp(`/applications/${caseId}/debrief`));
    const confirmationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/application-cases/${caseId}/debrief/confirmations`,
    );
    await page.getByRole("button", { name: "确认本次复盘" }).click();
    assert.equal((await confirmationResponse).status(), 201);
    await page.getByRole("heading", { name: "本次复盘已由你确认" }).waitFor();
    const confirmedEvents = await browserRequest(page, {
      method: "GET",
      requestPath: `/v1/application-cases/${caseId}/events?limit=50`,
    });
    assert(
      confirmedEvents.body.items.some((event) => event.eventType === "debrief_confirmed"),
      "confirmed Debrief must append its Case timeline event",
    );
    const backflow = page.getByRole("link", { name: /去修改岗位简历|去补证据/ }).first();
    assert.equal(await backflow.count(), 1, "backflow must appear only after confirmation");
    await backflow.click();
    await page.waitForURL(new RegExp(`/applications/${caseId}/(?:resume|requirements)`));

    step("legacy-tailoring-cross-owner-invalid-and-flag-off");
    await page.goto(`${baseUrl}/resume-tailorings/${legacyTailoringId}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "查看旧版岗位定向简历" }).waitFor();
    await page.getByText("这是一条只读历史", { exact: true }).waitFor();
    assert.equal(await page.locator(".tailoring-segment textarea[readonly]").count(), 1);
    assert.equal(await page.locator(".segment-actions").count(), 0);
    assert.equal(await page.getByRole("button", { name: /接受建议|保存我的编辑|保留原文|生成 ATS/ }).count(), 0);
    allowHttp(404, /\/resume-tailorings\//);
    await page.goto(`${baseUrl}/resume-tailorings/${randomUUID()}`, { waitUntil: "networkidle" });
    await page.getByText("没有找到这条旧版优化历史", { exact: true }).waitFor();

    const otherContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const otherPage = await otherContext.newPage();
    trackPage(otherPage);
    await otherPage.goto(`${baseUrl}/today`, { waitUntil: "networkidle" });
    allowHttp(404, new RegExp(`/application-cases/${caseId}`));
    await browserRequest(otherPage, {
      method: "GET",
      requestPath: `/v1/application-cases/${caseId}/events`,
      expectedStatus: 404,
    });
    await browserRequest(otherPage, {
      method: "GET",
      requestPath: `/v1/application-cases/${caseId}/interview-sessions`,
      expectedStatus: 404,
    });
    allowHttp(404, /\/application-cases\/not-a-case-id/);
    await browserRequest(otherPage, {
      method: "GET",
      requestPath: "/v1/application-cases/not-a-case-id/events",
      expectedStatus: 404,
    });
    await browserRequest(otherPage, {
      method: "GET",
      requestPath: "/v1/application-cases/not-a-case-id/interview-sessions",
      expectedStatus: 404,
    });
    await otherContext.close();

    const flagOff = await context.newPage();
    trackPage(flagOff);
    await flagOff.goto(`${flagOffBaseUrl}/jobs/${jobId}`, { waitUntil: "networkidle" });
    await flagOff.locator("main.product-shell").waitFor();
    assert.equal(await flagOff.locator(".career-os").count(), 0);
    await flagOff.close();

    step("four-viewports-key-lifecycle-surfaces");
    const viewportRoutes = [
      { path: "/today", heading: "今日" },
      { path: `/applications/${caseId}/application`, heading: "由你完成最后提交" },
      { path: `/applications/${caseId}/interview?session=${sessionId}`, heading: "模板面试" },
      { path: `/applications/${caseId}/debrief?session=${sessionId}`, heading: "面试复盘" },
      { path: "/settings/data", heading: "由你决定保留什么" },
    ];
    for (const viewport of [
      { width: 1536, height: 960, label: "1536" },
      { width: 1280, height: 900, label: "1280" },
      { width: 768, height: 900, label: "768-200-percent-equivalent" },
      { width: 320, height: 800, label: "320" },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of viewportRoutes) {
        await page.goto(`${baseUrl}${route.path}`, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: route.heading, exact: true }).first().waitFor();
        await assertNoDocumentOverflow(page, `${viewport.label} ${route.path}`);
      }
    }

    step("case-detach-selective-delete-compatibility-and-full-owner-delete");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/applications/${caseId}/overview`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "删除求职项目" }).click();
    await page.getByRole("heading", { name: "分别决定关联资产如何处理" }).waitFor();
    await assertFocused(page, ".career-modal-surface--case-deletion button.career-button--quiet");
    for (const name of [
      "case-resume-disposition",
      "case-interview-disposition",
      "case-debrief-disposition",
    ]) {
      await page.locator(`input[name="${name}"]`).nth(1).check();
    }
    const deleteCaseResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname === `/v1/application-cases/${caseId}`,
    );
    await page.getByRole("button", { name: "按以上选择删除" }).click();
    assert.equal((await deleteCaseResponse).status(), 200);
    await page.waitForURL(/\/applications(?:\?|$)/);
    await browserRequest(page, {
      method: "GET",
      requestPath: `/v1/application-cases/${caseId}`,
      expectedStatus: 404,
    });

    await page.goto(`${baseUrl}/data-control`, { waitUntil: "networkidle" });
    await page.waitForURL(/\/settings\/data$/);
    await page.getByRole("heading", { name: "独立资产" }).waitFor();
    const detachedAssets = page.locator(".career-data-asset-list > li");
    const detachedBefore = await detachedAssets.count();
    assert(detachedBefore >= 2, "detaching the Case must preserve Interview and Debrief assets");
    await detachedAssets.first().getByRole("button", { name: "删除", exact: true }).click();
    await page.getByRole("heading", { name: /删除(?:面试练习|复盘)/ }).waitFor();
    const assetDeleteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        /\/v1\/(?:interview-sessions|debriefs)\//.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "确认删除" }).click();
    assert.equal((await assetDeleteResponse).status(), 200);
    await page.getByText("独立资产已删除，数据范围已重新读取。").waitFor();
    assert.equal(await detachedAssets.count(), detachedBefore - 1);

    const sessionRequestsBeforeDeletion = sessionRequests.length;
    await page.getByLabel("我理解此操作不可撤销").check();
    await page.getByLabel("输入“删除我的数据”以确认").fill("删除我的数据");
    const ownerDeleteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" && new URL(response.url()).pathname === "/v1/profile",
    );
    await page.getByRole("button", { name: "永久删除全部个人数据" }).click();
    assert.equal((await ownerDeleteResponse).status(), 202);
    await page.waitForURL(/\/settings\/data\/deletion$/);
    await page.getByRole("heading", { name: "个人数据删除回执" }).waitFor();
    runOwnerTasks();
    await page.getByText("删除完成", { exact: true }).waitFor({ timeout: 25_000 });
    assert.equal(
      sessionRequests.length,
      sessionRequestsBeforeDeletion,
      "deletion receipt polling must not bootstrap a new session",
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("删除完成", { exact: true }).waitFor();
    assert.equal(
      sessionRequests.length,
      sessionRequestsBeforeDeletion,
      "deletion receipt refresh must not bootstrap a new session",
    );
    const ownerAfterDeletion = await client.query(
      "SELECT epoch, deleted_at FROM identity.owners WHERE id = $1",
      [ownerId],
    );
    assert(ownerAfterDeletion.rows[0].deleted_at, "owner deletion must tombstone the old owner");
    assert(Number(ownerAfterDeletion.rows[0].epoch) > Number(owner.rows[0].owner_epoch));

    await page.goto(`${baseUrl}/data-control/deletion`, { waitUntil: "networkidle" });
    await page.waitForURL(/\/settings\/data\/deletion$/);
    await page.getByText("删除完成", { exact: true }).waitFor();
    assert.equal(sessionRequests.length, sessionRequestsBeforeDeletion);

    assert.equal(externalRequests.length, 0, `external requests: ${externalRequests.join(" | ")}`);
    assert.equal(consoleProblems.length, 0, `console problems: ${consoleProblems.join(" | ")}`);
    assert.equal(unexpectedHttp.length, 0, `unexpected HTTP: ${unexpectedHttp.join(" | ")}`);
    assert(
      deliberateHttp.some((item) => item.startsWith("403 ")) &&
        deliberateHttp.some((item) => item.startsWith("409 ")) &&
        deliberateHttp.some((item) => item.startsWith("404 ")),
      `expected 403/409/404 checks: ${deliberateHttp.join(" | ")}`,
    );

    await context.close();
    process.stdout.write(
      `${JSON.stringify({
        passed: true,
        jobId,
        caseId,
        documentId,
        sessionId,
        legacyTailoringId,
        applicationCommands: applicationPosts.length,
        answerCommands: answerPosts.length,
        viewports: [1536, 1280, 768, 320],
        ownerDeleted: true,
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
