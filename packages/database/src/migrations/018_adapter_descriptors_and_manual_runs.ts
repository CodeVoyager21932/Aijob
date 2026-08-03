import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

export const adapterDescriptorsAndManualRunsMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE source_control.source_policy_versions
        ADD COLUMN adapter_options jsonb;

      ALTER TABLE ingestion.crawl_runs
        DROP CONSTRAINT crawl_runs_run_mode_check,
        ADD CONSTRAINT crawl_runs_run_mode_check CHECK (
          run_mode IN ('probe', 'scheduled', 'manual')
        );
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE ingestion.crawl_runs
        DROP CONSTRAINT crawl_runs_run_mode_check,
        ADD CONSTRAINT crawl_runs_run_mode_check CHECK (
          run_mode IN ('probe', 'scheduled')
        );

      ALTER TABLE source_control.source_policy_versions
        DROP COLUMN adapter_options;
    `.execute(db);
  },
};
