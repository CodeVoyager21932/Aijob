import { randomUUID } from "node:crypto";
import type { Database } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { ZodError, z } from "zod";
import { materializeLocalCatalog } from "../catalog/materialize.js";
import { canonicalJson, hashCanonicalJson } from "../lib/canonical-json.js";
import {
  BAIDU_INTERNSHIPS_ADAPTER_VERSION,
  BAIDU_INTERNSHIPS_LIST_URL,
  BAIDU_INTERNSHIPS_NORMALIZER_VERSION,
  normalizeBaiduInternship,
  parseBaiduInternshipPage,
} from "../sources/baidu-internships-adapter.js";
import {
  BEISEN_ZHIYE_ADAPTER_VERSION,
  BEISEN_ZHIYE_NORMALIZER_VERSION,
  type BeisenJobAd,
  buildBeisenZhiyeListRequest,
  buildBeisenZhiyeListUrl,
  isBeisenExplicitInternship,
  normalizeBeisenZhiyeJobAd,
  parseBeisenZhiyeListPage,
  resolveBeisenZhiyeTenant,
} from "../sources/beisen-zhiye-adapter.js";
import {
  buildFanruanTraineeListFormBody,
  FANRUAN_TRAINEE_ADAPTER_VERSION,
  FANRUAN_TRAINEE_LIST_URL,
  FANRUAN_TRAINEE_NORMALIZER_VERSION,
  type FanruanTraineeJob,
  isFanruanInternship,
  normalizeFanruanTraineeJob,
  parseFanruanTraineePage,
} from "../sources/fanruan-trainee-adapter.js";
import {
  buildJdCampusInternshipListRequest,
  JD_CAMPUS_INTERNSHIPS_ADAPTER_VERSION,
  JD_CAMPUS_INTERNSHIPS_LIST_URL,
  JD_CAMPUS_INTERNSHIPS_NORMALIZER_VERSION,
  normalizeJdCampusInternship,
  parseJdCampusInternshipPage,
} from "../sources/jd-campus-internships-adapter.js";
import {
  buildMeituanDetailRequest,
  buildMeituanSearchRequest,
  MEITUAN_ADAPTER_VERSION,
  MEITUAN_NORMALIZER_VERSION,
  type MeituanListItem,
  meituanDetailPayload,
  meituanDetailResponseSchema,
  meituanListPayload,
  meituanSearchResponseSchema,
  normalizeMeituanJob,
} from "../sources/meituan-official-adapter.js";
import {
  NANKAI_TAL_ADAPTER_VERSION,
  NANKAI_TAL_NORMALIZER_VERSION,
  NANKAI_TAL_SOURCE_URL,
  normalizeNankaiTalRole,
  parseNankaiTalPage,
} from "../sources/nankai-tal-2027-adapter.js";
import {
  getOfficialSourceAdapterDescriptor,
  type ProbeHandlerKey,
} from "../sources/official-source-adapters.js";
import {
  assessSource,
  loadSourceConfig,
  type ProbeQueryStream,
  type SourceConfig,
} from "../sources/source-config.js";
import { registerSourceConfig } from "../sources/source-registry.js";
import {
  buildTencentDetailUrl,
  buildTencentSearchRequest,
  isTencentStablePostId,
  normalizeTencentJob,
  type TencentListItem,
  tencentDetailResponseSchema,
  tencentSearchResponseSchema,
} from "../sources/tencent-campus-adapter.js";
import {
  normalizeUniversityEmploymentJob,
  parseUniversityEmploymentJobs,
  resolveUniversityEmploymentSource,
  UNIVERSITY_EMPLOYMENT_ADAPTER_VERSION,
  UNIVERSITY_EMPLOYMENT_NORMALIZER_VERSION,
} from "../sources/university-employment-adapter.js";
import {
  applyDirectSourceJobClosures,
  type DirectClosureReason,
  updateSourceJobActivityAfterRun,
} from "./job-activity.js";
import {
  assertActiveTaskLease,
  markFetchSchemaError,
  persistNormalizedOfficialJob,
  persistNormalizedTencentJob,
  recordFetchedResponse,
  type TaskLease,
} from "./persistence.js";
import {
  NetworkPolicyError,
  type SafeHttpResult,
  type SafeRequestOptions,
  safeRequestHtml,
  safeRequestJson,
  validateNavigationUrl,
  validateUrl,
} from "./safe-http.js";
import { storeSnapshot } from "./snapshot-store.js";

export interface ProbeRuntimeConfig {
  appEnv: "local" | "test" | "alpha" | "production";
  enableSourceProbe: boolean;
  snapshotDir: string;
  probeRequestIntervalMs: number;
}

export interface ProbeResult {
  reused: boolean;
  taskId: string;
  runId: string;
  completion: "complete" | "partial" | "failed";
  discoveredCount: number;
  normalizedCount: number;
  rejectedCount: number;
  errors: Array<{ code: string; message: string }>;
}

interface DiscoveredCandidate {
  item: TencentListItem;
  listFetchId: string;
  listItemIndex: number;
  discoveryStreams: string[];
}

export interface ProbeBudgetUsage {
  requests: number;
  pages: number;
  lastRequestStartedAtMs?: number;
}

function claimProbePage(sourceConfig: SourceConfig, usage: ProbeBudgetUsage): void {
  if (usage.pages >= sourceConfig.localProbe.requestBudget.maxPages) {
    throw new Error("PROBE_PAGE_BUDGET_EXCEEDED");
  }
  usage.pages += 1;
}

function claimProbeAttempt(sourceConfig: SourceConfig, usage: ProbeBudgetUsage): void {
  if (usage.requests >= sourceConfig.localProbe.requestBudget.maxRequests) {
    throw new Error("PROBE_REQUEST_BUDGET_EXCEEDED");
  }
  usage.requests += 1;
}

export function claimProbeRequest(
  sourceConfig: SourceConfig,
  usage: ProbeBudgetUsage,
  kind: "page" | "detail",
): void {
  if (kind === "page") claimProbePage(sourceConfig, usage);
  claimProbeAttempt(sourceConfig, usage);
}

export function probeRequestOptions(
  input: {
    sourceConfig: SourceConfig;
    budgetUsage: ProbeBudgetUsage;
    minimumIntervalMs: number;
  },
  kind: "page" | "detail",
): SafeRequestOptions {
  if (kind === "page") claimProbePage(input.sourceConfig, input.budgetUsage);
  return {
    beforeRequest: async () => {
      claimProbeAttempt(input.sourceConfig, input.budgetUsage);
      const now = Date.now();
      const lastStartedAt = input.budgetUsage.lastRequestStartedAtMs;
      if (lastStartedAt !== undefined) {
        await delay(Math.max(0, lastStartedAt + input.minimumIntervalMs - now));
      }
      input.budgetUsage.lastRequestStartedAtMs = Date.now();
    },
  };
}

const taskBackoffPolicySchema = z.object({
  baseMilliseconds: z.number().int().nonnegative(),
  maximumMilliseconds: z.number().int().nonnegative(),
  jitter: z.literal("full"),
  respectsRetryAfter: z.boolean(),
});
type TaskBackoffPolicy = z.infer<typeof taskBackoffPolicySchema>;

const retryableProbeErrorCodes = new Set([
  "DNS_EMPTY",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UPSTREAM_TIMEOUT",
]);

export function isRetryableProbeErrorCode(code: string): boolean {
  return retryableProbeErrorCodes.has(code) || /^UPSTREAM_HTTP_(408|429|5\d\d)$/.test(code);
}

const safeSoftRefreshRejectionCodes = new Set([
  "BEISEN_NOT_EXPLICIT_INTERNSHIP",
  "FANRUAN_NOT_EXPLICIT_INTERNSHIP",
  "UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP",
  "UNIVERSITY_EMPLOYMENT_NOT_INTERNSHIP_SECTION",
]);

export function isSafeSoftRefreshRejectionCode(code: string): boolean {
  return safeSoftRefreshRejectionCodes.has(code);
}

export function isHardRefreshConflictCode(code: string): boolean {
  return !isRetryableProbeErrorCode(code) && !isSafeSoftRefreshRejectionCode(code);
}

export function scheduledRefreshRejectionCode(input: {
  code: string;
  runMode: "probe" | "scheduled";
  refreshCoverage: SourceConfig["policy"]["refreshCoverage"];
  recordAlreadyTracked: boolean;
}): string {
  return input.runMode === "scheduled" &&
    input.refreshCoverage === "tracked_records" &&
    input.recordAlreadyTracked &&
    isSafeSoftRefreshRejectionCode(input.code)
    ? "TRACKED_RECORD_NOT_INTERNSHIP"
    : input.code;
}

export function isRefreshCountAnomaly(previousCount: number, currentCount: number): boolean {
  if (previousCount < 4 || currentCount < 0) return false;
  return currentCount < Math.ceil(previousCount / 4) || currentCount > previousCount * 4;
}

export function isSourcePolicyStatusAuthorizedForRun(
  status: SourceConfig["policy"]["status"],
  runMode: "probe" | "scheduled",
): boolean {
  return runMode === "scheduled"
    ? status === "pending_review" || status === "approved"
    : status === "pending_review";
}

export function directClosureReasonForErrorCode(code: string): DirectClosureReason | undefined {
  return code === "UPSTREAM_HTTP_404"
    ? "http_404"
    : code === "UPSTREAM_HTTP_410"
      ? "http_410"
      : undefined;
}

export function calculateTaskFailureTransition(input: {
  attempt: number;
  maxAttempts: number;
  errorCodes: string[];
  backoffPolicy: TaskBackoffPolicy;
  now: Date;
  random?: () => number;
}): { status: "queued" | "dead"; availableAt: Date; completedAt: Date | null } {
  const retryable =
    input.errorCodes.length > 0 && input.errorCodes.every(isRetryableProbeErrorCode);
  if (!retryable || input.attempt >= input.maxAttempts) {
    return { status: "dead", availableAt: input.now, completedAt: input.now };
  }

  const exponentialMaximum = Math.min(
    input.backoffPolicy.maximumMilliseconds,
    input.backoffPolicy.baseMilliseconds * 2 ** Math.max(0, input.attempt - 1),
  );
  const random = input.random ?? Math.random;
  const delayMilliseconds = Math.floor(Math.max(0, Math.min(1, random())) * exponentialMaximum);
  return {
    status: "queued",
    availableAt: new Date(input.now.getTime() + delayMilliseconds),
    completedAt: null,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorCode(error: unknown): string {
  if (error instanceof NetworkPolicyError) {
    return error.code;
  }
  if (error instanceof ZodError) {
    return "UPSTREAM_SCHEMA_CHANGED";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]+$/.test(error.code)
  ) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) {
    return error.message;
  }
  return "UNEXPECTED_PROBE_ERROR";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function trackedRecordAwareRejectionCode(input: {
  db: Kysely<Database>;
  sourceId: string;
  sourceConfig: SourceConfig;
  runMode: "probe" | "scheduled";
  code: string;
  sourceJobId?: string;
  canonicalSourceUrl?: string;
}): Promise<string> {
  if (
    input.runMode !== "scheduled" ||
    input.sourceConfig.policy.refreshCoverage !== "tracked_records" ||
    !isSafeSoftRefreshRejectionCode(input.code)
  ) {
    return input.code;
  }

  let recordAlreadyTracked = false;
  if (input.sourceJobId) {
    recordAlreadyTracked = Boolean(
      await input.db
        .selectFrom("ingestion.source_job_records")
        .select("id")
        .where("source_id", "=", input.sourceId)
        .where("source_job_id", "=", input.sourceJobId)
        .executeTakeFirst(),
    );
  } else if (input.canonicalSourceUrl) {
    recordAlreadyTracked = Boolean(
      await input.db
        .selectFrom("ingestion.source_job_records")
        .select("id")
        .where("source_id", "=", input.sourceId)
        .where("canonical_source_url", "=", input.canonicalSourceUrl)
        .executeTakeFirst(),
    );
  }

  return scheduledRefreshRejectionCode({
    code: input.code,
    runMode: input.runMode,
    refreshCoverage: input.sourceConfig.policy.refreshCoverage,
    recordAlreadyTracked,
  });
}

export async function lockScheduledPolicyForAcceptance(input: {
  transaction: Transaction<Database>;
  sourceId: string;
  policyVersion: number;
  adapterKey: string;
  adapterVersion: string;
}): Promise<boolean> {
  const source = await input.transaction
    .selectFrom("source_control.sources")
    .select("current_policy_version")
    .where("id", "=", input.sourceId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const policy = await input.transaction
    .selectFrom("source_control.source_policy_versions")
    .select(["adapter_key", "adapter_version"])
    .where("source_id", "=", input.sourceId)
    .where("version", "=", source.current_policy_version)
    .executeTakeFirstOrThrow();
  const runtime = await input.transaction
    .selectFrom("source_control.source_runtime_states")
    .select("policy_version")
    .where("source_id", "=", input.sourceId)
    .executeTakeFirstOrThrow();

  return (
    source.current_policy_version === input.policyVersion &&
    runtime.policy_version === input.policyVersion &&
    policy.adapter_key === input.adapterKey &&
    policy.adapter_version === input.adapterVersion
  );
}

async function persistHttpResponse(input: {
  db: Kysely<Database>;
  runtime: ProbeRuntimeConfig;
  sourceConfig: SourceConfig;
  sourceId: string;
  crawlRunId: string;
  response: SafeHttpResult;
  lease: TaskLease;
  fetchResult?: "success" | "http_error" | "schema_error" | "network_error" | "policy_error";
  errorCode?: string | null;
}): Promise<string> {
  const snapshot = await storeSnapshot(
    input.runtime.snapshotDir,
    input.sourceConfig.sourceKey,
    input.response.body,
    input.response.contentType,
  );
  return recordFetchedResponse({
    db: input.db,
    sourceId: input.sourceId,
    crawlRunId: input.crawlRunId,
    response: input.response,
    snapshot,
    lease: input.lease,
    ...(input.fetchResult ? { fetchResult: input.fetchResult } : {}),
    ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
  });
}

export async function reconcileAcceptedScheduledCatalog(input: {
  db: Kysely<Database>;
  sourceId: string;
  policyVersion: number;
  minimumHours: number;
  completedAt: Date;
  materializeCatalog?: typeof materializeLocalCatalog;
}): Promise<void> {
  try {
    await (input.materializeCatalog ?? materializeLocalCatalog)(input.db);
  } catch (error) {
    await input.db
      .updateTable("source_control.source_runtime_states")
      .set({
        freshness_state: "due",
        consecutive_failures: sql`consecutive_failures + 1`,
        last_error_code: "CATALOG_MATERIALIZATION_FAILED",
        updated_at: new Date(),
      })
      .where("source_id", "=", input.sourceId)
      .where("policy_version", "=", input.policyVersion)
      .execute();
    throw error;
  }

  await input.db
    .updateTable("source_control.source_runtime_states")
    .set({
      freshness_state: "fresh",
      consecutive_failures: 0,
      last_error_code: null,
      next_due_at: new Date(input.completedAt.getTime() + input.minimumHours * 60 * 60 * 1_000),
      automation_paused: false,
      automation_pause_reason: null,
      updated_at: new Date(),
    })
    .where("source_id", "=", input.sourceId)
    .where("policy_version", "=", input.policyVersion)
    .execute();
}

async function createOrClaimProbeTask(input: {
  db: Kysely<Database>;
  sourceId: string;
  config: SourceConfig;
  limit: number;
  runMode: "probe" | "scheduled";
  window: string;
}): Promise<
  | { reused: true; taskId: string; runId: string }
  | {
      reused: false;
      taskId: string;
      leaseOwner: string;
      fencingToken: number;
      attempt: number;
      maxAttempts: number;
      backoffPolicy: TaskBackoffPolicy;
    }
> {
  const { db, sourceId, config, limit, runMode, window } = input;
  const descriptor = getOfficialSourceAdapterDescriptor(config.policy.adapterKey);
  const idempotencyKey = hashCanonicalJson({
    taskType: "crawl",
    sourceId,
    policyVersion: config.policy.version,
    adapterVersion: config.policy.adapterVersion,
    normalizerVersion: descriptor.normalizerVersion,
    pipelineVersion: descriptor.pipelineVersion,
    adapterOptions: config.policy.adapterOptions,
    runMode,
    window,
    queryStreams: config.localProbe.queryStreams,
    requestBudget: config.localProbe.requestBudget,
    limit,
  });

  const taskId = randomUUID();
  await db
    .insertInto("task_queue.tasks")
    .values({
      id: taskId,
      task_type: "crawl",
      source_id: sourceId,
      policy_version: config.policy.version,
      adapter_version: config.policy.adapterVersion,
      run_mode: runMode,
      idempotency_key: idempotencyKey,
      status: "queued",
      attempt: 0,
      max_attempts: 3,
      available_at: new Date(),
      backoff_policy: canonicalJson({
        baseMilliseconds: 500,
        maximumMilliseconds: 5_000,
        jitter: "full",
        respectsRetryAfter: true,
      }),
      lease_owner: null,
      lease_until: null,
      heartbeat_at: null,
      last_error_code: null,
      last_error_summary: null,
      completed_at: null,
    })
    .onConflict((conflict) => conflict.column("idempotency_key").doNothing())
    .execute();

  const outcome = await db.transaction().execute(async (transaction) => {
    const task = await transaction
      .selectFrom("task_queue.tasks")
      .selectAll()
      .where("idempotency_key", "=", idempotencyKey)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();

    if (!task) {
      throw new Error("PROBE_TASK_LOCKED");
    }

    if (task.status === "succeeded") {
      const run = await transaction
        .selectFrom("ingestion.crawl_runs")
        .select("id")
        .where("task_id", "=", task.id)
        .orderBy("started_at", "desc")
        .executeTakeFirstOrThrow();
      return { reused: true as const, taskId: task.id, runId: run.id };
    }

    const now = new Date();
    if (task.status === "dead") {
      return { dead: true as const, taskId: task.id };
    }
    if (
      task.status === "running" &&
      task.lease_until &&
      new Date(task.lease_until).getTime() > now.getTime()
    ) {
      throw new Error("PROBE_ALREADY_RUNNING");
    }
    if (
      (task.status === "queued" || task.status === "failed") &&
      new Date(task.available_at).getTime() > now.getTime()
    ) {
      throw new Error("PROBE_TASK_NOT_AVAILABLE");
    }
    if (task.attempt >= task.max_attempts) {
      await transaction
        .updateTable("task_queue.tasks")
        .set({
          status: "dead",
          completed_at: now,
          lease_owner: null,
          lease_until: null,
          heartbeat_at: now,
        })
        .where("id", "=", task.id)
        .executeTakeFirstOrThrow();
      return { dead: true as const, taskId: task.id };
    }

    const leaseOwner = `collector-local-${randomUUID()}`;
    const fencingToken = Number(task.fencing_token) + 1;
    const attempt = task.attempt + 1;
    await transaction
      .updateTable("task_queue.tasks")
      .set({
        status: "running",
        attempt,
        lease_owner: leaseOwner,
        lease_until: new Date(now.getTime() + 60_000),
        heartbeat_at: now,
        fencing_token: fencingToken,
        last_error_code: null,
        last_error_summary: null,
      })
      .where("id", "=", task.id)
      .executeTakeFirstOrThrow();

    return {
      reused: false as const,
      taskId: task.id,
      leaseOwner,
      fencingToken,
      attempt,
      maxAttempts: task.max_attempts,
      backoffPolicy: taskBackoffPolicySchema.parse(task.backoff_policy),
    };
  });

  if ("dead" in outcome) {
    throw new Error("PROBE_TASK_DEAD");
  }
  return outcome;
}

async function updateHeartbeat(
  db: Kysely<Database>,
  taskId: string,
  leaseOwner: string,
  fencingToken: number,
): Promise<void> {
  const now = new Date();
  const result = await db
    .updateTable("task_queue.tasks")
    .set({
      heartbeat_at: now,
      lease_until: new Date(now.getTime() + 60_000),
    })
    .where("id", "=", taskId)
    .where("lease_owner", "=", leaseOwner)
    .where("fencing_token", "=", fencingToken)
    .where("status", "=", "running")
    .where("lease_until", ">", now)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) {
    throw new Error("TASK_LEASE_LOST");
  }
}

async function fetchSearchPage(input: {
  db: Kysely<Database>;
  runtime: ProbeRuntimeConfig;
  sourceConfig: SourceConfig;
  sourceId: string;
  crawlRunId: string;
  stream: ProbeQueryStream;
  pageIndex: number;
  pageSize: number;
  lease: TaskLease;
  budgetUsage: ProbeBudgetUsage;
}): Promise<{
  parsed: ReturnType<typeof tencentSearchResponseSchema.parse>;
  fetchId: string;
}> {
  const requestBody = buildTencentSearchRequest(input.stream, input.pageIndex, input.pageSize);
  const response = await safeRequestJson(
    {
      method: "POST",
      url: "https://join.qq.com/api/v1/position/searchPosition",
      jsonBody: requestBody,
    },
    input.sourceConfig.policy.fetchTargets,
    probeRequestOptions(
      {
        sourceConfig: input.sourceConfig,
        budgetUsage: input.budgetUsage,
        minimumIntervalMs: Math.max(
          input.runtime.probeRequestIntervalMs,
          input.sourceConfig.localProbe.requestBudget.minimumIntervalMs,
        ),
      },
      "page",
    ),
  );
  const fetchId = await persistHttpResponse({ ...input, response });
  try {
    return {
      parsed: tencentSearchResponseSchema.parse(response.json),
      fetchId,
    };
  } catch (error) {
    await markFetchSchemaError(input.db, fetchId, "UPSTREAM_SCHEMA_CHANGED", input.lease);
    throw error;
  }
}

async function fetchDetail(input: {
  db: Kysely<Database>;
  runtime: ProbeRuntimeConfig;
  sourceConfig: SourceConfig;
  sourceId: string;
  crawlRunId: string;
  postId: string;
  lease: TaskLease;
  budgetUsage: ProbeBudgetUsage;
}): Promise<{
  parsed: ReturnType<typeof tencentDetailResponseSchema.parse>;
  fetchId: string;
}> {
  const response = await safeRequestJson(
    {
      method: "GET",
      url: buildTencentDetailUrl(input.postId),
    },
    input.sourceConfig.policy.fetchTargets,
    probeRequestOptions(
      {
        sourceConfig: input.sourceConfig,
        budgetUsage: input.budgetUsage,
        minimumIntervalMs: Math.max(
          input.runtime.probeRequestIntervalMs,
          input.sourceConfig.localProbe.requestBudget.minimumIntervalMs,
        ),
      },
      "detail",
    ),
  );
  const fetchId = await persistHttpResponse({ ...input, response });
  try {
    return {
      parsed: tencentDetailResponseSchema.parse(response.json),
      fetchId,
    };
  } catch (error) {
    await markFetchSchemaError(input.db, fetchId, "UPSTREAM_SCHEMA_CHANGED", input.lease);
    throw error;
  }
}

async function discoverCandidates(input: {
  db: Kysely<Database>;
  runtime: ProbeRuntimeConfig;
  sourceConfig: SourceConfig;
  sourceId: string;
  crawlRunId: string;
  taskId: string;
  leaseOwner: string;
  fencingToken: number;
  limit: number;
  errors: ProbeResult["errors"];
  reportedTotals: Record<string, number>;
  rejectedCounter: { value: number };
  budgetUsage: ProbeBudgetUsage;
}): Promise<Map<string, DiscoveredCandidate>> {
  const discovered = new Map<string, DiscoveredCandidate>();

  for (const stream of input.sourceConfig.localProbe.queryStreams) {
    if (discovered.size >= input.limit) {
      break;
    }
    const streamIds = new Set<string>();
    let streamAddedCount = 0;
    let pageIndex = 1;
    let expectedTotal: number | undefined;
    const pageSize = Math.min(10, stream.targetItems);

    while (streamAddedCount < stream.targetItems && discovered.size < input.limit) {
      const { parsed, fetchId } = await fetchSearchPage({
        db: input.db,
        runtime: input.runtime,
        sourceConfig: input.sourceConfig,
        sourceId: input.sourceId,
        crawlRunId: input.crawlRunId,
        stream,
        pageIndex,
        pageSize,
        budgetUsage: input.budgetUsage,
        lease: {
          taskId: input.taskId,
          leaseOwner: input.leaseOwner,
          fencingToken: input.fencingToken,
        },
      });
      input.reportedTotals[stream.key] = parsed.data.count;
      expectedTotal ??= parsed.data.count;
      if (parsed.data.count !== expectedTotal) {
        input.errors.push({
          code: "UPSTREAM_TOTAL_CHANGED",
          message: `${stream.key} total changed from ${expectedTotal} to ${parsed.data.count}`,
        });
        break;
      }
      if (parsed.data.positionList.length === 0) {
        if (expectedTotal !== 0 && (pageIndex - 1) * pageSize < expectedTotal) {
          input.errors.push({
            code: "UPSTREAM_EARLY_EMPTY_PAGE",
            message: `${stream.key} returned an empty page before its reported end`,
          });
        }
        break;
      }

      for (const [listItemIndex, item] of parsed.data.positionList.entries()) {
        if (!isTencentStablePostId(item.postId)) {
          if (!streamIds.has(item.postId)) {
            streamIds.add(item.postId);
            input.rejectedCounter.value += 1;
            input.errors.push({
              code: "UNSTABLE_SOURCE_JOB_ID",
              message: `${stream.key} returned aggregate/sentinel postId ${item.postId}; skipped`,
            });
          }
          continue;
        }
        if (streamIds.has(item.postId)) {
          input.errors.push({
            code: "UPSTREAM_DUPLICATE_POST_ID",
            message: `${stream.key} repeated postId ${item.postId}`,
          });
          continue;
        }
        streamIds.add(item.postId);

        const existing = discovered.get(item.postId);
        if (existing) {
          if (!existing.discoveryStreams.includes(stream.key)) {
            existing.discoveryStreams.push(stream.key);
          }
          continue;
        }
        if (discovered.size < input.limit) {
          discovered.set(item.postId, {
            item,
            listFetchId: fetchId,
            listItemIndex,
            discoveryStreams: [stream.key],
          });
          streamAddedCount += 1;
        }
      }

      const consumed = pageIndex * pageSize;
      if (consumed >= expectedTotal || parsed.data.positionList.length < pageSize) {
        break;
      }
      pageIndex += 1;
      await updateHeartbeat(input.db, input.taskId, input.leaseOwner, input.fencingToken);
      await delay(
        Math.max(
          input.runtime.probeRequestIntervalMs,
          input.sourceConfig.localProbe.requestBudget.minimumIntervalMs,
        ),
      );
    }
  }

  return discovered;
}

interface AdapterProbeInput {
  db: Kysely<Database>;
  runtime: ProbeRuntimeConfig;
  sourceConfig: SourceConfig;
  sourceId: string;
  crawlRunId: string;
  taskId: string;
  leaseOwner: string;
  fencingToken: number;
  limit: number;
  errors: ProbeResult["errors"];
  budgetUsage: ProbeBudgetUsage;
  runMode: "probe" | "scheduled";
}

interface AdapterProbeOutput {
  discoveredCount: number;
  normalizedCount: number;
  rejectedCount: number;
  requestCount: number;
  reportedTotals: Record<string, number>;
  failureErrorCodes: string[];
  scopeExhausted: boolean;
  directClosures?: Array<{ recordIds: string[]; reason: DirectClosureReason }>;
}

function probeLease(input: AdapterProbeInput): TaskLease {
  return {
    taskId: input.taskId,
    leaseOwner: input.leaseOwner,
    fencingToken: input.fencingToken,
  };
}

function requestInterval(input: AdapterProbeInput): number {
  return Math.max(
    input.runtime.probeRequestIntervalMs,
    input.sourceConfig.localProbe.requestBudget.minimumIntervalMs,
  );
}

async function fetchMeituanListPage(
  input: AdapterProbeInput & {
    pageNo: number;
    pageSize: number;
  },
): Promise<{
  parsed: ReturnType<typeof meituanSearchResponseSchema.parse>;
  fetchId: string;
}> {
  const response = await safeRequestJson(
    {
      method: "POST",
      url: "https://zhaopin.meituan.com/api/official/job/getJobList",
      jsonBody: buildMeituanSearchRequest(input.pageNo, input.pageSize),
    },
    input.sourceConfig.policy.fetchTargets,
    probeRequestOptions(
      {
        sourceConfig: input.sourceConfig,
        budgetUsage: input.budgetUsage,
        minimumIntervalMs: requestInterval(input),
      },
      "page",
    ),
  );
  const fetchId = await persistHttpResponse({
    ...input,
    crawlRunId: input.crawlRunId,
    response,
    lease: probeLease(input),
  });
  try {
    return { parsed: meituanSearchResponseSchema.parse(response.json), fetchId };
  } catch (error) {
    await markFetchSchemaError(input.db, fetchId, "UPSTREAM_SCHEMA_CHANGED", probeLease(input));
    throw error;
  }
}

async function fetchMeituanDetail(
  input: AdapterProbeInput & {
    jobUnionId: string;
  },
): Promise<{
  parsed: ReturnType<typeof meituanDetailResponseSchema.parse>;
  fetchId: string;
}> {
  const response = await safeRequestJson(
    {
      method: "POST",
      url: "https://zhaopin.meituan.com/api/official/job/getJobDetail",
      jsonBody: buildMeituanDetailRequest(input.jobUnionId),
    },
    input.sourceConfig.policy.fetchTargets,
    probeRequestOptions(
      {
        sourceConfig: input.sourceConfig,
        budgetUsage: input.budgetUsage,
        minimumIntervalMs: requestInterval(input),
      },
      "detail",
    ),
  );
  const fetchId = await persistHttpResponse({
    ...input,
    crawlRunId: input.crawlRunId,
    response,
    lease: probeLease(input),
  });
  try {
    return { parsed: meituanDetailResponseSchema.parse(response.json), fetchId };
  } catch (error) {
    await markFetchSchemaError(input.db, fetchId, "UPSTREAM_SCHEMA_CHANGED", probeLease(input));
    throw error;
  }
}

async function runMeituanAdapterProbe(input: AdapterProbeInput): Promise<AdapterProbeOutput> {
  const candidates = new Map<
    string,
    { item: MeituanListItem; listFetchId: string; listItemIndex: number }
  >();
  const failureErrorCodes: string[] = [];
  const reportedTotals: Record<string, number> = {};
  let rejectedCount = 0;
  let pageNo = 1;
  let expectedTotal: number | undefined;

  while (candidates.size < input.limit) {
    const listResult = await fetchMeituanListPage({
      ...input,
      pageNo,
      pageSize: Math.min(10, input.limit - candidates.size),
    });
    const payload = meituanListPayload(listResult.parsed);
    reportedTotals["product-internships"] = payload.page.totalCount;
    expectedTotal ??= payload.page.totalCount;
    if (payload.page.totalCount !== expectedTotal) {
      input.errors.push({
        code: "UPSTREAM_TOTAL_CHANGED",
        message: `product-internships total changed from ${expectedTotal} to ${payload.page.totalCount}`,
      });
      break;
    }
    if (payload.list.length === 0) break;

    for (const [listItemIndex, item] of payload.list.entries()) {
      if (candidates.has(item.jobUnionId)) {
        rejectedCount += 1;
        input.errors.push({
          code: "UPSTREAM_DUPLICATE_JOB_ID",
          message: `Meituan repeated jobUnionId ${item.jobUnionId}`,
        });
        continue;
      }
      candidates.set(item.jobUnionId, {
        item,
        listFetchId: listResult.fetchId,
        listItemIndex,
      });
      if (candidates.size >= input.limit) break;
    }

    if (pageNo >= payload.page.totalPage || candidates.size >= payload.page.totalCount) break;
    pageNo += 1;
    await updateHeartbeat(input.db, input.taskId, input.leaseOwner, input.fencingToken);
    await delay(requestInterval(input));
  }

  let normalizedCount = 0;
  for (const candidate of candidates.values()) {
    try {
      await updateHeartbeat(input.db, input.taskId, input.leaseOwner, input.fencingToken);
      await delay(requestInterval(input));
      const detailResult = await fetchMeituanDetail({
        ...input,
        jobUnionId: candidate.item.jobUnionId,
      });
      const normalized = normalizeMeituanJob({
        list: candidate.item,
        detail: meituanDetailPayload(detailResult.parsed),
        listItemIndex: candidate.listItemIndex,
        listEvidenceRef: candidate.listFetchId,
        detailEvidenceRef: detailResult.fetchId,
      });
      if (!normalized.applyUrl) throw new Error("OFFICIAL_APPLY_URL_MISSING");
      validateNavigationUrl(normalized.applyUrl, "GET", input.sourceConfig.policy.applyTargets);
      await persistNormalizedOfficialJob({
        db: input.db,
        sourceId: input.sourceId,
        normalized,
        listFetchId: candidate.listFetchId,
        detailFetchId: detailResult.fetchId,
        observedAt: new Date(),
        lease: probeLease(input),
        adapterVersion: MEITUAN_ADAPTER_VERSION,
        normalizerVersion: MEITUAN_NORMALIZER_VERSION,
        deferLastSeenUpdate: input.runMode === "scheduled",
      });
      normalizedCount += 1;
    } catch (error) {
      const code = errorCode(error);
      if (code === "TASK_LEASE_LOST") throw error;
      rejectedCount += 1;
      failureErrorCodes.push(code);
      input.errors.push({ code, message: errorMessage(error) });
    }
  }

  return {
    discoveredCount: candidates.size,
    normalizedCount,
    rejectedCount,
    requestCount: input.budgetUsage.requests,
    reportedTotals,
    failureErrorCodes,
    scopeExhausted: expectedTotal !== undefined && candidates.size >= expectedTotal,
  };
}

async function runNankaiTalAdapterProbe(input: AdapterProbeInput): Promise<AdapterProbeOutput> {
  const response = await safeRequestHtml(
    { method: "GET", url: NANKAI_TAL_SOURCE_URL },
    input.sourceConfig.policy.fetchTargets,
    probeRequestOptions(
      {
        sourceConfig: input.sourceConfig,
        budgetUsage: input.budgetUsage,
        minimumIntervalMs: requestInterval(input),
      },
      "page",
    ),
  );
  const fetchId = await persistHttpResponse({
    ...input,
    crawlRunId: input.crawlRunId,
    response,
    lease: probeLease(input),
  });
  let page: ReturnType<typeof parseNankaiTalPage>;
  try {
    page = parseNankaiTalPage(response.text);
  } catch (error) {
    await markFetchSchemaError(input.db, fetchId, "UPSTREAM_SCHEMA_CHANGED", probeLease(input));
    throw error;
  }

  const roles = page.roles.slice(0, input.limit);
  const failureErrorCodes: string[] = [];
  let normalizedCount = 0;
  let rejectedCount = 0;
  for (const role of roles) {
    try {
      const normalized = normalizeNankaiTalRole({
        role,
        page,
        pageEvidenceRef: fetchId,
      });
      if (!normalized.applyUrl) throw new Error("OFFICIAL_APPLY_URL_MISSING");
      validateNavigationUrl(normalized.applyUrl, "GET", input.sourceConfig.policy.applyTargets);
      await persistNormalizedOfficialJob({
        db: input.db,
        sourceId: input.sourceId,
        normalized,
        listFetchId: fetchId,
        detailFetchId: fetchId,
        observedAt: new Date(),
        lease: probeLease(input),
        adapterVersion: NANKAI_TAL_ADAPTER_VERSION,
        normalizerVersion: NANKAI_TAL_NORMALIZER_VERSION,
        deferLastSeenUpdate: input.runMode === "scheduled",
      });
      normalizedCount += 1;
    } catch (error) {
      const code = errorCode(error);
      if (code === "TASK_LEASE_LOST") throw error;
      rejectedCount += 1;
      failureErrorCodes.push(code);
      input.errors.push({ code, message: errorMessage(error) });
    }
  }

  return {
    discoveredCount: roles.length,
    normalizedCount,
    rejectedCount,
    requestCount: input.budgetUsage.requests,
    reportedTotals: { "operations-roles": page.roles.length },
    failureErrorCodes,
    scopeExhausted: roles.length === page.roles.length,
  };
}

async function runBaiduInternshipsAdapterProbe(
  input: AdapterProbeInput,
): Promise<AdapterProbeOutput> {
  const response = await safeRequestHtml(
    { method: "GET", url: BAIDU_INTERNSHIPS_LIST_URL },
    input.sourceConfig.policy.fetchTargets,
    probeRequestOptions(
      {
        sourceConfig: input.sourceConfig,
        budgetUsage: input.budgetUsage,
        minimumIntervalMs: requestInterval(input),
      },
      "page",
    ),
  );
  const fetchId = await persistHttpResponse({
    ...input,
    crawlRunId: input.crawlRunId,
    response,
    lease: probeLease(input),
  });
  let page: ReturnType<typeof parseBaiduInternshipPage>;
  try {
    page = parseBaiduInternshipPage(response.text);
  } catch (error) {
    await markFetchSchemaError(input.db, fetchId, "UPSTREAM_SCHEMA_CHANGED", probeLease(input));
    throw error;
  }

  const jobs = page.jobs.slice(0, input.limit);
  const failureErrorCodes: string[] = [];
  let normalizedCount = 0;
  let rejectedCount = 0;
  for (const [listItemIndex, job] of jobs.entries()) {
    try {
      const normalized = normalizeBaiduInternship({
        job,
        listItemIndex,
        pageEvidenceRef: fetchId,
      });
      if (!normalized.applyUrl) throw new Error("OFFICIAL_APPLY_URL_MISSING");
      validateNavigationUrl(normalized.applyUrl, "GET", input.sourceConfig.policy.applyTargets);
      await persistNormalizedOfficialJob({
        db: input.db,
        sourceId: input.sourceId,
        normalized,
        listFetchId: fetchId,
        detailFetchId: fetchId,
        observedAt: new Date(),
        lease: probeLease(input),
        adapterVersion: BAIDU_INTERNSHIPS_ADAPTER_VERSION,
        normalizerVersion: BAIDU_INTERNSHIPS_NORMALIZER_VERSION,
        deferLastSeenUpdate: input.runMode === "scheduled",
      });
      normalizedCount += 1;
    } catch (error) {
      const code = errorCode(error);
      if (code === "TASK_LEASE_LOST") throw error;
      rejectedCount += 1;
      failureErrorCodes.push(code);
      input.errors.push({ code, message: errorMessage(error) });
    }
  }

  return {
    discoveredCount: jobs.length,
    normalizedCount,
    rejectedCount,
    requestCount: input.budgetUsage.requests,
    reportedTotals: { "all-function-internships": page.total },
    failureErrorCodes,
    scopeExhausted: jobs.length === page.jobs.length && page.jobs.length >= page.total,
  };
}

async function runJdCampusInternshipsAdapterProbe(
  input: AdapterProbeInput,
): Promise<AdapterProbeOutput> {
  const response = await safeRequestJson(
    {
      method: "POST",
      url: JD_CAMPUS_INTERNSHIPS_LIST_URL,
      jsonBody: buildJdCampusInternshipListRequest({ pageIndex: 0, pageSize: input.limit }),
    },
    input.sourceConfig.policy.fetchTargets,
    probeRequestOptions(
      {
        sourceConfig: input.sourceConfig,
        budgetUsage: input.budgetUsage,
        minimumIntervalMs: requestInterval(input),
      },
      "page",
    ),
  );
  const fetchId = await persistHttpResponse({
    ...input,
    crawlRunId: input.crawlRunId,
    response,
    lease: probeLease(input),
  });
  let page: ReturnType<typeof parseJdCampusInternshipPage>;
  try {
    page = parseJdCampusInternshipPage(response.json);
  } catch (error) {
    await markFetchSchemaError(input.db, fetchId, "UPSTREAM_SCHEMA_CHANGED", probeLease(input));
    throw error;
  }

  const jobs = page.jobs.slice(0, input.limit);
  const failureErrorCodes: string[] = [];
  let normalizedCount = 0;
  let rejectedCount = 0;
  for (const [listItemIndex, job] of jobs.entries()) {
    try {
      const normalized = normalizeJdCampusInternship({
        job,
        listItemIndex,
        pageEvidenceRef: fetchId,
      });
      if (!normalized.applyUrl) throw new Error("OFFICIAL_APPLY_URL_MISSING");
      validateNavigationUrl(normalized.applyUrl, "GET", input.sourceConfig.policy.applyTargets);
      await persistNormalizedOfficialJob({
        db: input.db,
        sourceId: input.sourceId,
        normalized,
        listFetchId: fetchId,
        detailFetchId: fetchId,
        observedAt: new Date(),
        lease: probeLease(input),
        adapterVersion: JD_CAMPUS_INTERNSHIPS_ADAPTER_VERSION,
        normalizerVersion: JD_CAMPUS_INTERNSHIPS_NORMALIZER_VERSION,
        deferLastSeenUpdate: input.runMode === "scheduled",
      });
      normalizedCount += 1;
    } catch (error) {
      const code = errorCode(error);
      if (code === "TASK_LEASE_LOST") throw error;
      rejectedCount += 1;
      failureErrorCodes.push(code);
      input.errors.push({ code, message: errorMessage(error) });
    }
  }

  return {
    discoveredCount: jobs.length,
    normalizedCount,
    rejectedCount,
    requestCount: input.budgetUsage.requests,
    reportedTotals: { "all-function-internships": page.total },
    failureErrorCodes,
    scopeExhausted: jobs.length === page.jobs.length && page.jobs.length >= page.total,
  };
}

async function runFanruanTraineeAdapterProbe(
  input: AdapterProbeInput,
): Promise<AdapterProbeOutput> {
  const candidates: Array<{ job: FanruanTraineeJob; listItemIndex: number; fetchId: string }> = [];
  const failureErrorCodes: string[] = [];
  const reportedTotals: Record<string, number> = {};
  let filteredNonInternship = 0;
  let trackedInternshipConflicts = 0;
  let page = 1;
  let scopeExhausted = false;

  for (;;) {
    const response = await safeRequestHtml(
      {
        method: "POST",
        url: FANRUAN_TRAINEE_LIST_URL,
        formBody: buildFanruanTraineeListFormBody(page),
      },
      input.sourceConfig.policy.fetchTargets,
      probeRequestOptions(
        {
          sourceConfig: input.sourceConfig,
          budgetUsage: input.budgetUsage,
          minimumIntervalMs: requestInterval(input),
        },
        "page",
      ),
    );
    const fetchId = await persistHttpResponse({
      ...input,
      crawlRunId: input.crawlRunId,
      response,
      lease: probeLease(input),
    });
    let parsed: ReturnType<typeof parseFanruanTraineePage>;
    try {
      parsed = parseFanruanTraineePage(response.text);
    } catch (error) {
      await markFetchSchemaError(input.db, fetchId, "UPSTREAM_SCHEMA_CHANGED", probeLease(input));
      throw error;
    }
    reportedTotals["trainee-jobads"] = parsed.dataTotal;

    for (const [listItemIndex, job] of parsed.jobs.entries()) {
      if (!isFanruanInternship(job)) {
        filteredNonInternship += 1;
        const code = await trackedRecordAwareRejectionCode({
          db: input.db,
          sourceId: input.sourceId,
          sourceConfig: input.sourceConfig,
          runMode: input.runMode,
          code: "FANRUAN_NOT_EXPLICIT_INTERNSHIP",
          sourceJobId: job.id,
        });
        if (code === "TRACKED_RECORD_NOT_INTERNSHIP") {
          trackedInternshipConflicts += 1;
          failureErrorCodes.push(code);
          input.errors.push({ code, message: `tracked job ${job.id} is no longer an internship` });
        }
        continue;
      }
      if (candidates.length < input.limit) {
        candidates.push({ job, listItemIndex, fetchId });
      }
    }

    const reachedReportedEnd = page >= parsed.pageTotal || parsed.jobs.length < parsed.pageSize;
    if (candidates.length >= input.limit || reachedReportedEnd) {
      scopeExhausted = reachedReportedEnd;
      break;
    }
    page += 1;
    await updateHeartbeat(input.db, input.taskId, input.leaseOwner, input.fencingToken);
    await delay(requestInterval(input));
  }
  reportedTotals["non-internship-filtered"] = filteredNonInternship;

  let normalizedCount = 0;
  let rejectedCount = trackedInternshipConflicts;
  for (const candidate of candidates) {
    try {
      const normalized = normalizeFanruanTraineeJob({
        job: candidate.job,
        listItemIndex: candidate.listItemIndex,
        pageEvidenceRef: candidate.fetchId,
      });
      if (!normalized.applyUrl) throw new Error("OFFICIAL_APPLY_URL_MISSING");
      validateNavigationUrl(normalized.applyUrl, "GET", input.sourceConfig.policy.applyTargets);
      await persistNormalizedOfficialJob({
        db: input.db,
        sourceId: input.sourceId,
        normalized,
        listFetchId: candidate.fetchId,
        detailFetchId: candidate.fetchId,
        observedAt: new Date(),
        lease: probeLease(input),
        adapterVersion: FANRUAN_TRAINEE_ADAPTER_VERSION,
        normalizerVersion: FANRUAN_TRAINEE_NORMALIZER_VERSION,
        deferLastSeenUpdate: input.runMode === "scheduled",
      });
      normalizedCount += 1;
    } catch (error) {
      const code = errorCode(error);
      if (code === "TASK_LEASE_LOST") throw error;
      rejectedCount += 1;
      failureErrorCodes.push(code);
      input.errors.push({ code, message: errorMessage(error) });
    }
  }

  return {
    discoveredCount: candidates.length,
    normalizedCount,
    rejectedCount,
    requestCount: input.budgetUsage.requests,
    reportedTotals,
    failureErrorCodes,
    scopeExhausted,
  };
}

async function runBeisenZhiyeAdapterProbe(input: AdapterProbeInput): Promise<AdapterProbeOutput> {
  const tenant = resolveBeisenZhiyeTenant(input.sourceConfig);
  const candidates: Array<{ job: BeisenJobAd; listItemIndex: number; fetchId: string }> = [];
  const failureErrorCodes: string[] = [];
  const reportedTotals: Record<string, number> = {};
  let nonInternshipKept = 0;
  const pageSize = 30;
  let pageIndex = 0;
  let scopeExhausted = false;

  for (;;) {
    const response = await safeRequestJson(
      {
        method: "POST",
        url: buildBeisenZhiyeListUrl(tenant),
        jsonBody: buildBeisenZhiyeListRequest({ tenant, pageIndex, pageSize }),
      },
      input.sourceConfig.policy.fetchTargets,
      probeRequestOptions(
        {
          sourceConfig: input.sourceConfig,
          budgetUsage: input.budgetUsage,
          minimumIntervalMs: requestInterval(input),
        },
        "page",
      ),
    );
    const fetchId = await persistHttpResponse({
      ...input,
      crawlRunId: input.crawlRunId,
      response,
      lease: probeLease(input),
    });
    let parsed: ReturnType<typeof parseBeisenZhiyeListPage>;
    try {
      parsed = parseBeisenZhiyeListPage(response.json);
    } catch (error) {
      await markFetchSchemaError(input.db, fetchId, "UPSTREAM_SCHEMA_CHANGED", probeLease(input));
      throw error;
    }
    reportedTotals[tenant.reportedTotalKey] = parsed.total;

    for (const [listItemIndex, job] of parsed.jobs.entries()) {
      // ADR-0035 第一条：非实习岗位**不再跳过**。校招、应届生与管培生同样是在校生可投供给，
      // 此前这里把它们取回后丢弃。仍然计数，用于观察「放开后多收了多少」；筛选已上移到
      // 资格层的 `catalog.job_reachability_verdict`。
      // 一并撤销的还有 `TRACKED_RECORD_NOT_INTERNSHIP`：已跟踪岗位「不再是实习」在新轴下
      // 不是冲突。
      if (!isBeisenExplicitInternship(job)) {
        nonInternshipKept += 1;
      }
      if (candidates.length < input.limit) {
        candidates.push({ job, listItemIndex, fetchId });
      }
    }

    const consumed = (pageIndex + 1) * pageSize;
    const reachedReportedEnd = consumed >= parsed.total || parsed.jobs.length < pageSize;
    if (candidates.length >= input.limit || reachedReportedEnd) {
      scopeExhausted = reachedReportedEnd;
      break;
    }
    pageIndex += 1;
    await updateHeartbeat(input.db, input.taskId, input.leaseOwner, input.fencingToken);
    await delay(requestInterval(input));
  }
  // 观察量而非过滤量：这些岗位现在照常入库，键名记录「多收了多少」。
  reportedTotals["non-internship-kept"] = nonInternshipKept;

  let normalizedCount = 0;
  let rejectedCount = 0;
  for (const candidate of candidates) {
    try {
      const normalized = normalizeBeisenZhiyeJobAd({
        tenant,
        job: candidate.job,
        listItemIndex: candidate.listItemIndex,
        pageEvidenceRef: candidate.fetchId,
      });
      if (!normalized.applyUrl) throw new Error("OFFICIAL_APPLY_URL_MISSING");
      validateNavigationUrl(normalized.applyUrl, "GET", input.sourceConfig.policy.applyTargets);
      await persistNormalizedOfficialJob({
        db: input.db,
        sourceId: input.sourceId,
        normalized,
        listFetchId: candidate.fetchId,
        detailFetchId: candidate.fetchId,
        observedAt: new Date(),
        lease: probeLease(input),
        adapterVersion: BEISEN_ZHIYE_ADAPTER_VERSION,
        normalizerVersion: BEISEN_ZHIYE_NORMALIZER_VERSION,
        deferLastSeenUpdate: input.runMode === "scheduled",
      });
      normalizedCount += 1;
    } catch (error) {
      const code = errorCode(error);
      if (code === "TASK_LEASE_LOST") throw error;
      rejectedCount += 1;
      failureErrorCodes.push(code);
      input.errors.push({ code, message: errorMessage(error) });
    }
  }

  return {
    discoveredCount: candidates.length,
    normalizedCount,
    rejectedCount,
    requestCount: input.budgetUsage.requests,
    reportedTotals,
    failureErrorCodes,
    scopeExhausted,
  };
}

async function runUniversityEmploymentAdapterProbe(
  input: AdapterProbeInput,
): Promise<AdapterProbeOutput> {
  const source = resolveUniversityEmploymentSource(input.sourceConfig);
  const pages = source.pageUrls;
  const failureErrorCodes: string[] = [];
  let normalizedCount = 0;
  let rejectedCount = 0;
  let discoveredCount = 0;
  let visitedPageCount = 0;
  const directClosures: NonNullable<AdapterProbeOutput["directClosures"]> = [];

  for (const [pageIndex, pageUrl] of pages.entries()) {
    if (discoveredCount >= input.limit) break;
    if (pageIndex > 0) {
      await updateHeartbeat(input.db, input.taskId, input.leaseOwner, input.fencingToken);
      await delay(requestInterval(input));
    }
    let response: Awaited<ReturnType<typeof safeRequestHtml>>;
    try {
      response = await safeRequestHtml(
        { method: "GET", url: pageUrl },
        input.sourceConfig.policy.fetchTargets,
        probeRequestOptions(
          {
            sourceConfig: input.sourceConfig,
            budgetUsage: input.budgetUsage,
            minimumIntervalMs: requestInterval(input),
          },
          "page",
        ),
      );
    } catch (error) {
      if (!(error instanceof NetworkPolicyError)) throw error;
      const directReason = directClosureReasonForErrorCode(error.code);
      if (input.runMode !== "scheduled" || !directReason || !error.response) throw error;

      const records = await input.db
        .selectFrom("ingestion.source_job_records")
        .select("id")
        .where("source_id", "=", input.sourceId)
        .where("canonical_source_url", "=", pageUrl)
        .execute();
      if (records.length === 0) throw error;

      await persistHttpResponse({
        ...input,
        crawlRunId: input.crawlRunId,
        response: error.response,
        lease: probeLease(input),
        fetchResult: "http_error",
        errorCode: error.code,
      });
      visitedPageCount += 1;
      discoveredCount += records.length;
      directClosures.push({ recordIds: records.map(({ id }) => id), reason: directReason });
      continue;
    }
    visitedPageCount += 1;
    const fetchId = await persistHttpResponse({
      ...input,
      crawlRunId: input.crawlRunId,
      response,
      lease: probeLease(input),
    });
    let jobs: ReturnType<typeof parseUniversityEmploymentJobs>;
    try {
      jobs = parseUniversityEmploymentJobs({
        format: source.pageFormat,
        html: response.text,
        pageUrl,
      }).slice(0, input.limit - discoveredCount);
    } catch (error) {
      const code = await trackedRecordAwareRejectionCode({
        db: input.db,
        sourceId: input.sourceId,
        sourceConfig: input.sourceConfig,
        runMode: input.runMode,
        code: errorCode(error),
        canonicalSourceUrl: pageUrl,
      });
      await markFetchSchemaError(input.db, fetchId, code, probeLease(input));
      if (code !== errorCode(error)) throw new Error(code);
      throw error;
    }
    discoveredCount += jobs.length;
    for (const job of jobs) {
      try {
        const normalized = normalizeUniversityEmploymentJob({
          source,
          job,
          pageEvidenceRef: fetchId,
        });
        if (normalized.applyUrl) {
          validateNavigationUrl(normalized.applyUrl, "GET", input.sourceConfig.policy.applyTargets);
        } else {
          const applicationEmail = (normalized.structuredFields as Record<string, unknown>)
            .applicationEmail;
          if (typeof applicationEmail !== "string" || applicationEmail.length === 0) {
            throw new Error("UNIVERSITY_EMPLOYMENT_APPLICATION_METHOD_MISSING");
          }
        }
        await persistNormalizedOfficialJob({
          db: input.db,
          sourceId: input.sourceId,
          normalized,
          listFetchId: fetchId,
          detailFetchId: fetchId,
          observedAt: new Date(),
          lease: probeLease(input),
          adapterVersion: UNIVERSITY_EMPLOYMENT_ADAPTER_VERSION,
          normalizerVersion: UNIVERSITY_EMPLOYMENT_NORMALIZER_VERSION,
          deferLastSeenUpdate: input.runMode === "scheduled",
        });
        normalizedCount += 1;
      } catch (error) {
        const code = await trackedRecordAwareRejectionCode({
          db: input.db,
          sourceId: input.sourceId,
          sourceConfig: input.sourceConfig,
          runMode: input.runMode,
          code: errorCode(error),
          sourceJobId: job.sourceJobId,
        });
        if (code === "TASK_LEASE_LOST") throw error;
        rejectedCount += 1;
        failureErrorCodes.push(code);
        input.errors.push({ code, message: errorMessage(error) });
      }
    }
  }

  return {
    discoveredCount,
    normalizedCount,
    rejectedCount,
    requestCount: input.budgetUsage.requests,
    reportedTotals: { "university-detail-pages": source.pageUrls.length },
    failureErrorCodes,
    scopeExhausted: visitedPageCount === source.pageUrls.length,
    directClosures,
  };
}

async function runTencentAdapterProbe(input: AdapterProbeInput): Promise<AdapterProbeOutput> {
  const reportedTotals: Record<string, number> = {};
  const failureErrorCodes: string[] = [];
  const discoveryRejectedCounter = { value: 0 };
  const candidates = await discoverCandidates({
    ...input,
    reportedTotals,
    rejectedCounter: discoveryRejectedCounter,
  });
  let normalizedCount = 0;
  let rejectedCount = discoveryRejectedCounter.value;
  const lease = probeLease(input);

  for (const candidate of candidates.values()) {
    try {
      await updateHeartbeat(input.db, input.taskId, input.leaseOwner, input.fencingToken);
      await delay(requestInterval(input));
      const detail = await fetchDetail({
        db: input.db,
        runtime: input.runtime,
        sourceConfig: input.sourceConfig,
        sourceId: input.sourceId,
        crawlRunId: input.crawlRunId,
        postId: candidate.item.postId,
        lease,
        budgetUsage: input.budgetUsage,
      });
      const normalized = normalizeTencentJob({
        list: candidate.item,
        detail: detail.parsed.data,
        listItemIndex: candidate.listItemIndex,
        entryScope: "日常实习",
        listEvidenceRef: candidate.listFetchId,
        detailEvidenceRef: detail.fetchId,
      });
      if (!normalized.applyUrl) throw new Error("OFFICIAL_APPLY_URL_MISSING");
      validateNavigationUrl(normalized.applyUrl, "GET", input.sourceConfig.policy.applyTargets);
      await persistNormalizedTencentJob({
        db: input.db,
        sourceId: input.sourceId,
        normalized,
        listFetchId: candidate.listFetchId,
        detailFetchId: detail.fetchId,
        observedAt: new Date(),
        lease,
        deferLastSeenUpdate: input.runMode === "scheduled",
      });
      normalizedCount += 1;
    } catch (error) {
      const code = errorCode(error);
      if (code === "TASK_LEASE_LOST") throw error;
      rejectedCount += 1;
      failureErrorCodes.push(code);
      input.errors.push({ code, message: errorMessage(error) });
    }
  }

  return {
    discoveredCount: candidates.size,
    normalizedCount,
    rejectedCount,
    requestCount: input.budgetUsage.requests,
    reportedTotals,
    failureErrorCodes,
    scopeExhausted: false,
  };
}

const adapterProbeHandlers = {
  baidu: runBaiduInternshipsAdapterProbe,
  "beisen-zhiye": runBeisenZhiyeAdapterProbe,
  "fanruan-trainee": runFanruanTraineeAdapterProbe,
  "jd-campus": runJdCampusInternshipsAdapterProbe,
  meituan: runMeituanAdapterProbe,
  "nankai-tal": runNankaiTalAdapterProbe,
  tencent: runTencentAdapterProbe,
  "university-employment": runUniversityEmploymentAdapterProbe,
} satisfies Record<ProbeHandlerKey, (input: AdapterProbeInput) => Promise<AdapterProbeOutput>>;

async function runSourceCrawl(input: {
  db: Kysely<Database>;
  runtime: ProbeRuntimeConfig;
  sourceKey: string;
  limit: number;
  runMode: "probe" | "scheduled";
  window: string;
}): Promise<ProbeResult> {
  if (input.runtime.appEnv !== "local" || !input.runtime.enableSourceProbe) {
    throw new Error("SOURCE_PROBE_LOCAL_ONLY");
  }

  const sourceConfig = await loadSourceConfig(input.sourceKey);
  const descriptor = getOfficialSourceAdapterDescriptor(sourceConfig.policy.adapterKey);
  const assessment = assessSource(sourceConfig);
  const policyStatusAllowed = isSourcePolicyStatusAuthorizedForRun(
    sourceConfig.policy.status,
    input.runMode,
  );
  // 六硬门全过的来源应当走 `scheduled` 周期刷新，而不是一次性 `probe`；与
  // `batch-import.ts` 的 `SOURCE_ALREADY_APPROVED_USE_SCHEDULED_REFRESH` 是同一条规则。
  // 此前它和其余五个条件共用 `INVALID_LOCAL_PROBE_EXCEPTION`，读起来像「越合格越不许探测」。
  if (input.runMode === "probe" && assessment.hardGatesPassed) {
    throw new Error("SOURCE_ALREADY_APPROVED_USE_SCHEDULED_REFRESH");
  }
  if (
    !policyStatusAllowed ||
    !sourceConfig.localProbe.enabled ||
    sourceConfig.candidate.acquisitionMode === "browser_required" ||
    descriptor.probeHandler === null
  ) {
    throw new Error("INVALID_LOCAL_PROBE_EXCEPTION");
  }
  if (
    input.runMode === "scheduled" &&
    (!sourceConfig.policy.crawlInterval.enabled ||
      sourceConfig.policy.refreshCoverage === "manual_snapshot")
  ) {
    throw new Error("SOURCE_SCHEDULED_REFRESH_NOT_AUTHORIZED");
  }
  if (input.limit < 1 || input.limit > sourceConfig.localProbe.requestBudget.maxItems) {
    throw new Error("PROBE_LIMIT_OUT_OF_RANGE");
  }
  for (const target of sourceConfig.policy.fetchTargets) {
    validateUrl(
      `https://${target.host}${target.pathPrefix}`,
      target.method,
      sourceConfig.policy.fetchTargets,
    );
  }

  const registered = await registerSourceConfig(input.db, sourceConfig);
  if (input.runMode === "scheduled") {
    const runtimeState = await input.db
      .selectFrom("source_control.source_runtime_states")
      .select(["automation_paused"])
      .where("source_id", "=", registered.sourceId)
      .executeTakeFirstOrThrow();
    if (runtimeState.automation_paused) throw new Error("SOURCE_AUTOMATION_PAUSED");
  }
  const claimed = await createOrClaimProbeTask({
    db: input.db,
    sourceId: registered.sourceId,
    config: sourceConfig,
    limit: input.limit,
    runMode: input.runMode,
    window: input.window,
  });

  if (claimed.reused) {
    const run = await input.db
      .selectFrom("ingestion.crawl_runs")
      .selectAll()
      .where("id", "=", claimed.runId)
      .executeTakeFirstOrThrow();
    if (input.runMode === "scheduled" && run.automation_acceptance === "accepted") {
      await reconcileAcceptedScheduledCatalog({
        db: input.db,
        sourceId: registered.sourceId,
        policyVersion: sourceConfig.policy.version,
        minimumHours: sourceConfig.policy.crawlInterval.minimumHours,
        completedAt: new Date(run.finished_at ?? run.started_at),
      });
    }
    return {
      reused: true,
      taskId: claimed.taskId,
      runId: claimed.runId,
      completion:
        run.completion === "complete"
          ? "complete"
          : run.completion === "failed"
            ? "failed"
            : "partial",
      discoveredCount: run.discovered_count,
      normalizedCount: run.normalized_count,
      rejectedCount: run.rejected_count,
      errors: (run.error_summary as ProbeResult["errors"]) ?? [],
    };
  }

  const lease: TaskLease = {
    taskId: claimed.taskId,
    leaseOwner: claimed.leaseOwner,
    fencingToken: claimed.fencingToken,
  };
  const runId = randomUUID();
  const runStartedAt = new Date();
  await input.db.transaction().execute(async (transaction) => {
    await assertActiveTaskLease(transaction, lease);
    await transaction
      .insertInto("ingestion.crawl_runs")
      .values({
        id: runId,
        task_id: claimed.taskId,
        source_id: registered.sourceId,
        policy_version: sourceConfig.policy.version,
        adapter_version: sourceConfig.policy.adapterVersion,
        run_mode: input.runMode,
        automation_acceptance: input.runMode === "scheduled" ? "pending" : "not_applicable",
        completion: null,
        reported_totals: canonicalJson({}),
        request_count: 0,
        discovered_count: 0,
        normalized_count: 0,
        rejected_count: 0,
        error_summary: canonicalJson([]),
        started_at: runStartedAt,
        finished_at: null,
      })
      .execute();
  });

  const errors: ProbeResult["errors"] = [];
  const failureErrorCodes: string[] = [];
  const reportedTotals: Record<string, number> = {};
  let discoveredCount = 0;
  let normalizedCount = 0;
  let rejectedCount = 0;
  let requestCount = 0;
  let completion: "complete" | "partial" | "failed" = "failed";
  let scopeExhausted = false;
  let directClosures: NonNullable<AdapterProbeOutput["directClosures"]> = [];
  const budgetUsage: ProbeBudgetUsage = { requests: 0, pages: 0 };
  const baselineRecordCount =
    input.runMode === "scheduled"
      ? Number(
          (
            await input.db
              .selectFrom("ingestion.source_job_records")
              .select(({ fn }) => fn.countAll<number>().as("count"))
              .where("source_id", "=", registered.sourceId)
              .executeTakeFirstOrThrow()
          ).count,
        )
      : 0;

  try {
    const adapterInput: AdapterProbeInput = {
      db: input.db,
      runtime: input.runtime,
      sourceConfig,
      sourceId: registered.sourceId,
      crawlRunId: runId,
      taskId: claimed.taskId,
      leaseOwner: claimed.leaseOwner,
      fencingToken: claimed.fencingToken,
      limit: input.limit,
      errors,
      budgetUsage,
      runMode: input.runMode,
    };

    const output = await adapterProbeHandlers[descriptor.probeHandler](adapterInput);
    discoveredCount = output.discoveredCount;
    normalizedCount = output.normalizedCount;
    rejectedCount = output.rejectedCount;
    requestCount = output.requestCount;
    Object.assign(reportedTotals, output.reportedTotals);
    failureErrorCodes.push(...output.failureErrorCodes);
    scopeExhausted = output.scopeExhausted;
    directClosures = output.directClosures ?? [];
    const directClosureCount = directClosures.reduce(
      (total, closure) => total + closure.recordIds.length,
      0,
    );
    if (directClosureCount > 0) reportedTotals["direct-closed-records"] = directClosureCount;
    completion =
      normalizedCount + directClosureCount > 0
        ? input.runMode === "scheduled" &&
          sourceConfig.policy.refreshCoverage === "full_scope" &&
          scopeExhausted &&
          rejectedCount === 0 &&
          failureErrorCodes.length === 0
          ? "complete"
          : "partial"
        : "failed";
    requestCount = budgetUsage.requests;
  } catch (error) {
    const code = errorCode(error);
    failureErrorCodes.push(code);
    errors.push({ code, message: errorMessage(error) });
    completion = normalizedCount > 0 ? "partial" : "failed";
    requestCount = budgetUsage.requests;
  }

  const hardConflictCodes = [
    ...new Set(errors.map(({ code }) => code).filter(isHardRefreshConflictCode)),
  ];
  if (input.runMode === "scheduled") {
    const previousAcceptedRun = await input.db
      .selectFrom("ingestion.crawl_runs")
      .select("normalized_count")
      .where("source_id", "=", registered.sourceId)
      .where("run_mode", "=", "scheduled")
      .where("automation_acceptance", "=", "accepted")
      .where("id", "!=", runId)
      .orderBy("finished_at", "desc")
      .executeTakeFirst();
    const previousComparableCount = previousAcceptedRun?.normalized_count ?? baselineRecordCount;
    const currentComparableCount =
      normalizedCount +
      directClosures.reduce((total, closure) => total + closure.recordIds.length, 0);
    const emptySuccessfulResponse =
      currentComparableCount === 0 && requestCount > 0 && failureErrorCodes.length === 0;
    if (
      emptySuccessfulResponse ||
      (failureErrorCodes.length === 0 &&
        isRefreshCountAnomaly(previousComparableCount, currentComparableCount))
    ) {
      hardConflictCodes.push("UPSTREAM_COUNT_ANOMALY");
      errors.push({
        code: "UPSTREAM_COUNT_ANOMALY",
        message: `normalized count changed from ${previousComparableCount} to ${currentComparableCount}`,
      });
    }
  }

  const now = new Date();
  const scheduledRetryableFailure =
    input.runMode === "scheduled" && failureErrorCodes.some(isRetryableProbeErrorCode);
  const automationAcceptanceCandidate =
    input.runMode === "scheduled" &&
    completion !== "failed" &&
    hardConflictCodes.length === 0 &&
    !scheduledRetryableFailure;
  const automationPauseCandidate = input.runMode === "scheduled" && hardConflictCodes.length > 0;
  const taskFailed = completion === "failed" || scheduledRetryableFailure;
  const baseFailureTransition =
    taskFailed && !automationPauseCandidate
      ? calculateTaskFailureTransition({
          attempt: claimed.attempt,
          maxAttempts: claimed.maxAttempts,
          errorCodes: failureErrorCodes,
          backoffPolicy: claimed.backoffPolicy,
          now,
        })
      : undefined;
  const automationAccepted = await input.db.transaction().execute(async (transaction) => {
    await assertActiveTaskLease(transaction, lease);
    const scheduledPolicyCurrent =
      input.runMode !== "scheduled" ||
      (await lockScheduledPolicyForAcceptance({
        transaction,
        sourceId: registered.sourceId,
        policyVersion: sourceConfig.policy.version,
        adapterKey: sourceConfig.policy.adapterKey,
        adapterVersion: sourceConfig.policy.adapterVersion,
      }));
    const stalePolicyRejected = input.runMode === "scheduled" && !scheduledPolicyCurrent;
    if (stalePolicyRejected) {
      errors.push({
        code: "SCHEDULED_TASK_POLICY_STALE",
        message: "source policy or adapter changed while the scheduled run was in progress",
      });
    }
    const transactionAutomationAccepted = automationAcceptanceCandidate && scheduledPolicyCurrent;
    const transactionAutomationPaused = automationPauseCandidate && scheduledPolicyCurrent;
    const failureTransition = stalePolicyRejected ? undefined : baseFailureTransition;
    const taskStatus = stalePolicyRejected
      ? "dead"
      : transactionAutomationPaused
        ? "dead"
        : (failureTransition?.status ?? "succeeded");
    const taskError = stalePolicyRejected
      ? errors.find((error) => error.code === "SCHEDULED_TASK_POLICY_STALE")
      : (taskFailed || transactionAutomationPaused) &&
          (hardConflictCodes.length > 0 || failureErrorCodes.length > 0)
        ? errors.find((error) => error.code === (hardConflictCodes[0] ?? failureErrorCodes[0]))
        : undefined;
    await transaction
      .updateTable("ingestion.crawl_runs")
      .set({
        completion,
        reported_totals: canonicalJson(reportedTotals),
        request_count: requestCount,
        discovered_count: discoveredCount,
        normalized_count: normalizedCount,
        rejected_count: rejectedCount,
        error_summary: canonicalJson(errors),
        automation_acceptance:
          input.runMode === "scheduled"
            ? transactionAutomationAccepted
              ? "accepted"
              : "rejected"
            : "not_applicable",
        finished_at: now,
      })
      .where("id", "=", runId)
      .execute();

    const taskUpdate = await transaction
      .updateTable("task_queue.tasks")
      .set({
        status: taskStatus,
        available_at: failureTransition?.availableAt ?? now,
        completed_at: failureTransition ? failureTransition.completedAt : now,
        lease_owner: null,
        lease_until: null,
        heartbeat_at: now,
        last_error_code: taskError?.code ?? null,
        last_error_summary: taskError?.message ?? null,
      })
      .where("id", "=", claimed.taskId)
      .where("lease_owner", "=", claimed.leaseOwner)
      .where("fencing_token", "=", claimed.fencingToken)
      .where("status", "=", "running")
      .executeTakeFirst();
    if (Number(taskUpdate.numUpdatedRows) !== 1) {
      throw new Error("TASK_LEASE_LOST");
    }

    if (input.runMode === "scheduled" && scheduledPolicyCurrent) {
      if (transactionAutomationAccepted) {
        await updateSourceJobActivityAfterRun({
          db: transaction,
          sourceId: registered.sourceId,
          runId,
          observedAt: now,
          completion,
          refreshCoverage: sourceConfig.policy.refreshCoverage,
          absencePolicy: sourceConfig.policy.absencePolicy,
          minimumHours: sourceConfig.policy.crawlInterval.minimumHours,
        });
        for (const closure of directClosures) {
          await applyDirectSourceJobClosures({
            db: transaction,
            recordIds: closure.recordIds,
            runId,
            reason: closure.reason,
            observedAt: now,
          });
        }
        const runtimeUpdate = await transaction
          .updateTable("source_control.source_runtime_states")
          .set({
            freshness_state: "due",
            last_complete_run_at: completion === "complete" ? now : undefined,
            last_successful_run_at: now,
            last_scheduled_run_at: now,
            consecutive_failures: 0,
            last_error_code: null,
            next_due_at: new Date(input.window),
            automation_paused: false,
            automation_pause_reason: null,
            updated_at: now,
          })
          .where("source_id", "=", registered.sourceId)
          .where("policy_version", "=", sourceConfig.policy.version)
          .executeTakeFirst();
        if (Number(runtimeUpdate.numUpdatedRows) !== 1) {
          throw new Error("SOURCE_RUNTIME_POLICY_STALE");
        }
      } else {
        const runtimeUpdate = await transaction
          .updateTable("source_control.source_runtime_states")
          .set({
            freshness_state: transactionAutomationPaused ? "stale" : "due",
            last_scheduled_run_at: now,
            consecutive_failures: sql`consecutive_failures + 1`,
            last_error_code: taskError?.code ?? "SOURCE_REFRESH_FAILED",
            next_due_at: transactionAutomationPaused
              ? null
              : failureTransition?.status === "queued"
                ? new Date(input.window)
                : new Date(
                    now.getTime() +
                      sourceConfig.policy.crawlInterval.minimumHours * 60 * 60 * 1_000,
                  ),
            automation_paused: transactionAutomationPaused,
            automation_pause_reason: transactionAutomationPaused
              ? (hardConflictCodes[0] ?? "SOURCE_REFRESH_HARD_CONFLICT")
              : null,
            updated_at: now,
          })
          .where("source_id", "=", registered.sourceId)
          .where("policy_version", "=", sourceConfig.policy.version)
          .executeTakeFirst();
        if (Number(runtimeUpdate.numUpdatedRows) !== 1) {
          throw new Error("SOURCE_RUNTIME_POLICY_STALE");
        }
      }
    }
    return transactionAutomationAccepted;
  });

  if (automationAccepted) {
    await reconcileAcceptedScheduledCatalog({
      db: input.db,
      sourceId: registered.sourceId,
      policyVersion: sourceConfig.policy.version,
      minimumHours: sourceConfig.policy.crawlInterval.minimumHours,
      completedAt: now,
    });
  }

  return {
    reused: false,
    taskId: claimed.taskId,
    runId,
    completion,
    discoveredCount,
    normalizedCount,
    rejectedCount,
    errors,
  };
}

export async function runSourceProbe(input: {
  db: Kysely<Database>;
  runtime: ProbeRuntimeConfig;
  sourceKey: string;
  limit: number;
  liveProbeApproved: boolean;
}): Promise<ProbeResult> {
  if (input.runtime.appEnv !== "test" && !input.liveProbeApproved) {
    throw new Error("SOURCE_PROBE_LIVE_CONFIRMATION_REQUIRED");
  }
  return runSourceCrawl({
    ...input,
    runMode: "probe",
    window: new Date().toISOString().slice(0, 13),
  });
}

export async function runScheduledSourceRefresh(input: {
  db: Kysely<Database>;
  runtime: ProbeRuntimeConfig;
  sourceKey: string;
  limit: number;
  dueWindow: string;
}): Promise<ProbeResult> {
  return runSourceCrawl({ ...input, runMode: "scheduled", window: input.dueWindow });
}
