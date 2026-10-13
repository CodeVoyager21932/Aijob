import { sql, type Migration } from "kysely";
export const personalAiBudgetMigration: Migration = {
  async up(db) {
    await sql`
    CREATE TABLE matching.personal_ai_calls(
      id uuid PRIMARY KEY,purpose text NOT NULL CHECK(purpose IN ('resume_review','resume_tailoring')),
      model_key text NOT NULL,extraction_version text NOT NULL,
      reserved_tokens integer NOT NULL CHECK(reserved_tokens>0),
      status text NOT NULL CHECK(status IN ('running','completed','failed')),
      lease_until timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,error_code text
    );
    COMMENT ON TABLE matching.personal_ai_calls IS 'Anonymous execution accounting only: no owner, prompt, result, content hash or personal identifiers. Reserved tokens are conservative estimates.';
    CREATE INDEX personal_ai_budget_window ON matching.personal_ai_calls(created_at,status);
    GRANT SELECT,INSERT,UPDATE,DELETE ON matching.personal_ai_calls TO aijob_match_worker,aijob_ops_cli;
    GRANT ALL ON matching.personal_ai_calls TO aijob_migrator;
  `.execute(db);
  },
  async down() {
    throw new Error(
      "Forward-only migration; restore a verified backup to roll back database state.",
    );
  },
};
