import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

export const persistSourceTargetPolicyMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE source_control.source_fetch_targets
        ADD COLUMN allow_redirects boolean NOT NULL DEFAULT false,
        ADD COLUMN allowed_query_parameters text[] NOT NULL DEFAULT ARRAY[]::text[],
        ADD CONSTRAINT source_fetch_targets_query_parameters_no_nulls CHECK (
          array_position(allowed_query_parameters, NULL) IS NULL
        );

      ALTER TABLE source_control.source_apply_targets
        ADD COLUMN allow_redirects boolean NOT NULL DEFAULT false,
        ADD COLUMN allowed_query_parameters text[] NOT NULL DEFAULT ARRAY[]::text[],
        ADD CONSTRAINT source_apply_targets_query_parameters_no_nulls CHECK (
          array_position(allowed_query_parameters, NULL) IS NULL
        );
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE source_control.source_apply_targets
        DROP COLUMN allowed_query_parameters,
        DROP COLUMN allow_redirects;

      ALTER TABLE source_control.source_fetch_targets
        DROP COLUMN allowed_query_parameters,
        DROP COLUMN allow_redirects;
    `.execute(db);
  },
};
