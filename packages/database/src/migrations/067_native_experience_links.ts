import { type Migration, sql } from "kysely";

export const nativeExperienceLinksMigration: Migration = {
  async up(db) {
    await sql`ALTER TABLE profile.resume_experience_links ALTER COLUMN entry_id TYPE text USING entry_id::text;
      ALTER TABLE profile.resume_experience_links ADD CONSTRAINT native_entry_id_length CHECK(length(entry_id) BETWEEN 1 AND 500);`.execute(
      db,
    );
  },
  async down() {
    throw new Error("Forward-only: native entry identities cannot be cast back to UUID.");
  },
};
