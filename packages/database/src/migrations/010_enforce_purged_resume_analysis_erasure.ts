import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

export const enforcePurgedResumeAnalysisErasureMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      UPDATE profile.resume_analyses
      SET
        raw_ciphertext = NULL,
        raw_nonce = NULL,
        raw_auth_tag = NULL,
        extracted_text_ciphertext = NULL,
        extracted_text_nonce = NULL,
        extracted_text_auth_tag = NULL,
        analysis_result = NULL,
        original_filename = NULL,
        updated_at = now()
      WHERE purged_at IS NOT NULL;

      ALTER TABLE profile.resume_analyses
        DROP CONSTRAINT IF EXISTS resume_analyses_purged_content_erased,
        ADD CONSTRAINT resume_analyses_purged_content_erased CHECK (
          purged_at IS NULL
          OR (
            raw_ciphertext IS NULL
            AND raw_nonce IS NULL
            AND raw_auth_tag IS NULL
            AND extracted_text_ciphertext IS NULL
            AND extracted_text_nonce IS NULL
            AND extracted_text_auth_tag IS NULL
            AND analysis_result IS NULL
            AND original_filename IS NULL
          )
        );
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Plaintext erasure is intentionally irreversible.
  },
};
