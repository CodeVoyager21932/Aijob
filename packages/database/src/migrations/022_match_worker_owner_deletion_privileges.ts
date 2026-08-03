import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

export const matchWorkerOwnerDeletionPrivilegesMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      GRANT UPDATE (status, deleted_at, retention_expires_at, last_seen_at)
        ON TABLE identity.owners
        TO aijob_match_worker;
      GRANT SELECT (owner_id), DELETE
        ON TABLE identity.owner_sessions
        TO aijob_match_worker;
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      REVOKE SELECT (owner_id), DELETE
        ON TABLE identity.owner_sessions
        FROM aijob_match_worker;
      REVOKE UPDATE (status, deleted_at, retention_expires_at, last_seen_at)
        ON TABLE identity.owners
        FROM aijob_match_worker;
    `.execute(db);
  },
};
