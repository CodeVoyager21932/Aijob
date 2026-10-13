import { type Migration, sql } from "kysely";

export const assistantCaseLifecycleMigration: Migration = {
  async up(db) {
    await sql`
      ALTER TABLE profile.assistant_sessions
        ADD COLUMN case_id uuid,
        ADD COLUMN detached_from_case_id uuid,
        ADD COLUMN deleted_at timestamptz,
        ADD FOREIGN KEY(owner_id,case_id) REFERENCES application.application_cases(owner_id,id),
        ADD FOREIGN KEY(owner_id,detached_from_case_id) REFERENCES application.application_cases(owner_id,id);
      UPDATE profile.assistant_sessions AS s SET case_id=c.id
        FROM application.application_cases AS c
        WHERE s.context->>'caseId'=c.id::text AND s.owner_id=c.owner_id;
      CREATE INDEX assistant_sessions_case ON profile.assistant_sessions(owner_id,case_id) WHERE deleted_at IS NULL;
    `.execute(db);
  },
  async down() {
    throw new Error("Forward-only: preserve application deletion dispositions.");
  },
};
