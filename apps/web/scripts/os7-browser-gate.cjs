const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { Client } = require("../../../packages/database/node_modules/pg");

const { seedBaseResume, seedCatalog } = require("./m1-browser-gate.cjs");

function loadPlaywright() {
  const bundledModules = process.env.CODEX_NODE_MODULES;
  return bundledModules ? require(path.join(bundledModules, "playwright")) : require("playwright");
}

function loopbackOrigin(value, label) {
  const parsed = new URL(value);
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname),
    `${label} must stay on loopback`,
  );
  return parsed.origin;
}

function safeDatabaseUrl(value, label, expectedPrefix) {
  assert(value, `${label} is required`);
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
      /^aijob_.+_test(?:_|$)/.test(databaseName) &&
      databaseName.startsWith(expectedPrefix),
    `${label} must point to a loopback ${expectedPrefix}* database`,
  );
  return value;
}

const fullBaseUrl = loopbackOrigin(
  process.env.OS7_FULL_BASE_URL || "http://127.0.0.1:5173",
  "OS7_FULL_BASE_URL",
);
const emptyBaseUrl = loopbackOrigin(
  process.env.OS7_EMPTY_BASE_URL || "http://127.0.0.1:5175",
  "OS7_EMPTY_BASE_URL",
);
const flagOffBaseUrl = loopbackOrigin(
  process.env.OS7_FLAG_OFF_BASE_URL || "http://127.0.0.1:5174",
  "OS7_FLAG_OFF_BASE_URL",
);
const fullDatabaseUrl = safeDatabaseUrl(
  process.env.OS7_FULL_DATABASE_URL,
  "OS7_FULL_DATABASE_URL",
  "aijob_ux_full_test_",
);
const emptyDatabaseUrl = safeDatabaseUrl(
  process.env.OS7_EMPTY_DATABASE_URL,
  "OS7_EMPTY_DATABASE_URL",
  "aijob_ux_empty_test_",
);
const browserExecutable = process.env.OS7_BROWSER_EXECUTABLE || undefined;
const pnpmExecutable = process.env.OS7_PNPM_EXECUTABLE || "pnpm";
const workspaceRoot = process.env.OS7_WORKSPACE_ROOT || process.cwd();
const runtimeRoot = process.env.OS7_RUNTIME_ROOT || workspaceRoot;

function step(label) {
  process.stdout.write(`OS7_GATE_STEP:${label}\n`);
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

async function assertVisualContract(page, label) {
  const result = await page.evaluate(() => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      return (
        style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length
      );
    };
    const undersized = [...document.querySelectorAll(".career-os *")]
      .filter(visible)
      .map((node) => ({
        tag: node.tagName,
        className: node.className,
        size: Number.parseFloat(getComputedStyle(node).fontSize),
      }))
      .filter((item) => Number.isFinite(item.size) && item.size < 12)
      .slice(0, 10);
    const nonstandardWeights = [...document.querySelectorAll(".career-os *")]
      .filter(visible)
      .map((node) => ({
        tag: node.tagName,
        className: node.className,
        weight: Number.parseInt(getComputedStyle(node).fontWeight, 10),
      }))
      .filter((item) => Number.isFinite(item.weight) && item.weight % 100 !== 0)
      .slice(0, 10);
    const oversizedTitles = [...document.querySelectorAll(".career-os h1")]
      .filter(visible)
      .map((node) => ({
        text: node.textContent?.trim(),
        size: Number.parseFloat(getComputedStyle(node).fontSize),
      }))
      .filter((item) => Number.isFinite(item.size) && item.size > 32);
    return { undersized, nonstandardWeights, oversizedTitles };
  });
  assert.deepEqual(
    result.undersized,
    [],
    `${label} undersized text: ${JSON.stringify(result.undersized)}`,
  );
  assert.deepEqual(
    result.nonstandardWeights,
    [],
    `${label} nonstandard font weights: ${JSON.stringify(result.nonstandardWeights)}`,
  );
  assert.deepEqual(
    result.oversizedTitles,
    [],
    `${label} oversized page titles: ${JSON.stringify(result.oversizedTitles)}`,
  );
}

async function browserRequest(page, input) {
  const result = await page.evaluate(async ({ method, requestPath, body, idempotencyKey }) => {
    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("aijob_csrf="))
      ?.slice("aijob_csrf=".length);
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (csrf) headers["x-csrf-token"] = decodeURIComponent(csrf);
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await fetch(requestPath, {
      method,
      credentials: "same-origin",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, text: await response.text() };
  }, input);
  if (input.expectedStatus === undefined) {
    assert(
      result.status >= 200 && result.status < 300,
      `${input.method} ${input.requestPath} failed: HTTP ${result.status} ${result.text}`,
    );
  } else {
    assert.equal(
      result.status,
      input.expectedStatus,
      `${input.method} ${input.requestPath} returned ${result.status}: ${result.text}`,
    );
  }
  return { status: result.status, body: result.text ? JSON.parse(result.text) : null };
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
        OS2_DATABASE_URL: fullDatabaseUrl,
        OS2_RUNTIME_ROOT: runtimeRoot,
      },
    },
  );
  assert.match(output, /OS2_OWNER_TASKS_PROCESSED:[1-9]\d*/);
}

async function createPublicCase(page, job) {
  const result = await browserRequest(page, {
    method: "POST",
    requestPath: "/v1/application-cases",
    idempotencyKey: `os7-public-case-${randomUUID()}`,
    body: {
      jobContext: {
        kind: "public",
        publishedJobId: job.jobId,
        publishedJobVersionId: job.versionId,
      },
    },
  });
  assert.equal(result.status, 201);
  return result.body.applicationCase;
}

async function createPrivateCase(page, suffix) {
  const result = await browserRequest(page, {
    method: "POST",
    requestPath: "/v1/application-cases",
    idempotencyKey: `os7-private-case-${randomUUID()}`,
    body: {
      jobContext: {
        kind: "private_input",
        title: `合成·${suffix}私有产品实习生`,
        companyName: `合成·${suffix}企业`,
        contentText:
          "仅用于 OS-7 离线系统总 Gate。职责包含用户研究、SQL 数据核验与跨团队复盘；截止时间、连续超长标识 ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 和其他安排未说明，不得补写。",
        source: { kind: "unspecified" },
        duplicateHandling: "create_separate",
      },
    },
  });
  assert.equal(result.status, 201);
  return result.body.applicationCase;
}

async function transitionCase(page, applicationCase, transitions) {
  let revision = applicationCase.revision;
  for (const transition of transitions) {
    const response = await browserRequest(page, {
      method: "POST",
      requestPath: `/v1/application-cases/${applicationCase.id}/transitions`,
      idempotencyKey: `os7-transition-${randomUUID()}`,
      body: {
        expectedRevision: revision,
        toStage: transition.toStage,
        outcome: transition.outcome ?? null,
        reason: null,
      },
    });
    revision = response.body.event.sequence;
  }
  return revision;
}

async function getCase(page, caseId) {
  return (
    await browserRequest(page, {
      method: "GET",
      requestPath: `/v1/application-cases/${caseId}`,
    })
  ).body;
}

async function installProfile(page) {
  const sectionId = randomUUID();
  const blockId = randomUUID();
  const evidenceId = randomUUID();
  return browserRequest(page, {
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
              title: "合成·项目经历",
              blocks: [
                {
                  id: blockId,
                  ordinal: 0,
                  text: "仅用于 OS-7 离线验收：完成用户访谈、SQL 数据分析与方案复盘。",
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
            section: "合成·项目经历",
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
}

async function reviseProfileFacts(page) {
  const current = await browserRequest(page, { method: "GET", requestPath: "/v1/profile/facts" });
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

async function createMatchRun(page, caseId) {
  const applicationCase = await getCase(page, caseId);
  const response = await browserRequest(page, {
    method: "POST",
    requestPath: `/v1/application-cases/${caseId}/match-runs`,
    idempotencyKey: `os7-match-${randomUUID()}`,
    body: { expectedCaseRevision: applicationCase.revision },
  });
  assert.equal(response.status, 202);
  return response.body;
}

async function createDerivedResume(page, caseId) {
  await page.goto(`${fullBaseUrl}/applications/${caseId}/resume`, { waitUntil: "networkidle" });
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

async function addEvidenceBackedBlock(page, text) {
  await page.getByRole("button", { name: "+ 添加内容区块" }).click();
  const block = page.locator(".career-resume-editor__block").last();
  await block.locator("textarea").fill(text);
  const evidenceInput = page
    .locator('.career-resume-editor__evidence input[type="checkbox"]')
    .first();
  if (!(await evidenceInput.isChecked())) await evidenceInput.check();
}

async function decideSuggestion(page, action, editedText) {
  const card = page
    .locator(".career-resume-review__suggestions > li")
    .filter({ has: page.getByRole("button", { name: action, exact: true }) })
    .first();
  await card.getByRole("button", { name: action, exact: true }).click();
  const draft = page.locator(".career-resume-review__decision-draft").first();
  await draft.waitFor();
  if (editedText) await draft.locator("textarea").fill(editedText);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/suggestions\/[0-9a-f-]+\/decisions$/i.test(new URL(response.url()).pathname),
  );
  await draft.getByRole("button", { name: "确认保存决定" }).click();
  assert.equal((await responsePromise).status(), 200);
}

async function createInterviewSession(page, caseId) {
  const applicationCase = await getCase(page, caseId);
  const created = await browserRequest(page, {
    method: "POST",
    requestPath: `/v1/application-cases/${caseId}/interview-sessions`,
    idempotencyKey: `os7-interview-${randomUUID()}`,
    body: { expectedCaseRevision: applicationCase.revision },
  });
  assert.equal(created.status, 201);
  return created.body.sessionId;
}

async function completeInterviewSession(page, caseId, sessionId) {
  let detail = (
    await browserRequest(page, {
      method: "GET",
      requestPath: `/v1/application-cases/${caseId}/interview-sessions/${sessionId}`,
    })
  ).body;
  for (let index = 0; index < 10; index += 1) {
    assert.equal(detail.session.status, "active");
    const result = await browserRequest(page, {
      method: "POST",
      requestPath: `/v1/application-cases/${caseId}/interview-sessions/${sessionId}/answers`,
      idempotencyKey: `os7-answer-${sessionId}-${index}-${randomUUID()}`,
      body: {
        expectedRevision: detail.session.revision,
        answer: `OS-7 第 ${index + 1} 题合成回答：明确目标、执行、协作与复盘，仅用于离线验收。`,
      },
    });
    if (result.body.completed) {
      return { sessionId, revision: result.body.appliedRevision };
    }
    detail = (
      await browserRequest(page, {
        method: "GET",
        requestPath: `/v1/application-cases/${caseId}/interview-sessions/${sessionId}`,
      })
    ).body;
  }
  throw new Error(`OS7_INTERVIEW_DID_NOT_COMPLETE:${sessionId}`);
}

async function prepareDebrief(page, caseId, completedSession) {
  const result = await browserRequest(page, {
    method: "PUT",
    requestPath: `/v1/application-cases/${caseId}/debrief`,
    idempotencyKey: `os7-debrief-${randomUUID()}`,
    body: {
      interviewSessionId: completedSession.sessionId,
      expectedSessionRevision: completedSession.revision,
    },
  });
  assert.equal(result.status, 201);
  return result.body.debrief;
}

async function confirmDebrief(page, caseId, debrief) {
  const itemDecisions = [
    ...debrief.expressionIssues.map((item) => ({
      itemKind: "expression_issue",
      itemId: item.id,
      decision: "accepted",
      editedText: null,
    })),
    ...debrief.evidenceGaps.map((item) => ({
      itemKind: "evidence_gap",
      itemId: item.id,
      decision: "deferred",
      editedText: null,
    })),
  ];
  const result = await browserRequest(page, {
    method: "POST",
    requestPath: `/v1/application-cases/${caseId}/debrief/confirmations`,
    idempotencyKey: `os7-debrief-confirm-${randomUUID()}`,
    body: { expectedDebriefRevision: debrief.revision, itemDecisions },
  });
  assert.equal(result.status, 201);
  return result.body;
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
  assert(row, "OS-7 legacy Tailoring requires a Case-derived Resume");
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
        `os7-legacy-${runId}`,
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
        "OS-7 只读兼容 fixture，不允许产生新写入。",
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

async function seedLegacyReview(client, documentId) {
  const context = await client.query(
    `SELECT owner_id, owner_epoch, case_id, detached_from_case_id, id AS document_id,
            current_content_revision_id, job_context_kind, published_job_id,
            published_job_version_id, requirement_set_id, private_job_snapshot_id,
            job_context_revision, evidence_revision_id
       FROM profile.resume_documents
      WHERE id = $1 AND deleted_at IS NULL`,
    [documentId],
  );
  const row = context.rows[0];
  assert(row?.detached_from_case_id, "OS-7 legacy Review requires a detached Resume");
  const reviewId = randomUUID();
  await client.query(
    `INSERT INTO profile.resume_review_runs
      (id, schema_version, owner_id, owner_epoch, case_id, detached_from_case_id,
       document_id, content_revision_id, job_context_kind, published_job_id,
       published_job_version_id, requirement_set_id, private_job_snapshot_id,
       job_context_revision, evidence_revision_id, mode, status, revision,
       creation_idempotency_key, creation_request_hash, completed_at, created_at, updated_at)
     VALUES ($1, 'resume-review-run-v1', $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, 'template', 'completed', 1, $15, $16, now(), now(), now())`,
    [
      reviewId,
      row.owner_id,
      row.owner_epoch,
      row.case_id,
      row.detached_from_case_id,
      row.document_id,
      row.current_content_revision_id,
      row.job_context_kind,
      row.published_job_id,
      row.published_job_version_id,
      row.requirement_set_id,
      row.private_job_snapshot_id,
      row.job_context_revision,
      row.evidence_revision_id,
      `os7-legacy-review-${reviewId}`,
      "d".repeat(64),
    ],
  );
  return reviewId;
}

async function main() {
  const fullClient = new Client({ connectionString: fullDatabaseUrl });
  const emptyClient = new Client({ connectionString: emptyDatabaseUrl });
  await Promise.all([fullClient.connect(), emptyClient.connect()]);
  const catalogTitles = [
    "合成·产品策略实习生",
    "合成·用户研究实习生",
    "合成·数据产品实习生",
    "合成·产品运营实习生",
  ];
  const jobIds = [];
  for (const [index, title] of catalogTitles.entries()) {
    jobIds.push(
      await seedCatalog(fullClient, {
        title,
        companyName: `合成·Career OS 企业 ${index + 1}`,
        sourceName: `合成·Career OS 官方招聘源 ${index + 1}`,
      }),
    );
  }
  const jobRows = await fullClient.query(
    `SELECT job.id AS job_id, job.current_version_id AS version_id, version.title
       FROM catalog.published_jobs AS job
       JOIN catalog.published_job_versions AS version ON version.id = job.current_version_id
      WHERE job.id = ANY($1::uuid[])`,
    [jobIds],
  );
  const jobsById = new Map(jobRows.rows.map((row) => [row.job_id, row]));
  const jobs = jobIds.map((jobId) => ({
    jobId,
    versionId: jobsById.get(jobId).version_id,
    title: jobsById.get(jobId).title,
  }));

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
      if ([403, 404, 409, 503].some((status) => message.text().includes(`status of ${status}`))) {
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
      if (
        request.method() === "POST" &&
        /\/resume-documents\/[0-9a-f-]+\/reviews$/i.test(url.pathname)
      ) {
        reviewPosts.push({
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
    const fullContext = await browser.newContext({ viewport: { width: 1536, height: 960 } });
    const page = await fullContext.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(35_000);
    trackPage(page);

    step("full-manifest-cases-profile-and-lazy-entry");
    await page.goto(`${fullBaseUrl}/today`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "今日", exact: true }).waitFor();
    assert.equal(
      resourcePaths.some((value) =>
        /CaseInterviewWorkspace|ResumeDocumentEditor|CareerDataControlPage/.test(value),
      ),
      false,
      "Today first paint must not load Interview, Resume Studio or Data Control",
    );
    const publicCases = [];
    for (const job of jobs) publicCases.push(await createPublicCase(page, job));
    const privateCase = await createPrivateCase(page, "阶段");
    await transitionCase(page, publicCases[1], [{ toStage: "preparing" }]);
    await transitionCase(page, publicCases[2], [{ toStage: "preparing" }]);
    const preparingCase = await getCase(page, publicCases[2].id);
    const applicationResult = await browserRequest(page, {
      method: "POST",
      requestPath: `/v1/application-cases/${publicCases[2].id}/manual-applications`,
      idempotencyKey: `os7-application-${randomUUID()}`,
      body: { expectedRevision: preparingCase.revision },
    });
    assert.equal(applicationResult.status, 200);
    await transitionCase(page, publicCases[3], [
      { toStage: "preparing" },
      { toStage: "applied" },
      { toStage: "interviewing" },
    ]);
    await transitionCase(page, privateCase, [{ toStage: "resolved", outcome: "withdrawn" }]);
    await installProfile(page);

    const richCaseId = publicCases[2].id;
    const requirements = (
      await browserRequest(page, {
        method: "GET",
        requestPath: `/v1/application-cases/${richCaseId}/requirements`,
      })
    ).body;
    const firstState = await browserRequest(page, {
      method: "PUT",
      requestPath: `/v1/application-cases/${richCaseId}/requirements/${requirements.requirements[0].id}`,
      body: {
        expectedRevision: requirements.revision,
        state: "confirmed",
        userNote: "合成·已有证据",
      },
    });
    await browserRequest(page, {
      method: "PUT",
      requestPath: `/v1/application-cases/${richCaseId}/requirements/${requirements.requirements[1].id}`,
      body: {
        expectedRevision: firstState.body.caseRevision,
        state: "needs_work",
        userNote: "合成·证据待补充",
      },
    });
    await page.goto(`${fullBaseUrl}/applications/${richCaseId}/requirements`, {
      waitUntil: "networkidle",
    });
    for (const evidenceState of ["已有证据", "证据待补充", "用户尚未确认"]) {
      await page.getByText(evidenceState, { exact: true }).first().waitFor();
    }

    step("matching-recommendation-and-insight-real-services");
    await createMatchRun(page, richCaseId);
    runOwnerTasks();
    await reviseProfileFacts(page);
    await createMatchRun(page, publicCases[1].id);
    runOwnerTasks();
    await page.goto(`${fullBaseUrl}/applications/${richCaseId}/overview`, {
      waitUntil: "networkidle",
    });
    await page.getByText("已有结果需要重新核对", { exact: true }).waitFor();
    await page.goto(`${fullBaseUrl}/applications/${publicCases[1].id}/overview`, {
      waitUntil: "networkidle",
    });
    await page.getByText("结果对应当前固定输入", { exact: true }).waitFor();
    await page.goto(
      `${fullBaseUrl}/jobs/recommended?cities=%E4%B8%8A%E6%B5%B7&jobFamilies=product`,
      {
        waitUntil: "networkidle",
      },
    );
    const recommendationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/recommendation-runs/from-search",
    );
    await page.getByRole("button", { name: "生成推荐", exact: true }).first().click();
    assert.equal((await recommendationResponse).status(), 202);
    await page.waitForURL(/\/jobs\/recommended\/[0-9a-f-]{36}/i);
    const recommendationUrl = page.url();
    runOwnerTasks();
    await page.getByRole("heading", { name: /\d+ 个岗位依据/ }).waitFor();
    await page.goto(`${fullBaseUrl}/jobs/insights`, { waitUntil: "networkidle" });
    await page.getByLabel("岗位方向").selectOption("product");
    await page.getByLabel("城市").fill("上海");
    const insightResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/job-insight-runs",
    );
    await page.getByRole("button", { name: "生成市场洞察" }).click();
    assert((await insightResponse).ok());
    await page.waitForURL(/\/jobs\/insights\/[0-9a-f-]{36}/i);
    const insightUrl = page.url();

    step("resume-review-conflict-session-docx-and-print");
    await seedBaseResume(fullClient, richCaseId);
    const richDocumentId = await createDerivedResume(page, richCaseId);
    for (const text of [
      "负责 SQL 数据分析，并根据用户访谈整理复盘结论。",
      "参与用户研究并核对 SQL 数据，结论仍由证据确认。",
      "与合成团队协作形成可追溯方案，不补写未知事实。",
    ]) {
      await addEvidenceBackedBlock(page, text);
    }
    const initialSave = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/resume-documents/${richDocumentId}/revisions`,
    );
    await page.getByRole("button", { name: "保存正文修订" }).click();
    assert.equal((await initialSave).status(), 201);
    const stalePage = await fullContext.newPage();
    stalePage.setDefaultTimeout(20_000);
    trackPage(stalePage);
    await stalePage.goto(page.url(), { waitUntil: "networkidle" });
    const staleDraft = stalePage.locator(".career-resume-editor__block textarea").first();
    await staleDraft.fill("合成·第二标签页冲突草稿必须保留");
    const freshDraft = page.locator(".career-resume-editor__block textarea").first();
    await freshDraft.fill("合成·第一标签页先保存当前修订");
    const freshSave = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/resume-documents/${richDocumentId}/revisions`,
    );
    await page.getByRole("button", { name: "保存正文修订" }).click();
    assert.equal((await freshSave).status(), 201);
    allowHttp(409, new RegExp(`/resume-documents/${richDocumentId}/revisions$`));
    const staleSave = stalePage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/resume-documents/${richDocumentId}/revisions`,
    );
    await stalePage.getByRole("button", { name: "保存正文修订" }).click();
    assert.equal((await staleSave).status(), 409);
    await stalePage.getByText("服务器已有更新，本地草稿没有被覆盖").waitFor();
    assert.match(await staleDraft.inputValue(), /冲突草稿必须保留/);
    await stalePage.close();
    await page.reload({ waitUntil: "networkidle" });

    let interceptReview = true;
    let interceptedReviewPosts = 0;
    allowHttp(403, new RegExp(`/resume-documents/${richDocumentId}/reviews$`));
    const reviewPattern = `**/v1/resume-documents/${richDocumentId}/reviews`;
    const reviewRoute = async (route) => {
      if (!interceptReview) return route.continue();
      interceptedReviewPosts += 1;
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "SESSION_REQUIRED", detail: "OS-7 合成会话边界" }),
      });
    };
    await page.route(reviewPattern, reviewRoute);
    await page.getByRole("button", { name: "运行确定性模板" }).click();
    await page.getByText(/系统没有自动重放刚才的修改/).waitFor();
    assert.equal(interceptedReviewPosts, 1);
    interceptReview = false;
    const reviewQueued = page.waitForResponse(
      (response) =>
        response.status() === 202 &&
        new URL(response.url()).pathname === `/v1/resume-documents/${richDocumentId}/reviews`,
    );
    await page.getByRole("button", { name: "运行确定性模板" }).click();
    await reviewQueued;
    assert.equal(interceptedReviewPosts, 1);
    assert.equal(reviewPosts.at(-2).idempotencyKey, reviewPosts.at(-1).idempotencyKey);
    await page.unroute(reviewPattern, reviewRoute);
    runOwnerTasks();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("审阅已完成", { exact: true }).waitFor();
    const suggestionCount = await page.locator(".career-resume-review__suggestions > li").count();
    assert(
      suggestionCount >= 4,
      `OS-7 requires accepted/edited/rejected/pending suggestions (${suggestionCount})`,
    );
    await decideSuggestion(page, "采用建议");
    await decideSuggestion(page, "编辑后采用", "完成用户研究、SQL 分析与方案复盘。");
    await decideSuggestion(page, "保留原文");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 DOCX" }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.docx$/i);
    const downloadStream = await download.createReadStream();
    const firstChunk = await new Promise((resolve, reject) => {
      downloadStream.once("data", resolve);
      downloadStream.once("error", reject);
    });
    assert.equal(Buffer.from(firstChunk).subarray(0, 2).toString("ascii"), "PK");
    await download.cancel();
    await page.evaluate(() => {
      window.__os7PrintCalled = false;
      window.print = () => {
        window.__os7PrintCalled = true;
      };
    });
    await page.getByRole("button", { name: "浏览器打印" }).click();
    assert.equal(await page.evaluate(() => window.__os7PrintCalled), true);
    const legacyTailoringId = await seedLegacyTailoring(fullClient, richCaseId);

    step("application-interview-debrief-and-detached-assets");
    const confirmedSessionId = await createInterviewSession(page, richCaseId);
    const confirmedSession = await completeInterviewSession(page, richCaseId, confirmedSessionId);
    const confirmedDebrief = await prepareDebrief(page, richCaseId, confirmedSession);
    await confirmDebrief(page, richCaseId, confirmedDebrief);
    await createDerivedResume(page, publicCases[3].id);
    const activeSessionId = await createInterviewSession(page, publicCases[3].id);
    const detachedCase = await createPrivateCase(page, "脱离资产");
    const detachedDocumentId = await createDerivedResume(page, detachedCase.id);
    const detachedSessionId = await createInterviewSession(page, detachedCase.id);
    const detachedSession = await completeInterviewSession(
      page,
      detachedCase.id,
      detachedSessionId,
    );
    const detachedDebrief = await prepareDebrief(page, detachedCase.id, detachedSession);
    const latestDetachedCase = await getCase(page, detachedCase.id);
    const deleteResult = await browserRequest(page, {
      method: "DELETE",
      requestPath: `/v1/application-cases/${detachedCase.id}`,
      body: {
        expectedRevision: latestDetachedCase.revision,
        resumeDocuments: "detach",
        interviewSessions: "detach",
        debriefs: "detach",
      },
    });
    assert.equal(deleteResult.status, 200);
    allowHttp(404, new RegExp(`/application-cases/${detachedCase.id}$`));
    await browserRequest(page, {
      method: "GET",
      requestPath: `/v1/application-cases/${detachedCase.id}`,
      expectedStatus: 404,
    });
    const legacyReviewId = await seedLegacyReview(fullClient, detachedDocumentId);
    const legacyReview = await browserRequest(page, {
      method: "GET",
      requestPath: `/v1/resume-documents/${detachedDocumentId}/review`,
    });
    assert.equal(legacyReview.body.review.reviewRun.schemaVersion, "resume-review-run-v1");

    step("owner-boundary-loading-error-retry-and-keyboard");
    const otherContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const otherPage = await otherContext.newPage();
    otherPage.setDefaultTimeout(20_000);
    trackPage(otherPage);
    await otherPage.goto(`${fullBaseUrl}/today`, { waitUntil: "networkidle" });
    const ownerBCase = await createPrivateCase(otherPage, "跨账户");
    assert(ownerBCase.id);
    allowHttp(404, new RegExp(`/application-cases/${richCaseId}$`));
    await browserRequest(otherPage, {
      method: "GET",
      requestPath: `/v1/application-cases/${richCaseId}`,
      expectedStatus: 404,
    });
    allowHttp(404, /\/application-cases\/not-a-case-id$/);
    await browserRequest(otherPage, {
      method: "GET",
      requestPath: "/v1/application-cases/not-a-case-id",
      expectedStatus: 404,
    });
    await otherContext.close();

    const boardPattern = "**/v1/application-cases/board?**";
    const boardDelay = async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    };
    await page.route(boardPattern, boardDelay);
    const boardRequestStart = resourcePaths.length;
    await page.goto(`${fullBaseUrl}/applications?view=board&stage=all&city=all&sort=updated`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByText("正在读取求职项目…").waitFor();
    await page.waitForLoadState("networkidle");
    await page.unroute(boardPattern, boardDelay);
    const boardRequests = resourcePaths.slice(boardRequestStart);
    const aggregateBoardReads = boardRequests.filter(
      (value) => value === "/v1/application-cases/board",
    ).length;
    assert(
      aggregateBoardReads >= 1 && aggregateBoardReads <= 2,
      `Board must use only the aggregate read model, allowing one dev-mode remount: ${boardRequests.join(" | ")}`,
    );
    assert.deepEqual(
      boardRequests.filter((value) =>
        /^\/v1\/application-cases\/[0-9a-f-]{36}(?:\/|$)/i.test(value),
      ),
      [],
      `Board must not issue per-Case reads: ${boardRequests.join(" | ")}`,
    );
    allowHttp(503, /\/v1\/jobs$/);
    let failCatalog = true;
    const catalogRoute = async (route) => {
      if (!failCatalog) return route.continue();
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "SYNTHETIC_RETRY", detail: "OS-7 合成目录暂时不可用" }),
      });
    };
    await page.route("**/v1/jobs?**", catalogRoute);
    await page.goto(`${fullBaseUrl}/jobs`, { waitUntil: "domcontentloaded" });
    await page.getByText("OS-7 合成目录暂时不可用").waitFor();
    failCatalog = false;
    await page.getByRole("button", { name: "重试" }).click();
    await page.getByRole("heading", { name: jobs[0].title }).waitFor();
    await page.unroute("**/v1/jobs?**", catalogRoute);

    await page.goto(`${fullBaseUrl}/today`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus({ preventScroll: true });
    });
    await page.keyboard.press("Tab");
    await assertFocused(page, ".skip-link");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "career-main");
    const commandTrigger = page.getByRole("button", { name: "搜索工作区页面" });
    await commandTrigger.focus();
    await page.keyboard.press("Control+K");
    await assertFocused(page, '.career-command-menu input[type="search"]');
    await page.keyboard.press("Escape");
    await assertFocused(page, "[data-command-search-trigger]");

    step("full-routes-four-viewports-and-visual-contract");
    const fullRoutes = [
      { path: "/today", target: page.getByRole("heading", { name: "今日", exact: true }) },
      { path: "/jobs", target: page.getByRole("heading", { name: "发现岗位", exact: true }) },
      {
        path: `/jobs/${jobs[0].jobId}`,
        target: page.getByRole("heading", { name: jobs[0].title }),
      },
      {
        path: new URL(recommendationUrl).pathname,
        target: page.getByRole("heading", { name: "证据推荐" }),
      },
      {
        path: new URL(insightUrl).pathname,
        target: page.getByRole("heading", { name: "岗位市场洞察" }),
      },
      {
        path: "/applications?view=board&stage=all&city=all&sort=updated",
        target: page.getByRole("heading", { name: "我的求职" }),
      },
      {
        path: `/applications/${richCaseId}/overview`,
        target: page.getByRole("heading", { name: jobs[2].title }),
      },
      {
        path: `/applications/${richCaseId}/requirements`,
        target: page.getByRole("heading", { name: "逐项理解岗位要求" }),
      },
      { path: `/applications/${richCaseId}/resume`, target: page.locator(".career-resume-editor") },
      {
        path: `/applications/${richCaseId}/application`,
        target: page.getByRole("heading", { name: "由你完成最后提交" }),
      },
      {
        path: `/applications/${richCaseId}/interview?session=${confirmedSessionId}`,
        target: page.getByRole("heading", { name: "模板面试", exact: true }),
      },
      {
        path: `/applications/${richCaseId}/debrief?session=${confirmedSessionId}`,
        target: page.getByRole("heading", { name: "面试复盘", exact: true }),
      },
      {
        path: "/resumes/import",
        target: page.getByRole("heading", { name: "上传简历，先确认事实与证据" }),
      },
      {
        path: "/resumes",
        target: page.getByRole("heading", { name: "一份可信基础，服务每个岗位版本" }),
      },
      { path: "/settings/data", target: page.getByRole("heading", { name: "由你决定保留什么" }) },
      {
        path: `/resume-tailorings/${legacyTailoringId}`,
        target: page.getByRole("heading", { name: "查看旧版岗位定向简历" }),
      },
    ];
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const route of fullRoutes) {
      await page.goto(`${fullBaseUrl}${route.path}`, { waitUntil: "networkidle" });
      await route.target.waitFor();
      await assertNoDocumentOverflow(page, `1280 ${route.path}`);
      await assertVisualContract(page, `1280 ${route.path}`);
      assert.doesNotMatch(await page.locator("body").innerText(), /匹配良好|匹配度|总分/);
    }
    const representativeRoutes = [
      { path: "/today", heading: "今日" },
      { path: "/jobs", heading: "发现岗位" },
      { path: "/applications?view=board&stage=all&city=all&sort=updated", heading: "我的求职" },
      { path: `/applications/${richCaseId}/overview`, heading: jobs[2].title },
      { path: `/applications/${richCaseId}/resume`, selector: ".career-resume-editor" },
      { path: "/settings/data", heading: "由你决定保留什么" },
    ];
    for (const viewport of [
      { width: 1536, height: 960, label: "1536" },
      { width: 1280, height: 900, label: "1280" },
      { width: 768, height: 900, label: "768-200-percent-equivalent" },
      { width: 320, height: 800, label: "320" },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of representativeRoutes) {
        await page.goto(`${fullBaseUrl}${route.path}`, { waitUntil: "networkidle" });
        if (route.heading) {
          await page.getByRole("heading", { name: route.heading, exact: true }).first().waitFor();
        } else {
          await page.locator(route.selector).waitFor();
        }
        await assertNoDocumentOverflow(page, `${viewport.label} ${route.path}`);
        await assertVisualContract(page, `${viewport.label} ${route.path}`);
      }
    }

    step("empty-database-real-empty-states");
    const emptyContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const emptyPage = await emptyContext.newPage();
    emptyPage.setDefaultTimeout(20_000);
    trackPage(emptyPage);
    for (const emptyRoute of [
      { path: "/today", text: "还没有进行中的求职项目" },
      { path: "/applications", text: "还没有求职项目" },
      { path: "/resumes", text: "还没有经过你确认的简历来源" },
      { path: "/jobs", text: "可信岗位目录当前为空" },
      { path: "/settings/data", text: "没有脱离项目后单独保留的资产" },
    ]) {
      await emptyPage.goto(`${emptyBaseUrl}${emptyRoute.path}`, { waitUntil: "networkidle" });
      await emptyPage.getByText(emptyRoute.text, { exact: false }).first().waitFor();
      await assertNoDocumentOverflow(emptyPage, `empty ${emptyRoute.path}`);
      await assertVisualContract(emptyPage, `empty ${emptyRoute.path}`);
    }
    const emptyCounts = await emptyClient.query(
      `SELECT
        (SELECT count(*)::integer FROM catalog.published_jobs) AS jobs,
        (SELECT count(*)::integer FROM application.application_cases) AS cases,
        (SELECT count(*)::integer FROM profile.resume_documents) AS documents,
        (SELECT count(*)::integer FROM profile.resume_evidence_revisions) AS evidence`,
    );
    assert.deepEqual(emptyCounts.rows[0], { jobs: 0, cases: 0, documents: 0, evidence: 0 });
    await emptyContext.close();

    step("flag-off-and-manifest-database-assertions");
    const flagContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const flagPage = await flagContext.newPage();
    const flagResources = [];
    flagPage.on("request", (request) => flagResources.push(new URL(request.url()).pathname));
    trackPage(flagPage);
    await flagPage.goto(`${flagOffBaseUrl}/jobs/${jobs[0].jobId}`, { waitUntil: "networkidle" });
    await flagPage.locator("main.product-shell").waitFor();
    assert.equal(await flagPage.locator(".career-os").count(), 0);
    assert.equal(
      flagResources.some((value) => /career-os|WorkspaceShell/.test(value)),
      false,
    );
    await flagContext.close();

    const ownerA = await fullClient.query(
      `SELECT owner_id FROM application.application_cases WHERE id = $1`,
      [richCaseId],
    );
    const ownerId = ownerA.rows[0].owner_id;
    const manifest = await fullClient.query(
      `SELECT
        (SELECT count(*)::integer FROM application.application_cases WHERE owner_id = $1 AND deleted_at IS NULL) AS active_cases,
        (SELECT count(*)::integer FROM application.application_cases WHERE owner_id = $1 AND deleted_at IS NULL AND published_job_id IS NOT NULL) AS public_cases,
        (SELECT count(*)::integer FROM application.application_cases WHERE owner_id = $1 AND deleted_at IS NULL AND private_job_snapshot_id IS NOT NULL) AS private_cases,
        (SELECT count(DISTINCT stage)::integer FROM application.application_cases WHERE owner_id = $1 AND deleted_at IS NULL) AS stages,
        (SELECT count(*)::integer FROM profile.resume_documents WHERE owner_id = $1 AND kind = 'base' AND deleted_at IS NULL) AS base_documents,
        (SELECT count(*)::integer FROM profile.resume_documents WHERE owner_id = $1 AND kind = 'case_derived' AND case_id IS NOT NULL AND deleted_at IS NULL) AS linked_documents,
        (SELECT count(*)::integer FROM profile.resume_documents WHERE owner_id = $1 AND kind = 'case_derived' AND detached_from_case_id IS NOT NULL AND deleted_at IS NULL) AS detached_documents,
        (SELECT count(*)::integer FROM matching.match_runs WHERE owner_id = $1 AND status = 'succeeded') AS match_runs,
        (SELECT count(*)::integer FROM matching.recommendation_runs WHERE owner_id = $1) AS recommendation_runs,
        (SELECT count(*)::integer FROM matching.job_insight_runs WHERE owner_id = $1) AS insight_runs,
        (SELECT count(*)::integer FROM profile.resume_review_runs WHERE owner_id = $1 AND schema_version = 'resume-review-run-v1') AS legacy_reviews,
        (SELECT count(*)::integer FROM profile.resume_review_runs WHERE owner_id = $1 AND schema_version = 'resume-review-run-v2') AS current_reviews,
        (SELECT count(*)::integer FROM matching.resume_tailoring_runs WHERE owner_id = $1) AS legacy_tailorings,
        (SELECT count(*)::integer FROM application.interview_sessions WHERE owner_id = $1 AND status = 'active' AND deleted_at IS NULL) AS active_interviews,
        (SELECT count(*)::integer FROM application.interview_sessions WHERE owner_id = $1 AND status = 'completed' AND deleted_at IS NULL) AS completed_interviews,
        (SELECT count(*)::integer FROM application.debriefs WHERE owner_id = $1 AND status = 'draft' AND deleted_at IS NULL) AS draft_debriefs,
        (SELECT count(*)::integer FROM application.debriefs WHERE owner_id = $1 AND status = 'confirmed' AND deleted_at IS NULL) AS confirmed_debriefs,
        (SELECT count(*)::integer FROM application.case_events WHERE owner_id = $1 AND event_type = 'manual_application_recorded') AS applications,
        (SELECT count(*)::integer FROM application.application_cases WHERE owner_id = $1 AND id = $2 AND deleted_at IS NOT NULL) AS deleted_cases`,
      [ownerId, detachedCase.id],
    );
    const counts = manifest.rows[0];
    assert.deepEqual(
      {
        active_cases: counts.active_cases,
        public_cases: counts.public_cases,
        private_cases: counts.private_cases,
        stages: counts.stages,
      },
      { active_cases: 5, public_cases: 4, private_cases: 1, stages: 5 },
    );
    for (const key of [
      "base_documents",
      "linked_documents",
      "detached_documents",
      "match_runs",
      "recommendation_runs",
      "insight_runs",
      "legacy_reviews",
      "current_reviews",
      "legacy_tailorings",
      "active_interviews",
      "completed_interviews",
      "draft_debriefs",
      "confirmed_debriefs",
      "applications",
      "deleted_cases",
    ]) {
      assert(
        Number(counts[key]) >= 1,
        `OS-7 full manifest missing ${key}: ${JSON.stringify(counts)}`,
      );
    }
    const requirementStates = await fullClient.query(
      `SELECT state, count(*)::integer AS count
         FROM application.case_requirement_states
        WHERE owner_id = $1 AND case_id = $2
        GROUP BY state`,
      [ownerId, richCaseId],
    );
    const persistedStates = new Map(requirementStates.rows.map((row) => [row.state, row.count]));
    assert(persistedStates.get("confirmed") >= 1);
    assert(persistedStates.get("needs_work") >= 1);
    const pendingSuggestions = await fullClient.query(
      `SELECT count(*)::integer AS count
         FROM profile.resume_review_suggestions AS suggestion
         JOIN profile.resume_review_runs AS run ON run.id = suggestion.review_run_id
        WHERE run.owner_id = $1 AND run.schema_version = 'resume-review-run-v2'
          AND suggestion.decision = 'pending'`,
      [ownerId],
    );
    assert(pendingSuggestions.rows[0].count >= 1);
    const confirmedEvent = await fullClient.query(
      `SELECT count(*)::integer AS count FROM application.case_events
        WHERE owner_id = $1 AND case_id = $2 AND event_type = 'debrief_confirmed'`,
      [ownerId, richCaseId],
    );
    assert.equal(confirmedEvent.rows[0].count, 1);

    allowHttp(404, /\/route-that-does-not-exist$/);
    await page.goto(`${fullBaseUrl}/route-that-does-not-exist`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "这里没有对应页面" }).waitFor();
    assert.equal(await page.locator(".career-os").count(), 1);
    assert.equal(await page.locator(".product-shell").count(), 0);

    assert.deepEqual(externalRequests, [], `external requests: ${externalRequests.join(" | ")}`);
    assert.deepEqual(consoleProblems, [], `console problems: ${consoleProblems.join(" | ")}`);
    assert.deepEqual(unexpectedHttp, [], `unexpected HTTP: ${unexpectedHttp.join(" | ")}`);
    for (const status of [403, 404, 409, 503]) {
      assert(
        deliberateHttp.some((problem) => problem.startsWith(`${status} `)),
        `OS-7 expected deliberate HTTP ${status}: ${deliberateHttp.join(" | ")}`,
      );
    }

    await fullContext.close();
    process.stdout.write(
      `${JSON.stringify({
        passed: true,
        fullDatabase: new URL(fullDatabaseUrl).pathname.slice(1),
        emptyDatabase: new URL(emptyDatabaseUrl).pathname.slice(1),
        jobIds,
        ownerId,
        richCaseId,
        richDocumentId,
        detachedDocumentId,
        activeSessionId,
        detachedSessionId,
        detachedDebriefId: detachedDebrief.id,
        legacyTailoringId,
        legacyReviewId,
        viewports: [1536, 1280, 768, 320],
      })}\n`,
    );
  } finally {
    await browser?.close();
    await Promise.all([fullClient.end(), emptyClient.end()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
