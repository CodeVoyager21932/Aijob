import { randomUUID } from "node:crypto";
import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { ZodError, z } from "zod";
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
import { assertConfiguredAdapterVersion } from "../sources/official-source-adapters.js";
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
  completion: "partial" | "failed";
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

async function persistHttpResponse(input: {
  db: Kysely<Database>;
  runtime: ProbeRuntimeConfig;
  sourceConfig: SourceConfig;
  sourceId: string;
  crawlRunId: string;
  response: SafeHttpResult;
  lease: TaskLease;
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
  });
}

async function createOrClaimProbeTask(input: {
  db: Kysely<Database>;
  sourceId: string;
  config: SourceConfig;
  limit: number;
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
  const { db, sourceId, config, limit } = input;
  const window = new Date().toISOString().slice(0, 13);
  const idempotencyKey = hashCanonicalJson({
    taskType: "crawl",
    sourceId,
    policyVersion: config.policy.version,
    adapterVersion: config.policy.adapterVersion,
    runMode: "probe",
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
      run_mode: "probe",
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
}

interface AdapterProbeOutput {
  discoveredCount: number;
  normalizedCount: number;
  rejectedCount: number;
  requestCount: number;
  reportedTotals: Record<string, number>;
  failureErrorCodes: string[];
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
  };
}

async function runFanruanTraineeAdapterProbe(
  input: AdapterProbeInput,
): Promise<AdapterProbeOutput> {
  const candidates: Array<{ job: FanruanTraineeJob; listItemIndex: number; fetchId: string }> = [];
  const failureErrorCodes: string[] = [];
  const reportedTotals: Record<string, number> = {};
  let filteredNonInternship = 0;
  let page = 1;

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
        continue;
      }
      if (candidates.length < input.limit) {
        candidates.push({ job, listItemIndex, fetchId });
      }
    }

    if (
      candidates.length >= input.limit ||
      page >= parsed.pageTotal ||
      parsed.jobs.length < parsed.pageSize
    ) {
      break;
    }
    page += 1;
    await updateHeartbeat(input.db, input.taskId, input.leaseOwner, input.fencingToken);
    await delay(requestInterval(input));
  }
  reportedTotals["non-internship-filtered"] = filteredNonInternship;

  let normalizedCount = 0;
  let rejectedCount = 0;
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
  };
}

async function runBeisenZhiyeAdapterProbe(input: AdapterProbeInput): Promise<AdapterProbeOutput> {
  const tenant = resolveBeisenZhiyeTenant(input.sourceConfig.sourceKey);
  const candidates: Array<{ job: BeisenJobAd; listItemIndex: number; fetchId: string }> = [];
  const failureErrorCodes: string[] = [];
  const reportedTotals: Record<string, number> = {};
  let filteredNonInternship = 0;
  const pageSize = 30;
  let pageIndex = 0;

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
      if (!isBeisenExplicitInternship(job)) {
        filteredNonInternship += 1;
        continue;
      }
      if (candidates.length < input.limit) {
        candidates.push({ job, listItemIndex, fetchId });
      }
    }

    const consumed = (pageIndex + 1) * pageSize;
    if (
      candidates.length >= input.limit ||
      consumed >= parsed.total ||
      parsed.jobs.length < pageSize
    ) {
      break;
    }
    pageIndex += 1;
    await updateHeartbeat(input.db, input.taskId, input.leaseOwner, input.fencingToken);
    await delay(requestInterval(input));
  }
  reportedTotals["non-internship-filtered"] = filteredNonInternship;

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
  };
}

async function runUniversityEmploymentAdapterProbe(
  input: AdapterProbeInput,
): Promise<AdapterProbeOutput> {
  const source = resolveUniversityEmploymentSource(input.sourceConfig.sourceKey);
  const pages = source.pageUrls;
  const failureErrorCodes: string[] = [];
  let normalizedCount = 0;
  let rejectedCount = 0;
  let discoveredCount = 0;

  for (const [pageIndex, pageUrl] of pages.entries()) {
    if (discoveredCount >= input.limit) break;
    if (pageIndex > 0) {
      await updateHeartbeat(input.db, input.taskId, input.leaseOwner, input.fencingToken);
      await delay(requestInterval(input));
    }
    const response = await safeRequestHtml(
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
      await markFetchSchemaError(input.db, fetchId, "UPSTREAM_SCHEMA_CHANGED", probeLease(input));
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
  }

  return {
    discoveredCount,
    normalizedCount,
    rejectedCount,
    requestCount: input.budgetUsage.requests,
    reportedTotals: { "university-detail-pages": source.pageUrls.length },
    failureErrorCodes,
  };
}

export async function runSourceProbe(input: {
  db: Kysely<Database>;
  runtime: ProbeRuntimeConfig;
  sourceKey: string;
  limit: number;
}): Promise<ProbeResult> {
  if (input.runtime.appEnv !== "local" || !input.runtime.enableSourceProbe) {
    throw new Error("SOURCE_PROBE_LOCAL_ONLY");
  }

  const sourceConfig = await loadSourceConfig(input.sourceKey);
  const assessment = assessSource(sourceConfig);
  if (
    sourceConfig.policy.status !== "pending_review" ||
    assessment.hardGatesPassed ||
    !sourceConfig.localProbe.enabled ||
    sourceConfig.candidate.acquisitionMode === "browser_required"
  ) {
    throw new Error("INVALID_LOCAL_PROBE_EXCEPTION");
  }
  if (input.limit < 1 || input.limit > sourceConfig.localProbe.requestBudget.maxItems) {
    throw new Error("PROBE_LIMIT_OUT_OF_RANGE");
  }
  assertConfiguredAdapterVersion(
    sourceConfig.policy.adapterKey,
    sourceConfig.policy.adapterVersion,
  );

  for (const target of sourceConfig.policy.fetchTargets) {
    validateUrl(
      `https://${target.host}${target.pathPrefix}`,
      target.method,
      sourceConfig.policy.fetchTargets,
    );
  }

  const registered = await registerSourceConfig(input.db, sourceConfig);
  const claimed = await createOrClaimProbeTask({
    db: input.db,
    sourceId: registered.sourceId,
    config: sourceConfig,
    limit: input.limit,
  });

  if (claimed.reused) {
    const run = await input.db
      .selectFrom("ingestion.crawl_runs")
      .selectAll()
      .where("id", "=", claimed.runId)
      .executeTakeFirstOrThrow();
    return {
      reused: true,
      taskId: claimed.taskId,
      runId: claimed.runId,
      completion: run.completion === "failed" ? "failed" : "partial",
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
        run_mode: "probe",
        completion: null,
        reported_totals: canonicalJson({}),
        request_count: 0,
        discovered_count: 0,
        normalized_count: 0,
        rejected_count: 0,
        error_summary: canonicalJson([]),
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
  let completion: "partial" | "failed" = "failed";
  const budgetUsage: ProbeBudgetUsage = { requests: 0, pages: 0 };

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
    };

    if (sourceConfig.policy.adapterKey === "tencent-public-api") {
      const discoveryRejectedCounter = { value: 0 };
      const candidates = await discoverCandidates({
        ...adapterInput,
        reportedTotals,
        rejectedCounter: discoveryRejectedCounter,
      });
      discoveredCount = candidates.size;
      rejectedCount += discoveryRejectedCounter.value;

      for (const candidate of candidates.values()) {
        try {
          await updateHeartbeat(input.db, claimed.taskId, claimed.leaseOwner, claimed.fencingToken);
          await delay(requestInterval(adapterInput));
          const detail = await fetchDetail({
            db: input.db,
            runtime: input.runtime,
            sourceConfig,
            sourceId: registered.sourceId,
            crawlRunId: runId,
            postId: candidate.item.postId,
            lease,
            budgetUsage,
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
          validateNavigationUrl(normalized.applyUrl, "GET", sourceConfig.policy.applyTargets);
          await persistNormalizedTencentJob({
            db: input.db,
            sourceId: registered.sourceId,
            normalized,
            listFetchId: candidate.listFetchId,
            detailFetchId: detail.fetchId,
            observedAt: new Date(),
            lease,
          });
          normalizedCount += 1;
        } catch (error) {
          const code = errorCode(error);
          if (code === "TASK_LEASE_LOST") throw error;
          rejectedCount += 1;
          failureErrorCodes.push(code);
          errors.push({ code, message: errorMessage(error) });
        }
      }
    } else {
      const output =
        sourceConfig.policy.adapterKey === "meituan-public-api"
          ? await runMeituanAdapterProbe(adapterInput)
          : sourceConfig.policy.adapterKey === "nankai-tal-deterministic-html"
            ? await runNankaiTalAdapterProbe(adapterInput)
            : sourceConfig.policy.adapterKey === "baidu-ssr-deterministic-html"
              ? await runBaiduInternshipsAdapterProbe(adapterInput)
              : sourceConfig.policy.adapterKey === "jd-campus-public-api"
                ? await runJdCampusInternshipsAdapterProbe(adapterInput)
                : sourceConfig.policy.adapterKey === "fanruan-trainee-public-api"
                  ? await runFanruanTraineeAdapterProbe(adapterInput)
                  : sourceConfig.policy.adapterKey === "beisen-zhiye-public-api"
                    ? await runBeisenZhiyeAdapterProbe(adapterInput)
                    : sourceConfig.policy.adapterKey === "university-employment-detail-html"
                      ? await runUniversityEmploymentAdapterProbe(adapterInput)
                      : (() => {
                          throw new Error("ADAPTER_NOT_IMPLEMENTED");
                        })();
      discoveredCount = output.discoveredCount;
      normalizedCount = output.normalizedCount;
      rejectedCount = output.rejectedCount;
      requestCount = output.requestCount;
      Object.assign(reportedTotals, output.reportedTotals);
      failureErrorCodes.push(...output.failureErrorCodes);
    }
    completion = normalizedCount > 0 ? "partial" : "failed";
    requestCount = budgetUsage.requests;
  } catch (error) {
    const code = errorCode(error);
    failureErrorCodes.push(code);
    errors.push({ code, message: errorMessage(error) });
    completion = normalizedCount > 0 ? "partial" : "failed";
    requestCount = budgetUsage.requests;
  }

  const now = new Date();
  const failureTransition =
    completion === "failed"
      ? calculateTaskFailureTransition({
          attempt: claimed.attempt,
          maxAttempts: claimed.maxAttempts,
          errorCodes: failureErrorCodes,
          backoffPolicy: claimed.backoffPolicy,
          now,
        })
      : undefined;
  const taskStatus = failureTransition?.status ?? "succeeded";
  const taskError =
    completion === "failed" && failureErrorCodes.length
      ? errors.find((error) => error.code === failureErrorCodes[0])
      : undefined;
  await input.db.transaction().execute(async (transaction) => {
    await assertActiveTaskLease(transaction, lease);
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
  });

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
