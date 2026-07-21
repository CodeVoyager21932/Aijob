import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

export const employerScaleAndJobInsightsMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE source_control.sources
        DROP CONSTRAINT sources_source_type_check,
        ADD CONSTRAINT sources_source_type_check CHECK (
          source_type IN (
            'organization_career_site',
            'organization_official_account',
            'official_ats',
            'university_employment_site'
          )
        );

      ALTER TABLE source_control.organizations
        ADD COLUMN scale_band text NOT NULL DEFAULT 'unknown',
        ADD COLUMN scale_evidence_url text,
        ADD COLUMN scale_evidence_text text,
        ADD COLUMN scale_verified_at timestamptz,
        ADD CONSTRAINT organizations_scale_band_check CHECK (
          scale_band IN ('small', 'medium', 'large', 'unknown')
        ),
        ADD CONSTRAINT organizations_scale_evidence_check CHECK (
          (
            scale_band = 'unknown'
            AND scale_evidence_url IS NULL
            AND scale_evidence_text IS NULL
            AND scale_verified_at IS NULL
          ) OR (
            scale_band <> 'unknown'
            AND scale_evidence_url IS NOT NULL
            AND scale_evidence_url ~ '^https://'
            AND scale_evidence_text IS NOT NULL
            AND length(trim(scale_evidence_text)) > 0
            AND scale_verified_at IS NOT NULL
          )
        );

      CREATE TABLE matching.job_insight_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
        evidence_revision_id uuid,
        candidate_job_version_ids jsonb NOT NULL CHECK (
          jsonb_typeof(candidate_job_version_ids) = 'array'
        ),
        candidate_requirement_set_ids jsonb NOT NULL CHECK (
          jsonb_typeof(candidate_requirement_set_ids) = 'array'
        ),
        data_version_hash text NOT NULL CHECK (data_version_hash ~ '^[a-f0-9]{64}$'),
        request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        idempotency_key text NOT NULL,
        algorithm_version text NOT NULL CHECK (algorithm_version = 'job-market-insight-v1'),
        result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz NOT NULL,
        UNIQUE (owner_id, id),
        UNIQUE (owner_id, idempotency_key),
        FOREIGN KEY (owner_id, evidence_revision_id)
          REFERENCES profile.resume_evidence_revisions(owner_id, id)
      );

      CREATE INDEX job_insight_runs_owner_created_idx
        ON matching.job_insight_runs(owner_id, created_at DESC);

      CREATE TRIGGER job_insight_runs_no_update
        BEFORE UPDATE ON matching.job_insight_runs
        FOR EACH ROW EXECUTE FUNCTION profile.prevent_revision_update();
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      DROP TRIGGER job_insight_runs_no_update ON matching.job_insight_runs;
      DROP TABLE matching.job_insight_runs;

      ALTER TABLE source_control.organizations
        DROP CONSTRAINT organizations_scale_evidence_check,
        DROP CONSTRAINT organizations_scale_band_check,
        DROP COLUMN scale_verified_at,
        DROP COLUMN scale_evidence_text,
        DROP COLUMN scale_evidence_url,
        DROP COLUMN scale_band;

      ALTER TABLE source_control.sources
        DROP CONSTRAINT sources_source_type_check,
        ADD CONSTRAINT sources_source_type_check CHECK (
          source_type IN (
            'organization_career_site',
            'official_ats',
            'university_employment_site'
          )
        );
    `.execute(db);
  },
};
