import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

export const allowResumeAnalysisV2MetadataMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE profile.resume_analyses
        DROP CONSTRAINT resume_analyses_result_metadata_only,
        ADD CONSTRAINT resume_analyses_result_metadata_only CHECK (
          analysis_result IS NULL
          OR (
            jsonb_typeof(analysis_result) = 'object'
            AND (
              (
                analysis_result ->> 'version' = 'resume-analysis-storage-v1'
                AND analysis_result - ARRAY['version', 'candidateEvidenceCount']::text[] = '{}'::jsonb
                AND CASE
                  WHEN
                    jsonb_typeof(analysis_result -> 'candidateEvidenceCount') = 'number'
                    AND analysis_result ->> 'candidateEvidenceCount' ~ '^(0|[1-9][0-9]{0,2})$'
                  THEN (analysis_result ->> 'candidateEvidenceCount')::integer BETWEEN 0 AND 100
                  ELSE false
                END
              )
              OR (
                analysis_result ->> 'version' = 'resume-analysis-storage-v2'
                AND analysis_result
                  - ARRAY['version', 'candidateEvidenceCount', 'documentBlockCount']::text[]
                  = '{}'::jsonb
                AND CASE
                  WHEN
                    jsonb_typeof(analysis_result -> 'candidateEvidenceCount') = 'number'
                    AND analysis_result ->> 'candidateEvidenceCount' ~ '^(0|[1-9][0-9]{0,2})$'
                  THEN (analysis_result ->> 'candidateEvidenceCount')::integer BETWEEN 0 AND 100
                  ELSE false
                END
                AND CASE
                  WHEN
                    jsonb_typeof(analysis_result -> 'documentBlockCount') = 'number'
                    AND analysis_result ->> 'documentBlockCount' ~ '^[1-9][0-9]{0,4}$'
                  THEN (analysis_result ->> 'documentBlockCount')::integer BETWEEN 1 AND 50000
                  ELSE false
                END
              )
            )
          )
        );
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // v2 metadata may already exist; reverting would make valid analyses unreadable.
  },
};
