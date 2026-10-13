import { type Migration, sql } from "kysely";
export const sourceOnboardingMigration: Migration = {
  async up(db) {
    await sql`
    CREATE TABLE source_control.onboarding_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL UNIQUE REFERENCES task_queue.tasks(id),
      version text NOT NULL, request jsonb NOT NULL, result jsonb, status text NOT NULL DEFAULT 'queued',
      created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
    );
    GRANT SELECT,INSERT,UPDATE ON source_control.onboarding_runs TO aijob_ops_cli,aijob_collector_worker;
    GRANT ALL ON source_control.onboarding_runs TO aijob_migrator;
  `.execute(db);
  },
  async down() {
    throw new Error("Forward-only: retain source onboarding evidence.");
  },
};
