import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

export const g2CorrectnessFoundationsMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE catalog.published_job_versions
        ADD COLUMN active_requirement_set_id uuid
          REFERENCES catalog.job_requirement_sets(id);

      CREATE TABLE catalog.job_condition_projections (
        published_job_version_id uuid PRIMARY KEY
          REFERENCES catalog.published_job_versions(id) ON DELETE CASCADE,
        requirement_set_id uuid NOT NULL UNIQUE
          REFERENCES catalog.job_requirement_sets(id) ON DELETE CASCADE,
        locations jsonb NOT NULL,
        weekly_attendance_days jsonb NOT NULL,
        duration_months jsonb NOT NULL,
        earliest_start_date jsonb NOT NULL,
        graduation_years jsonb NOT NULL,
        student_status jsonb NOT NULL,
        education_levels jsonb NOT NULL,
        majors jsonb NOT NULL,
        languages jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE profile.resume_document_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES identity.owners(id),
        owner_epoch bigint NOT NULL CHECK (owner_epoch > 0),
        resume_analysis_id uuid,
        revision integer NOT NULL CHECK (revision > 0),
        base_revision integer,
        schema_version text NOT NULL,
        sections jsonb NOT NULL CHECK (jsonb_typeof(sections) = 'array'),
        content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
        confirmed_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (owner_id, revision),
        UNIQUE (owner_id, id),
        FOREIGN KEY (owner_id, base_revision)
          REFERENCES profile.resume_document_revisions(owner_id, revision),
        FOREIGN KEY (owner_id, resume_analysis_id)
          REFERENCES profile.resume_analyses(owner_id, id)
          ON DELETE SET NULL (resume_analysis_id)
      );

      ALTER TABLE profile.resume_evidence_revisions
        ADD COLUMN schema_version text NOT NULL DEFAULT 'resume-evidence-v1',
        ADD COLUMN document_revision_id uuid,
        ADD CONSTRAINT resume_evidence_revisions_owner_document_fk
          FOREIGN KEY (owner_id, document_revision_id)
          REFERENCES profile.resume_document_revisions(owner_id, id);

      ALTER TABLE matching.recommendation_runs
        ADD COLUMN candidate_requirement_set_ids jsonb NOT NULL DEFAULT '[]'::jsonb
          CHECK (jsonb_typeof(candidate_requirement_set_ids) = 'array'),
        ADD COLUMN resume_document_revision_id uuid,
        ADD CONSTRAINT recommendation_runs_owner_document_fk
          FOREIGN KEY (owner_id, resume_document_revision_id)
          REFERENCES profile.resume_document_revisions(owner_id, id);

      ALTER TABLE matching.recommendation_items
        ADD COLUMN basis_state text NOT NULL DEFAULT 'insufficient'
          CHECK (basis_state IN ('complete', 'partial', 'insufficient')),
        ADD COLUMN coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN gaps jsonb NOT NULL DEFAULT '[]'::jsonb
          CHECK (jsonb_typeof(gaps) = 'array');

      ALTER TABLE matching.resume_tailoring_runs
        ALTER COLUMN resume_analysis_id DROP NOT NULL,
        ADD COLUMN resume_document_revision_id uuid,
        ADD CONSTRAINT tailoring_runs_owner_document_fk
          FOREIGN KEY (owner_id, resume_document_revision_id)
          REFERENCES profile.resume_document_revisions(owner_id, id);

      ALTER TABLE matching.resume_tailoring_segments
        ADD COLUMN source_block_id uuid,
        ADD COLUMN section_id uuid,
        ADD COLUMN section_title text;

      CREATE INDEX resume_document_revisions_owner_created_idx
        ON profile.resume_document_revisions(owner_id, created_at DESC);

      CREATE TRIGGER resume_document_revisions_no_update
        BEFORE UPDATE ON profile.resume_document_revisions
        FOR EACH ROW EXECUTE FUNCTION profile.prevent_revision_update();
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Correctness revisions are immutable user and catalog history; rollback is forward-only.
  },
};
