import { randomBytes } from "node:crypto";
import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import {
  assertActiveOwnerEpoch,
  createAnonymousSession,
  findActiveSession,
  hashOpaqueToken,
  issueOwnerSession,
} from "./session-repository.js";

/** Called over the inherited Node IPC channel only. Never exposed as an HTTP login. */
export async function restoreDeviceSession(
  db: Kysely<Database>,
  input: { credential?: string; sessionToken?: string },
) {
  const session = input.sessionToken
    ? await findActiveSession({ db, sessionToken: input.sessionToken })
    : null;
  if (input.credential) {
    return db.transaction().execute(async (tx) => {
      const binding = (
        await sql<{
          owner_id: string;
          owner_epoch: number;
        }>`SELECT owner_id,owner_epoch FROM identity.device_bindings WHERE credential_hash=${hashOpaqueToken(input.credential!)} AND revoked_at IS NULL FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      if (!binding) throw new Error("DEVICE_BINDING_REVOKED");
      await assertActiveOwnerEpoch(tx, binding.owner_id, binding.owner_epoch);
      await sql`UPDATE identity.device_bindings SET last_used_at=now() WHERE credential_hash=${hashOpaqueToken(input.credential!)}`.execute(
        tx,
      );
      if (session?.ownerId === binding.owner_id && session.ownerEpoch === binding.owner_epoch)
        return { reuse: true as const };
      return {
        reuse: false as const,
        session: await issueOwnerSession({
          db: tx,
          ownerId: binding.owner_id,
          ownerEpoch: binding.owner_epoch,
          revokeExisting: false,
        }),
      };
    });
  }
  const fresh = session ? null : await createAnonymousSession({ db });
  const owner = session ?? fresh!.context,
    credential = randomBytes(32).toString("base64url");
  await db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    await sql`INSERT INTO identity.device_bindings(owner_id,owner_epoch,credential_hash) VALUES(${owner.ownerId}::uuid,${owner.ownerEpoch},${hashOpaqueToken(credential)})`.execute(
      tx,
    );
  });
  return fresh
    ? { reuse: false as const, credential, session: fresh }
    : { reuse: true as const, credential };
}
