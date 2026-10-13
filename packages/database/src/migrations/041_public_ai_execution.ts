import { sql, type Migration } from "kysely";
export const publicAiExecutionMigration: Migration = {
  async up(db) {
    await sql`
      CREATE TABLE source_control.public_ai_calls (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cache_key text NOT NULL,
        purpose text NOT NULL CHECK (purpose IN ('source_configuration','job_semantics')),
        model_key text NOT NULL, extraction_version text NOT NULL,
        reserved_tokens integer NOT NULL CHECK (reserved_tokens > 0),
        status text NOT NULL CHECK(status IN ('running','completed','failed')),
        error_code text, lease_until timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
      );
      CREATE INDEX public_ai_calls_budget ON source_control.public_ai_calls(created_at, status);
      CREATE INDEX public_ai_calls_key ON source_control.public_ai_calls(cache_key, status, lease_until);
      CREATE TABLE source_control.public_ai_cache (
        cache_key text PRIMARY KEY, call_id uuid NOT NULL REFERENCES source_control.public_ai_calls(id),
        result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      GRANT SELECT, INSERT, UPDATE, DELETE ON source_control.public_ai_calls, source_control.public_ai_cache
        TO aijob_collector_worker, aijob_ops_cli;
      GRANT ALL ON source_control.public_ai_calls, source_control.public_ai_cache TO aijob_migrator;
    `.execute(db);
  },
  async down() {
    throw new Error(
      "Forward-only migration; restore a verified backup to roll back database state.",
    );
  },
};
