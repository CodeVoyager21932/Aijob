import type { AppConfig } from "@aijob/config";
import { OpenAiCompatibleProvider } from "../ai/provider.js";
import { buildOperationsConsole } from "../sources/operations-console.js";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import {
  loadSourceConfig,
  parseSourceConfigValue,
  type SourceConfig,
} from "../sources/source-config.js";
import { runScheduledSourceRefresh } from "./probe.js";
import {
  safeRequestHtml,
  safeRequestResource,
  safeRequestJson,
  safeRequestText,
  validateUrl,
  NetworkPolicyError,
  type SafeRequestOptions,
  type SafeHttpResult,
} from "./safe-http.js";
import { fetchRobotsTxt } from "./robots-fetch.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import {
  installSourceProposal,
  reconcileSourceInstallation,
  validateSourceProposal,
  suggestSourceExtraction,
} from "../sources/onboarding-service.js";
import { sourceExceptionEvidence } from "../sources/exception-review.js";
import { sourceAutomationMetrics } from "../sources/automation-metrics.js";

// Explicit offline seams: actual orchestration/persistence/browser run, while ALL
// network transports deny anything not in this fixture. Runtime policy has separate tests.
vi.mock("./automation-runtime.js", async (original) => ({
  ...(await original<typeof import("./automation-runtime.js")>()),
  mayExecuteSourceNetwork: () => true,
}));
vi.mock("../sources/source-config.js", async (original) => ({
  ...(await original<typeof import("../sources/source-config.js")>()),
  loadSourceConfig: vi.fn(),
}));
vi.mock("./safe-http.js", async (original) => ({
  ...(await original<typeof import("./safe-http.js")>()),
  safeRequestResource: vi.fn(),
  safeRequestHtml: vi.fn(),
  safeRequestJson: vi.fn(),
  safeRequestText: vi.fn(),
}));
vi.mock("./robots-fetch.js", () => ({ fetchRobotsTxt: vi.fn() }));
const url = process.env.AIJOB_SUPPLY_TEST_DATABASE_URL,
  executablePath = process.env.AIJOB_TEST_BROWSER_EXECUTABLE;
const enabled = url && new URL(url).pathname === "/aijob_supply_pipeline_test";
(enabled ? describe : describe.skip)(
  "configured supply full pipeline using dedicated PostgreSQL and offline pages",
  () => {
    const db = createDatabase(url ?? "postgresql://unused"),
      root = resolve("../../.data", `supply-pipeline-${randomUUID()}`);
    let sequence = 0,
      mode: "healthy" | "pagination_failure" | "empty" | "rate_limited" = "healthy";
    const configs = new Map<string, SourceConfig>();
    const rawConfigs = new Map<string, Record<string, unknown>>();
    beforeAll(async () => {
      await migrateToLatest(db);
      await mkdir(root, { recursive: true });
      vi.stubGlobal("fetch", () => {
        throw new Error("UNEXPECTED_EXTERNAL_FETCH");
      });
      vi.mocked(loadSourceConfig).mockImplementation(async (key) => {
        const config = configs.get(key);
        if (!config) throw new Error("UNKNOWN_FIXTURE_SOURCE");
        return structuredClone(config);
      });
      vi.mocked(fetchRobotsTxt).mockImplementation(async (input) => {
        await input.beforeRequest?.();
        return {
          host: input.host,
          requestUrl: `https://${input.host}/robots.txt`,
          errorCode: "UPSTREAM_HTTP_404",
          outcome: { status: "unavailable", reason: "not_found" },
        };
      });
      async function transport(
        spec: { url: string; method: "GET" | "POST" },
        targets: SourceConfig["policy"]["fetchTargets"],
        options?: SafeRequestOptions,
      ): Promise<SafeHttpResult> {
        validateUrl(spec.url, spec.method, targets);
        await options?.beforeRequest?.();
        const request = new URL(spec.url);
        if (!request.hostname.endsWith(".example.test"))
          throw new Error("EXTERNAL_SOURCE_FORBIDDEN_IN_FIXTURE");
        const dynamic = request.hostname.startsWith("dynamic"),
          page = request.searchParams.get("page");
        if (mode === "rate_limited")
          throw new NetworkPolicyError("UPSTREAM_HTTP_429", "fixture rate limit");
        if (mode === "pagination_failure" && page === "2")
          throw new NetworkPolicyError("UPSTREAM_HTTP_503", "fixture page two failure");
        let html: string;
        if (request.pathname === "/jobs") {
          if (mode === "empty") html = "<main data-end>站点加载错误</main>";
          else if (page === "2")
            html = '<main data-end><div class="job"><a href="/jobs/2">岗位二</a></div></main>';
          else {
            const list =
              '<div class="job"><a href="/jobs/1">岗位一</a></div><a class="next" href="/jobs?page=2">下一页</a>';
            html = dynamic
              ? `<main></main><script>document.querySelector('main').innerHTML=${JSON.stringify(list)}</script>`
              : list;
          }
        } else if (/^\/jobs\/[12]$/.test(request.pathname))
          html = `<h1>产品运营实习生 ${request.pathname.at(-1)}</h1><div class="requirements">本科、硕士或博士在读；熟悉 SQL 优先</div><div class="duties">编写需求文档</div><a class="apply" href="${request.pathname}/apply">投递</a>`;
        else throw new Error("UNREGISTERED_FIXTURE_URL");
        return {
          requestUrl: spec.url,
          finalUrl: spec.url,
          method: spec.method,
          status: 200,
          contentType: "text/html; charset=utf-8",
          responseHeaders: {},
          body: Buffer.from(html),
          requestFingerprint: hashCanonicalJson(spec),
        };
      }
      vi.mocked(safeRequestResource).mockImplementation(transport);
      vi.mocked(safeRequestHtml).mockImplementation(async (...args) => {
        const response = await transport(...args);
        return { ...response, text: Buffer.from(response.body).toString("utf8") };
      });
      vi.mocked(safeRequestJson).mockImplementation(async () => {
        throw new Error("UNEXPECTED_JSON_TRANSPORT");
      });
      vi.mocked(safeRequestText).mockImplementation(async () => {
        throw new Error("UNEXPECTED_TEXT_TRANSPORT");
      });
    }, 60000);
    afterAll(async () => {
      vi.unstubAllGlobals();
      await db.destroy();
    });
    async function fixture(render: boolean) {
      const raw = JSON.parse(
        await readFile(
          new URL("../../../../config/sources/tencent-campus.json", import.meta.url),
          "utf8",
        ),
      );
      const key = `${render ? "dynamic" : "html"}-${randomUUID()}`,
        host = `${key}.example.test`,
        target = {
          method: "GET",
          scheme: "https",
          host,
          port: 443,
          pathPrefix: "/jobs",
          allowedQueryParameters: ["page"],
          allowRedirects: false,
        };
      raw.sourceKey = key;
      raw.organization = { slug: key, name: `夹具企业 ${key}`, officialDomain: host };
      raw.candidate = {
        ...raw.candidate,
        name: key,
        entrypointUrl: `https://${host}/jobs`,
        acquisitionMode: render ? "browser_required" : "deterministic_html",
      };
      raw.policy = {
        ...raw.policy,
        version: "1",
        status: "pending_review",
        adapterKey: render ? "configured-official-browser" : "configured-official-html",
        adapterVersion: "1.0.0",
        entrypoints: [`https://${host}/jobs`],
        crawlInterval: { enabled: true, minimumHours: 12 },
        refreshCoverage: "full_scope",
        absencePolicy: "close_after_two_complete_absences",
        fetchTargets: [target, { ...target, pathPrefix: "/jobs/" }],
        applyTargets: [{ ...target, pathPrefix: "/jobs/" }],
        adapterOptions: {
          configurationVersion: "fixture-1",
          render,
          list: {
            row: ".job",
            detailLink: "a",
            nextLink: ".next",
            terminalMarker: "[data-end]",
            emptyMarker: ".empty",
          },
          detail: {
            title: "h1",
            requirements: ".requirements",
            responsibilities: ".duties",
            applyLink: ".apply",
          },
        },
        accessPolicyEvidence: {
          robots: {
            status: "assessed",
            allowsAllFetchTargets: true,
            crawlDelaySeconds: null,
            hosts: [{ host, status: "missing", bodySha256: null }],
          },
          termsOfService: {
            documentUrl: null,
            excerpt: "离线夹具访问依据",
            prohibitsAggregation: false,
          },
          verifiedAt: "2026-09-06",
          evidenceRef: "offline-fixture",
        },
      };
      raw.candidate.hardGates.accessPolicyAccepted = { status: "pass", note: "离线夹具" };
      raw.localProbe.enabled = true;
      raw.localProbe.requestBudget = {
        maxItems: 10,
        maxPages: 5,
        maxRequests: 30,
        minimumIntervalMs: 250,
      };
      raw.localProbe.requestDefaults = raw.policy.adapterOptions;
      const config = parseSourceConfigValue(raw, key);
      configs.set(key, config);
      rawConfigs.set(key, raw);
      return config;
    }
    async function run(config: SourceConfig) {
      return runScheduledSourceRefresh({
        db,
        sourceKey: config.sourceKey,
        limit: 10,
        dueWindow: new Date(Date.now() + sequence++ * 1000).toISOString(),
        runtime: {
          appEnv: "local",
          enableSourceProbe: true,
          snapshotDir: root,
          probeRequestIntervalMs: 250,
          ...(executablePath ? { browserExecutablePath: executablePath } : {}),
        },
      });
    }
    it("validates changed AI selectors and keeps both configuration readers synchronized before installation", async () => {
      const config = await fixture(false);
      const configuration = rawConfigs.get(config.sourceKey)!;
      const candidate = structuredClone(config.policy.adapterOptions) as {
        configurationVersion: string;
        detail: { requirements: string };
      };
      candidate.configurationVersion = "fixture-ai-2";
      candidate.detail.requirements = ".new-requirements";
      const provider = vi
        .spyOn(OpenAiCompatibleProvider.prototype, "completeStructured")
        .mockResolvedValue(candidate);
      const proposal = {
        configuration,
        expectedPreviousHash: null,
        sample: {
          listHtml: '<main data-end><div class="job"><a href="/jobs/1">岗位</a></div></main>',
          detailHtml:
            '<h1>产品实习生</h1><div class="new-requirements">本科、硕士或博士在读</div><a class="apply" href="/jobs/1/apply">投递</a>',
          detailUrl: `https://${config.organization.officialDomain}/jobs/1`,
        },
      };
      try {
        const appConfig = {
          ai: {
            enabled: true,
            requestTimeoutMs: 1000,
            model: "fixture",
            baseUrl: "https://provider.example.test/v1",
            apiKey: "fixture-only",
          },
          publicAiBudget: {
            dailyCalls: 100,
            dailyTokens: 1000000,
            concurrency: 2,
            maxOutputTokens: 2048,
          },
        } as AppConfig;
        const first = await suggestSourceExtraction({ db, appConfig, proposal });
        expect(first.mode).toBe("ai");
        const checked = validateSourceProposal(first.proposal);
        expect(checked.config.localProbe.requestDefaults).toEqual(
          checked.config.policy.adapterOptions,
        );
        expect(checked.sampleResult).toMatchObject({ requirements: "本科、硕士或博士在读" });
        expect((await suggestSourceExtraction({ db, appConfig, proposal })).mode).toBe("cache");
        expect(provider).toHaveBeenCalledTimes(1);
        const installed = await db
          .selectFrom("source_control.sources")
          .select("id")
          .where("source_key", "=", config.sourceKey)
          .execute();
        expect(installed).toHaveLength(0);
      } finally {
        provider.mockRestore();
      }
    });
    it("automatically materializes HTML, keeps revisions stable and isolates failed/empty/429 rounds", async () => {
      const config = await fixture(false);
      mode = "healthy";
      const first = await run(config);
      expect(first.completion, JSON.stringify(first)).toBe("complete");
      expect(first.normalizedCount).toBe(2);
      const count = async () =>
        (
          await sql<{
            count: number;
          }>`SELECT count(*)::int AS count FROM ingestion.source_job_revisions r JOIN ingestion.source_job_records record ON record.id=r.source_job_record_id JOIN source_control.sources source ON source.id=record.source_id WHERE source.source_key=${config.sourceKey}`.execute(
            db,
          )
        ).rows[0]?.count;
      expect(await count()).toBe(2);
      expect((await run(config)).completion).toBe("complete");
      expect(await count()).toBe(2);
      for (const failure of ["pagination_failure", "empty", "rate_limited"] as const) {
        mode = failure;
        const failed = await run(config);
        expect(failed.completion).not.toBe("complete");
        const closed = await sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM ingestion.source_job_activity_states a JOIN ingestion.source_job_records r ON r.id=a.source_job_record_id JOIN source_control.sources s ON s.id=r.source_id WHERE s.source_key=${config.sourceKey} AND (a.absence_state='closed' OR a.direct_state='closed')`.execute(
          db,
        );
        expect(closed.rows[0]?.count).toBe(0);
        const review = await sourceExceptionEvidence(db, failed.runId, 0);
        expect(review?.run.id).toBe(failed.runId);
        const runtime = await db
          .selectFrom("source_control.source_runtime_states as r")
          .innerJoin("source_control.sources as s", "s.id", "r.source_id")
          .select("r.automation_paused")
          .where("s.source_key", "=", config.sourceKey)
          .executeTakeFirstOrThrow();
        if (runtime.automation_paused) {
          const app = buildOperationsConsole({
            db,
            config: { appEnv: "local", workspaceRoot: root } as AppConfig,
            port: 5193,
          });
          try {
            const html = await app.inject({ url: "/", headers: { host: "127.0.0.1:5193" } }),
              token = html.body.match(/const token="([a-f0-9]+)"/)?.[1];
            expect(token).toBeTruthy();
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: "/api/actions",
                  headers: { host: "127.0.0.1:5193" },
                  payload: {},
                })
              ).statusCode,
            ).toBe(403);
            expect(
              (await app.inject({ url: "/api/exceptions", headers: { host: "evil.example" } }))
                .statusCode,
            ).toBe(403);
            const resumed = await app.inject({
              method: "POST",
              url: "/api/actions",
              headers: {
                host: "127.0.0.1:5193",
                origin: "http://127.0.0.1:5193",
                "x-aijob-ops": token as string,
              },
              payload: {
                action: "resume",
                sourceKeys: [config.sourceKey],
                reviewedVersions: { [config.sourceKey]: config.policy.version },
              },
            });
            expect(resumed.json().results[0]).toMatchObject({ success: true });
          } finally {
            await app.close();
          }
        }
      }
      mode = "healthy";
      const unrelated = await fixture(false);
      expect((await run(unrelated)).completion).toBe("complete");
      expect((await run(config)).completion).toBe("complete");
      expect(await count()).toBe(2);
    }, 60000);
    it("counts failed scheduled work and operator intervention in the same reporting window", async () => {
      const metrics = await sourceAutomationMetrics(db);
      const expected = (
        await sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM task_queue.tasks WHERE task_type='crawl' AND run_mode='scheduled' AND created_at>=now()-interval '30 days'`.execute(
          db,
        )
      ).rows[0]?.count;
      expect(metrics.planned).toBe(expected);
      expect(metrics.planned).toBeGreaterThan(metrics.acceptedComplete);
      expect(metrics.manualIntervention.touchedSources).toBeGreaterThan(0);
      expect(metrics.planned).toBe(
        metrics.acceptedComplete + metrics.failed + metrics.pending + metrics.otherUnaccepted,
      );
      expect(metrics.automaticSuccessRate).toBeLessThan(1);
      expect(metrics.recovery).not.toEqual([]);
    });
    it("reconciles an interrupted installation only while the reviewed file is still installed", async () => {
      const config = await fixture(false),
        configuration = rawConfigs.get(config.sourceKey)!;
      await mkdir(resolve(root, "config/sources"), { recursive: true });
      const proposal = {
        configuration,
        expectedPreviousHash: null,
        sample: {
          listHtml: '<main data-end><div class="job"><a href="/jobs/1">岗位</a></div></main>',
          detailHtml:
            '<h1>产品实习生</h1><div class="requirements">本科或硕士在读</div><div class="duties">编写需求文档</div><a class="apply" href="/jobs/1/apply">投递</a>',
          detailUrl: config.policy.entrypoints[0] + "/1",
        },
      };
      const checked = validateSourceProposal(proposal);
      const result = await installSourceProposal({
        db,
        workspaceRoot: root,
        proposal,
        reviewedHash: checked.proposalHash,
      });
      await sql`UPDATE source_control.operator_actions SET status='failed' WHERE id=${result.actionId}::uuid`.execute(
        db,
      );
      expect(
        await reconcileSourceInstallation({ db, workspaceRoot: root, actionId: result.actionId }),
      ).toMatchObject(result);
      expect(
        await reconcileSourceInstallation({ db, workspaceRoot: root, actionId: result.actionId }),
      ).toMatchObject(result);
      await writeFile(
        resolve(root, "config/sources", config.sourceKey + ".json"),
        JSON.stringify({ ...configuration, operatorNote: "newer reviewed change" }),
        "utf8",
      );
      await expect(
        reconcileSourceInstallation({ db, workspaceRoot: root, actionId: result.actionId }),
      ).rejects.toThrow("CONFIGURATION_INSTALLED_VERSION_CHANGED");
    }, 60000);
    (executablePath ? it : it.skip)(
      "runs the browser adapter through persistence and normal automatic acceptance",
      async () => {
        mode = "healthy";
        const config = await fixture(true),
          result = await run(config);
        expect(result.completion, JSON.stringify(result)).toBe("complete");
        expect(result.normalizedCount).toBe(2);
        const second = await run(config);
        expect(second.normalizedCount).toBe(2);
      },
      60000,
    );
  },
);
