import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

export const allowTailoringFallbackOutcomeMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      CREATE OR REPLACE FUNCTION matching.protect_immutable_run_context()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF (
          to_jsonb(NEW)
            - ARRAY[
                'status',
                'result',
                'failure_code',
                'completed_at',
                'used_template_fallback'
              ]
        ) IS DISTINCT FROM (
          to_jsonb(OLD)
            - ARRAY[
                'status',
                'result',
                'failure_code',
                'completed_at',
                'used_template_fallback'
              ]
        ) THEN
          RAISE EXCEPTION 'IMMUTABLE_RUN_CONTEXT';
        END IF;
        RETURN NEW;
      END;
      $$;
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      CREATE OR REPLACE FUNCTION matching.protect_immutable_run_context()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF (
          to_jsonb(NEW)
            - ARRAY['status', 'result', 'failure_code', 'completed_at']
        ) IS DISTINCT FROM (
          to_jsonb(OLD)
            - ARRAY['status', 'result', 'failure_code', 'completed_at']
        ) THEN
          RAISE EXCEPTION 'IMMUTABLE_RUN_CONTEXT';
        END IF;
        RETURN NEW;
      END;
      $$;
    `.execute(db);
  },
};
