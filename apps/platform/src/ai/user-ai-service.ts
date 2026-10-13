import { createHmac, randomUUID } from "node:crypto";
import {
  UserAiSettingsInputSchema,
  UserAiSettingsSchema,
  UserAiUsageSchema,
} from "@aijob/contracts";
import type { AppConfig } from "@aijob/config";
import type { Database } from "@aijob/database";
import { sql, type Kysely, type Transaction } from "kysely";
import type { z } from "zod";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { encryptResumePayload, decryptResumePayload } from "../resume/crypto.js";
import { studioJson } from "../resume-documents/studio-service.js";
import { ServiceError } from "../lib/service-error.js";
import { OpenAiCompatibleProvider } from "./provider.js";
import { userProviderFetch } from "./user-provider-fetch.js";

type Db = Kysely<Database> | Transaction<Database>;
interface ConnectionRow {
  id: string;
  test_status: string | null;
  test_error: string | null;
  tested_at: Date | null;
  test_revision: number | null;
  revision: number;
  settings: unknown;
  ciphertext: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
  updated_at: Date;
}
const secretKey = (config: AppConfig, owner: OwnerScope) =>
  createHmac("sha256", Buffer.from(config.resumeEncryptionKey, "hex"))
    .update(`user-ai-v1:${owner.ownerId}:${owner.ownerEpoch}`)
    .digest("hex");
const publicSettings = (row: ConnectionRow) =>
  UserAiSettingsSchema.parse({
    ...(row.settings as object),
    connectionId: row.id,
    revision: Number(row.revision),
    testStatus: row.test_revision === row.revision ? row.test_status : null,
    testError: row.test_revision === row.revision ? row.test_error : null,
    testedAt: row.tested_at ? new Date(row.tested_at).toISOString() : null,
    keyConfigured: true,
    updatedAt: new Date(row.updated_at).toISOString(),
  });

export async function userAiSettings(db: Db, owner: OwnerScope) {
  const row = (
    await sql<ConnectionRow>`SELECT id,revision,settings,updated_at,test_status,test_error,tested_at,test_revision FROM profile.ai_connections WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
      db,
    )
  ).rows[0];
  const usage = (
    await sql<{
      calls: number;
      reservedTokens: number;
      completed: number;
      failed: number;
      running: number;
    }>`
    SELECT count(*)::int AS calls,COALESCE(sum(reserved_tokens),0)::float8 AS "reservedTokens",
      count(*) FILTER(WHERE status='completed')::int AS completed,
      count(*) FILTER(WHERE status='failed' OR (status='running' AND lease_until<=now()))::int AS failed,
      count(*) FILTER(WHERE status='running' AND lease_until>now())::int AS running
    FROM profile.ai_usage WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND created_at>=now()-interval '24 hours'
  `.execute(db)
  ).rows[0];
  return { settings: row ? publicSettings(row) : null, usage: UserAiUsageSchema.parse(usage) };
}

export async function saveUserAiSettings(
  db: Kysely<Database>,
  owner: OwnerScope,
  config: AppConfig,
  raw: unknown,
) {
  const input = UserAiSettingsInputSchema.parse(raw);
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const current = (
      await sql<ConnectionRow>`SELECT * FROM profile.ai_connections WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} FOR UPDATE`.execute(
        tx,
      )
    ).rows[0];
    if ((current?.revision ?? 0) !== input.expectedRevision)
      throw new ServiceError(
        409,
        "AI_SETTINGS_CONFLICT",
        "API 配置已在其他页面更新，当前输入已保留，请重新载入后保存。",
      );
    if (!current && !input.apiKey)
      throw new ServiceError(422, "AI_KEY_REQUIRED", "首次配置需要填写 API Key。");
    const encrypted = input.apiKey
      ? encryptResumePayload(Buffer.from(input.apiKey), secretKey(config, owner))
      : null;
    const { apiKey: _key, expectedRevision: _revision, ...settings } = input;
    const normalized = new URL(settings.baseUrl);
    normalized.pathname = normalized.pathname.replace(/\/+$/, "");
    settings.baseUrl = normalized.toString().replace(/\/$/, "");
    await sql`INSERT INTO profile.ai_connections(owner_id,owner_epoch,settings,ciphertext,nonce,auth_tag)
      VALUES(${owner.ownerId},${owner.ownerEpoch},${studioJson(settings)}::jsonb,${encrypted?.ciphertext ?? current!.ciphertext},${encrypted?.initializationVector ?? current!.nonce},${encrypted?.authenticationTag ?? current!.auth_tag})
      ON CONFLICT(owner_id) DO UPDATE SET settings=EXCLUDED.settings,ciphertext=EXCLUDED.ciphertext,nonce=EXCLUDED.nonce,auth_tag=EXCLUDED.auth_tag,revision=profile.ai_connections.revision+1,updated_at=now()`.execute(
      tx,
    );
    return userAiSettings(tx, owner);
  });
}

export async function userAiAvailability(db: Db, owner: OwnerScope) {
  const { settings } = await userAiSettings(db, owner);
  return {
    enabled: Boolean(settings?.enabled),
    model: settings?.model ?? null,
    reason: !settings
      ? "接入自己的 API 后即可使用 AI 助手"
      : !settings.enabled
        ? "你的 AI 接口已停用"
        : null,
    revision: settings?.revision ?? null,
    connectionId: settings?.connectionId ?? null,
  };
}

export async function loadUserAiConnection(
  db: Db,
  owner: OwnerScope,
  config: AppConfig,
  expectedRevision?: number | null,
  expectedConnectionId?: string | null,
) {
  const row = (
    await sql<ConnectionRow>`SELECT * FROM profile.ai_connections WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
      db,
    )
  ).rows[0];
  if (!row || !publicSettings(row).enabled)
    throw new ServiceError(409, "AI_NOT_READY", "请先在设置中接入并启用自己的 API。");
  if (
    (expectedRevision != null && Number(row.revision) !== expectedRevision) ||
    (expectedConnectionId != null && row.id !== expectedConnectionId)
  )
    throw new ServiceError(
      409,
      "AI_CONNECTION_CHANGED",
      "API 配置已改变，请使用当前配置重新发送这一轮。",
    );
  return {
    ...publicSettings(row),
    apiKey: decryptResumePayload(
      {
        ciphertext: row.ciphertext,
        initializationVector: row.nonce,
        authenticationTag: row.auth_tag,
      },
      secretKey(config, owner),
    ).toString("utf8"),
  };
}

export function userBudgetProvider(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  connection: Awaited<ReturnType<typeof loadUserAiConnection>>;
  purpose: string;
  fetchImpl?: typeof fetch | undefined;
}): Pick<OpenAiCompatibleProvider, "completeStructured"> {
  const { db, owner, connection } = input,
    provider = new OpenAiCompatibleProvider(connection, input.fetchImpl ?? userProviderFetch);
  return {
    async completeStructured(request) {
      const bytes = Buffer.byteLength(JSON.stringify(request.untrustedPayload));
      if (bytes > 250000)
        throw new ServiceError(
          422,
          "AI_INPUT_TOO_LARGE",
          "本轮材料较长，请选择更少的经历或新开一次任务。",
        );
      const outputTokens = Math.min(
        request.maxOutputTokens ?? connection.maxOutputTokens,
        connection.maxOutputTokens,
      );
      const tokens = bytes + Buffer.byteLength(request.systemInstruction) + outputTokens + 1024,
        id = randomUUID();
      await db.transaction().execute(async (tx) => {
        await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
        const current = (
          await sql<{
            id: string;
            revision: number;
            settings: { enabled: boolean };
          }>`SELECT id,revision,settings FROM profile.ai_connections WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        if (
          !current ||
          !current.settings.enabled ||
          Number(current.revision) !== connection.revision ||
          current.id !== connection.connectionId
        )
          throw new ServiceError(409, "AI_CONNECTION_CHANGED", "API 配置已改变，请重新发送。");
        const { usage } = await userAiSettings(tx, owner);
        if (usage.running >= connection.concurrency)
          throw new ServiceError(
            429,
            "AI_CONCURRENCY_LIMIT",
            "你的其他 AI 任务正在处理，稍后可以重试。",
          );
        if (
          usage.calls >= connection.dailyCalls ||
          usage.reservedTokens + tokens > connection.dailyTokens
        )
          throw new ServiceError(
            429,
            "AI_BUDGET_EXHAUSTED",
            "已达到你设置的用量限制，可以调整限制或稍后继续。",
          );
        await sql`INSERT INTO profile.ai_usage(id,owner_id,owner_epoch,connection_revision,purpose,model,reserved_tokens,status,lease_until) VALUES(${id},${owner.ownerId},${owner.ownerEpoch},${connection.revision},${input.purpose},${connection.model},${tokens},'running',now()+interval '3 minutes')`.execute(
          tx,
        );
      });
      try {
        const result = await provider.completeStructured({
          ...request,
          maxOutputTokens: outputTokens,
        });
        await db.transaction().execute(async (tx) => {
          await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
          await sql`UPDATE profile.ai_usage SET status='completed',completed_at=now() WHERE id=${id} AND owner_id=${owner.ownerId} AND status='running' AND lease_until>now()`.execute(
            tx,
          );
        });
        return result;
      } catch (error) {
        await db
          .transaction()
          .execute(async (tx) => {
            await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
            await sql`UPDATE profile.ai_usage SET status='failed',error_code='AI_REQUEST_FAILED',completed_at=now() WHERE id=${id} AND owner_id=${owner.ownerId}`.execute(
              tx,
            );
          })
          .catch(() => {});
        throw error;
      }
    },
  };
}
