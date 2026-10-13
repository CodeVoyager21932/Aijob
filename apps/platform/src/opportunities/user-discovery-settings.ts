import { createHmac } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  DiscoverySettingsInputSchema,
  DiscoverySettingsResponseSchema,
  type SearchAdapter,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { userAiSettings } from "../ai/user-ai-service.js";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";
import { decryptResumePayload, encryptResumePayload } from "../resume/crypto.js";
import { readOpportunitySettings } from "./local-settings.js";
import { SEARCH_ADAPTER_VERSION } from "./search-adapters.js";
import { syncDiscoveryDemand } from "./subscriptions.js";

type Db = Kysely<Database> | Transaction<Database>;
export interface DiscoveryRow {
  owner_id: string;
  owner_epoch: number;
  id: string;
  revision: number;
  mode: "existing_sources" | "ai_connection" | "tavily";
  adapter: SearchAdapter;
  ciphertext: Buffer | null;
  nonce: Buffer | null;
  auth_tag: Buffer | null;
  capability: string;
  capability_code: string | null;
  checked_at: Date | null;
  connection_id: string | null;
  connection_revision: number | null;
  adapter_version: string | null;
  next_search_at: Date;
  last_search_at: Date | null;
  last_search_status: string | null;
  legacy_pending: boolean;
}
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const secretKey = (config: AppConfig, owner: OwnerScope) =>
  createHmac("sha256", Buffer.from(config.resumeEncryptionKey, "hex"))
    .update(`user-discovery-v1:${owner.ownerId}:${owner.ownerEpoch}`)
    .digest("hex");
const legacyFingerprint = (config: AppConfig, key: string) =>
  createHmac("sha256", Buffer.from(config.resumeEncryptionKey, "hex"))
    .update(`discovery-legacy:${key}`)
    .digest("hex");
export async function discoveryRow(db: Db, owner: OwnerScope, lock = false) {
  return (
    await sql<DiscoveryRow>`SELECT * FROM profile.discovery_settings WHERE owner_id=${owner.ownerId}::uuid AND owner_epoch=${owner.ownerEpoch} ${lock ? sql`FOR UPDATE` : sql``}`.execute(
      db,
    )
  ).rows[0];
}
export function discoverySecret(row: DiscoveryRow, config: AppConfig, owner: OwnerScope) {
  if (!row.ciphertext || !row.nonce || !row.auth_tag)
    throw new ServiceError(409, "SEARCH_KEY_REQUIRED", "请保存搜索 Key。");
  return decryptResumePayload(
    {
      ciphertext: row.ciphertext,
      initializationVector: row.nonce,
      authenticationTag: row.auth_tag,
    },
    secretKey(config, owner),
  ).toString("utf8");
}
export async function userDiscoveryUsage(db: Db, owner: OwnerScope) {
  const result = (
    await sql<{
      dailyUsed: number;
      monthlyUsed: number;
      toolCalls: number | null;
      modelTokens: number | null;
    }>`
    SELECT count(*) FILTER(WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')::int AS "dailyUsed",
      count(*)::int AS "monthlyUsed",CASE WHEN count(*) FILTER(WHERE tool_calls IS NULL)=0 THEN sum(tool_calls)::int END AS "toolCalls",
      CASE WHEN count(*) FILTER(WHERE model IS NOT NULL AND model_tokens IS NULL)=0 THEN sum(model_tokens)::int END AS "modelTokens"
    FROM profile.discovery_usage WHERE owner_id=${owner.ownerId}::uuid AND owner_epoch=${owner.ownerEpoch}
      AND created_at>=date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'`.execute(
      db,
    )
  ).rows[0]!;
  return { ...result, dailyLimit: 20 as const, monthlyLimit: 500 as const };
}
export async function userDiscoverySettings(db: Db, owner: OwnerScope, config: AppConfig) {
  const row = await discoveryRow(db, owner),
    ai = (await userAiSettings(db, owner)).settings;
  const matches =
    !!row &&
    (row.mode !== "ai_connection" ||
      (!!ai?.enabled &&
        row.connection_id === ai.connectionId &&
        row.connection_revision === ai.revision)) &&
    row.adapter_version === SEARCH_ADAPTER_VERSION;
  let legacyAvailable = false;
  if (config.appEnv === "local") {
    const old = readOpportunitySettings(config);
    if (old.apiKey)
      legacyAvailable = !(
        await sql`SELECT 1 FROM profile.discovery_legacy_bindings WHERE fingerprint=${legacyFingerprint(config, old.apiKey)}`.execute(
          db,
        )
      ).rows.length;
  }
  const next =
    (
      await sql<{
        due: Date | null;
      }>`SELECT min(d.next_due_at) AS due FROM profile.discovery_schedule d JOIN application.saved_searches s ON s.id=d.search_id WHERE d.owner_id=${owner.ownerId}::uuid AND d.owner_epoch=${owner.ownerEpoch} AND s.discovery_enabled`.execute(
        db,
      )
    ).rows[0]?.due ?? null;
  return DiscoverySettingsResponseSchema.parse({
    settings: row
      ? {
          id: row.id,
          revision: row.revision,
          mode: row.mode,
          adapter: row.adapter,
          keyConfigured:
            row.mode === "tavily"
              ? !!row.ciphertext
              : row.mode === "ai_connection" && !!ai?.keyConfigured,
          capability:
            row.mode === "existing_sources" ? "ready" : matches ? row.capability : "unchecked",
          capabilityCode: matches ? row.capability_code : null,
          checkedAt: iso(row.checked_at),
          connectionId: row.connection_id,
          connectionRevision: row.connection_revision,
          nextSearchAt:
            row.mode !== "existing_sources" && matches && row.capability === "ready"
              ? iso(next)
              : null,
          lastSearchAt: iso(row.last_search_at),
          lastSearchStatus: row.last_search_status,
        }
      : null,
    legacyAvailable,
    usage: await userDiscoveryUsage(db, owner),
  });
}
export async function saveUserDiscoverySettings(
  db: Kysely<Database>,
  owner: OwnerScope,
  config: AppConfig,
  raw: unknown,
) {
  const input = DiscoverySettingsInputSchema.parse(raw);
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const current = await discoveryRow(tx, owner, true);
    if ((current?.revision ?? 0) !== input.expectedRevision)
      throw new ServiceError(
        409,
        "SEARCH_SETTINGS_CONFLICT",
        "搜索配置已在其他页面改变，请重新载入后保存。",
      );
    let key = input.apiKey;
    if (input.useLegacyKey) {
      if (config.appEnv !== "local" || input.mode !== "tavily")
        throw new ServiceError(422, "SEARCH_LEGACY_UNAVAILABLE", "本机搜索配置不可沿用。");
      key = readOpportunitySettings(config).apiKey;
      if (!key) throw new ServiceError(422, "SEARCH_KEY_REQUIRED", "本机没有可沿用的搜索 Key。");
      const claimed = (
        await sql`INSERT INTO profile.discovery_legacy_bindings(fingerprint,owner_id,owner_epoch) VALUES(${legacyFingerprint(config, key)},${owner.ownerId}::uuid,${owner.ownerEpoch}) ON CONFLICT DO NOTHING RETURNING fingerprint`.execute(
          tx,
        )
      ).rows.length;
      if (!claimed)
        throw new ServiceError(
          409,
          "SEARCH_LEGACY_ALREADY_BOUND",
          "本机配置已由账户沿用，请使用该账户，或填写你自己的搜索 Key。",
        );
    }
    if (input.mode === "tavily" && !key && !current?.ciphertext)
      throw new ServiceError(
        422,
        "SEARCH_KEY_REQUIRED",
        "请填写搜索 Key，或沿用已保存的本机配置。",
      );
    const ai = (await userAiSettings(tx, owner)).settings;
    if (input.mode === "ai_connection" && !ai?.enabled)
      throw new ServiceError(409, "AI_NOT_READY", "请先保存并启用 AI 连接，再选择复用。");
    const encrypted = key ? encryptResumePayload(Buffer.from(key), secretKey(config, owner)) : null;
    const retain =
      current?.mode === input.mode &&
      current.adapter === input.adapter &&
      !key &&
      (input.mode !== "ai_connection" ||
        (current.connection_id === ai?.connectionId &&
          current.connection_revision === ai.revision)) &&
      current.adapter_version === SEARCH_ADAPTER_VERSION;
    const legacyPending =
      input.mode !== "existing_sources" && (input.useLegacyKey || current?.legacy_pending === true);
    await sql`INSERT INTO profile.discovery_settings(owner_id,owner_epoch,mode,adapter,ciphertext,nonce,auth_tag,connection_id,connection_revision,adapter_version,capability,legacy_pending)
      VALUES(${owner.ownerId}::uuid,${owner.ownerEpoch},${input.mode},${input.adapter},${encrypted?.ciphertext ?? current?.ciphertext ?? null},${encrypted?.initializationVector ?? current?.nonce ?? null},${encrypted?.authenticationTag ?? current?.auth_tag ?? null},${ai?.connectionId ?? null}::uuid,${ai?.revision ?? null},${SEARCH_ADAPTER_VERSION},${retain ? current.capability : input.mode === "existing_sources" ? "ready" : "unchecked"},${legacyPending})
      ON CONFLICT(owner_id) DO UPDATE SET revision=profile.discovery_settings.revision+1,mode=EXCLUDED.mode,adapter=EXCLUDED.adapter,ciphertext=EXCLUDED.ciphertext,nonce=EXCLUDED.nonce,auth_tag=EXCLUDED.auth_tag,
        connection_id=EXCLUDED.connection_id,connection_revision=EXCLUDED.connection_revision,adapter_version=EXCLUDED.adapter_version,capability=EXCLUDED.capability,capability_code=NULL,next_search_at=now(),legacy_pending=EXCLUDED.legacy_pending,updated_at=now()`.execute(
      tx,
    );
    await syncDiscoveryDemand(tx);
    return userDiscoverySettings(tx, owner, config);
  });
}
/** Removing a connection stays in existing-sources mode: it must not revive legacy billing. */
export async function deleteUserDiscoverySettings(
  db: Kysely<Database>,
  owner: OwnerScope,
  revision: number,
) {
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const row = await discoveryRow(tx, owner, true);
    if (!row) return { deleted: true };
    if (row.revision !== revision)
      throw new ServiceError(409, "SEARCH_SETTINGS_CONFLICT", "配置已更新，请重新载入后删除。");
    await sql`UPDATE profile.discovery_settings SET revision=revision+1,mode='existing_sources',ciphertext=NULL,nonce=NULL,auth_tag=NULL,capability='ready',capability_code=NULL,connection_id=NULL,connection_revision=NULL,legacy_pending=false,updated_at=now() WHERE owner_id=${owner.ownerId}::uuid`.execute(
      tx,
    );
    await sql`DELETE FROM profile.discovery_cache WHERE owner_id=${owner.ownerId}::uuid AND owner_epoch=${owner.ownerEpoch}`.execute(
      tx,
    );
    await syncDiscoveryDemand(tx);
    return { deleted: true };
  });
}
