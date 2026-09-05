const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const path = require("node:path");
const { Client } = require("../../../packages/database/node_modules/pg");
const { seedCatalog } = require("./m1-browser-gate.cjs");
const { chromium } = require(path.join(process.env.CODEX_NODE_MODULES, "playwright"));
const url = new URL(process.env.OS7_FULL_DATABASE_URL);
assert(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/aijob_ux_full_test_/.test(url.pathname));

async function request(page, method, endpoint, body) {
  return page.evaluate(async ({method, endpoint, body}) => {
    const csrf = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("aijob_csrf="))?.slice(11);
    const response = await fetch(endpoint, {method, headers: {"Content-Type": "application/json", "x-csrf-token": decodeURIComponent(csrf ?? ""), "Idempotency-Key": crypto.randomUUID()}, ...(body ? {body: JSON.stringify(body)} : {})});
    if (!response.ok) throw new Error(`${endpoint}: ${response.status} ${await response.text()}`);
    return response.json();
  }, {method, endpoint, body});
}

async function main() {
  const db = new Client({connectionString: url.toString()});
  await db.connect();
  const browser = await chromium.launch({headless: true, executablePath: process.env.OS7_BROWSER_EXECUTABLE});
  const context = await browser.newContext();
  const errors = [];
  await context.route("**/*", route => {
    const target = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(target.hostname)) return route.continue();
    errors.push("external request"); return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  try {
    const jobId = await seedCatalog(db, {title: "合成·岗位事实纠偏验收"});
    const {rows: [version]} = await db.query("SELECT v.* FROM catalog.published_jobs j JOIN catalog.published_job_versions v ON v.id = j.current_version_id WHERE j.id = $1", [jobId]);
    await page.goto("http://127.0.0.1:5173/today", {waitUntil: "networkidle"});
    await page.getByRole("heading", {name: "今日", exact: true}).waitFor();
    const created = await request(page, "POST", "/v1/application-cases", {jobContext: {kind: "public", publishedJobId: jobId, publishedJobVersionId: version.id}});
    const caseId = created.applicationCase.id;
    const clause = "每周至少到岗3天，至少实习3个月，实习6个月优先";
    const unclassified = "具备良好的自驱力";
    const unit = (id, text, start) => ({id, text, evidenceRefs: ["synthetic-jd"], origin: {kind: "jd_clause"}, section: "requirements", sourceSpan: {start, end: start + text.length, excerptHash: createHash("sha256").update(text).digest("hex")}});
    const sourceUnits = [unit("fidelity-clause", clause, 0), unit("fidelity-unclassified", unclassified, clause.length + 1)];
    const requirement = (id, kind, expectedValue, necessity) => ({id, kind, operator: "at_least", expectedValue, necessity, sourceText: clause, sourceUnitId: sourceUnits[0].id, sourceSpan: sourceUnits[0].sourceSpan, evidenceRefs: ["synthetic-jd"]});
    const requirements = [requirement("fidelity-weekly", "weekly_attendance", 3, "required"), requirement("fidelity-minimum", "duration", 3, "required"), requirement("fidelity-preferred", "duration", 6, "preferred")];
    const nextSetId = randomUUID();
    await db.query("INSERT INTO catalog.job_requirement_sets (id, published_job_version_id, schema_version, source_units, requirements, content_hash) VALUES ($1,$2,'job-requirements-v5',$3::jsonb,$4::jsonb,$5)", [nextSetId, version.id, JSON.stringify(sourceUnits), JSON.stringify(requirements), createHash("sha256").update(JSON.stringify(requirements)).digest("hex")]);
    await db.query("INSERT INTO catalog.job_condition_projections SELECT published_job_version_id, $2::uuid, locations, weekly_attendance_days, duration_months, earliest_start_date, graduation_years, student_status, education_levels, majors, languages FROM catalog.job_condition_projections WHERE requirement_set_id = $1", [version.active_requirement_set_id, nextSetId]);
    await db.query("UPDATE catalog.published_job_versions SET active_requirement_set_id=$2 WHERE id=$1", [version.id, nextSetId]);
    await page.goto(`http://127.0.0.1:5173/applications/${caseId}/requirements`, {waitUntil: "networkidle"});
    assert.equal((await request(page, "GET", `/v1/application-cases/${caseId}/requirements`)).requirementContext.requirementSetId, version.active_requirement_set_id);
    await page.getByRole("button", {name: "查看变化", exact: true}).click();
    await page.getByRole("button", {name: "确认升级 Case", exact: true}).click();
    await page.locator('[data-source-unit="fidelity-clause"]').waitFor();
    for (const width of [1536, 1280, 768, 320]) {
      await page.setViewportSize({width, height: 960});
      assert.equal(await page.locator('[data-source-unit="fidelity-clause"] h3').textContent(), clause);
      assert.equal(await page.locator('[data-source-unit="fidelity-clause"] [data-requirement-trigger]').count(), 3);
      assert.equal(await page.locator('[data-source-unit="fidelity-unclassified"] h3').textContent(), unclassified);
      assert(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1), `overflow at ${width}`);
    }
    await page.reload({waitUntil: "networkidle"});
    assert.equal((await request(page, "GET", `/v1/application-cases/${caseId}/requirements`)).requirementContext.requirementSetId, nextSetId);
    await page.goto(`http://127.0.0.1:5173/applications/${caseId}/application`, {waitUntil: "networkidle"});
    await page.locator('[data-handoff-kind="exact"]').waitFor();
    await db.query("UPDATE catalog.published_job_versions SET application_link_kind='official_list_fallback' WHERE id=$1", [version.id]);
    await page.reload({waitUntil: "networkidle"});
    await page.getByRole("link", {name: "前往官方列表查找岗位"}).waitFor();
    assert.match(await page.locator('[data-handoff-kind="official_list_fallback"]').textContent(), /合成·岗位事实纠偏验收/);
    const after = await request(page, "GET", `/v1/application-cases/${caseId}`);
    assert.equal(after.stage, "interested");
    assert.equal(after.jobContext.officialUrl, null);
    await db.query("UPDATE catalog.published_job_versions SET application_link_kind='missing', apply_url=NULL WHERE id=$1", [version.id]);
    await page.reload({waitUntil: "networkidle"});
    await page.locator('[data-handoff-kind="missing"]').waitFor();
    assert.equal(await page.locator('[data-handoff-kind="missing"] a').count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({gate: "job-fact-fidelity", passed: true, widths: [1536, 1280, 768, 320], originalClauses: true, distinctAssertions: true, sameVersionExplicitUpgrade: true, historicalPin: true, handoffs: ["exact", "official_list_fallback", "missing"], externalRequests: 0}));
  } finally { await browser.close(); await db.end(); }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
