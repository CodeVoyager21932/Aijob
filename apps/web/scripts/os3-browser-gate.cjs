const assert = require("node:assert/strict");
const path = require("node:path");
const { Client } = require("../../../packages/database/node_modules/pg");

process.env.M1_PUBLIC_TITLE ||= "OS-3 合成产品实习生";
const { seedCatalog } = require("./m1-browser-gate.cjs");

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

function safeDatabaseUrl(value) {
  assert(value, "OS3_DATABASE_URL is required");
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
      /^aijob_.+_test(?:_|$)/.test(databaseName),
    "OS3_DATABASE_URL must point to a loopback aijob_*_test_* database",
  );
  return value;
}

const baseUrl = loopbackUrl(process.env.OS3_BASE_URL || "http://127.0.0.1:5173", "OS3_BASE_URL");
const flagOffBaseUrl = loopbackUrl(
  process.env.OS3_FLAG_OFF_BASE_URL || "http://127.0.0.1:5174",
  "OS3_FLAG_OFF_BASE_URL",
);
const databaseUrl = safeDatabaseUrl(process.env.OS3_DATABASE_URL);
const browserExecutable = process.env.OS3_BROWSER_EXECUTABLE || undefined;
const publicTitle = process.env.M1_PUBLIC_TITLE;

function step(label) {
  process.stdout.write(`OS3_GATE_STEP:${label}\n`);
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
    const container = node.closest(".career-case-card, .career-case-row");
    const containerStyle = container ? getComputedStyle(container) : null;
    return {
      hasOutline: style.outlineStyle !== "none" && style.outlineWidth !== "0px",
      hasContainerRing:
        Boolean(containerStyle) &&
        (containerStyle.boxShadow !== "none" || containerStyle.outlineStyle !== "none"),
    };
  });
  assert(
    focus.hasOutline || focus.hasContainerRing,
    `${selector} must expose a visible focus indicator`,
  );
}

async function requestJson(page, input) {
  const result = await page.evaluate(async ({ method, requestPath, body, idempotencyKey }) => {
    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("aijob_csrf="))
      ?.slice("aijob_csrf=".length);
    if (!csrf) throw new Error("OS3_CSRF_COOKIE_MISSING");
    const response = await fetch(requestPath, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-csrf-token": decodeURIComponent(csrf),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, text };
  }, input);
  assert(
    result.status >= 200 && result.status < 300,
    `${input.method} ${input.requestPath} failed: HTTP ${result.status} ${result.text}`,
  );
  return result.text ? JSON.parse(result.text) : null;
}

async function createPrivateCases(page, count) {
  const result = await page.evaluate(async (requestedCount) => {
    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("aijob_csrf="))
      ?.slice("aijob_csrf=".length);
    if (!csrf) throw new Error("OS3_CSRF_COOKIE_MISSING");
    const applicationCases = [];
    for (let index = 1; index <= requestedCount; index += 1) {
      const longSuffix =
        index === requestedCount
          ? "超长岗位名称用于验证窄屏长文本不会突破容器并保持完整可读"
          : `第 ${String(index).padStart(2, "0")} 个`;
      const response = await fetch("/v1/application-cases", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrf),
          "Idempotency-Key": `os3-private-${index}-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          jobContext: {
            kind: "private_input",
            title: `OS-3 合成私有岗位 ${longSuffix}`,
            companyName:
              index === requestedCount
                ? "OS-3 合成企业长名称用于检验检查器与看板卡片的稳定换行"
                : `OS-3 合成企业 ${String(index).padStart(2, "0")}`,
            contentText: `仅用于离线验收的合成 JD ${index}。岗位地点、截止时间与工作方式均未说明，不得由系统补写。`,
            source: { kind: "unspecified" },
            duplicateHandling: "create_separate",
          },
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`OS3_PRIVATE_CASE_CREATE_FAILED:${response.status}:${text}`);
      }
      applicationCases.push(JSON.parse(text).applicationCase);
    }
    return applicationCases;
  }, count);
  assert.equal(result.length, count);
  return result;
}

async function transitionFixtureCase(page, applicationCase, transitions) {
  let revision = applicationCase.revision;
  for (const transition of transitions) {
    const response = await requestJson(page, {
      method: "POST",
      requestPath: `/v1/application-cases/${applicationCase.id}/transitions`,
      body: {
        expectedRevision: revision,
        toStage: transition.toStage,
        outcome: transition.outcome ?? null,
        reason: transition.reason ?? null,
      },
      idempotencyKey: `os3-fixture-transition-${crypto.randomUUID()}`,
    });
    revision = response.event.sequence;
  }
  return revision;
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const jobId = await seedCatalog(client);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    executablePath: browserExecutable,
    headless: true,
    timeout: 30_000,
  });

  let expectedHttpStatus = null;
  const consoleProblems = [];
  const unexpectedHttp = [];
  const deliberateHttp = [];
  const externalRequests = [];
  const resourcePaths = [];
  const apiRequests = [];
  const transitionRequests = [];

  const trackPage = (page) => {
    page.on("console", (message) => {
      if (!["warning", "error"].includes(message.type())) return;
      if (
        [403, 404, 409, 503].some((status) =>
          message.text().includes(`status of ${status}`),
        )
      ) {
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
      if (url.pathname.startsWith("/v1/")) {
        apiRequests.push(`${request.method()} ${url.pathname}${url.search}`);
      }
      if (request.method() === "POST" && /\/v1\/application-cases\/[0-9a-f-]{36}\/transitions/i.test(url.pathname)) {
        transitionRequests.push({
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
      if (response.status() === expectedHttpStatus) deliberateHttp.push(problem);
      else unexpectedHttp.push(problem);
    });
  };

  try {
    const context = await browser.newContext({ viewport: { width: 1536, height: 960 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(30_000);
    trackPage(page);

    step("synthetic-case-fixture");
    await page.goto(`${baseUrl}/jobs/${jobId}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: publicTitle }).waitFor();
    const publicCreatePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/application-cases",
    );
    await page.getByRole("button", { name: "加入我的求职" }).click();
    const publicCreateResponse = await publicCreatePromise;
    assert(publicCreateResponse.ok(), "the public Case must be created through the real API");
    const publicCreate = await publicCreateResponse.json();
    const publicCaseId = publicCreate.applicationCase.id;
    assert.match(publicCaseId, /^[0-9a-f-]{36}$/i);
    await page.waitForURL(new RegExp(`/applications/${publicCaseId}/requirements`));

    const privateCases = await createPrivateCases(page, 25);
    await transitionFixtureCase(page, privateCases[0], [{ toStage: "preparing" }]);
    await transitionFixtureCase(page, privateCases[1], [
      { toStage: "preparing" },
      { toStage: "applied" },
    ]);
    await transitionFixtureCase(page, privateCases[2], [
      { toStage: "preparing" },
      { toStage: "applied" },
      { toStage: "interviewing" },
    ]);
    await transitionFixtureCase(page, privateCases[3], [
      { toStage: "resolved", outcome: "withdrawn" },
    ]);

    step("board-complete-collection");
    apiRequests.length = 0;
    await page.goto(
      `${baseUrl}/applications?view=board&stage=all&city=all&sort=updated`,
      { waitUntil: "networkidle" },
    );
    await page.getByRole("heading", { name: "我的求职" }).waitFor();
    await page.getByText("当前筛选共 26 个求职项目").waitFor();
    assert.equal(await page.locator(".career-case-column").count(), 5);
    const interestedColumn = page.locator(".career-case-column--interested");
    assert.equal(await interestedColumn.locator("[data-case-trigger]").count(), 20);
    await interestedColumn.getByRole("button", { name: /继续加载（已显示 20\/22）/ }).waitFor();
    assert.equal(
      apiRequests.some((entry) => /^GET \/v1\/application-cases\/[0-9a-f-]{36}$/i.test(entry)),
      false,
      "the board first view must not issue card-level detail requests",
    );
    assert.equal(
      resourcePaths.some((value) => /ResumeDocumentEditor|CaseInterviewWorkspace/.test(value)),
      false,
      "the board first view must not load Resume Editor or Interview",
    );
    await assertNoDocumentOverflow(page, "1536 board");

    let failContinuation = true;
    const continuationRoute = async (route) => {
      const url = new URL(route.request().url());
      if (
        failContinuation &&
        url.searchParams.get("stage") === "interested" &&
        url.searchParams.has("cursor")
      ) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "SYNTHETIC_COLUMN_FAILURE", detail: "合成列续页暂时不可用" }),
        });
        return;
      }
      await route.continue();
    };
    await page.route("**/v1/application-cases?**", continuationRoute);
    expectedHttpStatus = 503;
    await interestedColumn.getByRole("button", { name: /继续加载/ }).click();
    await interestedColumn.getByText("合成列续页暂时不可用").waitFor();
    failContinuation = false;
    await interestedColumn.getByRole("button", { name: "重试" }).click();
    await interestedColumn.locator("[data-case-trigger]").nth(21).waitFor();
    assert.equal(await interestedColumn.locator("[data-case-trigger]").count(), 22);
    expectedHttpStatus = null;
    await page.unroute("**/v1/application-cases?**", continuationRoute);

    step("city-filter-and-history");
    const cityInput = page.getByPlaceholder("全部城市");
    await cityInput.fill("上海");
    await page.getByRole("button", { name: "应用城市筛选" }).click();
    await page.waitForURL(/city=%E4%B8%8A%E6%B5%B7/);
    await page.getByText("当前筛选共 1 个求职项目").waitFor();
    assert.equal(await page.locator("[data-case-trigger]").count(), 1);
    await page.getByText(publicTitle, { exact: true }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("当前筛选共 1 个求职项目").waitFor();
    await page.getByRole("button", { name: "清除城市筛选" }).click();
    await page.getByText("当前筛选共 26 个求职项目").waitFor();

    await page.getByRole("button", { name: "列表", exact: true }).click();
    await page.waitForURL(/view=list/);
    await page.locator(".career-case-list").waitFor();
    await page.getByRole("button", { name: "看板", exact: true }).click();
    await page.waitForURL(/view=board/);
    await page.goBack({ waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).searchParams.get("view"), "list");
    await page.goForward({ waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).searchParams.get("view"), "board");

    step("board-api-retry");
    let failBoard = true;
    const boardRoute = async (route) => {
      if (failBoard) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "SYNTHETIC_BOARD_FAILURE", detail: "合成看板暂时不可用" }),
        });
        return;
      }
      await route.continue();
    };
    await page.route("**/v1/application-cases/board?**", boardRoute);
    expectedHttpStatus = 503;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("合成看板暂时不可用").waitFor();
    failBoard = false;
    await page.getByRole("button", { name: "重新读取" }).click();
    await page.getByText("当前筛选共 26 个求职项目").waitFor();
    expectedHttpStatus = null;
    await page.unroute("**/v1/application-cases/board?**", boardRoute);

    step("wide-peek-deep-link");
    await page.goto(
      `${baseUrl}/applications?view=board&stage=all&city=%E4%B8%8A%E6%B5%B7&sort=deadline&peek=${publicCaseId}`,
      { waitUntil: "networkidle" },
    );
    await page.locator(".career-resizable-pane .career-inspector").waitFor();
    assert.equal(await page.locator(".career-modal-surface--inspector[role='dialog']").count(), 0);
    assert.equal(await page.locator(".career-case-column").count(), 5);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".career-resizable-pane .career-inspector").waitFor();
    const workspaceLink = page.getByRole("link", { name: /打开求职工作区/ });
    assert.match(await workspaceLink.getAttribute("href"), new RegExp(`/applications/${publicCaseId}/overview`));
    await page.getByRole("button", { name: "关闭岗位侧览" }).click();
    await page.waitForURL((url) => !url.searchParams.has("peek"));
    await assertFocused(page, `[data-case-trigger="${publicCaseId}"]`);
    await page.goBack({ waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).searchParams.get("peek"), publicCaseId);
    await page.locator(".career-resizable-pane .career-inspector").waitFor();
    await page.goForward({ waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).searchParams.has("peek"), false);

    step("revision-conflict-reconfirm");
    const conflictCase = privateCases[24];
    await page.goto(
      `${baseUrl}/applications?view=board&stage=interested&city=all&sort=updated&peek=${conflictCase.id}`,
      { waitUntil: "networkidle" },
    );
    await page.getByLabel("目标阶段").selectOption("resolved");
    await page.getByLabel("求职结果").selectOption("offer");
    await requestJson(page, {
      method: "POST",
      requestPath: `/v1/application-cases/${conflictCase.id}/transitions`,
      body: { expectedRevision: 1, toStage: "preparing", outcome: null, reason: null },
      idempotencyKey: `os3-conflict-primer-${crypto.randomUUID()}`,
    });
    const detailReadsBeforeConflict = apiRequests.filter(
      (entry) => entry === `GET /v1/application-cases/${conflictCase.id}`,
    ).length;
    expectedHttpStatus = 409;
    const conflictResponsePromise = page.waitForResponse(
      (response) =>
        response.status() === 409 &&
        new URL(response.url()).pathname === `/v1/application-cases/${conflictCase.id}/transitions`,
    );
    await page.getByRole("button", { name: "确认更新" }).click();
    await conflictResponsePromise;
    await page.getByText(/项目阶段已变化，已读取最新版本/).waitFor();
    await page.getByRole("button", { name: "再次确认更新" }).waitFor();
    assert.equal(await page.getByLabel("目标阶段").inputValue(), "resolved");
    assert.equal(await page.getByLabel("求职结果").inputValue(), "offer");
    await page.waitForFunction(
      ({ expectedPath, minimum }) =>
        performance
          .getEntriesByType("resource")
          .filter((entry) => new URL(entry.name).pathname === expectedPath).length > minimum,
      {
        expectedPath: `/v1/application-cases/${conflictCase.id}`,
        minimum: detailReadsBeforeConflict,
      },
    );
    expectedHttpStatus = null;
    const reconfirmResponsePromise = page.waitForResponse(
      (response) =>
        response.status() === 200 &&
        new URL(response.url()).pathname === `/v1/application-cases/${conflictCase.id}/transitions`,
    );
    await page.getByRole("button", { name: "再次确认更新" }).click();
    await reconfirmResponsePromise;
    await page.getByText("获得 Offer").waitFor();

    step("session-boundary-no-replay");
    const sessionCase = privateCases[23];
    await page.goto(
      `${baseUrl}/applications?view=board&stage=interested&city=all&sort=updated&peek=${sessionCase.id}`,
      { waitUntil: "networkidle" },
    );
    await page.getByLabel("目标阶段").selectOption("preparing");
    let interceptedTransitionPosts = 0;
    const sessionTransitionRoute = async (route) => {
      interceptedTransitionPosts += 1;
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "SESSION_REQUIRED", detail: "合成会话边界" }),
      });
    };
    const transitionPattern = `**/v1/application-cases/${sessionCase.id}/transitions`;
    await page.route(transitionPattern, sessionTransitionRoute);
    expectedHttpStatus = 403;
    await page.getByRole("button", { name: "确认更新" }).click();
    await page.getByText(/本机会话已恢复，刚才的修改没有重放/).waitFor();
    assert.equal(interceptedTransitionPosts, 1, "the session boundary must not replay a mutation");
    assert.equal(await page.getByLabel("目标阶段").inputValue(), "preparing");
    expectedHttpStatus = null;
    await page.unroute(transitionPattern, sessionTransitionRoute);
    const sessionRetryPromise = page.waitForResponse(
      (response) =>
        response.status() === 200 &&
        new URL(response.url()).pathname === `/v1/application-cases/${sessionCase.id}/transitions`,
    );
    await page.getByRole("button", { name: "再次确认更新" }).click();
    await sessionRetryPromise;
    const currentStage = page.locator(".career-inspector__current-stage .career-stage-badge");
    await currentStage.waitFor();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".career-inspector__current-stage .career-stage-badge")
          ?.textContent?.trim() === "准备投递",
    );

    step("owner-and-invalid-peek-404");
    const otherContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const otherPage = await otherContext.newPage();
    otherPage.setDefaultTimeout(15_000);
    trackPage(otherPage);
    expectedHttpStatus = 404;
    await otherPage.goto(
      `${baseUrl}/applications?view=board&stage=all&city=all&sort=updated&peek=${publicCaseId}`,
      { waitUntil: "domcontentloaded" },
    );
    await otherPage.getByText("记录不存在、已删除或不属于当前账户。").waitFor();
    assert.equal(new URL(otherPage.url()).searchParams.get("peek"), publicCaseId);
    await otherPage.goto(
      `${baseUrl}/applications?view=board&stage=all&city=all&sort=updated&peek=not-a-case-id`,
      { waitUntil: "domcontentloaded" },
    );
    await otherPage.getByText("记录不存在、已删除或不属于当前账户。").waitFor();
    assert.equal(new URL(otherPage.url()).searchParams.get("peek"), "not-a-case-id");
    expectedHttpStatus = null;
    await otherContext.close();

    step("four-viewports-and-keyboard");
    const viewportCases = [
      { width: 1280, height: 900, label: "1280" },
      { width: 768, height: 900, label: "768-equivalent-200-percent" },
    ];
    for (const viewport of viewportCases) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(
        `${baseUrl}/applications?view=board&stage=all&city=all&sort=updated`,
        { waitUntil: "networkidle" },
      );
      await page.locator(".career-case-board").waitFor();
      assert.equal(await page.locator(".career-case-column").count(), 5);
      await assertNoDocumentOverflow(page, `${viewport.label} board`);
      const boardLayout = await page.locator(".career-case-board").evaluate((node) => ({
        overflow: node.scrollWidth - node.clientWidth,
        overflowX: getComputedStyle(node).overflowX,
      }));
      assert.equal(boardLayout.overflowX, "auto", `${viewport.label} board must own overflow`);
      if (viewport.width === 768) {
        assert(
          boardLayout.overflow > 0,
          `${viewport.label} must keep horizontal overflow inside the board`,
        );
      }
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    const overlayTrigger = page.locator("[data-case-trigger]").first();
    const overlayCaseId = await overlayTrigger.getAttribute("data-case-trigger");
    await overlayTrigger.click();
    await page.locator(".career-modal-surface--inspector[role='dialog']").waitFor();
    await assertFocused(page, ".career-modal-surface--inspector [aria-label='关闭岗位侧览']");
    await page.keyboard.press("Escape");
    await assertFocused(page, `[data-case-trigger="${overlayCaseId}"]`);

    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(
      `${baseUrl}/applications?view=board&stage=all&city=all&sort=updated`,
      { waitUntil: "networkidle" },
    );
    await page.waitForURL(/stage=interested/);
    assert.equal(new URL(page.url()).searchParams.get("stage"), "interested");
    assert.equal(await page.locator(".career-case-column").count(), 1);
    await assertNoDocumentOverflow(page, "320 board");
    const mobileTrigger = page.locator("[data-case-trigger]").first();
    const mobileCaseId = await mobileTrigger.getAttribute("data-case-trigger");
    await mobileTrigger.focus();
    await assertFocused(page, `[data-case-trigger="${mobileCaseId}"]`);
    await mobileTrigger.press("Enter");
    const mobileDialog = page.locator(".career-modal-surface--inspector[role='dialog']");
    await mobileDialog.waitFor();
    await assertFocused(page, ".career-modal-surface--inspector [aria-label='关闭岗位侧览']");
    await assertNoDocumentOverflow(page, "320 full-screen Peek");
    await page.keyboard.press("Escape");
    await assertFocused(page, `[data-case-trigger="${mobileCaseId}"]`);

    step("deleted-case-unreadable");
    const deletedCase = privateCases[22];
    await requestJson(page, {
      method: "DELETE",
      requestPath: `/v1/application-cases/${deletedCase.id}`,
      body: {
        expectedRevision: 1,
        resumeDocuments: "delete",
        interviewSessions: "delete",
        debriefs: "delete",
      },
      idempotencyKey: null,
    });
    expectedHttpStatus = 404;
    await page.goto(
      `${baseUrl}/applications?view=board&stage=interested&city=all&sort=updated&peek=${deletedCase.id}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.getByText("记录不存在、已删除或不属于当前账户。").waitFor();
    expectedHttpStatus = null;

    step("flag-off-and-network-boundary");
    const flagOff = await context.newPage();
    flagOff.setDefaultTimeout(15_000);
    trackPage(flagOff);
    await flagOff.goto(`${flagOffBaseUrl}/jobs/${jobId}`, { waitUntil: "domcontentloaded" });
    await flagOff.locator("main.product-shell").waitFor();
    assert.equal(await flagOff.locator(".career-os").count(), 0);
    await flagOff.goto(`${flagOffBaseUrl}/applications`, { waitUntil: "domcontentloaded" });
    await flagOff.locator("main.product-shell").waitFor();
    assert.equal(await flagOff.locator(".career-os").count(), 0);
    await flagOff.close();

    assert(
      transitionRequests.length >= 11,
      `fixture and UI must exercise real transition commands (received ${transitionRequests.length})`,
    );
    assert(
      transitionRequests.every(({ idempotencyKey }) => Boolean(idempotencyKey)),
      "every stage transition must carry an Idempotency-Key",
    );
    assert.deepEqual(externalRequests, [], `network must remain loopback: ${externalRequests.join(" | ")}`);
    assert.deepEqual(unexpectedHttp, [], `unexpected HTTP responses: ${unexpectedHttp.join(" | ")}`);
    assert(deliberateHttp.some((problem) => problem.startsWith("503 ")));
    assert(deliberateHttp.some((problem) => problem.startsWith("409 ")));
    assert(deliberateHttp.some((problem) => problem.startsWith("403 ")));
    assert(deliberateHttp.filter((problem) => problem.startsWith("404 ")).length >= 3);
    assert.deepEqual(consoleProblems, [], `console must stay clean: ${consoleProblems.join(" | ")}`);

    await context.close();
    process.stdout.write(
      `${JSON.stringify({
        passed: true,
        jobId,
        publicCaseId,
        syntheticCaseCount: 26,
        initialStageTotals: {
          interested: 22,
          preparing: 1,
          applied: 1,
          interviewing: 1,
          resolved: 1,
        },
        viewports: [1536, 1280, 768, 320],
      })}\n`,
    );
  } finally {
    await browser.close();
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
