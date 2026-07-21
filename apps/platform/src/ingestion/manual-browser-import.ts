import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { canonicalJson, hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import {
  BYTEDANCE_MANUAL_BROWSER_ADAPTER_VERSION,
  BYTEDANCE_MANUAL_BROWSER_NORMALIZER_VERSION,
  normalizeBytedanceManualBrowserJob,
  parseBytedanceManualBrowserSnapshot,
} from "../sources/bytedance-manual-browser-adapter.js";
import {
  normalizeOfficialAccountManualJob,
  OFFICIAL_ACCOUNT_MANUAL_ADAPTER_VERSION,
  OFFICIAL_ACCOUNT_MANUAL_NORMALIZER_VERSION,
  parseOfficialAccountManualSnapshot,
} from "../sources/official-account-manual-adapter.js";
import { assertConfiguredAdapterVersion } from "../sources/official-source-adapters.js";
import { loadSourceConfig } from "../sources/source-config.js";
import { registerSourceConfig } from "../sources/source-registry.js";
import {
  assertActiveTaskLease,
  persistNormalizedOfficialJob,
  recordFetchedResponse,
} from "./persistence.js";
import { validateNavigationUrl } from "./safe-http.js";
import { storeSnapshot } from "./snapshot-store.js";

const MAX_MANUAL_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MANUAL_IMPORT_ROOT = ".data/browser-imports";
const MANUAL_IMPORT_PIPELINE_VERSION = "2";

export interface ManualBrowserImportResult {
  reused: boolean;
  taskId: string;
  runId: string;
  snapshotHash: string;
  discoveredCount: number;
  normalizedCount: number;
  createdRevisionCount: number;
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

export async function importManualBrowserSnapshot(input: {
  db: Kysely<Database>;
  appEnv: "local" | "test" | "alpha" | "production";
  enableLocalMvp: boolean;
  workspaceRoot: string;
  snapshotDirectory: string;
  sourceKey: string;
  filePath: string;
  sourceConfigDirectory?: string;
}): Promise<ManualBrowserImportResult> {
  if ((input.appEnv !== "local" && input.appEnv !== "test") || !input.enableLocalMvp) {
    throw new Error("MANUAL_BROWSER_IMPORT_LOCAL_ONLY");
  }
  const sourceConfig = await loadSourceConfig(input.sourceKey, input.sourceConfigDirectory);
  if (
    sourceConfig.policy.status !== "pending_review" ||
    sourceConfig.candidate.acquisitionMode !== "browser_required" ||
    sourceConfig.localProbe.enabled ||
    !["bytedance-manual-browser-snapshot", "official-account-manual-snapshot"].includes(
      sourceConfig.policy.adapterKey,
    )
  ) {
    throw new Error("INVALID_MANUAL_BROWSER_SOURCE");
  }
  assertConfiguredAdapterVersion(
    sourceConfig.policy.adapterKey,
    sourceConfig.policy.adapterVersion,
  );

  const document = await readManualSnapshotFile(input.workspaceRoot, input.filePath);
  const imported = (() => {
    if (sourceConfig.policy.adapterKey === "bytedance-manual-browser-snapshot") {
      const snapshot = parseBytedanceManualBrowserSnapshot(document);
      validateNavigationUrl(snapshot.sourcePageUrl, "GET", sourceConfig.policy.fetchTargets);
      return {
        bytes: new TextEncoder().encode(canonicalJson(snapshot)),
        sourcePageUrl: snapshot.sourcePageUrl,
        capturedAt: snapshot.capturedAt,
        captureMode: snapshot.captureMode,
        reportedTotal: snapshot.reportedTotal,
        adapterVersion: BYTEDANCE_MANUAL_BROWSER_ADAPTER_VERSION,
        normalizerVersion: BYTEDANCE_MANUAL_BROWSER_NORMALIZER_VERSION,
        normalizedJobs: snapshot.jobs.map((job) => {
          validateNavigationUrl(job.detailUrl, "GET", sourceConfig.policy.applyTargets);
          return normalizeBytedanceManualBrowserJob({
            job,
            snapshotEvidenceRef: "manual-browser-snapshot",
          });
        }),
      };
    }
    const snapshot = parseOfficialAccountManualSnapshot(document);
    validateNavigationUrl(snapshot.sourcePageUrl, "GET", sourceConfig.policy.fetchTargets);
    return {
      bytes: new TextEncoder().encode(canonicalJson(snapshot)),
      sourcePageUrl: snapshot.sourcePageUrl,
      capturedAt: snapshot.capturedAt,
      captureMode: snapshot.captureMode,
      reportedTotal: snapshot.reportedTotal,
      adapterVersion: OFFICIAL_ACCOUNT_MANUAL_ADAPTER_VERSION,
      normalizerVersion: OFFICIAL_ACCOUNT_MANUAL_NORMALIZER_VERSION,
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
  const idempotencyKey = hashCanonicalJson({
    taskType: "crawl",
    runMode: "manual-browser-snapshot",
    sourceId: registered.sourceId,
    policyVersion: sourceConfig.policy.version,
    adapterVersion: sourceConfig.policy.adapterVersion,
    importPipelineVersion: MANUAL_IMPORT_PIPELINE_VERSION,
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
        run_mode: "probe",
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
        run_mode: "probe",
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
        adapterVersion: imported.adapterVersion,
        normalizerVersion: imported.normalizerVersion,
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
