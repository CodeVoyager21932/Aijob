import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import { MatchRunTaskPayloadSchema } from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import type { Kysely, Selectable } from "kysely";
import { z } from "zod";
import { isActiveOwnerEpochState } from "../identity/session-repository.js";
import { processMatchRun, processRecommendationRun } from "../matching/service.js";
import { processOwnerDeletion } from "../profile/deletion-service.js";
import {
  OWNER_RETENTION_MAINTENANCE_INTERVAL_MS,
  runOwnerRetentionMaintenance,
} from "../profile/retention-service.js";
import { processResumeAnalysis, purgeExpiredResumeContent } from "../resume/analysis-service.js";
import { processResumeReview } from "../resume-documents/review-service.js";
import { purgeExpiredResumeExports } from "../tailoring/export-retention.js";
import { processResumeExport, processTailoringRun } from "../tailoring/service.js";
import { type OwnerTaskLease, OwnerTaskLeaseLostError } from "./owner-task-lease.js";

const LEASE_MS = 60_000;
const HEARTBEAT_MS = 10_000;
const OWNER_TASK_TYPES = [
  "resume_analysis",
  "match_run",
  "recommendation_run",
  "resume_tailoring",
  "resume_export",
  "resume_review",
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

async function claimTask(
  db: Kysely<Database>,
  workerId: string,
  now: Date,
): Promise<TaskRow | null> {
  return db.transaction().execute(async (transaction) => {
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
      .where((expression) => expression("attempt", ">=", expression.ref("max_attempts")))
      .where((expression) =>
        expression.or([
          expression("status", "=", "queued"),
          expression.and([
            expression("status", "=", "running"),
            expression("lease_until", "<", now),
          ]),
        ]),
      )
      .execute();
    const candidate = await transaction
      .selectFrom("task_queue.tasks")
      .select("id")
      .where("task_type", "in", OWNER_TASK_TYPES)
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
        ...("executionContext" in payload
          ? { executionContext: payload.executionContext }
          : {}),
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
  const exhausted = task.attempt >= task.max_attempts;
  const errorCode =
    error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "OWNER_TASK_FAILED";
  const result = await db
    .updateTable("task_queue.tasks")
    .set({
      status: exhausted ? "dead" : "queued",
      available_at: exhausted
        ? now
        : new Date(now.getTime() + Math.min(30_000, 2 ** task.attempt * 1_000)),
      lease_owner: null,
      lease_until: null,
      heartbeat_at: now,
      last_error_code: errorCode,
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
}): Promise<boolean> {
  const workerId = input.workerId ?? `match-worker-${randomUUID()}`;
  const task = await claimTask(input.db, workerId, input.now ?? new Date());
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
}): Promise<void> {
  const workerId = `match-worker-${randomUUID()}`;
  const idleDelayMs = input.idleDelayMs ?? 500;
  let nextMaintenanceAt = 0;
  while (!input.signal.aborted) {
    if (Date.now() >= nextMaintenanceAt) {
      const now = new Date();
      await purgeExpiredResumeContent({ db: input.db, now });
      await purgeExpiredResumeExports({ db: input.db, now });
      await runOwnerRetentionMaintenance({ db: input.db, now });
      nextMaintenanceAt = Date.now() + OWNER_RETENTION_MAINTENANCE_INTERVAL_MS;
    }
    const processed = await runOneOwnerTask({
      db: input.db,
      config: input.config,
      workerId,
      signal: input.signal,
    });
    if (processed) continue;
    await new Promise<void>((resolve) => {
      const finish = () => {
        input.signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const timeout = setTimeout(finish, idleDelayMs);
      const onAbort = () => {
        clearTimeout(timeout);
        finish();
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export const workerTaskPayloadSchemas = {
  resume_analysis: AnalysisPayloadSchema,
  match_run: MatchRunTaskPayloadSchema,
  recommendation_run: RunPayloadSchema,
  resume_tailoring: RunPayloadSchema,
  resume_export: ExportPayloadSchema,
  resume_review: RunPayloadSchema,
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
