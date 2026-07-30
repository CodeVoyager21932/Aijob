import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

export const freezeJobInsightSourceVerificationsMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE matching.job_insight_runs
        ADD COLUMN candidate_source_verifications jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD CONSTRAINT job_insight_source_verifications_array_check CHECK (
          jsonb_typeof(candidate_source_verifications) = 'array'
        );
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE matching.job_insight_runs
        DROP CONSTRAINT job_insight_source_verifications_array_check,
        DROP COLUMN candidate_source_verifications;
    `.execute(db);
  },
};
