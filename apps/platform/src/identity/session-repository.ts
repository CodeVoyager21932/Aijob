import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";

export const ANONYMOUS_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export interface OwnerContext {
  ownerId: string;
  ownerEpoch: number;
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
    ])
    .where("session.token_hash", "=", hashOpaqueToken(input.sessionToken))
    .where("session.revoked_at", "is", null)
    .where("session.expires_at", ">", now)
    .where("owner.retention_expires_at", ">", now)
    .executeTakeFirst();

  if (
    !row ||
    row.owner_status !== "active" ||
    Number(row.current_owner_epoch) !== Number(row.owner_epoch)
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
    .select(["status", "epoch", "retention_expires_at"])
    .where("id", "=", ownerId)
    .forUpdate()
    .executeTakeFirst();
  if (
    !owner ||
    owner.status !== "active" ||
    Number(owner.epoch) !== ownerEpoch ||
    new Date(owner.retention_expires_at).getTime() <= now.getTime()
  ) {
    throw new Error("OWNER_EPOCH_STALE");
  }
}
