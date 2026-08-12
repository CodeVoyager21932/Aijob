import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type CareerOwner,
  CareerOwnerSchema,
  type SessionStatus,
  SessionStatusSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";

export const ANONYMOUS_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export interface OwnerScope {
  ownerId: string;
  ownerEpoch: number;
}

export interface OwnerLifecycleState {
  status: string;
  epoch: number;
  retention_mode: string;
  retention_expires_at: Date | null;
}

export interface OwnerContext extends OwnerScope {
  sessionId: string;
  sessionExpiresAt: Date;
  csrfTokenHash: string;
}

export interface CreatedAnonymousSession {
  context: OwnerContext;
  sessionToken: string;
  csrfToken: string;
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export async function getCareerOwner(input: {
  db: Kysely<Database>;
  ownerId: string;
  ownerEpoch: number;
}): Promise<CareerOwner | null> {
  const row = await input.db
    .selectFrom("identity.owners as owner")
    .leftJoin("identity.accounts as account", "account.owner_id", "owner.id")
    .select([
      "owner.id",
      "owner.status",
      "owner.epoch",
      "owner.retention_mode",
      "owner.retention_expires_at",
      "owner.created_at",
      "owner.last_seen_at",
      "owner.deleted_at",
      "account.id as account_id",
    ])
    .where("owner.id", "=", input.ownerId)
    .where("owner.epoch", "=", input.ownerEpoch)
    .executeTakeFirst();
  if (!row) return null;
  return CareerOwnerSchema.parse({
    id: row.id,
    status: row.status,
    epoch: Number(row.epoch),
    retentionMode: row.retention_mode,
    retentionExpiresAt: row.retention_expires_at ? toIso(row.retention_expires_at) : null,
    accountId: row.account_id,
    createdAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at),
    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
  });
}

export async function projectSessionStatus(input: {
  db: Kysely<Database>;
  context: OwnerContext | null;
}): Promise<SessionStatus> {
  if (!input.context) return { authenticated: false };
  const owner = await getCareerOwner({
    db: input.db,
    ownerId: input.context.ownerId,
    ownerEpoch: input.context.ownerEpoch,
  });
  if (!owner) return { authenticated: false };
  return SessionStatusSchema.parse({
    authenticated: true,
    owner,
    session: {
      id: input.context.sessionId,
      ownerEpoch: input.context.ownerEpoch,
      expiresAt: input.context.sessionExpiresAt.toISOString(),
    },
  });
}

export function isActiveOwnerEpochState(
  owner: OwnerLifecycleState | undefined,
  expectedEpoch: number,
  now: Date,
): boolean {
  if (!owner || owner.status !== "active" || Number(owner.epoch) !== expectedEpoch) {
    return false;
  }
  if (owner.retention_mode === "account_managed") return true;
  if (owner.retention_mode !== "anonymous_ttl" || owner.retention_expires_at === null) {
    return false;
  }
  return new Date(owner.retention_expires_at).getTime() > now.getTime();
}

export async function createAnonymousSession(input: {
  db: Kysely<Database>;
  now?: Date;
  ttlMs?: number;
}): Promise<CreatedAnonymousSession> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? ANONYMOUS_SESSION_TTL_MS));
  const ownerId = randomUUID();
  const sessionId = randomUUID();
  const sessionToken = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const tokenHash = hashOpaqueToken(sessionToken);
  const csrfTokenHash = hashOpaqueToken(csrfToken);

  await input.db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("identity.owners")
      .values({
        id: ownerId,
        status: "active",
        epoch: 1,
        retention_expires_at: expiresAt,
        last_seen_at: now,
        deleted_at: null,
      })
      .execute();
    await transaction
      .insertInto("identity.owner_sessions")
      .values({
        id: sessionId,
        owner_id: ownerId,
        owner_epoch: 1,
        token_hash: tokenHash,
        csrf_token_hash: csrfTokenHash,
        expires_at: expiresAt,
        revoked_at: null,
        last_seen_at: now,
      })
      .execute();
  });

  return {
    context: {
      ownerId,
      ownerEpoch: 1,
      sessionId,
      sessionExpiresAt: expiresAt,
      csrfTokenHash,
    },
    sessionToken,
    csrfToken,
  };
}

export async function findActiveSession(input: {
  db: Kysely<Database>;
  sessionToken: string;
  now?: Date;
}): Promise<OwnerContext | null> {
  const now = input.now ?? new Date();
  const row = await input.db
    .selectFrom("identity.owner_sessions as session")
    .innerJoin("identity.owners as owner", "owner.id", "session.owner_id")
    .select([
      "session.id as session_id",
      "session.owner_id",
      "session.owner_epoch",
      "session.csrf_token_hash",
      "session.expires_at",
      "owner.epoch as current_owner_epoch",
      "owner.status as owner_status",
      "owner.retention_mode as owner_retention_mode",
      "owner.retention_expires_at as owner_retention_expires_at",
    ])
    .where("session.token_hash", "=", hashOpaqueToken(input.sessionToken))
    .where("session.revoked_at", "is", null)
    .where("session.expires_at", ">", now)
    .executeTakeFirst();

  if (
    !row ||
    !isActiveOwnerEpochState(
      {
        status: row.owner_status,
        epoch: Number(row.current_owner_epoch),
        retention_mode: row.owner_retention_mode,
        retention_expires_at: row.owner_retention_expires_at,
      },
      Number(row.owner_epoch),
      now,
    )
  ) {
    return null;
  }

  await Promise.all([
    input.db
      .updateTable("identity.owner_sessions")
      .set({ last_seen_at: now })
      .where("id", "=", row.session_id)
      .execute(),
    input.db
      .updateTable("identity.owners")
      .set({ last_seen_at: now })
      .where("id", "=", row.owner_id)
      .where("epoch", "=", Number(row.owner_epoch))
      .where("status", "=", "active")
      .execute(),
  ]);

  return {
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    sessionId: row.session_id,
    sessionExpiresAt: new Date(row.expires_at),
    csrfTokenHash: row.csrf_token_hash,
  };
}

export async function revokeOwnerSessions(input: {
  db: Kysely<Database>;
  ownerId: string;
  now?: Date;
}): Promise<void> {
  await input.db
    .updateTable("identity.owner_sessions")
    .set({ revoked_at: input.now ?? new Date() })
    .where("owner_id", "=", input.ownerId)
    .where("revoked_at", "is", null)
    .execute();
}

export async function assertActiveOwnerEpoch(
  db: Kysely<Database>,
  ownerId: string,
  ownerEpoch: number,
  now = new Date(),
): Promise<void> {
  const owner = await db
    .selectFrom("identity.owners")
    .select(["status", "epoch", "retention_mode", "retention_expires_at"])
    .where("id", "=", ownerId)
    .forUpdate()
    .executeTakeFirst();
  if (!isActiveOwnerEpochState(owner, ownerEpoch, now)) {
    throw new Error("OWNER_EPOCH_STALE");
  }
}
