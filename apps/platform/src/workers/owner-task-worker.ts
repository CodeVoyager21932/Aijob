import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import { MatchRunTaskPayloadSchema } from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, type Selectable, sql, type Transaction } from "kysely";
import { z } from "zod";
import { processAssistantTurn } from "../ai/assistant-service.js";
import { processUserAiTest } from "../ai/user-ai-test.js";
import { isActiveOwnerEpochState } from "../identity/session-repository.js";
import { processMatchRun, processRecommendationRun } from "../matching/service.js";
import { processOpportunityDigest, scheduleOpportunityDigests } from "../opportunities/digests.js";
import { syncDiscoveryDemand } from "../opportunities/subscriptions.js";
import {
  processUserDiscovery,
  scheduleUserDiscovery,
  UserDiscoveryPayloadSchema,
} from "../opportunities/user-discovery-worker.js";
import { processOwnerDeletion } from "../profile/deletion-service.js";
import {
  OWNER_RETENTION_MAINTENANCE_INTERVAL_MS,
  runOwnerRetentionMaintenance,
} from "../profile/retention-service.js";
import { processResumeAnalysis, purgeExpiredResumeContent } from "../resume/analysis-service.js";
import { processResumeReview, processResumeReviewV2 } from "../resume-documents/review-service.js";
import { processStudioImport } from "../resume-documents/studio-import.js";
import { purgeExpiredResumeExports } from "../tailoring/export-retention.js";
import { processResumeExport, processTailoringRun } from "../tailoring/service.js";
import { type OwnerTaskLease, OwnerTaskLeaseLostError } from "./owner-task-lease.js";

const LEASE_MS = 60_000;
const HEARTBEAT_MS = 10_000;
const OWNER_TASK_TYPES = [
  "user_source_discovery",
  "opportunity_digest",
  "resume_analysis",
  "match_run",
  "recommendation_run",
  "resume_tailoring",
  "resume_export",
  "resume_review",
  "resume_review_v2",
  "resume_studio_import",
  "career_assistant",
  "ai_connection_test",
  "owner_deletion",
] as const;

type TaskRow = Selectable<Database["task_queue.tasks"]>;

const RunPayloadSchema = z.object({ runId: z.string().trim().min(1) });
const AnalysisPayloadSchema = z.object({ analysisId: z.string().trim().min(1) });
const ExportPayloadSchema = z.object({ exportId: z.string().trim().min(1) });
const DeletionPayloadSchema = z.object({ deletionId: z.string().trim().min(1) });

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

/** Reflect exhausted tasks in their user-facing object; never revive deleted owners or overwrite a new retry. */
async function reflectExhaustedTasks(
  db: Kysely<Database> | Transaction<Database>,
  ownerIds?: readonly string[],
) {
  const ownerFilter = ownerIds ? sql`q.owner_id=ANY(${[...ownerIds]}::uuid[])` : sql`true`;
  await sql`UPDATE profile.discovery_settings d SET capability='temporary_failure',capability_code='OWNER_TASK_ATTEMPTS_EXHAUSTED',checked_at=now()
    FROM task_queue.tasks q,identity.owners o WHERE ${ownerFilter} AND q.task_type='user_source_discovery' AND q.status='dead'
      AND d.id::text=q.payload->>'settingsId' AND d.revision::text=q.payload->>'revision' AND d.capability='queued'
      AND d.owner_id=q.owner_id AND d.owner_epoch=q.owner_epoch AND o.id=d.owner_id AND o.epoch=d.owner_epoch AND o.status='active'
      AND (o.retention_expires_at IS NULL OR o.retention_expires_at>now())`.execute(db);
  await sql`UPDATE profile.assistant_turns t SET status='failed',failure_code='OWNER_TASK_ATTEMPTS_EXHAUSTED',completed_at=now()
    FROM task_queue.tasks q,identity.owners o WHERE ${ownerFilter} AND q.task_type='career_assistant' AND q.status='dead'
      AND t.id::text=q.payload->>'turnId' AND t.owner_id=q.owner_id AND t.owner_epoch=q.owner_epoch AND t.status='queued'
      AND o.id=t.owner_id AND o.epoch=t.owner_epoch AND o.status='active' AND (o.retention_expires_at IS NULL OR o.retention_expires_at>now())
      AND NOT EXISTS(SELECT 1 FROM task_queue.tasks newer WHERE newer.task_type=q.task_type AND newer.owner_id=q.owner_id AND newer.owner_epoch=q.owner_epoch AND newer.payload->>'turnId'=q.payload->>'turnId' AND newer.status IN ('queued','running'))`.execute(
    db,
  );
  await sql`UPDATE profile.ai_connections c SET test_status='failed',test_error='OWNER_TASK_ATTEMPTS_EXHAUSTED',tested_at=now()
    FROM task_queue.tasks q,identity.owners o WHERE ${ownerFilter} AND q.task_type='ai_connection_test' AND q.status='dead'
      AND c.owner_id=q.owner_id AND c.owner_epoch=q.owner_epoch AND c.id::text=q.payload->>'connectionId' AND c.revision::text=q.payload->>'revision' AND c.test_status='queued'
      AND o.id=c.owner_id AND o.epoch=c.owner_epoch AND o.status='active' AND (o.retention_expires_at IS NULL OR o.retention_expires_at>now())
      AND NOT EXISTS(SELECT 1 FROM task_queue.tasks newer WHERE newer.task_type=q.task_type AND newer.owner_id=q.owner_id AND newer.owner_epoch=q.owner_epoch AND newer.payload=q.payload AND newer.status IN ('queued','running'))`.execute(
    db,
  );
  await sql`UPDATE profile.resume_originals r SET status='failed',failure_code='OWNER_TASK_ATTEMPTS_EXHAUSTED'
    FROM task_queue.tasks q,identity.owners o WHERE ${ownerFilter} AND q.task_type='resume_studio_import' AND q.status='dead'
      AND r.id::text=q.payload->>'originalId' AND r.owner_id=q.owner_id AND r.owner_epoch=q.owner_epoch AND r.status='queued'
      AND o.id=r.owner_id AND o.epoch=r.owner_epoch AND o.status='active' AND (o.retention_expires_at IS NULL OR o.retention_expires_at>now())`.execute(
    db,
  );
}

async function recoverExhaustedOwnerTasks(
  transaction: Kysely<Database> | Transaction<Database>,
  now: Date,
  ownerIds?: readonly string[],
) {
  await transaction
    .updateTable("task_queue.tasks")
    .set({
      status: "dead",
      lease_owner: null,
      lease_until: null,
      heartbeat_at: now,
      completed_at: now,
      last_error_code: "OWNER_TASK_ATTEMPTS_EXHAUSTED",
      last_error_summary: null,
    })
    .where("task_type", "in", OWNER_TASK_TYPES)
    .$if(ownerIds !== undefined, (qb) => qb.where("owner_id", "in", ownerIds ?? []))
    .where((expression) => expression("attempt", ">=", expression.ref("max_attempts")))
    .where((expression) =>
      expression.or([
        expression("status", "=", "queued"),
        expression.and([expression("status", "=", "running"), expression("lease_until", "<", now)]),
      ]),
    )
    .execute();
  await reflectExhaustedTasks(transaction, ownerIds);
}

async function claimTask(
  db: Kysely<Database>,
  workerId: string,
  now: Date,
  taskTypes: readonly (typeof OWNER_TASK_TYPES)[number][] = OWNER_TASK_TYPES,
  ownerIds?: readonly string[],
  recoverInline = true,
): Promise<TaskRow | null> {
  if (ownerIds?.length === 0) return null;
  return db.transaction().execute(async (transaction) => {
    if (recoverInline) await recoverExhaustedOwnerTasks(transaction, now, ownerIds);
    if (taskTypes.length === 0) return null;
    const candidate = await transaction
      .selectFrom("task_queue.tasks")
      .select("id")
      .where("task_type", "in", taskTypes)
      .$if(ownerIds !== undefined, (qb) => qb.where("owner_id", "in", ownerIds ?? []))
      .where((expression) => expression("attempt", "<", expression.ref("max_attempts")))
      .where((expression) =>
        expression.or([
          expression.and([
            expression("status", "=", "queued"),
            expression("available_at", "<=", now),
          ]),
          expression.and([
            expression("status", "=", "running"),
            expression("lease_until", "<", now),
          ]),
        ]),
      )
      .orderBy("available_at", "asc")
      .orderBy("created_at", "asc")
      // executeTakeFirst only discards returned rows; LIMIT must bound database locks.
      .limit(1)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!candidate) return null;
    return (
      (await transaction
        .updateTable("task_queue.tasks")
        .set((expression) => ({
          status: "running",
          attempt: expression("attempt", "+", 1),
          lease_owner: workerId,
          lease_until: new Date(now.getTime() + LEASE_MS),
          heartbeat_at: now,
          fencing_token: expression("fencing_token", "+", 1),
          last_error_code: null,
          last_error_summary: null,
        }))
        .where("id", "=", candidate.id)
        .returningAll()
        .executeTakeFirst()) ?? null
    );
  });
}

async function ownerStillActive(db: Kysely<Database>, task: TaskRow): Promise<boolean> {
  if (!task.owner_id || task.owner_epoch === null) return false;
  const now = new Date();
  const owner = await db
    .selectFrom("identity.owners")
    .select(["status", "epoch", "retention_mode", "retention_expires_at"])
    .where("id", "=", task.owner_id)
    .executeTakeFirst();
  return isActiveOwnerEpochState(owner, Number(task.owner_epoch), now);
}

async function taskLeaseStillHeld(
  db: Kysely<Database>,
  task: TaskRow,
  workerId: string,
  now = new Date(),
): Promise<boolean> {
  const current = await db
    .selectFrom("task_queue.tasks")
    .select(["status", "lease_owner", "lease_until", "fencing_token"])
    .where("id", "=", task.id)
    .executeTakeFirst();
  return (
    current?.status === "running" &&
    current.lease_owner === workerId &&
    Number(current.fencing_token) === Number(task.fencing_token) &&
    current.lease_until !== null &&
    new Date(current.lease_until).getTime() > now.getTime()
  );
}

function watchOwnerTaskValidity(input: {
  db: Kysely<Database>;
  task: TaskRow;
  workerId: string;
  controller: AbortController;
  intervalMs?: number;
}): NodeJS.Timeout {
  const timer = setInterval(() => {
    void (async () => {
      if (input.controller.signal.aborted) return;
      const leaseHeld = await taskLeaseStillHeld(input.db, input.task, input.workerId);
      const ownerValid =
        input.task.task_type === "owner_deletion" || (await ownerStillActive(input.db, input.task));
      if (!leaseHeld || !ownerValid) input.controller.abort();
    })().catch(() => input.controller.abort());
  }, input.intervalMs ?? 250);
  timer.unref();
  return timer;
}

async function dispatchTask(
  db: Kysely<Database>,
  config: AppConfig,
  task: TaskRow,
  signal?: AbortSignal,
  fetchImpl?: typeof fetch,
): Promise<void> {
  if (!task.owner_id || task.owner_epoch === null) {
    throw new Error("OWNER_TASK_CONTEXT_MISSING");
  }
  const owner = {
    ownerId: task.owner_id,
    ownerEpoch: Number(task.owner_epoch),
  };
  if (!task.lease_owner) {
    throw new Error("OWNER_TASK_LEASE_MISSING");
  }
  const lease: OwnerTaskLease = {
    taskId: task.id,
    taskType: task.task_type,
    ownerId: owner.ownerId,
    ownerEpoch: owner.ownerEpoch,
    leaseOwner: task.lease_owner,
    fencingToken: Number(task.fencing_token),
  };

  if (task.task_type !== "owner_deletion" && !(await ownerStillActive(db, task))) {
    throw new Error("OWNER_EPOCH_STALE");
  }

  switch (task.task_type) {
    case "user_source_discovery": {
      await processUserDiscovery({
        db,
        owner,
        config,
        lease,
        signal,
        fetchImpl,
        payload: UserDiscoveryPayloadSchema.parse(task.payload),
      });
      return;
    }
    case "opportunity_digest": {
      if (config.opportunityDigestEnabled === false) return;
      const payload = z
        .object({
          searchId: z.string().uuid(),
          revision: z.number().int().positive(),
          localDate: z.string().date(),
        })
        .parse(task.payload);
      await processOpportunityDigest({ db, lease, ...payload, local: config.enableLocalMvp });
      return;
    }
    case "ai_connection_test": {
      const payload = z
        .object({ revision: z.number().int().positive(), connectionId: z.string().uuid() })
        .parse(task.payload);
      await processUserAiTest({ db, owner, ...payload, config, lease, signal, fetchImpl });
      return;
    }
    case "career_assistant": {
      const payload = z
        .object({ sessionId: z.string().uuid(), turnId: z.string().uuid() })
        .parse(task.payload);
      await processAssistantTurn({ db, owner, ...payload, config, lease, signal, fetchImpl });
      return;
    }
    case "resume_studio_import": {
      const payload = z
        .object({
          originalId: z.string().uuid(),
          documentId: z.string().uuid(),
          expectedRevision: z.number().int(),
          editorCore: z.literal("native-v1").optional(),
        })
        .parse(task.payload);
      const processImport =
        payload.editorCore === "native-v1"
          ? (await import("../resume-documents/native-import.js")).processNativeImport
          : processStudioImport;
      await processImport({
        db,
        owner,
        ...payload,
        config,
        lease,
        ...(signal ? { signal } : {}),
      });
      return;
    }
    case "resume_analysis": {
      const { analysisId } = AnalysisPayloadSchema.parse(task.payload);
      await processResumeAnalysis({
        db,
        analysisId,
        ownerId: owner.ownerId,
        ownerEpoch: owner.ownerEpoch,
        encryptionKey: config.resumeEncryptionKey,
        lease,
        ...(config.resumeParser
          ? {
              parserSandbox: {
                mode: config.resumeParser.mode,
                ...(config.resumeParser.containerImage
                  ? { containerImage: config.resumeParser.containerImage }
                  : {}),
              },
            }
          : {}),
        ...(signal === undefined ? {} : { signal }),
      });
      return;
    }
    case "match_run": {
      const payload = MatchRunTaskPayloadSchema.parse(task.payload);
      await processMatchRun(db, owner, payload.runId, lease, {
        enableLocalMvp: config.enableLocalMvp,
        ...("executionContext" in payload ? { executionContext: payload.executionContext } : {}),
      });
      return;
    }
    case "recommendation_run": {
      const { runId } = RunPayloadSchema.parse(task.payload);
      await processRecommendationRun(db, owner, runId, lease, {
        enableLocalMvp: config.enableLocalMvp,
      });
      return;
    }
    case "resume_tailoring": {
      const { runId } = RunPayloadSchema.parse(task.payload);
      await processTailoringRun(db, config, owner, runId, lease, fetchImpl, signal);
      return;
    }
    case "resume_export": {
      const { exportId } = ExportPayloadSchema.parse(task.payload);
      await processResumeExport(db, config, owner, exportId, lease);
      return;
    }
    case "resume_review": {
      const { runId } = RunPayloadSchema.parse(task.payload);
      await processResumeReview(db, owner, runId, lease);
      return;
    }
    case "resume_review_v2": {
      const { runId } = RunPayloadSchema.parse(task.payload);
      await processResumeReviewV2(db, config, owner, runId, lease, fetchImpl, signal);
      return;
    }
    case "owner_deletion": {
      const { deletionId } = DeletionPayloadSchema.parse(task.payload);
      await processOwnerDeletion({
        db,
        deletionId,
        ownerId: owner.ownerId,
        requestedOwnerEpoch: owner.ownerEpoch,
        lease,
      });
      return;
    }
    default:
      throw new Error("OWNER_TASK_TYPE_UNSUPPORTED");
  }
}

export async function finishOwnerTask(
  db: Kysely<Database>,
  task: TaskRow,
  workerId: string,
  now = new Date(),
): Promise<void> {
  const result = await db
    .updateTable("task_queue.tasks")
    .set({
      status: "succeeded",
      lease_owner: null,
      lease_until: null,
      heartbeat_at: now,
      completed_at: now,
    })
    .where("id", "=", task.id)
    .where("lease_owner", "=", workerId)
    .where("fencing_token", "=", task.fencing_token)
    .where("status", "=", "running")
    .where("lease_until", ">", now)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) {
    throw new OwnerTaskLeaseLostError();
  }
}

export async function failOwnerTask(
  db: Kysely<Database>,
  task: TaskRow,
  workerId: string,
  error: unknown,
  now = new Date(),
): Promise<void> {
  // Capacity waiting never reached the provider and must not consume a retry.
  const capacityWait =
    (task.task_type === "career_assistant" ||
      task.task_type === "ai_connection_test" ||
      task.task_type === "user_source_discovery") &&
    error instanceof Error &&
    "code" in error &&
    error.code === "AI_CONCURRENCY_LIMIT";
  const exhausted = !capacityWait && task.attempt >= task.max_attempts;
  const errorCode =
    error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "OWNER_TASK_FAILED";
  const result = await db
    .updateTable("task_queue.tasks")
    .set({
      status: exhausted ? "dead" : "queued",
      attempt: capacityWait ? task.attempt - 1 : task.attempt,
      available_at: exhausted
        ? now
        : new Date(
            now.getTime() + (capacityWait ? 1000 : Math.min(30_000, 2 ** task.attempt * 1_000)),
          ),
      lease_owner: null,
      lease_until: null,
      heartbeat_at: now,
      last_error_code: capacityWait ? "AI_CONCURRENCY_LIMIT" : errorCode,
      last_error_summary: null,
      completed_at: exhausted ? now : null,
    })
    .where("id", "=", task.id)
    .where("lease_owner", "=", workerId)
    .where("fencing_token", "=", task.fencing_token)
    .where("status", "=", "running")
    .where("lease_until", ">", now)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) {
    throw new OwnerTaskLeaseLostError();
  }
}

export async function renewOwnerTaskLease(
  db: Kysely<Database>,
  task: TaskRow,
  workerId: string,
  now = new Date(),
): Promise<void> {
  const result = await db
    .updateTable("task_queue.tasks")
    .set({
      heartbeat_at: now,
      lease_until: new Date(now.getTime() + LEASE_MS),
    })
    .where("id", "=", task.id)
    .where("lease_owner", "=", workerId)
    .where("fencing_token", "=", task.fencing_token)
    .where("status", "=", "running")
    .where("lease_until", ">", now)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) {
    throw new OwnerTaskLeaseLostError();
  }
}

function heartbeat(
  db: Kysely<Database>,
  task: TaskRow,
  workerId: string,
  controller: AbortController,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    void renewOwnerTaskLease(db, task, workerId).catch(() => controller.abort());
  }, HEARTBEAT_MS);
  timer.unref();
  return timer;
}

export async function runOneOwnerTask(input: {
  db: Kysely<Database>;
  config: AppConfig;
  workerId?: string;
  now?: Date;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  taskTypes?: readonly (typeof OWNER_TASK_TYPES)[number][];
  ownerIds?: readonly string[];
  /** The long-running worker performs recovery once in its maintenance loop. */
  recoveryManagedByWorker?: boolean;
}): Promise<boolean> {
  if (input.signal?.aborted) return false;
  const workerId = input.workerId ?? `match-worker-${randomUUID()}`;
  const task = await claimTask(
    input.db,
    workerId,
    input.now ?? new Date(),
    input.taskTypes,
    input.ownerIds,
    !input.recoveryManagedByWorker,
  );
  if (!task) return false;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (input.signal?.aborted) {
    controller.abort();
  } else {
    input.signal?.addEventListener("abort", onAbort, { once: true });
  }
  const timer = heartbeat(input.db, task, workerId, controller);
  const validityTimer = watchOwnerTaskValidity({
    db: input.db,
    task,
    workerId,
    controller,
  });
  try {
    await dispatchTask(input.db, input.config, task, controller.signal, input.fetchImpl);
    await finishOwnerTask(input.db, task, workerId);
  } catch (error) {
    if (!(error instanceof OwnerTaskLeaseLostError)) {
      try {
        await failOwnerTask(input.db, task, workerId, error);
      } catch (failureError) {
        if (!(failureError instanceof OwnerTaskLeaseLostError)) throw failureError;
      }
    }
  } finally {
    clearInterval(timer);
    clearInterval(validityTimer);
    input.signal?.removeEventListener("abort", onAbort);
  }
  return true;
}

export async function runOwnerTaskWorker(input: {
  db: Kysely<Database>;
  config: AppConfig;
  signal: AbortSignal;
  idleDelayMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const workerId = `match-worker-${randomUUID()}`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) abort();
  const interactive = ["career_assistant", "ai_connection_test"] as const;
  const parsing = ["resume_studio_import", "resume_analysis"] as const;
  const background = OWNER_TASK_TYPES.filter(
    (t) => !([...interactive, ...parsing] as readonly string[]).includes(t),
  );
  // Reserve interactive capacity so an isolated parser/export cannot hold up a conversation.
  const lanes: readonly (readonly (typeof OWNER_TASK_TYPES)[number][])[] = [
    ...Array.from({ length: input.config.ownerTaskInteractiveConcurrency }, () => interactive),
    parsing,
    background,
  ];
  const idle = (delayMs = input.idleDelayMs ?? 500) =>
    new Promise<void>((resolve) => {
      if (controller.signal.aborted) {
        resolve();
        return;
      }
      const done = () => {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, delayMs);
      controller.signal.addEventListener("abort", done, { once: true });
    });
  let nextMaintenanceAt = 0;
  let nextOpportunityScanAt = 0;
  try {
    const results = await Promise.allSettled([
      ...lanes.map(async (taskTypes, index) => {
        try {
          while (!controller.signal.aborted) {
            const processed = await runOneOwnerTask({
              db: input.db,
              config: input.config,
              workerId: `${workerId}-${index}`,
              signal: controller.signal,
              taskTypes,
              recoveryManagedByWorker: true,
              ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
            });
            if (!processed) await idle();
          }
        } catch (error) {
          abort();
          throw error;
        }
      }),
      (async () => {
        try {
          // Recovery is independent of occupied task lanes. An idle worker no
          // longer writes four recovery statements before every claim attempt.
          while (!controller.signal.aborted) {
            const now = new Date();
            if (Date.now() >= nextOpportunityScanAt) {
              await syncDiscoveryDemand(input.db);
              await scheduleUserDiscovery(input.db, now);
              if (input.config.opportunityDigestEnabled !== false)
                await scheduleOpportunityDigests(input.db, now);
              nextOpportunityScanAt = Date.now() + 60_000;
            }
            await input.db.transaction().execute((tx) => recoverExhaustedOwnerTasks(tx, now));
            if (Date.now() >= nextMaintenanceAt) {
              await purgeExpiredResumeContent({ db: input.db, now });
              await purgeExpiredResumeExports({ db: input.db, now });
              await runOwnerRetentionMaintenance({ db: input.db, now });
              nextMaintenanceAt = Date.now() + OWNER_RETENTION_MAINTENANCE_INTERVAL_MS;
            }
            await idle(1000);
          }
        } catch (error) {
          abort();
          throw error;
        }
      })(),
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
  } finally {
    abort();
    input.signal.removeEventListener("abort", abort);
  }
}

export const workerTaskPayloadSchemas = {
  resume_analysis: AnalysisPayloadSchema,
  match_run: MatchRunTaskPayloadSchema,
  recommendation_run: RunPayloadSchema,
  resume_tailoring: RunPayloadSchema,
  resume_export: ExportPayloadSchema,
  resume_review: RunPayloadSchema,
  resume_review_v2: RunPayloadSchema,
  owner_deletion: DeletionPayloadSchema,
} as const;

export function ownerTaskPayload(taskType: keyof typeof workerTaskPayloadSchemas, id: string) {
  const key =
    taskType === "resume_analysis"
      ? "analysisId"
      : taskType === "resume_export"
        ? "exportId"
        : taskType === "owner_deletion"
          ? "deletionId"
          : "runId";
  return asJson({ [key]: id });
}
