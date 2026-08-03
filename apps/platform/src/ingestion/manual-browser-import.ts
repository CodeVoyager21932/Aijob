import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { materializeLocalCatalog } from "../catalog/materialize.js";
import { canonicalJson, hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import {
  normalizeBytedanceManualBrowserJob,
  parseBytedanceManualBrowserSnapshot,
} from "../sources/bytedance-manual-browser-adapter.js";
import {
  normalizeOfficialAccountManualJob,
  parseOfficialAccountManualSnapshot,
} from "../sources/official-account-manual-adapter.js";
import { getOfficialSourceAdapterDescriptor } from "../sources/official-source-adapters.js";
import { loadSourceConfig } from "../sources/source-config.js";
import { registerSourceConfig } from "../sources/source-registry.js";
import { updateSourceJobActivityAfterRun } from "./job-activity.js";
import {
  assertActiveTaskLease,
  persistNormalizedOfficialJob,
  recordFetchedResponse,
} from "./persistence.js";
import { validateNavigationUrl } from "./safe-http.js";
import { storeSnapshot } from "./snapshot-store.js";

const MAX_MANUAL_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MANUAL_IMPORT_ROOT = ".data/browser-imports";

type CatalogMaterializer = (db: Kysely<Database>) => Promise<unknown>;

export interface ManualBrowserImportResult {
  reused: boolean;
  taskId: string;
  runId: string;
  snapshotHash: string;
  discoveredCount: number;
  normalizedCount: number;
  createdRevisionCount: number;
}

export function buildManualBrowserImportIdempotencyKey(input: {
  sourceId: string;
  policyVersion: number;
  adapterVersion: string;
  normalizerVersion: string;
  pipelineVersion: string;
  snapshotHash: string;
}): string {
  return hashCanonicalJson({
    taskType: "crawl",
    runMode: "manual",
    sourceId: input.sourceId,
    policyVersion: input.policyVersion,
    adapterVersion: input.adapterVersion,
    normalizerVersion: input.normalizerVersion,
    pipelineVersion: input.pipelineVersion,
    snapshotHash: input.snapshotHash,
  });
}

async function safeImportPath(workspaceRoot: string, filePath: string): Promise<string> {
  const importRoot = resolve(workspaceRoot, MANUAL_IMPORT_ROOT);
  const absolutePath = resolve(workspaceRoot, filePath);
  if (!absolutePath.toLowerCase().endsWith(".json")) {
    throw new Error("MANUAL_BROWSER_SNAPSHOT_PATH_FORBIDDEN");
  }
  const [realImportRoot, realSnapshotPath] = await Promise.all([
    realpath(importRoot),
    realpath(absolutePath),
  ]);
  const relativePath = relative(realImportRoot, realSnapshotPath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("MANUAL_BROWSER_SNAPSHOT_PATH_FORBIDDEN");
  }
  return realSnapshotPath;
}

async function readManualSnapshotFile(workspaceRoot: string, filePath: string): Promise<unknown> {
  const absolutePath = await safeImportPath(workspaceRoot, filePath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_MANUAL_SNAPSHOT_BYTES) {
    throw new Error("MANUAL_BROWSER_SNAPSHOT_SIZE_INVALID");
  }
  const contents = await readFile(absolutePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("MANUAL_BROWSER_SNAPSHOT_INVALID_JSON");
  }
  return parsed;
}

function stableErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return "MANUAL_BROWSER_IMPORT_FAILED";
}

async function materializeAndConfirmManualSnapshot(input: {
  db: Kysely<Database>;
  sourceId: string;
  minimumHours: number;
  scheduleEnabled: boolean;
  materializeCatalog: CatalogMaterializer;
}): Promise<void> {
  try {
    await input.materializeCatalog(input.db);
  } catch (error) {
    const failedAt = new Date();
    await input.db
      .updateTable("source_control.source_runtime_states")
      .set({
        freshness_state: "due",
        last_error_code: "CATALOG_MATERIALIZATION_FAILED",
        updated_at: failedAt,
      })
      .where("source_id", "=", input.sourceId)
      .execute();
    throw error;
  }

  const confirmedAt = new Date();
  const nextDueAt = input.scheduleEnabled
    ? new Date(confirmedAt.getTime() + input.minimumHours * 60 * 60 * 1_000)
    : null;
  await input.db.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("source_control.source_runtime_states")
      .set({
        freshness_state: "fresh",
        consecutive_failures: 0,
        last_error_code: null,
        next_due_at: nextDueAt,
        manual_snapshot_required: false,
        manual_snapshot_due_at: null,
        last_successful_run_at: confirmedAt,
        updated_at: confirmedAt,
      })
      .where("source_id", "=", input.sourceId)
      .execute();
  });
}

export async function importManualBrowserSnapshot(input: {
  db: Kysely<Database>;
  appEnv: "local" | "test" | "alpha" | "production";
  enableLocalMvp: boolean;
  workspaceRoot: string;
  snapshotDirectory: string;
  sourceKey: string;
  filePath: string;
  sourceConfigDirectory?: string;
  materializeCatalog?: CatalogMaterializer;
}): Promise<ManualBrowserImportResult> {
  if ((input.appEnv !== "local" && input.appEnv !== "test") || !input.enableLocalMvp) {
    throw new Error("MANUAL_BROWSER_IMPORT_LOCAL_ONLY");
  }
  const sourceConfig = await loadSourceConfig(input.sourceKey, input.sourceConfigDirectory);
  const materializeCatalog = input.materializeCatalog ?? materializeLocalCatalog;
  const descriptor = getOfficialSourceAdapterDescriptor(sourceConfig.policy.adapterKey);
  if (
    sourceConfig.policy.status !== "pending_review" ||
    sourceConfig.candidate.acquisitionMode !== "browser_required" ||
    sourceConfig.localProbe.enabled ||
    descriptor.probeHandler !== null ||
    descriptor.manualHandler === null
  ) {
    throw new Error("INVALID_MANUAL_BROWSER_SOURCE");
  }

  const document = await readManualSnapshotFile(input.workspaceRoot, input.filePath);
  const imported = (() => {
    if (descriptor.manualHandler === "bytedance-browser") {
      const snapshot = parseBytedanceManualBrowserSnapshot(document);
      validateNavigationUrl(snapshot.sourcePageUrl, "GET", sourceConfig.policy.fetchTargets);
      return {
        bytes: new TextEncoder().encode(canonicalJson(snapshot)),
        sourcePageUrl: snapshot.sourcePageUrl,
        capturedAt: snapshot.capturedAt,
        captureMode: snapshot.captureMode,
        reportedTotal: snapshot.reportedTotal,
        normalizedJobs: snapshot.jobs.map((job) => {
          validateNavigationUrl(job.detailUrl, "GET", sourceConfig.policy.applyTargets);
          return normalizeBytedanceManualBrowserJob({
            job,
            snapshotEvidenceRef: "manual-browser-snapshot",
          });
        }),
      };
    }
    if (descriptor.manualHandler !== "official-account-browser") {
      throw new Error("MANUAL_HANDLER_NOT_IMPLEMENTED");
    }
    const snapshot = parseOfficialAccountManualSnapshot(document);
    validateNavigationUrl(snapshot.sourcePageUrl, "GET", sourceConfig.policy.fetchTargets);
    return {
      bytes: new TextEncoder().encode(canonicalJson(snapshot)),
      sourcePageUrl: snapshot.sourcePageUrl,
      capturedAt: snapshot.capturedAt,
      captureMode: snapshot.captureMode,
      reportedTotal: snapshot.reportedTotal,
      normalizedJobs: snapshot.jobs.map((job) => {
        if (job.application.type === "official_url") {
          validateNavigationUrl(job.application.url, "GET", sourceConfig.policy.applyTargets);
        }
        return normalizeOfficialAccountManualJob({
          job,
          organizationName: sourceConfig.organization.name,
          officialDomain: sourceConfig.organization.officialDomain,
          sourcePageUrl: snapshot.sourcePageUrl,
          snapshotEvidenceRef: "manual-official-account-snapshot",
        });
      }),
    };
  })();
  const { bytes, normalizedJobs } = imported;
  const snapshotHash = sha256(bytes);
  const registered = await registerSourceConfig(input.db, sourceConfig);
  const idempotencyKey = buildManualBrowserImportIdempotencyKey({
    sourceId: registered.sourceId,
    policyVersion: sourceConfig.policy.version,
    adapterVersion: descriptor.adapterVersion,
    normalizerVersion: descriptor.normalizerVersion,
    pipelineVersion: descriptor.pipelineVersion,
    snapshotHash,
  });

  const existingTask = await input.db
    .selectFrom("task_queue.tasks")
    .selectAll()
    .where("idempotency_key", "=", idempotencyKey)
    .executeTakeFirst();
  if (existingTask) {
    if (existingTask.status !== "succeeded") {
      throw new Error("MANUAL_BROWSER_IMPORT_ALREADY_ATTEMPTED");
    }
    const run = await input.db
      .selectFrom("ingestion.crawl_runs")
      .selectAll()
      .where("task_id", "=", existingTask.id)
      .orderBy("started_at", "desc")
      .executeTakeFirstOrThrow();
    await materializeAndConfirmManualSnapshot({
      db: input.db,
      sourceId: registered.sourceId,
      minimumHours: sourceConfig.policy.crawlInterval.minimumHours,
      scheduleEnabled: sourceConfig.policy.crawlInterval.enabled,
      materializeCatalog,
    });
    return {
      reused: true,
      taskId: existingTask.id,
      runId: run.id,
      snapshotHash,
      discoveredCount: run.discovered_count,
      normalizedCount: run.normalized_count,
      createdRevisionCount: 0,
    };
  }

  const storedSnapshot = await storeSnapshot(
    input.snapshotDirectory,
    sourceConfig.sourceKey,
    bytes,
    "application/vnd.aijob.manual-browser-snapshot+json",
  );
  const taskId = randomUUID();
  const runId = randomUUID();
  const leaseOwner = `manual-browser-local-${randomUUID()}`;
  const now = new Date();
  const lease = { taskId, leaseOwner, fencingToken: 1 };
  await input.db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("task_queue.tasks")
      .values({
        id: taskId,
        task_type: "crawl",
        source_id: registered.sourceId,
        policy_version: sourceConfig.policy.version,
        adapter_version: sourceConfig.policy.adapterVersion,
        run_mode: "manual",
        idempotency_key: idempotencyKey,
        status: "running",
        attempt: 1,
        max_attempts: 1,
        available_at: now,
        backoff_policy: canonicalJson({
          baseMilliseconds: 0,
          maximumMilliseconds: 0,
          jitter: "full",
          respectsRetryAfter: false,
        }),
        lease_owner: leaseOwner,
        lease_until: new Date(now.getTime() + 5 * 60_000),
        heartbeat_at: now,
        fencing_token: 1,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();
    await transaction
      .insertInto("ingestion.crawl_runs")
      .values({
        id: runId,
        task_id: taskId,
        source_id: registered.sourceId,
        policy_version: sourceConfig.policy.version,
        adapter_version: sourceConfig.policy.adapterVersion,
        run_mode: "manual",
        completion: null,
        reported_totals: canonicalJson({ manualVisiblePage: imported.reportedTotal }),
        request_count: 0,
        discovered_count: 0,
        normalized_count: 0,
        rejected_count: 0,
        error_summary: canonicalJson([]),
        finished_at: null,
      })
      .execute();
  });

  let createdRevisionCount = 0;
  try {
    const fetchId = await recordFetchedResponse({
      db: input.db,
      sourceId: registered.sourceId,
      crawlRunId: runId,
      response: {
        requestUrl: imported.sourcePageUrl,
        finalUrl: imported.sourcePageUrl,
        method: "GET",
        status: 200,
        contentType: "application/vnd.aijob.manual-browser-snapshot+json",
        responseHeaders: { "x-aijob-capture-mode": imported.captureMode },
        requestFingerprint: hashCanonicalJson({
          captureMode: imported.captureMode,
          sourcePageUrl: imported.sourcePageUrl,
          snapshotHash,
        }),
        body: bytes,
      },
      snapshot: storedSnapshot,
      lease,
    });
    const observedAt = new Date(imported.capturedAt);
    for (const normalized of normalizedJobs) {
      const result = await persistNormalizedOfficialJob({
        db: input.db,
        sourceId: registered.sourceId,
        normalized,
        listFetchId: fetchId,
        detailFetchId: fetchId,
        observedAt,
        lease,
        adapterVersion: descriptor.adapterVersion,
        normalizerVersion: descriptor.normalizerVersion,
        importMode: "manual",
      });
      if (result.createdRevision) createdRevisionCount += 1;
    }

    const finishedAt = new Date();
    await input.db.transaction().execute(async (transaction) => {
      await assertActiveTaskLease(transaction, lease);
      await transaction
        .updateTable("ingestion.crawl_runs")
        .set({
          completion: "partial",
          discovered_count: normalizedJobs.length,
          normalized_count: normalizedJobs.length,
          rejected_count: 0,
          finished_at: finishedAt,
        })
        .where("id", "=", runId)
        .execute();
      await transaction
        .updateTable("task_queue.tasks")
        .set({
          status: "succeeded",
          completed_at: finishedAt,
          heartbeat_at: finishedAt,
          lease_owner: null,
          lease_until: null,
        })
        .where("id", "=", taskId)
        .execute();
      await updateSourceJobActivityAfterRun({
        db: transaction,
        sourceId: registered.sourceId,
        runId,
        observedAt: finishedAt,
        completion: "partial",
        refreshCoverage: sourceConfig.policy.refreshCoverage,
        absencePolicy: sourceConfig.policy.absencePolicy,
        minimumHours: sourceConfig.policy.crawlInterval.minimumHours,
      });
    });
  } catch (error) {
    const failedAt = new Date();
    await input.db.transaction().execute(async (transaction) => {
      await assertActiveTaskLease(transaction, lease);
      await transaction
        .updateTable("ingestion.crawl_runs")
        .set({
          completion: "failed",
          discovered_count: normalizedJobs.length,
          normalized_count: createdRevisionCount,
          rejected_count: normalizedJobs.length - createdRevisionCount,
          error_summary: canonicalJson([
            {
              code: stableErrorCode(error),
              message: error instanceof Error ? error.message : String(error),
            },
          ]),
          finished_at: failedAt,
        })
        .where("id", "=", runId)
        .execute();
      await transaction
        .updateTable("task_queue.tasks")
        .set({
          status: "dead",
          completed_at: failedAt,
          heartbeat_at: failedAt,
          lease_owner: null,
          lease_until: null,
          last_error_code: stableErrorCode(error),
          last_error_summary: error instanceof Error ? error.message : String(error),
        })
        .where("id", "=", taskId)
        .execute();
    });
    throw error;
  }

  await materializeAndConfirmManualSnapshot({
    db: input.db,
    sourceId: registered.sourceId,
    minimumHours: sourceConfig.policy.crawlInterval.minimumHours,
    scheduleEnabled: sourceConfig.policy.crawlInterval.enabled,
    materializeCatalog,
  });

  return {
    reused: false,
    taskId,
    runId,
    snapshotHash,
    discoveredCount: normalizedJobs.length,
    normalizedCount: normalizedJobs.length,
    createdRevisionCount,
  };
}
