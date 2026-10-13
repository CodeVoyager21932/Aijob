import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";
export const nativeImportWorkerPermissionsMigration: Migration = {
  async up(db: Kysely<Database>) {
    // Import saves the draft then updates its display title/time; it cannot change
    // application linkage or the immutable submitted revision pointers.
    await sql`GRANT UPDATE(title,updated_at) ON profile.resume_documents TO aijob_match_worker`.execute(
      db,
    );
  },
};
