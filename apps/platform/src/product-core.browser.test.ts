import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MaterialSnippetSchema,
  type MaterialSnippet,
  JobGraphScopeSchema,
  PlannerItemSchema,
  CaseStageSchema,
  type PlannerItem,
} from "@aijob/contracts";
import { chromium, type Browser, type Page } from "playwright-core";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { aggregateCurrentGraph, type GraphRecord } from "./insights/current-graph.js";
import { plannerCalendar } from "./planner/service.js";
import { interpretOfficialJob } from "./catalog/job-semantics.js";

const webUrl = process.env.AIJOB_TEST_WEB_URL;
const executablePath = process.env.AIJOB_TEST_BROWSER_EXECUTABLE;
(webUrl && executablePath ? describe : describe.skip)(
  "product core browser journey with offline API fixtures",
  () => {
    let browser: Browser;
    const now = new Date().toISOString();
    const ownerId = randomUUID();
    const rows: GraphRecord[] = Array.from({ length: 8 }, (_, index) => {
      const jobVersionId = randomUUID();
      const requirements =
        index < 5 ? "硕士及以上学历；熟练掌握SQL；985高校优先" : "本科及以上学历；熟悉Python或SQL";
      return {
        jobId: randomUUID(),
        jobVersionId,
        companyId: `company-${index % 3}`,
        companyName: ["青禾科技（测试）", "云川数据（测试）", "星舟研究（测试）"][
          index % 3
        ] as string,
        title: "产品运营实习生",
        verifiedAt: now,
        parsed: true,
        atoms: interpretOfficialJob({
          jobVersionId,
          title: "产品运营实习生",
          requirements,
          responsibilities: "制作数据看板与需求文档",
        }).atoms,
      };
    });
    beforeAll(async () => {
      if (new URL(webUrl as string).hostname !== "127.0.0.1")
        throw new Error("LOCAL_TEST_WEB_ONLY");
      browser = await chromium.launch({ executablePath: executablePath as string, headless: true });
    }, 30000);
    afterAll(async () => {
      await browser?.close();
    });
    async function fixture(page: Page, withEvidence = false, calendarOnServer = false) {
      const evidenceId = randomUUID(),
        revisionId = randomUUID();
      const revision = {
        id: revisionId,
        ownerId,
        revision: 1,
        baseRevision: null,
        contentHash: "a".repeat(64),
        confirmedAt: now,
        createdAt: now,
        resumeAnalysisId: null,
        schemaVersion: "resume-evidence-v1",
        documentRevisionId: null,
        evidence: [
          {
            id: evidenceId,
            resumeAnalysisId: null,
            section: "校园数据项目",
            originalText: "使用 SQL 分析校园问卷",
            claim: "使用 SQL 分析校园问卷",
            skills: ["SQL"],
            outcomes: [],
            confirmed: true,
          },
        ],
      };
      const items: PlannerItem[] = [];
      const snippets: MaterialSnippet[] = [];
      const errors: string[] = [];
      const unhandled: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page
        .context()
        .addCookies([
          { name: "aijob_csrf", value: "offline-fixture-token", url: webUrl as string },
        ]);
      await page.context().route("**/v1/**", async (route) => {
        const url = new URL(route.request().url()),
          path = url.pathname;
        let payload: unknown;
        if (path === "/v1/session")
          payload = {
            authenticated: true,
            owner: {
              id: ownerId,
              status: "active",
              epoch: 1,
              retentionMode: "anonymous_ttl",
              retentionExpiresAt: "2099-01-01T00:00:00.000Z",
              accountId: null,
              createdAt: now,
              lastSeenAt: now,
              deletedAt: null,
            },
            session: { id: randomUUID(), ownerEpoch: 1, expiresAt: "2099-01-01T00:00:00.000Z" },
          };
        else if (path === "/v1/job-graph")
          payload = aggregateCurrentGraph(
            rows,
            JobGraphScopeSchema.parse(JSON.parse(url.searchParams.get("scope") ?? "{}")),
            "fixture-1",
          );
        else if (path === "/v1/job-graph/evidence") {
          const matches = rows.flatMap((row) =>
            row.atoms
              .filter((atom) => atom.key === url.searchParams.get("key"))
              .map((atom) => ({
                jobId: row.jobId,
                jobVersionId: row.jobVersionId,
                title: row.title,
                companyName: row.companyName,
                atom,
              })),
          );
          payload = { items: matches, total: matches.length, nextOffset: null };
        } else if (path === "/v1/job-graph/personal-comparison") {
          payload = {
            key: route.request().postDataJSON().key,
            evidenceRevisionId: withEvidence ? revisionId : null,
            mode: "rules-reference",
            candidates: withEvidence
              ? [
                  {
                    evidenceId,
                    statement: "使用 SQL 分析校园问卷",
                    section: "校园数据项目",
                    reason: "包含同一工具的已确认表述",
                  },
                ]
              : [],
          };
        } else if (path === `/v1/profile/evidence/${revisionId}`) payload = revision;
        else if (path === "/v1/profile/evidence")
          payload = withEvidence
            ? revision
            : {
                revision: 0,
                resumeAnalysisId: null,
                schemaVersion: "resume-evidence-v2",
                documentRevisionId: null,
                evidence: [],
              };
        else if (path === "/v1/application-cases/board")
          payload = {
            schemaVersion: "application-board-v1",
            generatedAt: now,
            filters: { city: null, sort: "updated" },
            columns: CaseStageSchema.options.map((stage) => ({
              stage,
              total: 0,
              items: [],
              nextCursor: null,
            })),
          };
        else if (path === "/v1/planner-items" && route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          const item = PlannerItemSchema.parse({
            ...body,
            id: randomUUID(),
            revision: 1,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          });
          items.push(item);
          payload = item;
        } else if (path === "/v1/planner-items")
          payload = {
            items: items.filter(
              (item) => url.searchParams.get("status") === "all" || item.status !== "done",
            ),
            nextOffset: null,
          };
        else if (path.startsWith("/v1/planner-items/") && route.request().method() === "PUT") {
          const body = route.request().postDataJSON();
          const index = items.findIndex((item) => item.id === path.split("/").at(-1));
          const prior = items[index];
          if (!prior) throw new Error("PLANNER_FIXTURE_NOT_FOUND");
          items[index] = PlannerItemSchema.parse({
            ...prior,
            ...body,
            revision: prior.revision + 1,
            updatedAt: now,
            completedAt: body.status === "done" ? now : null,
          });
          payload = items[index];
        } else if (path === "/v1/material-snippets" && route.request().method() === "POST") {
          const item = MaterialSnippetSchema.parse({
            ...route.request().postDataJSON(),
            id: randomUUID(),
            revision: 1,
            createdAt: now,
            updatedAt: now,
          });
          snippets.push(item);
          payload = item;
        } else if (path === "/v1/material-snippets")
          payload = { items: snippets, nextOffset: null };
        else if (path === "/v1/planner-calendar.ics") {
          if (calendarOnServer) return route.continue();
          return route.fulfill({
            status: 200,
            contentType: "text/calendar; charset=utf-8",
            headers: { "content-disposition": "attachment; filename=planner.ics" },
            body: plannerCalendar(items),
          });
        } else if (path === "/v1/saved-searches") payload = { items: [] };
        else {
          unhandled.push(`${route.request().method()} ${path}`);
          return route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({ code: "UNHANDLED_FIXTURE", detail: path }),
          });
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(payload),
        });
      });
      return { items, snippets, errors, unhandled, evidenceId, revisionId };
    }
    it("opens original quotes without a resume, saves preparation, restores focus and completes the item", async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const state = await fixture(page);
      try {
        await page.goto(`${webUrl}/jobs/insights`);
        const trigger = page.getByRole("button", { name: "查看SQL原句", exact: true });
        await trigger.waitFor();
        await trigger.click();
        await page.getByRole("dialog", { name: "SQL的岗位原句" }).waitFor();
        await page.getByRole("button", { name: "关联经历 / 加入准备" }).first().click();
        const editor = page.getByRole("dialog", { name: "添加事项" });
        await editor.waitFor();
        await editor.getByLabel("事项名称", { exact: true }).fill("完成一份 SQL 分析报告");
        await editor
          .getByLabel("准备产物", { exact: true })
          .fill("整理分析步骤与结果，等待确认经历");
        await editor.getByRole("button", { name: "保存事项", exact: true }).click();
        await editor.waitFor({ state: "hidden" });
        expect(state.items).toHaveLength(1);
        expect(state.items[0]?.source?.sourceText).toContain("SQL");
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        expect(await trigger.evaluate((element) => element === document.activeElement)).toBe(true);
        await page.getByRole("link", { name: "我的准备清单", exact: true }).click();
        await page.getByRole("button", { name: "完成一份 SQL 分析报告", exact: true }).waitFor();
        await page.getByRole("button", { name: "完成", exact: true }).click();
        await page
          .getByRole("button", { name: "完成一份 SQL 分析报告", exact: true })
          .waitFor({ state: "hidden" });
        expect(state.items[0]?.status).toBe("done");
        expect(state.errors).toEqual([]);
        expect(state.unhandled).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60000);
    it("carries selected confirmed experience from a requirement into a preparation artifact", async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }),
        state = await fixture(page, true);
      try {
        await page.goto(`${webUrl}/jobs/insights`);
        await page.getByRole("button", { name: "查看SQL原句", exact: true }).click();
        const drawer = page.getByRole("dialog", { name: "SQL的岗位原句" });
        await drawer.getByRole("button", { name: "查看相关经历", exact: true }).click();
        await drawer.getByRole("checkbox", { name: /使用 SQL 分析校园问卷/ }).check();
        await drawer.getByRole("button", { name: "关联经历 / 加入准备" }).first().click();
        const editor = page.getByRole("dialog", { name: "添加事项" });
        await editor
          .getByRole("checkbox", { name: "使用 SQL 分析校园问卷", exact: true })
          .waitFor();
        expect(
          await editor
            .getByRole("checkbox", { name: "使用 SQL 分析校园问卷", exact: true })
            .isChecked(),
        ).toBe(true);
        await editor
          .getByLabel("准备产物", { exact: true })
          .fill("复查 SQL 分组与去重逻辑，整理为面试说明");
        await editor.getByRole("button", { name: "保存事项", exact: true }).click();
        await editor.waitFor({ state: "hidden" });
        expect(state.items[0]).toMatchObject({
          evidenceRevisionId: state.revisionId,
          evidenceIds: [state.evidenceId],
          artifact: "复查 SQL 分组与去重逻辑，整理为面试说明",
        });
        expect(state.errors).toEqual([]);
        expect(state.unhandled).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60000);
    it("reuses material text and downloads one stable calendar item after rescheduling", async () => {
      const page = await browser.newPage({
          viewport: { width: 360, height: 900 },
          acceptDownloads: true,
        }),
        state = await fixture(page, false, true);
      // Chromium downloads can reissue outside Fetch interception; serve this fixture
      // over actual loopback HTTP so the downloaded bytes use the real calendar serializer.
      const server = createServer(async (req, res) => {
        try {
          if (req.url?.startsWith("/v1/planner-calendar.ics")) {
            res.writeHead(200, {
              "Content-Type": "text/calendar; charset=utf-8",
              "Content-Disposition": "attachment; filename=planner.ics",
            });
            res.end(plannerCalendar(state.items));
            return;
          }
          const upstream = await fetch(new URL(req.url ?? "/", webUrl), {
            signal: AbortSignal.timeout(5000),
          });
          res.writeHead(upstream.status, {
            "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
          });
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch {
          res.writeHead(502);
          res.end();
        }
      });
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      const address = server.address();
      if (!address || typeof address === "string") throw Error("FIXTURE_HTTP_MISSING");
      const origin = `http://127.0.0.1:${address.port}`;
      await page.addInitScript(
        "Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__aijobCopied=text;}}});",
      );
      try {
        await page.goto(`${origin}/resumes/snippets`);
        await page.getByRole("button", { name: "新建复用材料", exact: true }).click();
        const editor = page.getByRole("dialog", { name: "编辑复用材料" });
        await editor.getByLabel("材料名称", { exact: true }).fill("数据分析项目短版");
        await editor.getByRole("combobox", { name: /^用途/ }).selectOption("project_short");
        await editor
          .getByLabel("正文", { exact: true })
          .fill("使用 SQL 整理校园问卷并输出分析报告。");
        await editor.getByRole("button", { name: "保存材料", exact: true }).click();
        await editor.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "复制正文", exact: true }).click();
        expect(await page.evaluate("window.__aijobCopied")).toBe(state.snippets[0]?.body);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          ),
        ).toBe(true);
        await page.goto(`${origin}/applications/planner`);
        await page.getByRole("button", { name: "添加事项", exact: true }).click();
        const task = page.getByRole("dialog", { name: "添加事项" });
        await task.getByLabel("事项名称", { exact: true }).fill("准备项目说明");
        await task.getByLabel("时间（北京时间，可留空）", { exact: true }).fill("2026-09-07T10:00");
        await task.getByRole("button", { name: "保存事项", exact: true }).click();
        await task.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "准备项目说明", exact: true }).click();
        const edit = page.getByRole("dialog", { name: "编辑事项" });
        await edit.getByLabel("时间（北京时间，可留空）", { exact: true }).fill("2026-09-08T10:00");
        await edit.getByRole("button", { name: "保存事项", exact: true }).click();
        await edit.waitFor({ state: "hidden" });
        const downloading = page.waitForEvent("download");
        await page.getByRole("link", { name: "导出日历 ICS", exact: true }).click();
        const download = await downloading,
          path = await download.path();
        if (!path) throw Error("CALENDAR_DOWNLOAD_MISSING");
        const calendar = await readFile(path, "utf8");
        expect(calendar).toContain("DUE:20260908T020000Z");
        expect(calendar.match(/UID:planner-/g)).toHaveLength(1);
        expect(calendar).toContain("SEQUENCE:2");
        expect(state.items).toHaveLength(1);
        expect(state.errors).toEqual([]);
        expect(state.unhandled).toEqual([]);
      } finally {
        await page.close();
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
      }
    }, 60000);
    it("keeps graph, comparison and edit actions usable at 320/360 pixels and 200% CSS zoom", async () => {
      const directory = resolve("../../docs/evidence/product-core-upgrade-2026-09-06/screenshots");
      await mkdir(directory, { recursive: true });
      for (const width of [320, 360, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const state = await fixture(page);
        try {
          await page.goto(`${webUrl}/jobs/insights`);
          await page.getByRole("button", { name: "查看SQL原句", exact: true }).waitFor();
          if (width === 1280)
            await page.evaluate(() => {
              document.documentElement.style.zoom = "2";
            });
          await page.getByRole("button", { name: "对照两个方向", exact: true }).click();
          await page.getByRole("button", { name: "查看SQL方向 B原句", exact: true }).waitFor();
          const overflow = await page.evaluate(() => ({
            width: document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth,
          }));
          expect(overflow.scroll).toBeLessThanOrEqual(overflow.width + 1);
          await page.screenshot({
            path: resolve(directory, `graph-${width}${width === 1280 ? "-zoom200" : ""}.png`),
            fullPage: true,
          });
          await page.getByRole("button", { name: "查看SQL方向 A原句", exact: true }).click();
          await page.getByRole("button", { name: "关联经历 / 加入准备" }).first().click();
          const editor = page.getByRole("dialog", { name: "添加事项" });
          await editor.waitFor();
          expect(
            await editor.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
          ).toBe(true);
          await page.keyboard.press("Tab");
          expect(await editor.evaluate((element) => element.contains(document.activeElement))).toBe(
            true,
          );
          await page.screenshot({
            path: resolve(directory, `preparation-${width}${width === 1280 ? "-zoom200" : ""}.png`),
            fullPage: true,
          });
          expect(state.errors).toEqual([]);
          expect(state.unhandled).toEqual([]);
        } finally {
          await page.close();
        }
      }
    }, 90000);
  },
);
