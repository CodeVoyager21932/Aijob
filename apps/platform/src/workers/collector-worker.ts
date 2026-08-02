import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { shanghaiDateKey } from "../catalog/effective-activity.js";
import { materializeLocalCatalog } from "../catalog/materialize.js";
import type { ProbeResult, ProbeRuntimeConfig } from "../ingestion/probe.js";
import { runScheduledSourceRefresh } from "../ingestion/probe.js";
import {
  openCircuitForTransportFailures,
  refreshFreshnessAndSnapshotReminders,
  selectDueSourceRefreshes,
} from "../ingestion/refresh-scheduler.js";
import { readLocalRefreshControl } from "../sources/local-refresh-control.js";
import { loadSourceConfig } from "../sources/source-config.js";

const DEFAULT_SCAN_INTERVAL_MS = 60_000;
export const COLLECTOR_ADVISORY_LOCK_KEY = 2_600_026;

export interface CollectorWorkerConfig extends ProbeRuntimeConfig {
  workspaceRoot: string;
}

export interface CollectorCycleResult {
  state:
    | "disabled"
    | "environment_blocked"
    | "collector_busy"
    | "circuit_open_or_not_due"
    | "source_deferred"
    | "source_paused"
    | "ran";
  sourceKey?: string;
  errorCode?: string;
  result?: ProbeResult;
  manualSnapshotSourceKeys?: string[];
}

export interface CollectorWorkerDependencies {
  now?: () => Date;
  materializeCatalog?: (db: Kysely<Database>) => Promise<unknown>;
  runCycle?: (input: {
    db: Kysely<Database>;
    config: CollectorWorkerConfig;
    now: Date;
  }) => Promise<CollectorCycleResult>;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function withCollectorExecutionLock<T>(
  db: Kysely<Database>,
  operation: (connection: Kysely<Database>) => Promise<T>,
): Promise<T | undefined> {
  return db.connection().execute(async (connection) => {
    const acquired = await sql<{ acquired: boolean }>`
      SELECT pg_try_advisory_lock(${COLLECTOR_ADVISORY_LOCK_KEY}) AS acquired
    `.execute(connection);
    if (!acquired.rows[0]?.acquired) return undefined;

    try {
      return await operation(connection);
    } finally {
      await sql`SELECT pg_advisory_unlock(${COLLECTOR_ADVISORY_LOCK_KEY})`.execute(connection);
    }
  });
}

export async function waitForCollectorIdle(db: Kysely<Database>): Promise<void> {
  await db.connection().execute(async (connection) => {
    await sql`SELECT pg_advisory_lock(${COLLECTOR_ADVISORY_LOCK_KEY})`.execute(connection);
    try {
      return;
    } finally {
      await sql`SELECT pg_advisory_unlock(${COLLECTOR_ADVISORY_LOCK_KEY})`.execute(connection);
    }
  });
}

async function pauseStaleSourceRuntime(input: {
  db: Kysely<Database>;
  sourceId: string;
  policyVersion: number;
  errorCode: string;
  now: Date;
}): Promise<void> {
  await input.db
    .updateTable("source_control.source_runtime_states")
    .set({
      freshness_state: "stale",
      automation_paused: true,
      automation_pause_reason: input.errorCode,
      consecutive_failures: sql`consecutive_failures + 1`,
      last_error_code: input.errorCode,
      next_due_at: null,
      updated_at: input.now,
    })
    .where("source_id", "=", input.sourceId)
    .where("policy_version", "=", input.policyVersion)
    .execute();
}

async function deferDeadSourceRuntime(input: {
  db: Kysely<Database>;
  sourceId: string;
  policyVersion: number;
  minimumHours: number;
  errorCode: string;
  now: Date;
}): Promise<void> {
  await input.db
    .updateTable("source_control.source_runtime_states")
    .set({
      freshness_state: "stale",
      automation_paused: false,
      automation_pause_reason: null,
      consecutive_failures: sql`consecutive_failures + 1`,
      last_error_code: input.errorCode,
      next_due_at: new Date(input.now.getTime() + input.minimumHours * 60 * 60 * 1_000),
      updated_at: input.now,
    })
    .where("source_id", "=", input.sourceId)
    .where("policy_version", "=", input.policyVersion)
    .execute();
}

export async function runOneCollectorCycle(input: {
  db: Kysely<Database>;
  config: CollectorWorkerConfig;
  now?: Date;
  executeRefresh?: typeof runScheduledSourceRefresh;
  readRefreshControl?: typeof readLocalRefreshControl;
}): Promise<CollectorCycleResult> {
  if (input.config.appEnv !== "local") return { state: "environment_blocked" };

  const now = input.now ?? new Date();
  const readRefreshControl = input.readRefreshControl ?? readLocalRefreshControl;
  const manualSnapshotSourceKeys = await refreshFreshnessAndSnapshotReminders(input.db, now);
  if (!readRefreshControl(input.config.workspaceRoot).enabled) {
    return { state: "disabled", manualSnapshotSourceKeys };
  }
  const cycle = await withCollectorExecutionLock(input.db, async (connection) => {
    if (!readRefreshControl(input.config.workspaceRoot).enabled) {
      return { state: "disabled" as const };
    }
    const due = (await selectDueSourceRefreshes(connection, now, 3))[0];
    if (!due) return { state: "circuit_open_or_not_due" as const };

    let sourceConfig: Awaited<ReturnType<typeof loadSourceConfig>>;
    try {
      sourceConfig = await loadSourceConfig(due.sourceKey);
    } catch {
      const errorCode = "SOURCE_CONFIG_LOAD_FAILED";
      await pauseStaleSourceRuntime({
        db: connection,
        sourceId: due.sourceId,
        policyVersion: due.policyVersion,
        errorCode,
        now,
      });
      return { state: "source_paused" as const, sourceKey: due.sourceKey, errorCode };
    }
    if (
      sourceConfig.policy.version !== due.policyVersion ||
      sourceConfig.policy.adapterVersion !== due.adapterVersion ||
      !sourceConfig.policy.crawlInterval.enabled
    ) {
      const errorCode = "SCHEDULED_TASK_POLICY_STALE";
      await pauseStaleSourceRuntime({
        db: connection,
        sourceId: due.sourceId,
        policyVersion: due.policyVersion,
        errorCode,
        now,
      });
      return { state: "source_paused" as const, sourceKey: due.sourceKey, errorCode };
    }

    if (!readRefreshControl(input.config.workspaceRoot).enabled) {
      return { state: "disabled" as const };
    }

    const executeRefresh = input.executeRefresh ?? runScheduledSourceRefresh;
    let result: ProbeResult;
    try {
      result = await executeRefresh({
        db: connection,
        runtime: input.config,
        sourceKey: due.sourceKey,
        limit: sourceConfig.localProbe.requestBudget.maxItems,
        dueWindow: due.nextDueAt.toISOString(),
      });
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : String(error);
      if (errorCode !== "PROBE_TASK_DEAD") throw error;
      await deferDeadSourceRuntime({
        db: connection,
        sourceId: due.sourceId,
        policyVersion: due.policyVersion,
        minimumHours: sourceConfig.policy.crawlInterval.minimumHours,
        errorCode,
        now,
      });
      return { state: "source_deferred" as const, sourceKey: due.sourceKey, errorCode };
    }
    await openCircuitForTransportFailures(connection, now);
    return { state: "ran" as const, sourceKey: due.sourceKey, result };
  });
  return cycle
    ? { ...cycle, manualSnapshotSourceKeys }
    : { state: "collector_busy", manualSnapshotSourceKeys };
}

export async function runCollectorWorker(input: {
  db: Kysely<Database>;
  config: CollectorWorkerConfig;
  signal: AbortSignal;
  scanIntervalMs?: number;
  onCycle?: (result: CollectorCycleResult) => void;
  onError?: (error: unknown) => void;
  dependencies?: CollectorWorkerDependencies;
}): Promise<void> {
  const scanIntervalMs = input.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS;
  const now = input.dependencies?.now ?? (() => new Date());
  const materializeCatalog = input.dependencies?.materializeCatalog ?? materializeLocalCatalog;
  const runCycle = input.dependencies?.runCycle ?? runOneCollectorCycle;
  let lastReconciledShanghaiDate: string | undefined;
  while (!input.signal.aborted) {
    try {
      const cycleNow = now();
      const currentShanghaiDate = shanghaiDateKey(cycleNow);
      if (currentShanghaiDate !== lastReconciledShanghaiDate) {
        await materializeCatalog(input.db);
        lastReconciledShanghaiDate = currentShanghaiDate;
      }
      const result = await runCycle({ db: input.db, config: input.config, now: cycleNow });
      input.onCycle?.(result);
    } catch (error) {
      input.onError?.(error);
    }
    await abortableDelay(scanIntervalMs, input.signal);
  }
}
