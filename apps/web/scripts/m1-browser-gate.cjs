const { randomUUID } = require("node:crypto");
const { mkdir } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { Client } = require("../../../packages/database/node_modules/pg");

const baseUrl = process.env.M1_BASE_URL || "http://127.0.0.1:5174";
const databaseUrl = process.env.M1_DATABASE_URL;
const browserExecutable = process.env.M1_BROWSER_EXECUTABLE || undefined;
const screenshotDirectory =
  process.env.M1_SCREENSHOT_DIR || path.join(os.tmpdir(), "aijob-m1-browser-gate");
const flagOff = process.argv.includes("--flag-off");
const publicTitle = "M1 合成产品实习生";

function assert(condition, message) {
  if (!condition) throw new Error(`M1_BROWSER_ASSERTION_FAILED: ${message}`);
}

async function seedCatalog(client) {
  const existing = await client.query(
    "SELECT published_job_id FROM catalog.published_job_versions WHERE title = $1 LIMIT 1",
    [publicTitle],
  );
  if (existing.rows[0]) return existing.rows[0].published_job_id;

  const organizationId = randomUUID();
  const sourceId = randomUUID();
  const recordId = randomUUID();
  const revisionId = randomUUID();
  const jobId = randomUUID();
  const versionId = randomUUID();
  const requirementSetId = randomUUID();
  const sourceUrl = `https://m1-${sourceId}.example.test/jobs/${recordId}`;
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
      id: "m1-city",
      kind: "city",
      operator: "one_of",
      expectedValue: ["上海"],
      sourceText: "工作地点：上海",
      evidenceRefs: [`${revisionId}#city`],
      sourceSpan: null,
      necessity: "required",
    },
    {
      id: "m1-sql",
      kind: "skill",
      operator: "contains",
      expectedValue: ["SQL"],
      sourceText: "掌握 SQL，并能完成用户研究与数据分析",
      evidenceRefs: [`${revisionId}#sql`],
      sourceSpan: null,
      necessity: "required",
    },
    {
      id: "m1-unknown",
      kind: "other",
      operator: "unknown",
      expectedValue: null,
      sourceText: "其他安排请与招聘方进一步确认",
      evidenceRefs: [`${revisionId}#unknown`],
      sourceSpan: null,
      necessity: "unknown",
    },
  ];

  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO source_control.organizations (id, slug, name, official_domain) VALUES ($1, $2, $3, $4)",
      [organizationId, `m1-${organizationId}`, "M1 合成科技", "m1.example.test"],
    );
    await client.query(
      `INSERT INTO source_control.sources
        (id, organization_id, source_candidate_id, source_key, source_type, name, current_policy_version)
       VALUES ($1, $2, NULL, $3, 'organization_career_site', $4, 1)`,
      [sourceId, organizationId, `m1-browser-${sourceId}`, "M1 合成企业招聘官网"],
    );
    await client.query(
      `INSERT INTO source_control.source_policy_versions
        (source_id, version, policy_status, config_registered, catalog_role, runtime_scope,
         provenance_level, acquisition_mode, adapter_key, adapter_version, entrypoints,
         crawl_interval, policy_notes, reviewed_at)
       VALUES ($1, 1, 'approved', true, 'canonical', 'alpha', 'organization_owned',
         'public_api', 'm1-offline-browser-fixture', '1', $2::jsonb, '24h', $3, now())`,
      [
        sourceId,
        JSON.stringify(["https://m1.example.test/jobs"]),
        "Synthetic offline fixture; never fetched.",
      ],
    );
    await client.query(
      `INSERT INTO source_control.source_runtime_states
        (source_id, policy_version, freshness_state, last_complete_run_at, consecutive_failures)
       VALUES ($1, 1, 'fresh', now(), 0)`,
      [sourceId],
    );
    await client.query(
      `INSERT INTO ingestion.source_job_records
        (id, source_id, source_job_id, canonical_source_url, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [recordId, sourceId, `m1-${recordId}`, sourceUrl],
    );
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
        "1".repeat(64),
        "M1 合成科技",
        publicTitle,
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
        "负责合成的产品研究、需求分析与数据复盘。",
        "工作地点：上海。掌握 SQL，并能完成用户研究与数据分析。其他安排请与招聘方进一步确认。",
        sourceUrl,
        `${sourceUrl}/apply`,
        JSON.stringify(knownWorkMode),
        JSON.stringify(unknown),
      ],
    );
    await client.query(
      "INSERT INTO catalog.published_jobs (id, current_version_id, public_version_id) VALUES ($1, NULL, NULL)",
      [jobId],
    );
    await client.query(
      `INSERT INTO catalog.published_job_versions
        (id, published_job_id, source_job_revision_id, content_hash, company_name, title,
         job_family, locations, responsibilities, requirements, structured_fields,
         activity_state, source_url, apply_url, effective_at, work_mode, deadline_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10,
         '{}'::jsonb, 'active', $11, $12, now(), $13::jsonb, $14::jsonb)`,
      [
        versionId,
        jobId,
        revisionId,
        "2".repeat(64),
        "M1 合成科技",
        publicTitle,
        JSON.stringify({
          state: "known",
          value: "product",
          evidenceRefs: [`${revisionId}#family`],
        }),
        JSON.stringify(knownLocations),
        "负责合成的产品研究、需求分析与数据复盘。",
        "工作地点：上海。掌握 SQL，并能完成用户研究与数据分析。其他安排请与招聘方进一步确认。",
        sourceUrl,
        `${sourceUrl}/apply`,
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
       VALUES ($1, $2, 'm1-browser-v1', $3::jsonb, $4)`,
      [requirementSetId, versionId, JSON.stringify(requirements), "3".repeat(64)],
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
    return jobId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function seedBaseResume(client, caseId) {
  const ownerResult = await client.query(
    `SELECT owner_id AS id, owner_epoch AS epoch
     FROM application.application_cases WHERE id = $1`,
    [caseId],
  );
  const owner = ownerResult.rows[0];
  assert(owner, "anonymous owner must exist before seeding a base resume");
  const existing = await client.query(
    "SELECT id FROM profile.resume_documents WHERE owner_id = $1 AND kind = 'base' AND deleted_at IS NULL",
    [owner.id],
  );
  if (existing.rows[0]) return;

  const documentId = randomUUID();
  const revisionId = randomUUID();
  const evidenceRevisionId = randomUUID();
  const sectionId = randomUUID();
  const blockId = randomUUID();
  const evidenceId = "m1-evidence-product-research";
  const content = [
    {
      id: sectionId,
      ordinal: 0,
      title: "项目经历",
      blocks: [
        {
          id: blockId,
          ordinal: 0,
          text: "在合成课程项目中完成用户访谈与 SQL 数据分析，并基于证据复盘方案。",
          evidenceIds: [evidenceId],
        },
      ],
    },
  ];
  const evidence = [
    {
      id: evidenceId,
      resumeAnalysisId: null,
      section: "项目经历",
      originalText: "合成课程项目用户研究与 SQL 数据分析。",
      claim: "完成用户研究、SQL 分析与方案复盘。",
      skills: ["用户研究", "SQL"],
      outcomes: ["形成可追溯复盘"],
      confirmed: true,
    },
  ];

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO profile.resume_documents
        (id, owner_id, owner_epoch, kind, title, case_id, published_job_id,
         published_job_version_id, requirement_set_id, base_document_id,
         base_document_revision_id, evidence_revision_id, current_content_revision_id,
         current_layout_revision_id, creation_idempotency_key, creation_request_hash,
         expires_at, deleted_at)
       VALUES ($1, $2, $3, 'base', 'M1 合成基础简历', NULL, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL, NULL, $4, $5, NULL, NULL)`,
      [documentId, owner.id, owner.epoch, `m1-base-${documentId}`, "4".repeat(64)],
    );
    await client.query(
      `INSERT INTO profile.resume_document_revisions
        (id, owner_id, owner_epoch, resume_analysis_id, revision, base_revision,
         schema_version, sections, content_hash, confirmed_at, document_id,
         document_revision, base_document_revision_id)
       VALUES ($1, $2, $3, NULL, 1, NULL, 'resume-content-v1', $4::jsonb,
         $5, now(), $6, 1, NULL)`,
      [revisionId, owner.id, owner.epoch, JSON.stringify(content), "5".repeat(64), documentId],
    );
    await client.query(
      `INSERT INTO profile.resume_evidence_revisions
        (id, owner_id, owner_epoch, resume_analysis_id, revision, base_revision,
         evidence, content_hash, confirmed_at, schema_version, document_revision_id)
       VALUES ($1, $2, $3, NULL, 1, NULL, $4::jsonb, $5, now(),
         'resume-evidence-v1', NULL)`,
      [evidenceRevisionId, owner.id, owner.epoch, JSON.stringify(evidence), "6".repeat(64)],
    );
    await client.query(
      "UPDATE profile.resume_documents SET current_content_revision_id = $2 WHERE id = $1",
      [documentId, revisionId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function caseIdFromUrl(url) {
  const match = /\/applications\/([0-9a-f-]{36})\//i.exec(url);
  assert(match, `expected Case URL, received ${url}`);
  return match[1];
}

async function openPrivateJd(page, input) {
  await page.goto(`${baseUrl}/applications`);
  await page.getByRole("button", { name: "导入私有 JD" }).first().click();
  await page.getByLabel("岗位名称").fill(input.title);
  if (input.companyName) await page.getByLabel("公司名称（可不填）").fill(input.companyName);
  await page.getByLabel("JD 原文").fill(input.content);
  if (input.url) {
    await page.getByLabel("用户提供链接").check();
    await page.getByLabel("HTTPS 链接").fill(input.url);
  }
  if (input.separate) await page.getByLabel("另建一份").check();
  await page.getByRole("button", { name: "加入我的求职" }).last().click();
  await page.waitForURL(/\/applications\/[0-9a-f-]{36}\/requirements/i);
  return caseIdFromUrl(page.url());
}

async function runFlagOff(browser, jobId) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${baseUrl}/jobs/${jobId}`);
  await page.getByRole("heading", { name: publicTitle }).waitFor();
  assert(
    (await page.getByRole("button", { name: "加入我的求职" }).count()) === 0,
    "flag-off job detail must not show the Career OS entry",
  );
  assert(
    (await page.locator(".product-shell").count()) > 0,
    "flag-off route must keep ProductShell",
  );
  await page.close();
}

async function runM1(browser, client, jobId) {
  const ownersBefore = await client.query(
    "SELECT count(*)::integer AS count FROM identity.owners WHERE deleted_at IS NULL",
  );
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleProblems = [];
  const unexpectedHttpProblems = [];
  const expectedHttpProblems = [];
  let expectedNetworkFailure = false;
  let expectedHttpStatus = null;
  const collectConsoleProblems = (targetPage) => {
    targetPage.on("console", (message) => {
      if (message.type() !== "error" && message.type() !== "warning") return;
      if (
        expectedNetworkFailure &&
        /Failed to load resource|ERR_FAILED|Failed to fetch/i.test(message.text())
      ) {
        return;
      }
      if (
        expectedHttpStatus !== null &&
        message.text().includes(`status of ${expectedHttpStatus}`)
      ) {
        return;
      }
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    });
    targetPage.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
    targetPage.on("response", (response) => {
      if (response.status() < 400) return;
      const problem = `${response.status()} ${new URL(response.url()).pathname}`;
      if (response.status() === expectedHttpStatus) {
        expectedHttpProblems.push(problem);
        return;
      }
      unexpectedHttpProblems.push(problem);
    });
  };
  collectConsoleProblems(page);
  context.on("page", collectConsoleProblems);

  await page.goto(`${baseUrl}/jobs/${jobId}`);
  await page.getByRole("heading", { name: publicTitle }).waitFor();
  const publicCreateResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/application-cases",
  );
  await page.getByRole("button", { name: "加入我的求职" }).click();
  const createResponse = await publicCreateResponse;
  if (!createResponse.ok()) {
    throw new Error(
      `M1_PUBLIC_CASE_CREATE_FAILED: HTTP ${createResponse.status()} request=${createResponse.request().postData()} response=${await createResponse.text()}`,
    );
  }
  await page.waitForURL(/\/applications\/[0-9a-f-]{36}\/requirements/i);
  const publicCaseId = caseIdFromUrl(page.url());
  const ownerCount = await client.query(
    "SELECT count(*)::integer AS count FROM identity.owners WHERE deleted_at IS NULL",
  );
  assert(
    ownerCount.rows[0].count === ownersBefore.rows[0].count + 1,
    "parallel first-page reads must create exactly one owner",
  );
  await page.getByText(/岗位版本 [0-9a-f-]{36}/i).waitFor();
  await page.getByRole("button", { name: /掌握 SQL/ }).click();
  await page.waitForURL(/[?&]requirement=m1-sql(?:&|$)/);
  await page.getByLabel("状态").selectOption("confirmed");
  await page.getByLabel("用户备注").fill("浏览器 Gate：SQL 经历需要关联已确认证据");
  const firstSaveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes(`/v1/application-cases/${publicCaseId}/requirements/`),
  );
  await page.getByRole("button", { name: "保存状态与备注" }).click();
  assert((await firstSaveResponse).ok(), "the first requirement update must succeed");
  await page
    .getByPlaceholder("记录需要向招聘方或自己进一步确认的问题")
    .fill("SQL 使用深度需要达到什么程度？");
  await page.getByRole("button", { name: "添加问题" }).click();
  await page.getByText("SQL 使用深度需要达到什么程度？").waitFor();
  await page.reload();
  await page.getByLabel("用户备注").waitFor();
  assert(
    (await page.getByLabel("状态").inputValue()) === "confirmed",
    "requirement state must survive refresh",
  );
  assert(
    (await page.getByLabel("用户备注").inputValue()).includes("浏览器 Gate"),
    "requirement note must survive refresh",
  );

  const secondTab = await context.newPage();
  await secondTab.goto(page.url());
  await secondTab.getByLabel("用户备注").fill("标签页二保留的冲突草稿");
  await page.getByLabel("用户备注").fill("标签页一先保存的更新");
  const tabOneSaveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes(`/v1/application-cases/${publicCaseId}/requirements/`),
  );
  await page.getByRole("button", { name: "保存状态与备注" }).click();
  assert((await tabOneSaveResponse).ok(), "the first tab update must succeed before conflict");
  expectedHttpStatus = 409;
  const conflictResponsePromise = secondTab.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes(`/v1/application-cases/${publicCaseId}/requirements/`),
  );
  await secondTab.getByRole("button", { name: "保存状态与备注" }).click();
  const conflictResponse = await conflictResponsePromise;
  const conflictBody = await conflictResponse.json();
  assert(conflictResponse.status() === 409, "the stale second-tab update must return HTTP 409");
  assert(
    conflictBody.code === "APPLICATION_CASE_REVISION_CONFLICT",
    `the stale second-tab update must return the standard revision conflict code (received ${JSON.stringify(conflictBody)})`,
  );
  await secondTab.getByText("数据已在另一处更新").waitFor();
  await secondTab.waitForTimeout(100);
  expectedHttpStatus = null;
  assert(
    (await secondTab.getByLabel("用户备注").inputValue()) === "标签页二保留的冲突草稿",
    "revision conflict must preserve the second-tab draft",
  );
  await secondTab.close();

  await page.goto(`${baseUrl}/applications/${publicCaseId}/resume`);
  await page.getByRole("heading", { name: "请先准备并确认基础简历" }).waitFor();
  await seedBaseResume(client, publicCaseId);
  await page.reload();
  await page.getByRole("heading", { name: "创建这份岗位派生简历" }).waitFor();
  await page.getByRole("button", { name: "创建岗位简历" }).click();
  await page.getByText("A4 只读预览").waitFor();
  const resumeBlock = page.locator("[data-resume-block-trigger]").first();
  await resumeBlock.click();
  await page.waitForURL(/\?block=[0-9a-f-]{36}/i);
  await page.reload();
  await page.getByText("在合成课程项目中完成用户访谈与 SQL 数据分析").first().waitFor();
  await page.screenshot({
    path: path.join(screenshotDirectory, "m1-resume-1280.png"),
    fullPage: true,
  });

  const privateInput = {
    title: "私有运营实习生",
    companyName: "私有合成公司",
    content:
      "岗位职责\n负责内容运营与数据复盘。\n任职要求\n每周到岗 4 天；其他信息需要进一步确认。",
  };
  const privateCaseId = await openPrivateJd(page, privateInput);
  const reusedCaseId = await openPrivateJd(page, privateInput);
  assert(
    reusedCaseId === privateCaseId,
    "default duplicate handling must reopen the existing private Case",
  );
  const separateCaseId = await openPrivateJd(page, { ...privateInput, separate: true });
  assert(separateCaseId !== privateCaseId, "create_separate must create another private Case");
  const urlCaseId = await openPrivateJd(page, {
    title: "私有销售实习生",
    content: "负责客户研究与销售线索整理。",
    url: "https://private.example.test/job/1",
  });
  assert(urlCaseId !== privateCaseId, "a different private JD must create a new Case");
  await page.getByText("用户提供链接，平台未核验").first().waitFor();

  await page.goto(`${baseUrl}/applications`);
  const trigger = page.locator(`[data-case-trigger="${publicCaseId}"]`);
  await trigger.click();
  await page.getByRole("button", { name: "关闭岗位侧览" }).click();
  await page.waitForFunction(
    (caseId) => document.activeElement?.getAttribute("data-case-trigger") === caseId,
    publicCaseId,
  );

  expectedNetworkFailure = true;
  await page.route("**/v1/application-cases?*", (route) => route.abort("failed"));
  await page.reload();
  await page.getByText("求职项目暂时无法读取").waitFor();
  await page.unroute("**/v1/application-cases?*");
  expectedNetworkFailure = false;
  await page.getByRole("button", { name: "重新读取" }).click();
  await page.locator("[data-case-trigger]").first().waitFor();

  expectedHttpStatus = 404;
  await page.goto(`${baseUrl}/applications/${randomUUID()}/overview`);
  await page.getByRole("heading", { name: "没有找到这个求职项目" }).waitFor();
  await page.waitForTimeout(100);
  expectedHttpStatus = null;

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${baseUrl}/applications`);
  await page.getByRole("button", { name: "导入私有 JD" }).first().click();
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert(mobileOverflow <= 1, `320px layout must not overflow the page (${mobileOverflow}px)`);
  await page.screenshot({
    path: path.join(screenshotDirectory, "m1-private-jd-320.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto(`${baseUrl}/applications`);
  const zoomOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert(
    zoomOverflow <= 1,
    `200% equivalent viewport must not overflow the page (${zoomOverflow}px)`,
  );

  assert(consoleProblems.length === 0, `console must stay clean: ${consoleProblems.join(" | ")}`);
  assert(
    unexpectedHttpProblems.length === 0,
    `unexpected HTTP failures must stay empty: ${unexpectedHttpProblems.join(" | ")}`,
  );
  assert(
    expectedHttpProblems.some((problem) => problem.startsWith("409 ")) &&
      expectedHttpProblems.some((problem) => problem.startsWith("404 ")),
    `the deliberate 409 and 404 checks must both run: ${expectedHttpProblems.join(" | ")}`,
  );
  await context.close();
  return { publicCaseId, privateCaseId, separateCaseId, urlCaseId };
}

async function main() {
  assert(databaseUrl, "M1_DATABASE_URL is required");
  await mkdir(screenshotDirectory, { recursive: true });
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const jobId = await seedCatalog(client);
  const browser = await chromium.launch({
    executablePath: browserExecutable,
    headless: true,
    timeout: 30_000,
  });
  try {
    if (flagOff) {
      await runFlagOff(browser, jobId);
      process.stdout.write(`${JSON.stringify({ mode: "flag-off", jobId, passed: true })}\n`);
    } else {
      const result = await runM1(browser, client, jobId);
      process.stdout.write(`${JSON.stringify({ mode: "m1", jobId, ...result, passed: true })}\n`);
    }
  } finally {
    await browser.close();
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
