import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

// A fresh desktop database uses the actual service roles, including the existing
// owner-retention loop. Grant only its missing audit/revocation operations.
export const localRuntimeRetentionPermissionsMigration: Migration = {
  async up(db: Kysely<Database>) {
    await sql`
      GRANT USAGE ON SCHEMA decision_feedback_audit
        TO aijob_web_api, aijob_match_worker, aijob_ops_cli, aijob_migrator;
      GRANT INSERT ON decision_feedback_audit.audit_events TO aijob_web_api;
      GRANT SELECT, INSERT, DELETE ON decision_feedback_audit.audit_events TO aijob_match_worker;
      GRANT ALL ON decision_feedback_audit.audit_events TO aijob_ops_cli, aijob_migrator;
      GRANT UPDATE(epoch), DELETE ON identity.owners TO aijob_match_worker;
      GRANT SELECT(revoked_at), UPDATE(revoked_at) ON identity.owner_sessions TO aijob_match_worker;
    `.execute(db);
  },
};
