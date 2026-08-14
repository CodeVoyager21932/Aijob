const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { Client } = require("../../../packages/database/node_modules/pg");

process.env.M1_PUBLIC_TITLE ||= "OS-4 合成产品策略实习生";
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
  assert(value, "OS4_DATABASE_URL is required");
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
      /^aijob_.+_test(?:_|$)/.test(databaseName),
    "OS4_DATABASE_URL must point to a loopback aijob_*_test_* database",
  );
  return value;
}

const baseUrl = loopbackUrl(process.env.OS4_BASE_URL || "http://127.0.0.1:5173", "OS4_BASE_URL");
const flagOffBaseUrl = loopbackUrl(
  process.env.OS4_FLAG_OFF_BASE_URL || "http://127.0.0.1:5174",
  "OS4_FLAG_OFF_BASE_URL",
);
const databaseUrl = safeDatabaseUrl(process.env.OS4_DATABASE_URL);
const browserExecutable = process.env.OS4_BROWSER_EXECUTABLE || undefined;
const pnpmExecutable = process.env.OS4_PNPM_EXECUTABLE || "pnpm";
const workspaceRoot = process.env.OS4_WORKSPACE_ROOT || process.cwd();
const runtimeRoot = process.env.OS4_RUNTIME_ROOT || workspaceRoot;
const publicTitle = process.env.M1_PUBLIC_TITLE;

function step(label) {
  process.stdout.write(`OS4_GATE_STEP:${label}\n`);
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

async function browserRequest(page, input) {
  const result = await page.evaluate(async ({ method, requestPath, body, idempotencyKey }) => {
    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("aijob_csrf="))
      ?.slice("aijob_csrf=".length);
    if (!csrf) throw new Error("OS4_CSRF_COOKIE_MISSING");
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
  const expectedStatus = input.expectedStatus;
  if (expectedStatus === undefined) {
    assert(
      result.status >= 200 && result.status < 300,
      `${input.method} ${input.requestPath} failed: HTTP ${result.status} ${result.text}`,
    );
  } else {
    assert.equal(
      result.status,
      expectedStatus,
      `${input.method} ${input.requestPath} returned ${result.status}: ${result.text}`,
    );
  }
  return {
    status: result.status,
    body: result.text ? JSON.parse(result.text) : null,
  };
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

async function installProfile(page) {
  const sectionId = randomUUID();
  const blockId = randomUUID();
  const evidenceId = randomUUID();
  const response = await browserRequest(page, {
    method: "PUT",
    requestPath: "/v1/profile/confirmation",
    body: {
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
              id: sectionId,
              ordinal: 0,
              title: "合成项目经历",
              blocks: [
                {
                  id: blockId,
                  ordinal: 0,
                  text: "仅用于 OS-4 离线验收：完成用户访谈、SQL 数据分析与方案复盘。",
                },
              ],
            },
          ],
        },
        evidence: [
          {
            id: evidenceId,
            resumeAnalysisId: null,
            sourceBlockId: blockId,
            section: "合成项目经历",
            evidenceType: "project",
            statement: "完成合成用户研究、SQL 数据分析与方案复盘。",
            skills: ["用户研究", "SQL"],
            outcomes: ["形成可追溯复盘"],
            confirmed: true,
          },
        ],
      },
    },
  });
  return response.body;
}

async function reviseProfileFacts(page) {
  const current = await browserRequest(page, {
    method: "GET",
    requestPath: "/v1/profile/facts",
  });
  return browserRequest(page, {
    method: "PUT",
    requestPath: "/v1/profile/facts",
    body: {
      expectedRevision: current.body.revision,
      facts: [
        { key: "current_student", value: true },
        { key: "graduation_year", value: 2027 },
        { key: "current_city", value: "上海" },
        { key: "weekly_attendance_days", value: 4 },
        { key: "duration_months", value: 6 },
        { key: "skills", value: ["SQL", "用户研究", "数据分析"] },
      ],
    },
  });
}

async function createNextCatalogVersion(client, jobId) {
  const current = await client.query(
    `SELECT version.id AS version_id,
            revision.source_job_record_id,
            revision.source_url,
            revision.apply_url
       FROM catalog.published_jobs AS job
       JOIN catalog.published_job_versions AS version ON version.id = job.current_version_id
       JOIN ingestion.source_job_revisions AS revision ON revision.id = version.source_job_revision_id
      WHERE job.id = $1`,
    [jobId],
  );
  assert.equal(current.rowCount, 1);
  const previousVersionId = current.rows[0].version_id;
  const recordId = current.rows[0].source_job_record_id;
  const sourceUrl = current.rows[0].source_url;
  const applyUrl = current.rows[0].apply_url;
  const revisionId = randomUUID();
  const versionId = randomUUID();
  const requirementSetId = randomUUID();
  const revisionHash = revisionId.replaceAll("-", "").repeat(2);
  const versionHash = versionId.replaceAll("-", "").repeat(2);
  const requirementHash = requirementSetId.replaceAll("-", "").repeat(2);
  const longRequirement =
    "需要把用户访谈、业务约束、SQL 数据核验与跨团队协作整理成可追溯的决策记录；遇到信息不足时必须明确标注未知，不得用推测补写结论。";
  const knownLocations = {
    state: "known",
    value: ["上海"],
    evidenceRefs: [`${revisionId}#locations`],
  };
  const knownWorkMode = {
    state: "known",
    value: "线下",
    evidenceRefs: [`${revisionId}#work-mode`],
  };
  const unknown = { state: "unknown", reason: "source_not_stated" };
  const requirements = [
    {
      id: `os4-city-${versionId}`,
      kind: "city",
      operator: "one_of",
      expectedValue: ["上海"],
      sourceText: "工作地点：上海",
      evidenceRefs: [`${revisionId}#city`],
      sourceSpan: null,
      necessity: "required",
    },
    {
      id: `os4-sql-${versionId}`,
      kind: "skill",
      operator: "contains",
      expectedValue: ["SQL", "数据分析"],
      sourceText: "掌握 SQL，并能完成用户研究与数据分析",
      evidenceRefs: [`${revisionId}#sql`],
      sourceSpan: null,
      necessity: "preferred",
    },
    {
      id: `os4-trace-${versionId}`,
      kind: "other",
      operator: "contains",
      expectedValue: "可追溯决策记录",
      sourceText: longRequirement,
      evidenceRefs: [`${revisionId}#trace`],
      sourceSpan: null,
      necessity: "required",
    },
  ];

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO ingestion.source_job_revisions
        (id, source_job_record_id, revision_content_hash, import_mode, adapter_version,
         normalizer_version, company_name, title, job_family, locations, business_groups,
         entry_scope, source_project_name, recruit_label_name, recruitment_type,
         responsibilities, requirements, structured_fields, ingestion_state,
         publication_state, activity_state, source_url, apply_url, quality_flags,
         work_mode, deadline_at)
       VALUES ($1, $2, $3, 'manual', '1', '1', $4, $5, $6::jsonb, $7::jsonb,
         '[]'::jsonb, 'internship', NULL, '实习', $8::jsonb, $9, $10, '{}'::jsonb,
         'validated', 'published', 'active', $11, $12, '[]'::jsonb, $13::jsonb, $14::jsonb)`,
      [
        revisionId,
        recordId,
        revisionHash,
        "M1 合成科技",
        `${publicTitle}（目录修订）`,
        JSON.stringify({
          state: "known",
          value: "product",
          evidenceRefs: [`${revisionId}#family`],
        }),
        JSON.stringify(knownLocations),
        JSON.stringify({
          state: "known",
          value: "internship",
          evidenceRefs: [`${revisionId}#type`],
        }),
        "负责合成的产品研究、需求判断、数据核验与跨团队复盘。",
        `工作地点：上海。掌握 SQL，并能完成用户研究与数据分析。${longRequirement}`,
        sourceUrl,
        applyUrl,
        JSON.stringify(knownWorkMode),
        JSON.stringify(unknown),
      ],
    );
    await client.query(
      `INSERT INTO catalog.published_job_versions
        (id, published_job_id, source_job_revision_id, content_hash, company_name, title,
         job_family, locations, responsibilities, requirements, structured_fields,
         activity_state, source_url, apply_url, effective_at, work_mode, deadline_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10,
         '{}'::jsonb, 'active', $11, $12, clock_timestamp(), $13::jsonb, $14::jsonb)`,
      [
        versionId,
        jobId,
        revisionId,
        versionHash,
        "M1 合成科技",
        `${publicTitle}（目录修订）`,
        JSON.stringify({
          state: "known",
          value: "product",
          evidenceRefs: [`${revisionId}#family`],
        }),
        JSON.stringify(knownLocations),
        "负责合成的产品研究、需求判断、数据核验与跨团队复盘。",
        `工作地点：上海。掌握 SQL，并能完成用户研究与数据分析。${longRequirement}`,
        sourceUrl,
        applyUrl,
        JSON.stringify(knownWorkMode),
        JSON.stringify(unknown),
      ],
    );
    await client.query(
      `INSERT INTO catalog.published_job_version_revision_links
        (published_job_version_id, source_job_revision_id) VALUES ($1, $2)`,
      [versionId, revisionId],
    );
    await client.query(
      `INSERT INTO catalog.job_requirement_sets
        (id, published_job_version_id, schema_version, requirements, content_hash)
       VALUES ($1, $2, 'os4-browser-v1', $3::jsonb, $4)`,
      [requirementSetId, versionId, JSON.stringify(requirements), requirementHash],
    );
    await client.query(
      `INSERT INTO catalog.job_condition_projections
        (published_job_version_id, requirement_set_id, locations, weekly_attendance_days,
         duration_months, earliest_start_date, graduation_years, student_status,
         education_levels, majors, languages)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $4::jsonb, $4::jsonb, $4::jsonb,
         $4::jsonb, $4::jsonb, $4::jsonb, $4::jsonb)`,
      [versionId, requirementSetId, JSON.stringify(knownLocations), JSON.stringify(unknown)],
    );
    await client.query(
      "UPDATE catalog.published_job_versions SET active_requirement_set_id = $2 WHERE id = $1",
      [versionId, requirementSetId],
    );
    await client.query(
      "UPDATE catalog.published_jobs SET current_version_id = $2, public_version_id = $2 WHERE id = $1",
      [jobId, versionId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return {
    previousVersionId,
    versionId,
    requirementSetId,
    longRequirement,
    longRequirementId: `os4-trace-${versionId}`,
  };
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

  const allowedHttp = [];
  const deliberateHttp = [];
  const unexpectedHttp = [];
  const consoleProblems = [];
  const externalRequests = [];
  const resourcePaths = [];
  const matchPosts = [];
  const upgradePosts = [];
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
      if (request.method() === "POST" && /\/match-runs$/.test(url.pathname)) {
        matchPosts.push({
          path: url.pathname,
          idempotencyKey: request.headers()["idempotency-key"] || null,
          body: request.postData(),
        });
      }
      if (request.method() === "POST" && /\/job-version-upgrades$/.test(url.pathname)) {
        upgradePosts.push({
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
    const context = await browser.newContext({ viewport: { width: 1536, height: 960 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(30_000);
    trackPage(page);

    step("public-case-and-confirmed-profile");
    await page.goto(`${baseUrl}/jobs/${jobId}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: publicTitle }).waitFor();
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/application-cases",
    );
    await page.getByRole("button", { name: "加入我的求职" }).click();
    const createResponse = await createResponsePromise;
    assert.equal(createResponse.status(), 201);
    const publicCaseId = (await createResponse.json()).applicationCase.id;
    assert.match(publicCaseId, /^[0-9a-f-]{36}$/i);
    await page.waitForURL(new RegExp(`/applications/${publicCaseId}/requirements`));
    await installProfile(page);

    step("match-state-failure-and-session-boundary");
    const matchPath = `/v1/application-cases/${publicCaseId}/match-state`;
    let failedStateReads = 0;
    let failMatchState = true;
    allowHttp(503, new RegExp(`${publicCaseId}/match-state$`));
    const matchStateRoute = async (route) => {
      if (failMatchState) {
        failedStateReads += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "SYNTHETIC_MATCH_STATE_FAILURE", detail: "合成核对状态暂时不可用" }),
        });
        return;
      }
      await route.continue();
    };
    await page.route(`**${matchPath}`, matchStateRoute);
    await page.goto(`${baseUrl}/applications/${publicCaseId}/overview`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByText("三轴核对状态暂时无法读取").waitFor();
    await page.getByText("合成核对状态暂时不可用").waitFor();
    failMatchState = false;
    await page.getByRole("button", { name: "重新读取" }).click();
    await page.getByText("尚未核对这个固定岗位版本").waitFor();
    await page.unroute(`**${matchPath}`, matchStateRoute);
    assert(failedStateReads >= 2, `expected retryable state reads, received ${failedStateReads}`);
    assert.equal(
      resourcePaths.some((value) =>
        /CaseResumeWorkspace|ResumeDocumentEditor|CaseInterviewWorkspace/.test(value),
      ),
      false,
      "the Case overview must not load Resume Editor or Interview",
    );
    await assertNoDocumentOverflow(page, "1536 Case overview");

    let interceptedMatchPosts = 0;
    allowHttp(403, new RegExp(`${publicCaseId}/match-runs$`));
    const matchMutationPattern = `**/v1/application-cases/${publicCaseId}/match-runs`;
    const sessionRoute = async (route) => {
      interceptedMatchPosts += 1;
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "SESSION_REQUIRED", detail: "合成会话边界" }),
      });
    };
    await page.route(matchMutationPattern, sessionRoute);
    await page.getByRole("button", { name: "开始核对" }).click();
    await page.getByText(/系统没有自动重放刚才的修改/).waitFor();
    assert.equal(interceptedMatchPosts, 1);
    await page.unroute(matchMutationPattern, sessionRoute);
    const firstQueued = page.waitForResponse(
      (response) =>
        response.status() === 202 && new URL(response.url()).pathname.endsWith("/match-runs"),
    );
    await page.locator(".career-revision-conflict").getByRole("button", { name: "重试" }).click();
    await firstQueued;
    await page.getByText("核对任务已进入队列").waitFor();
    assert.equal(matchPosts.length, 2, "the recovered session must not replay the first mutation");
    assert.equal(matchPosts[0].idempotencyKey, matchPosts[1].idempotencyKey);

    step("fixed-version-match-and-profile-staleness");
    runOwnerTasks();
    await page.getByText("结果对应当前固定输入").waitFor();
    assert.equal(await page.locator(".career-case-match__axes article").count(), 3);
    await page.getByText("资格条件", { exact: true }).waitFor();
    await page.getByText("经历证据", { exact: true }).waitFor();
    await page.getByText("个人偏好", { exact: true }).waitFor();
    assert.doesNotMatch(
      await page.locator(".career-case-match").innerText(),
      /匹配良好|匹配度|总分/,
    );
    await reviseProfileFacts(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("已有结果需要重新核对").waitFor();
    await page.getByText("求职事实已有新修订").waitFor();
    await page.getByText("以下是上次固定输入的结果；重新核对前不会覆盖。").waitFor();
    assert.equal(await page.locator(".career-case-match__axes article").count(), 3);
    await page.getByRole("button", { name: "重新核对" }).click();
    await page.getByText("核对任务已进入队列").waitFor();
    runOwnerTasks();
    await page.getByText("结果对应当前固定输入").waitFor();

    step("catalog-diff-focus-and-mobile-layout");
    const nextVersion = await createNextCatalogVersion(client, jobId);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText(/目录有新版本，当前仍固定在/).waitFor();
    await page.getByText("目录已有新版本").waitFor();
    assert.equal(await page.locator(".career-case-match__axes article").count(), 3);
    const diffTrigger = page.getByRole("button", { name: "查看变化" });
    await diffTrigger.focus();
    await assertFocused(page, ".career-case-version-control button");
    await diffTrigger.press("Enter");
    await page.locator(".career-version-dialog[role='dialog']").waitFor();
    await assertFocused(page, ".career-version-dialog [aria-label='关闭岗位版本差异']");
    await page
      .locator(".career-version-requirements")
      .filter({ hasText: nextVersion.longRequirement })
      .waitFor();
    await assertNoDocumentOverflow(page, "1536 version diff");
    await page.keyboard.press("Escape");
    await assertFocused(page, ".career-case-version-control button");

    await page.setViewportSize({ width: 320, height: 800 });
    await page.getByRole("button", { name: "查看变化" }).click();
    await page.locator(".career-version-dialog[role='dialog']").waitFor();
    await assertNoDocumentOverflow(page, "320 version diff");
    await page
      .locator(".career-version-requirements")
      .filter({ hasText: nextVersion.longRequirement })
      .waitFor();
    await page.keyboard.press("Escape");
    await assertFocused(page, ".career-case-version-control button");
    await page.setViewportSize({ width: 1536, height: 960 });

    step("version-upgrade-conflict-and-reconfirm");
    await page.getByRole("button", { name: "查看变化" }).click();
    const requirements = await browserRequest(page, {
      method: "GET",
      requestPath: `/v1/application-cases/${publicCaseId}/requirements`,
    });
    const conflictRequirement = requirements.body.requirements[0];
    assert(conflictRequirement, "the fixed Case must expose at least one requirement");
    await browserRequest(page, {
      method: "PUT",
      requestPath: `/v1/application-cases/${publicCaseId}/requirements/${encodeURIComponent(conflictRequirement.id)}`,
      body: {
        expectedRevision: requirements.body.revision,
        state: "needs_work",
        userNote: "OS-4 合成冲突：保留版本差异对话框后再次确认。",
      },
    });
    allowHttp(409, new RegExp(`${publicCaseId}/job-version-upgrades$`));
    const conflictResponse = page.waitForResponse(
      (response) =>
        response.status() === 409 &&
        new URL(response.url()).pathname.endsWith("/job-version-upgrades"),
    );
    const detailRefresh = page.waitForResponse(
      (response) =>
        response.status() === 200 &&
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === `/v1/application-cases/${publicCaseId}`,
    );
    await page.getByRole("button", { name: "确认升级 Case" }).click();
    await conflictResponse;
    await detailRefresh;
    await page.getByText("版本升级没有完成").waitFor();
    await page
      .locator(".career-version-requirements")
      .filter({ hasText: nextVersion.longRequirement })
      .waitFor();
    assert.equal(await page.locator(".career-version-dialog[role='dialog']").count(), 1);
    const upgradeResponse = page.waitForResponse(
      (response) =>
        response.status() === 200 &&
        new URL(response.url()).pathname.endsWith("/job-version-upgrades"),
    );
    await page.getByRole("button", { name: "确认升级 Case" }).click();
    await upgradeResponse;
    await page.getByText(/与目录一致/).waitFor();
    await page.getByText("已有结果需要重新核对").waitFor();
    await page.getByText("Case 已固定到其他岗位版本").waitFor();
    assert.equal(await page.locator(".career-case-match__axes article").count(), 3);
    assert.equal(upgradePosts.length, 2);
    assert(upgradePosts.every(({ idempotencyKey }) => Boolean(idempotencyKey)));
    assert.notEqual(upgradePosts[0].idempotencyKey, upgradePosts[1].idempotencyKey);

    step("requirements-deep-link-and-recomputed-match");
    const overviewUrl = page.url();
    const requirementUrl = `${baseUrl}/applications/${publicCaseId}/requirements?requirement=${encodeURIComponent(nextVersion.longRequirementId)}`;
    await page.goto(requirementUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "逐项理解岗位要求" }).waitFor();
    await page.getByText(nextVersion.longRequirement, { exact: true }).first().waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText(nextVersion.longRequirement, { exact: true }).first().waitFor();
    await page.goBack({ waitUntil: "networkidle" });
    assert.equal(page.url(), overviewUrl);
    await page.goForward({ waitUntil: "networkidle" });
    assert.equal(page.url(), requirementUrl);
    await page.goto(`${baseUrl}/applications/${publicCaseId}/overview`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "重新核对" }).click();
    await page.getByText("核对任务已进入队列").waitFor();
    runOwnerTasks();
    await page.getByText("结果对应当前固定输入").waitFor();

    step("private-case-and-owner-boundary");
    const privateCreated = await browserRequest(page, {
      method: "POST",
      requestPath: "/v1/application-cases",
      idempotencyKey: `os4-private-${randomUUID()}`,
      body: {
        jobContext: {
          kind: "private_input",
          title: "OS-4 合成私有战略分析实习生长标题用于窄屏换行核验",
          companyName: "OS-4 合成私有企业",
          contentText: "仅用于离线验收的私有 JD；未知字段保持未知，不进入公共三轴匹配。",
          source: { kind: "unspecified" },
        },
      },
    });
    const privateCaseId = privateCreated.body.applicationCase.id;
    await page.goto(`${baseUrl}/applications/${privateCaseId}/overview`, { waitUntil: "networkidle" });
    await page.getByText(/私有 JD 内容修订/).waitFor();
    await page.getByText("私有 JD 保持逐项核对").waitFor();
    allowHttp(422, new RegExp(`${privateCaseId}/match-runs$`));
    await browserRequest(page, {
      method: "POST",
      requestPath: `/v1/application-cases/${privateCaseId}/match-runs`,
      idempotencyKey: `os4-private-match-${randomUUID()}`,
      expectedStatus: 422,
      body: { expectedCaseRevision: privateCreated.body.applicationCase.revision },
    });

    const otherContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const otherPage = await otherContext.newPage();
    otherPage.setDefaultTimeout(15_000);
    trackPage(otherPage);
    allowHttp(404, new RegExp(`/application-cases/${publicCaseId}(?:/match-state)?$`));
    allowHttp(404, /\/application-cases\/not-a-case-id$/);
    await otherPage.goto(`${baseUrl}/applications/${publicCaseId}/overview`, {
      waitUntil: "domcontentloaded",
    });
    await otherPage.getByRole("heading", { name: "没有找到这个求职项目" }).waitFor();
    await browserRequest(otherPage, {
      method: "GET",
      requestPath: `/v1/application-cases/${publicCaseId}/match-state`,
      expectedStatus: 404,
    });
    await otherPage.goto(`${baseUrl}/applications/not-a-case-id/overview`, {
      waitUntil: "domcontentloaded",
    });
    await otherPage.getByRole("heading", { name: "没有找到这个求职项目" }).waitFor();
    await otherContext.close();

    step("four-viewports-and-requirement-overlay");
    for (const viewport of [
      { width: 1280, height: 900, label: "1280" },
      { width: 768, height: 900, label: "768-equivalent-200-percent" },
      { width: 320, height: 800, label: "320" },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${baseUrl}/applications/${publicCaseId}/overview`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: /M1 合成科技/ }).waitFor();
      await page.getByText("结果对应当前固定输入").waitFor();
      await assertNoDocumentOverflow(page, `${viewport.label} Case overview`);
    }
    const upgradedRequirements = await browserRequest(page, {
      method: "GET",
      requestPath: `/v1/application-cases/${publicCaseId}/requirements`,
    });
    const longRequirementId = upgradedRequirements.body.requirements.find(
      ({ sourceText }) => sourceText === nextVersion.longRequirement,
    )?.id;
    assert(longRequirementId, "the upgraded requirement must remain addressable");
    await page.goto(
      `${baseUrl}/applications/${publicCaseId}/requirements?requirement=${encodeURIComponent(longRequirementId)}`,
      { waitUntil: "networkidle" },
    );
    const requirementDialog = page.locator(".career-modal-surface--inspector[role='dialog']");
    await requirementDialog.waitFor();
    await assertFocused(
      page,
      ".career-modal-surface--inspector [aria-label='关闭要求检查器']",
    );
    await page.getByText(nextVersion.longRequirement, { exact: true }).first().waitFor();
    await assertNoDocumentOverflow(page, "320 requirement inspector");
    await page.keyboard.press("Escape");
    await assertFocused(page, `[data-requirement-trigger="${longRequirementId}"]`);

    step("delete-unreadable-flag-off-and-network-boundary");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/applications/${publicCaseId}/overview`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "删除求职项目" }).click();
    await assertFocused(
      page,
      ".career-modal-surface--case-deletion button.career-button--quiet",
    );
    for (const name of [
      "case-resume-disposition",
      "case-interview-disposition",
      "case-debrief-disposition",
    ]) {
      await page.locator(`input[name="${name}"]`).first().check();
    }
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.status() === 200 &&
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname === `/v1/application-cases/${publicCaseId}`,
    );
    await page.getByRole("button", { name: "按以上选择删除" }).click();
    await deleteResponse;
    await page.waitForURL(/\/applications(?:\?|$)/);
    allowHttp(404, new RegExp(`/application-cases/${publicCaseId}(?:/match-state)?$`));
    await page.goto(`${baseUrl}/applications/${publicCaseId}/overview`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "没有找到这个求职项目" }).waitFor();
    await browserRequest(page, {
      method: "GET",
      requestPath: `/v1/application-cases/${publicCaseId}/match-state`,
      expectedStatus: 404,
    });

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

    assert(matchPosts.length >= 5, `expected real Case match commands, received ${matchPosts.length}`);
    assert(matchPosts.every(({ idempotencyKey }) => Boolean(idempotencyKey)));
    assert.deepEqual(externalRequests, [], `network must remain loopback: ${externalRequests.join(" | ")}`);
    assert.deepEqual(unexpectedHttp, [], `unexpected HTTP responses: ${unexpectedHttp.join(" | ")}`);
    assert(deliberateHttp.filter((problem) => problem.startsWith("503 ")).length >= 2);
    assert(deliberateHttp.some((problem) => problem.startsWith("403 ")));
    assert(deliberateHttp.some((problem) => problem.startsWith("409 ")));
    assert(deliberateHttp.some((problem) => problem.startsWith("422 ")));
    assert(deliberateHttp.filter((problem) => problem.startsWith("404 ")).length >= 5);
    assert.deepEqual(consoleProblems, [], `console must stay clean: ${consoleProblems.join(" | ")}`);

    await context.close();
    process.stdout.write(
      `${JSON.stringify({
        passed: true,
        jobId,
        publicCaseId,
        privateCaseId,
        initialVersionId: nextVersion.previousVersionId,
        upgradedVersionId: nextVersion.versionId,
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
