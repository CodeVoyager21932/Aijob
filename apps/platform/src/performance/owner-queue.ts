import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { loadAppConfig } from "@aijob/config";
import { CreateAssistantSessionSchema, SubmitAssistantTurnSchema } from "@aijob/contracts";
import { assertIsolatedTestDatabaseUrl, createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { createAnonymousSession } from "../identity/session-repository.js";
import { createAssistantSession, submitAssistantTurn } from "../ai/assistant-service.js";
import { saveUserAiSettings } from "../ai/user-ai-service.js";
import { requestOwnerDeletion } from "../profile/deletion-service.js";
import { createStudioImport } from "../resume-documents/studio-import.js";
import { runOwnerTaskWorker } from "../workers/owner-task-worker.js";

const url = process.env.AIJOB_BENCH_DATABASE_URL;
if (!url) throw new Error("Explicit synthetic benchmark database required");
assertIsolatedTestDatabaseUrl(url);
if (!new URL(url).pathname.includes("queue_benchmark_test"))
  throw new Error("Dedicated queue_benchmark_test required");
const profile = process.env.AIJOB_QUEUE_PROFILE ?? "short";
const profiles = {
  short: { turns: 60, intervalMs: 400, modelMs: 250, slowModelMs: 2000, drainMs: 60000 },
  endurance: { turns: 600, intervalMs: 1000, modelMs: 800, slowModelMs: 4000, drainMs: 60000 },
  saturation: { turns: 120, intervalMs: 100, modelMs: 1000, slowModelMs: 3000, drainMs: 120000 },
} as const;
if (!(profile in profiles)) throw new Error("Unknown synthetic queue profile");
const scenario = profiles[profile as keyof typeof profiles];
const idlePollMs = Number(process.env.AIJOB_BENCH_WORKER_IDLE_MS ?? 50);
if (!Number.isInteger(idlePollMs) || idlePollMs < 20 || idlePollMs > 1000)
  throw new Error("Benchmark idle poll must be between 20 and 1000ms");
const root = resolve("../..");
const output = resolve(
  process.env.AIJOB_BENCH_OUTPUT ??
    `../../docs/evidence/query-endurance-2026-09-08/queue-${profile}.json`,
);
const db = createDatabase(url),
  workerDb = createDatabase(url);
const config = loadAppConfig({
  rootDirectory: root,
  overrideEnvironment: {
    APP_ENV: "test",
    DATABASE_URL: url,
    RESUME_ENCRYPTION_KEY: "a".repeat(64),
    ENABLE_AI: "false",
    RESUME_PARSER_MODE: "process",
  },
});
const controller = new AbortController();
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const records = new Map<
  number,
  { queuedAt: number; turnId: string; startedAt?: number; modelEndedAt?: number }
>();
const queue: unknown[] = [];
const interruptions: Array<{ phase: string; gapMs: number }> = [];
const completedObservedAt = new Map<string, number>();
let worker: Promise<void> | undefined;
let sampling = false;
let sampler: Promise<void> | undefined;
let cancelStarted = 0,
  cancelAborted = 0,
  deletionRequested = 0;
let peakRss = 0;
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? null,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
    max: sorted.at(-1) ?? null,
  };
};
const fetchFixture: typeof fetch = async (_url, init) => {
  const body = String(init?.body);
  const cancel = body.includes("queue-cancel-probe");
  const index = Number(/queue-probe-(\d+)-end/.exec(body)?.[1]);
  if (!cancel && !records.has(index)) throw new Error("UNEXPECTED_FIXTURE_REQUEST");
  const record = records.get(index);
  if (record) record.startedAt = performance.now();
  if (cancel) cancelStarted = performance.now();
  await new Promise<void>((done, reject) => {
    const abort = () => {
      clearTimeout(timer);
      if (cancel) cancelAborted = performance.now();
      reject(new Error("FIXTURE_ABORTED"));
    };
    const timer = setTimeout(
      () => {
        init?.signal?.removeEventListener("abort", abort);
        done();
      },
      cancel ? 15000 : index % 10 === 0 ? scenario.slowModelMs : scenario.modelMs,
    );
    if (init?.signal?.aborted) abort();
    else init?.signal?.addEventListener("abort", abort, { once: true });
  });
  if (record) record.modelEndedAt = performance.now();
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              schemaVersion: "career-assistant-result-v1",
              kind: "question",
              reply: "请结合刚才的整理过程继续说明。",
              question: "哪些整理工作由你亲自完成？",
              artifact: null,
              changes: [],
              preparation: [],
              known: [],
              openQuestions: [],
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};
try {
  await migrateToLatest(db);
  const existing = await db.selectFrom("identity.owners").select("id").limit(1).execute();
  if (existing.length) throw new Error("Use a new empty queue benchmark database");
  const owners: Array<Awaited<ReturnType<typeof createAnonymousSession>>["context"]> = [];
  for (let i = 0; i < 21; i++) {
    const owner = (await createAnonymousSession({ db })).context;
    await saveUserAiSettings(db, owner, config, {
      expectedRevision: 0,
      baseUrl: "https://fixture.example/v1",
      model: "queue-fixture",
      apiKey: "synthetic-only",
      dailyCalls: 1000,
      dailyTokens: 10000000,
    });
    owners.push(owner);
  }
  const enqueue = async (index: number, cancel = false) => {
    const owner = owners[cancel ? 20 : index % 20]!;
    const session = await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({
        task: "experience",
        context: { initialText: "课程项目：整理公开问卷与访谈记录。" },
      }),
      randomUUID(),
      true,
    );
    const queuedAt = performance.now();
    // Register before submission: a running worker may claim immediately after commit.
    if (!cancel) records.set(index, { queuedAt, turnId: "" });
    const result = await submitAssistantTurn(
      db,
      owner,
      session.id,
      SubmitAssistantTurnSchema.parse({
        expectedRevision: session.revision,
        message: cancel ? "queue-cancel-probe" : `queue-probe-${index}-end 我亲自整理了访谈记录。`,
      }),
      randomUUID(),
      config,
    );
    if (!cancel) records.get(index)!.turnId = result.turns.at(-1)!.id;
  };
  await enqueue(-1, true);
  worker = runOwnerTaskWorker({
    db: workerDb,
    config,
    signal: controller.signal,
    idleDelayMs: idlePollMs,
    fetchImpl: fetchFixture,
  });
  let deadline = performance.now() + 15000;
  while (!cancelStarted && performance.now() < deadline) await sleep(20);
  if (!cancelStarted) throw new Error("Cancellation fixture never started");
  deletionRequested = performance.now();
  await requestOwnerDeletion({ db, owner: owners[20]! });
  const fixture = await readFile(
    resolve(
      root,
      "docs/evidence/experience-upgrade-2026-09-07/export/cn_classic_single_column.pdf",
    ),
  );
  for (let i = 0; i < 8; i++)
    await createStudioImport(
      db,
      owners[i]!,
      {
        filename: "synthetic-queue.pdf",
        mediaType: "application/pdf",
        buffer: fixture,
        encryptionKey: config.resumeEncryptionKey,
      },
      randomUUID(),
    );
  sampling = true;
  sampler = (async () => {
    let previousSampleAt = performance.now();
    while (sampling) {
      const sampleAt = performance.now();
      if (sampleAt - previousSampleAt > 5250)
        interruptions.push({ phase: "sampling", gapMs: sampleAt - previousSampleAt });
      previousSampleAt = sampleAt;
      const rows = (
        await sql`SELECT task_type,status,count(*)::int AS count,
      max(EXTRACT(EPOCH FROM (now()-available_at))*1000) FILTER(WHERE status='queued') AS oldest_wait_ms
      FROM task_queue.tasks GROUP BY task_type,status`.execute(db)
      ).rows;
      queue.push({ at: new Date().toISOString(), rows });
      const finished = (
        await sql<{ id: string }>`SELECT id FROM profile.assistant_turns
        WHERE status IN ('completed','failed')`.execute(db)
      ).rows;
      for (const turn of finished) {
        if (!completedObservedAt.has(turn.id)) completedObservedAt.set(turn.id, performance.now());
      }
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      await sleep(250);
    }
  })();
  const producerStart = performance.now();
  let previousArrivalAt = producerStart;
  for (let i = 0; i < scenario.turns; i++) {
    const arrivalAt = performance.now();
    if (i > 0 && arrivalAt - previousArrivalAt > scenario.intervalMs + 5000) {
      interruptions.push({ phase: "producer", gapMs: arrivalAt - previousArrivalAt });
      break; // Report unissued requests; never turn a host/DB pause into a catch-up burst.
    }
    previousArrivalAt = arrivalAt;
    await enqueue(i);
    await sleep(Math.max(0, producerStart + (i + 1) * scenario.intervalMs - performance.now()));
  }
  console.info("Finished continuous arrivals; waiting for remaining tasks");
  deadline = performance.now() + scenario.drainMs;
  let remaining = 0;
  do {
    remaining = Number(
      (
        await sql<{
          count: string;
        }>`SELECT count(*)::text AS count FROM task_queue.tasks WHERE status IN ('queued','running')`.execute(
          db,
        )
      ).rows[0]!.count,
    );
    if (remaining) await sleep(100);
  } while (remaining && performance.now() < deadline);
  sampling = false;
  await sampler;
  const turns = (
    await sql<{
      id: string;
      status: string;
      failure_code: string | null;
      completed_at: Date | null;
    }>`SELECT id,status,failure_code,completed_at FROM profile.assistant_turns`.execute(db)
  ).rows;
  const byId = new Map(turns.map((t) => [t.id, t]));
  // A final completion may occur after the periodic sampler's last read.
  for (const turn of turns) {
    if (["completed", "failed"].includes(turn.status) && !completedObservedAt.has(turn.id))
      completedObservedAt.set(turn.id, performance.now());
  }
  const samples = [...records].map(([index, r]) => ({
    index,
    ...r,
    status: byId.get(r.turnId)?.status ?? "missing",
    failureCode: byId.get(r.turnId)?.failure_code ?? null,
    completedAt: completedObservedAt.get(r.turnId) ?? null,
    databaseCompletedAt: byId.get(r.turnId)?.completed_at?.toISOString() ?? null,
  }));
  const originals = (
    await sql<{
      status: string;
      failure_code: string | null;
    }>`SELECT status,failure_code FROM profile.resume_originals`.execute(db)
  ).rows;
  const deletedOwner = await db
    .selectFrom("identity.owners")
    .select("status")
    .where("id", "=", owners[20]!.ownerId)
    .executeTakeFirst();
  const deletedTurns = (
    await sql<{
      id: string;
    }>`SELECT id FROM profile.assistant_turns WHERE owner_id=${owners[20]!.ownerId}`.execute(db)
  ).rows;
  const report = {
    generatedAt: new Date().toISOString(),
    interruptions,
    continuousEnvironment: interruptions.length === 0,
    submittedTurns: records.size,
    unissuedTurns: scenario.turns - records.size,
    environment: {
      elapsedClock: "Node performance.now throughout; database timestamps are diagnostics only",
      cpu: cpus()[0]?.model,
      memoryBytes: totalmem(),
      node: process.version,
      interactiveLanes: config.ownerTaskInteractiveConcurrency,
      parserLanes: 1,
      backgroundLanes: 1,
      idlePollMs,
      recoveryIntervalMs: 1000,
    },
    fixture: {
      owners: 20,
      profile,
      plannedTurns: scenario.turns,
      arrivalIntervalMs: scenario.intervalMs,
      modelDelayMs: scenario.modelMs,
      slowEveryTenthModelDelayMs: scenario.slowModelMs,
      realModelCalls: 0,
      pdfImports: 8,
    },
    durationMs: performance.now() - producerStart,
    remainingTasks: remaining,
    completed: samples.filter((s) => s.status === "completed").length,
    failed: samples.filter((s) => s.status === "failed").length,
    waitingForModelMs: summary(
      samples.filter((s) => s.startedAt !== undefined).map((s) => s.startedAt! - s.queuedAt),
    ),
    endToEndMs: summary(
      samples.filter((s) => s.completedAt !== null).map((s) => s.completedAt! - s.queuedAt),
    ),
    peakRssBytes: peakRss,
    cancellation: {
      requestedAt: deletionRequested,
      modelStartedAt: cancelStarted,
      modelAbortedAt: cancelAborted,
      abortDelayMs: cancelAborted ? cancelAborted - deletionRequested : null,
      ownerStatus: deletedOwner?.status ?? "missing",
      remainingTurns: deletedTurns.length,
    },
    originals,
    samples,
    queue,
    limitations: [
      `${(scenario.turns * scenario.intervalMs) / 1000}-second continuous synthetic arrivals; not hours of production load.`,
      "Real scheduler, PostgreSQL, BYOK protocol, parsing, deletion and cancellation; fixture model latency and outputs only.",
      "No real provider availability, cost or output-quality claim; CPU/RSS only this process.",
      "End-to-end completion is observed by 250ms polling on the same monotonic clock; includes observation delay.",
    ],
  };
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ ...report, samples: undefined, queue: undefined }));
  if (
    interruptions.length > 0 ||
    report.completed !== scenario.turns ||
    report.failed ||
    remaining ||
    !cancelAborted ||
    deletedTurns.length ||
    originals.some((r) => r.status !== "ready" && r.status !== "succeeded") ||
    samples.some((s) => s.completedAt === null)
  )
    throw new Error(
      interruptions.length ? "QUEUE_ENVIRONMENT_INTERRUPTED" : "QUEUE_ACCEPTANCE_INCOMPLETE",
    );
} finally {
  sampling = false;
  controller.abort();
  await sampler;
  await worker;
  await workerDb.destroy();
  await db.destroy();
}
