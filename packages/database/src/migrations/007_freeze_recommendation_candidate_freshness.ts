import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

/**
 * Legacy recommendation runs did not persist the source observation used by
 * the freshness tie-breaker. Keep the column nullable so those runs remain
 * readable without inventing a historical last_seen_at value. Every new run
 * is required to populate it in the recommendation service.
 */
export const freezeRecommendationCandidateFreshnessMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE matching.recommendation_runs
        ADD COLUMN candidate_freshness_snapshots jsonb,
        ADD CONSTRAINT recommendation_candidate_freshness_snapshots_array
          CHECK (
            candidate_freshness_snapshots IS NULL
            OR (
              jsonb_typeof(candidate_freshness_snapshots) = 'array'
              AND jsonb_array_length(candidate_freshness_snapshots) > 0
            )
          );
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE matching.recommendation_runs
        DROP CONSTRAINT recommendation_candidate_freshness_snapshots_array,
        DROP COLUMN candidate_freshness_snapshots;
    `.execute(db);
  },
};
