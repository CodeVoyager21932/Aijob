import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cpus, totalmem, platform, release } from "node:os";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { assertIsolatedTestDatabaseUrl, createDatabase, migrateToLatest } from "@aijob/database";
import { JobSearchQuerySchema, type ResumePrintInput } from "@aijob/contracts";
import { sql } from "kysely";
import { buildApp } from "../app.js";
import { createAnonymousSession } from "../identity/session-repository.js";
import { loadLegacyCatalogRecords } from "../catalog/repository.js";
import { searchCatalogRecords } from "../catalog/filtering.js";
import { materializeLocalCatalog } from "../catalog/materialize.js";
import { renderResumePdf } from "../resume-documents/pdf-service.js";
import { parseResumeBuffer } from "../resume/parse.js";
import { seedBenchmarkCatalog } from "./fixtures.js";

const url = process.env.AIJOB_BENCH_DATABASE_URL;
if (!url)
  throw new Error(
    "Set AIJOB_BENCH_DATABASE_URL explicitly; application DATABASE_URL is never used.",
  );
assertIsolatedTestDatabaseUrl(url);
if (!decodeURIComponent(new URL(url).pathname).includes("benchmark_test"))
  throw new Error("Dedicated benchmark_test database required");
const count = Number(process.env.AIJOB_BENCH_JOBS ?? 10000),
  concurrency = Number(process.env.AIJOB_BENCH_CONCURRENCY ?? 50);
if (![10000, 100000].includes(count) || ![50, 100].includes(concurrency))
  throw new Error("Use 10000/100000 jobs and 50/100 concurrency.");
const db = createDatabase(url),
  workerDb = createDatabase(url);
const output = resolve(
  process.env.AIJOB_BENCH_OUTPUT ??
    `../../docs/evidence/product-core-upgrade-2026-09-06/performance-${count}-${concurrency}.json`,
);
type Sample = { operation: string; ms: number; status: number; error?: string };
const timings: Sample[] = [];
const phases: unknown[] = [];
const summary = (samples: Sample[]) =>
  Object.fromEntries(
    [...new Set(samples.map((s) => s.operation))].map((operation) => {
      const values = samples.filter((s) => s.operation === operation),
        sorted = values.map((s) => s.ms).sort((a, b) => a - b);
      return [
        operation,
        {
          requests: values.length,
          errors: values.filter((s) => s.status >= 400).length,
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
          max: sorted.at(-1),
        },
      ];
    }),
  );
let app: ReturnType<typeof buildApp> | undefined;
try {
  await migrateToLatest(db);
  console.info(`Seeding ${count} synthetic jobs`);
  const fixture = await seedBenchmarkCatalog(
    db,
    count,
    process.env.AIJOB_BENCH_REUSE_FIXTURE === "1",
  );
  const config = {
    appEnv: "test" as const,
    databaseUrl: url,
    snapshotDirectory: ".data/benchmark-snapshots",
    host: "127.0.0.1",
    port: 0,
    probeRequestIntervalMs: 750,
    ownerTaskInteractiveConcurrency: 8,
    logLevel: "silent" as const,
    enableInternalPreview: false,
    enableSourceProbe: false,
    enableLocalMvp: false,
    resumeEncryptionKey: "0".repeat(64),
    resumeMaxBytes: 5 * 1024 * 1024,
    ai: { enabled: false, requestTimeoutMs: 30000 },
    identity: { acceptedOrigins: [], alphaInviteCodeHashes: [] },
    workspaceRoot: resolve("../.."),
  };
  app = buildApp({ config, db });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const sessions = [];
  for (let i = 0; i < concurrency; i++) sessions.push(await createAnonymousSession({ db }));
  const query = JobSearchQuerySchema.parse({ limit: 20 });
  const baseline: number[] = [];
  const baselineErrors: Array<{ ms: number; error: string }> = [];
  console.info("Measuring legacy full-catalog baseline");
  for (let i = 0; i < (count === 100000 ? 0 : 3); i++) {
    const start = performance.now();
    try {
      const rows = await loadLegacyCatalogRecords(db, false);
      const result = searchCatalogRecords(rows, query);
      if (result.totalKnown + result.totalUnknown !== count)
        throw new Error(`BENCHMARK_VISIBLE_COUNT:${result.totalKnown + result.totalUnknown}`);
      baseline.push(performance.now() - start);
    } catch (error) {
      baselineErrors.push({
        ms: performance.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }
  const paths = [
    "/v1/jobs?limit=20",
    "/v1/jobs?limit=20&jobFamilies=engineering",
    "/v1/jobs?limit=20&cities=%E4%B8%8A%E6%B5%B7",
    "/v1/jobs?limit=20&keyword=SQL",
    "/v1/job-graph",
    "/v1/job-graph?scope=" + encodeURIComponent(JSON.stringify({ jobFamily: "product" })),
  ];
  const cold = [];
  for (const path of paths) {
    const start = performance.now(),
      response = await fetch(address + path);
    await response.arrayBuffer();
    cold.push({ path, ms: performance.now() - start, status: response.status });
  }
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify({ state: "running", fixture, baseline, cold }, null, 2));
  console.info(JSON.stringify({ baseline, cold }));
  const sectionId = randomUUID();
  const snapshot: ResumePrintInput = {
    title: "基准测试中文简历",
    content: {
      schemaVersion: "resume-content-v1",
      sections: [
        {
          id: sectionId,
          ordinal: 0,
          title: "项目经历",
          blocks: Array.from({ length: 12 }, (_, i) => ({
            id: randomUUID(),
            ordinal: i,
            text: "使用 SQL 分析校园数据，编写需求文档并整理实验报告。",
            evidenceIds: [],
          })),
        },
      ],
    },
    templateKey: "cn_classic_single_column",
    sectionOrder: [sectionId],
    settings: {
      schemaVersion: "resume-layout-settings-v1",
      fontSizeToken: "standard",
      lineSpacingToken: "standard",
      sectionSpacingToken: "standard",
      colorToken: "charcoal",
      pageBreakPolicy: "keep_sections",
    },
  };
  const browser = process.env.AIJOB_TEST_BROWSER_EXECUTABLE,
    font = process.env.AIJOB_TEST_PDF_FONT;
  for (const phase of ["hot", "mixed"]) {
    for (const path of paths) {
      const r = await fetch(address + path);
      await r.arrayBuffer();
    }
    console.info(`Running ${phase}: ${concurrency} users × 10 sequential requests`);
    const start = performance.now(),
      cpu = process.cpuUsage(),
      lag = monitorEventLoopDelay({ resolution: 20 });
    lag.enable();
    let peakRss = process.memoryUsage().rss;
    const sampler = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 100);
    const samples: Sample[] = [];
    const background =
      phase === "mixed"
        ? (async () => {
            const jobs: Array<[string, () => Promise<unknown>]> = [
              [
                "collector_materialize",
                () => materializeLocalCatalog(workerDb, { sourceId: fixture.base.sourceId }),
              ],
              [
                "resume_parse",
                async () => {
                  if (browser && font) {
                    const pdf = await renderResumePdf({
                      db: workerDb,
                      snapshot,
                      runtime: {
                        executablePath: browser,
                        fontPath: font,
                        concurrency: 2,
                        timeoutMs: 30000,
                      },
                    });
                    return parseResumeBuffer({ kind: "pdf", buffer: pdf });
                  }
                  return { skipped: "PDF runtime absent" };
                },
              ],
            ];
            await Promise.all(
              jobs.map(async ([operation, run]) => {
                const at = performance.now();
                try {
                  await run();
                  samples.push({ operation, ms: performance.now() - at, status: 200 });
                } catch (error) {
                  samples.push({
                    operation,
                    ms: performance.now() - at,
                    status: 500,
                    error: error instanceof Error ? error.message : String(error),
                  });
                }
              }),
            );
          })()
        : Promise.resolve();
    await Promise.all(
      sessions.map(async (session, user) => {
        for (let n = 0; n < 10; n++) {
          if (count === 100000 && n > 0 && performance.now() - start > 90000) break;
          const write = phase === "mixed" && n % 5 === 4,
            path = write ? "/v1/application-cases" : paths[(user + n) % paths.length]!;
          const operation = write
              ? "case_write"
              : path.startsWith("/v1/job-graph")
                ? "graph"
                : "catalog",
            at = performance.now();
          try {
            const headers: Record<string, string> = {
              cookie: `aijob_session=${session.sessionToken}; aijob_csrf=${session.csrfToken}`,
            };
            if (write)
              Object.assign(headers, {
                origin: address,
                "x-csrf-token": session.csrfToken,
                "content-type": "application/json",
                "idempotency-key": randomUUID(),
              });
            const response = await fetch(address + path, {
              signal: AbortSignal.timeout(60000),
              headers,
              ...(write
                ? {
                    method: "POST",
                    body: JSON.stringify({
                      jobContext: {
                        kind: "private_input",
                        title: `准备申请 ${user}-${n}`,
                        companyName: "基准测试企业",
                        contentText: "岗位职责：使用 SQL 编写数据报告。岗位要求：本科或硕士在读。",
                        source: { kind: "unspecified" },
                      },
                    }),
                  }
                : {}),
            });
            const body = await response.text();
            samples.push({
              operation,
              ms: performance.now() - at,
              status: response.status,
              ...(!response.ok ? { error: body.slice(0, 400) } : {}),
            });
          } catch (error) {
            samples.push({
              operation,
              ms: performance.now() - at,
              status: 599,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }),
    );
    await background;
    clearInterval(sampler);
    lag.disable();
    const cpuTime = process.cpuUsage(cpu);
    phases.push({
      phase,
      plannedHttpRequests: concurrency * 10,
      completedHttpRequests: samples.filter((s) =>
        ["catalog", "graph", "case_write"].includes(s.operation),
      ).length,
      capacityProbeDeadlineMs: count === 100000 ? 90000 : null,
      wallMs: performance.now() - start,
      summary: summary(samples),
      peakRssBytes: peakRss,
      cpuMs: (cpuTime.user + cpuTime.system) / 1000,
      eventLoopP95Ms: lag.percentile(95) / 1e6,
      samples,
    });
    timings.push(...samples);
  }
  const database = (
    await sql<{
      bytes: string;
      version: string;
    }>`SELECT pg_database_size(current_database())::text AS bytes,version() AS version`.execute(db)
  ).rows[0];
  const queue = (
    await sql`SELECT status,count(*)::int AS count,max(EXTRACT(EPOCH FROM (now()-available_at))) FILTER(WHERE status='queued') AS oldest_wait_seconds FROM task_queue.tasks GROUP BY status`.execute(
      db,
    )
  ).rows;
  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      os: platform(),
      release: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      node: process.version,
      dbPoolPerBoundary: 10,
      database,
    },
    fixture,
    concurrency,
    baseline: {
      operation: "legacy_service_full_catalog",
      samplesMs: baseline,
      errors: baselineErrors,
      skippedReason:
        count === 100000
          ? "Legacy baseline measured at 10000; a separate 100000 legacy attempt was interrupted during full-catalog processing. This probe measures current HTTP capacity."
          : null,
    },
    coldHttp: cold,
    phases,
    queueSnapshot: queue,
    limitations: [
      "Loopback HTTP with real routing, owner sessions and CSRF; not an external WAN or proxy test.",
      "Synthetic current versions and short JD text; historical-depth and real-source latency need separate deployment measurements.",
      "Background uses the real materializer, PDF renderer and PDF parser; no real network crawling or paid model call.",
      "Task queue snapshot is reported, not presented as a measured sustained worker backlog.",
    ],
    summary: summary(timings),
  };
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ output, summary: report.summary, cold }));
} catch (error) {
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        state: "failed",
        generatedAt: new Date().toISOString(),
        count,
        concurrency,
        phases,
        summary: summary(timings),
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close();
  await db.destroy();
  await workerDb.destroy();
}
