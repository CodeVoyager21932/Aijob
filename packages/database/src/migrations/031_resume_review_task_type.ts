import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";

import type { Database } from "../types.js";

export const resumeReviewTaskTypeMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE task_queue.tasks
        DROP CONSTRAINT tasks_task_type_check,
        ADD CONSTRAINT tasks_task_type_check CHECK (
          task_type IN (
            'crawl',
            'resume_analysis',
            'match_run',
            'recommendation_run',
            'resume_tailoring',
            'resume_export',
            'resume_review',
            'owner_deletion'
          )
        );
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Forward-only expand: queued review work must remain representable during rollback.
  },
};
