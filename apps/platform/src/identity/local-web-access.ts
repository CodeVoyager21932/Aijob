import { randomBytes } from "node:crypto";
import type { LocalRecoveryFile } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import {
  assertActiveOwnerEpoch,
  hashOpaqueToken,
  issueOwnerSession,
  type OwnerScope,
} from "./session-repository.js";

export const BROWSER_ACCESS_TTL_MS = 400 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
type Purpose = "browser" | "recovery";
interface Binding {
  owner_id: string;
  owner_epoch: number;
  last_used_at: Date;
}

// Separate namespaces prevent web credentials from being accepted by desktop IPC,
// and prevent a downloaded recovery file from acting as a remembered-browser cookie.
function prefix(purpose: Purpose) {
  return `web-${purpose}-v1:`;
}
function credentialHash(purpose: Purpose, credential: string) {
  return prefix(purpose) + hashOpaqueToken(credential);
}
function browserExpired(binding: Binding, now: Date) {
  return new Date(binding.last_used_at).valueOf() + BROWSER_ACCESS_TTL_MS <= now.valueOf();
}

export class LocalWebAccess {
  constructor(private readonly db: Kysely<Database>) {}

  async remember(owner: OwnerScope, credential: string | undefined, now: Date) {
    return this.db.transaction().execute(async (tx) => {
      await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch, now);
      const hash = credential ? credentialHash("browser", credential) : null;
      const binding = hash
        ? (
            await sql<Binding>`
        SELECT owner_id, owner_epoch, last_used_at FROM identity.device_bindings
        WHERE credential_hash=${hash} AND revoked_at IS NULL FOR UPDATE
      `.execute(tx)
          ).rows[0]
        : undefined;
      if (
        binding &&
        binding.owner_id === owner.ownerId &&
        binding.owner_epoch === owner.ownerEpoch &&
        !browserExpired(binding, now)
      ) {
        if (new Date(binding.last_used_at).valueOf() + TOUCH_INTERVAL_MS > now.valueOf())
          return undefined;
        await sql`UPDATE identity.device_bindings SET last_used_at=${now} WHERE credential_hash=${hash}`.execute(
          tx,
        );
        return credential;
      }
      const fresh = randomBytes(32).toString("base64url");
      await sql`INSERT INTO identity.device_bindings(owner_id, owner_epoch, credential_hash, created_at, last_used_at)
        VALUES(${owner.ownerId}::uuid, ${owner.ownerEpoch}, ${credentialHash("browser", fresh)}, ${now}, ${now})`.execute(
        tx,
      );
      return fresh;
    });
  }

  async restore(credential: string, purpose: Purpose, now: Date) {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(credential)) return null;
    const hash = credentialHash(purpose, credential);
    try {
      return await this.db.transaction().execute(async (tx) => {
        const candidate = (
          await sql<Binding>`SELECT owner_id, owner_epoch, last_used_at
          FROM identity.device_bindings WHERE credential_hash=${hash} AND revoked_at IS NULL`.execute(
            tx,
          )
        ).rows[0];
        if (!candidate) return null;
        // Keep owner-before-binding lock order, shared with generation and deletion.
        await assertActiveOwnerEpoch(tx, candidate.owner_id, candidate.owner_epoch, now);
        const binding = (
          await sql<Binding>`SELECT owner_id, owner_epoch, last_used_at
          FROM identity.device_bindings WHERE credential_hash=${hash} AND revoked_at IS NULL FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        if (!binding || (purpose === "browser" && browserExpired(binding, now))) return null;
        await sql`UPDATE identity.device_bindings SET last_used_at=${now} WHERE credential_hash=${hash}`.execute(
          tx,
        );
        return issueOwnerSession({
          db: tx,
          ownerId: binding.owner_id,
          ownerEpoch: binding.owner_epoch,
          now,
          revokeExisting: false,
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "OWNER_EPOCH_STALE") return null;
      throw error;
    }
  }

  async recoveryCreatedAt(owner: OwnerScope) {
    const binding = (
      await sql<{ created_at: Date }>`SELECT created_at FROM identity.device_bindings
      WHERE owner_id=${owner.ownerId}::uuid AND owner_epoch=${owner.ownerEpoch}
      AND credential_hash LIKE ${`${prefix("recovery")}%`} AND revoked_at IS NULL
      ORDER BY created_at DESC LIMIT 1`.execute(this.db)
    ).rows[0];
    return binding ? new Date(binding.created_at).toISOString() : null;
  }

  async createRecoveryFile(owner: OwnerScope, now: Date): Promise<LocalRecoveryFile> {
    const recoveryKey = randomBytes(32).toString("base64url");
    await this.db.transaction().execute(async (tx) => {
      await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch, now);
      await sql`UPDATE identity.device_bindings SET revoked_at=${now}
        WHERE owner_id=${owner.ownerId}::uuid AND owner_epoch=${owner.ownerEpoch}
        AND credential_hash LIKE ${`${prefix("recovery")}%`} AND revoked_at IS NULL`.execute(tx);
      await sql`INSERT INTO identity.device_bindings(owner_id, owner_epoch, credential_hash, created_at, last_used_at)
        VALUES(${owner.ownerId}::uuid, ${owner.ownerEpoch}, ${credentialHash("recovery", recoveryKey)}, ${now}, ${now})`.execute(
        tx,
      );
    });
    return {
      format: "aijob-local-recovery",
      version: 1,
      workspaceId: owner.ownerId,
      createdAt: now.toISOString(),
      recoveryKey,
    };
  }

  async forgetBrowser(credential: string | undefined, now: Date) {
    if (!credential) return;
    await sql`UPDATE identity.device_bindings SET revoked_at=${now}
      WHERE credential_hash=${credentialHash("browser", credential)} AND revoked_at IS NULL`.execute(
      this.db,
    );
  }
}
