import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

export const minimizeResumeAnalysisStorageMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE profile.resume_analyses
        DROP CONSTRAINT resume_analyses_file_metadata,
        DROP CONSTRAINT IF EXISTS resume_analyses_result_metadata_only,
        DROP CONSTRAINT IF EXISTS resume_analyses_purged_content_erased;

      UPDATE profile.resume_analyses
      SET
        raw_ciphertext = NULL,
        raw_nonce = NULL,
        raw_auth_tag = NULL,
        extracted_text_ciphertext = NULL,
        extracted_text_nonce = NULL,
        extracted_text_auth_tag = NULL,
        analysis_result = NULL,
        original_filename = NULL
      WHERE purged_at IS NOT NULL;

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
        purged_at = COALESCE(purged_at, now()),
        updated_at = now()
      WHERE purge_after <= now();

      UPDATE profile.resume_analyses
      SET analysis_result = CASE
        WHEN
          purged_at IS NULL
          AND num_nonnulls(
            extracted_text_ciphertext,
            extracted_text_nonce,
            extracted_text_auth_tag
          ) = 3
        THEN jsonb_build_object(
          'version', 'resume-analysis-storage-v1',
          'candidateEvidenceCount',
          CASE
            WHEN
              analysis_result ->> 'version' = 'resume-analysis-storage-v1'
              AND jsonb_typeof(analysis_result -> 'candidateEvidenceCount') = 'number'
              AND analysis_result ->> 'candidateEvidenceCount' ~ '^(0|[1-9][0-9]{0,2})$'
            THEN LEAST((analysis_result ->> 'candidateEvidenceCount')::integer, 100)
            WHEN jsonb_typeof(analysis_result -> 'candidateEvidence') = 'array'
            THEN LEAST(jsonb_array_length(analysis_result -> 'candidateEvidence'), 100)
            ELSE 0
          END
        )
        ELSE NULL
      END
      WHERE analysis_result IS NOT NULL;

      ALTER TABLE profile.resume_analyses
        ADD CONSTRAINT resume_analyses_file_metadata CHECK (
          (
            input_kind = 'pasted_text'
            AND original_filename IS NULL
            AND media_type = 'text/plain'
          )
          OR
          (
            input_kind = 'pdf'
            AND media_type = 'application/pdf'
            AND (
              (purged_at IS NULL AND original_filename IS NOT NULL)
              OR (purged_at IS NOT NULL AND original_filename IS NULL)
            )
          )
          OR
          (
            input_kind = 'docx'
            AND media_type =
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            AND (
              (purged_at IS NULL AND original_filename IS NOT NULL)
              OR (purged_at IS NOT NULL AND original_filename IS NULL)
            )
          )
        ),
        ADD CONSTRAINT resume_analyses_result_metadata_only CHECK (
          analysis_result IS NULL
          OR (
            jsonb_typeof(analysis_result) = 'object'
            AND analysis_result ->> 'version' = 'resume-analysis-storage-v1'
            AND analysis_result - ARRAY['version', 'candidateEvidenceCount']::text[] = '{}'::jsonb
            AND CASE
              WHEN
                jsonb_typeof(analysis_result -> 'candidateEvidenceCount') = 'number'
                AND analysis_result ->> 'candidateEvidenceCount' ~ '^(0|[1-9][0-9]{0,2})$'
              THEN (analysis_result ->> 'candidateEvidenceCount')::integer BETWEEN 0 AND 100
              ELSE false
            END
          )
        ),
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
    // Plaintext removal and filename erasure are intentionally irreversible.
  },
};
