import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";
export const desktopIdentityMigration: Migration = {
  async up(db: Kysely<Database>) {
    await sql`
    CREATE TABLE identity.device_bindings(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES identity.owners(id),
      owner_epoch integer NOT NULL, credential_hash text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
    );
    GRANT SELECT,INSERT,UPDATE,DELETE ON identity.device_bindings TO aijob_web_api,aijob_ops_cli,aijob_migrator;
    GRANT DELETE ON identity.device_bindings TO aijob_match_worker;
    GRANT SELECT(owner_id) ON identity.device_bindings TO aijob_match_worker;
  `.execute(db);
  },
};
