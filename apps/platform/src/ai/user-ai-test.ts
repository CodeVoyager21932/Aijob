import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, type Kysely } from "kysely";
import type { Database } from "@aijob/database";
import type { AppConfig } from "@aijob/config";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { withOwnerTaskLease, type OwnerTaskLease } from "../workers/owner-task-lease.js";
import { ServiceError } from "../lib/service-error.js";
import { studioJson } from "../resume-documents/studio-service.js";
import { loadUserAiConnection, userAiSettings, userBudgetProvider } from "./user-ai-service.js";

export async function queueUserAiTest(
  db: Kysely<Database>,
  owner: OwnerScope,
  revision: number,
  key: string,
) {
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const { settings } = await userAiSettings(tx, owner);
    if (!settings?.enabled || settings.revision !== revision)
      throw new ServiceError(409, "AI_SETTINGS_CONFLICT", "请先保存并启用当前配置，再测试连接。");
    const existing = await tx
      .selectFrom("task_queue.tasks")
      .select("id")
      .where("owner_id", "=", owner.ownerId)
      .where("idempotency_key", "=", `ai-test:${key}`)
      .executeTakeFirst();
    if (existing) return { queued: true };
    if (settings.testStatus === "queued") return { queued: true };
    await sql`UPDATE profile.ai_connections SET test_status='queued',test_error=null,test_revision=revision WHERE owner_id=${owner.ownerId}`.execute(
      tx,
    );
    await tx
      .insertInto("task_queue.tasks")
      .values({
        id: randomUUID(),
        task_type: "ai_connection_test",
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        payload: studioJson({ revision, connectionId: settings.connectionId }),
        idempotency_key: `ai-test:${key}`,
        status: "queued",
        attempt: 0,
        max_attempts: 2,
        available_at: new Date(),
        backoff_policy: studioJson({ baseMs: 1000, maxMs: 10000 }),
        lease_owner: null,
        lease_until: null,
        heartbeat_at: null,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();
    return { queued: true };
  });
}

export async function processUserAiTest(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  config: AppConfig;
  revision: number;
  connectionId: string;
  lease: OwnerTaskLease;
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch | undefined;
}) {
  let errorCode: string | null = null;
  try {
    const connection = await loadUserAiConnection(
      input.db,
      input.owner,
      input.config,
      input.revision,
      input.connectionId,
    );
    await userBudgetProvider({
      ...input,
      connection,
      purpose: "connection_test",
    }).completeStructured({
      systemInstruction: '请仅返回 JSON：{"ok":true}。',
      untrustedPayload: { message: "连接检查，不含个人材料。" },
      schema: z.object({ ok: z.literal(true) }),
      maxOutputTokens: 128,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (error instanceof Error && "code" in error && error.code === "AI_CONCURRENCY_LIMIT")
      throw error;
    errorCode =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "AI_CONNECTION_FAILED";
  }
  await withOwnerTaskLease(input.db, input.lease, async (tx) => {
    await sql`UPDATE profile.ai_connections SET test_status=${errorCode ? "failed" : "completed"},test_error=${errorCode},tested_at=now() WHERE owner_id=${input.owner.ownerId} AND owner_epoch=${input.owner.ownerEpoch} AND revision=${input.revision} AND id=${input.connectionId}`.execute(
      tx,
    );
  });
}
