import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

export const enforceCorrectnessProjectionOwnershipMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE catalog.job_requirement_sets
        ADD CONSTRAINT job_requirement_sets_version_id_unique
          UNIQUE (published_job_version_id, id);

      ALTER TABLE catalog.published_job_versions
        ADD CONSTRAINT published_job_versions_active_requirement_set_owner_fk
          FOREIGN KEY (id, active_requirement_set_id)
          REFERENCES catalog.job_requirement_sets(published_job_version_id, id);

      ALTER TABLE catalog.job_condition_projections
        ADD CONSTRAINT job_condition_projections_requirement_set_owner_fk
          FOREIGN KEY (published_job_version_id, requirement_set_id)
          REFERENCES catalog.job_requirement_sets(published_job_version_id, id)
          ON DELETE CASCADE;

      ALTER TABLE profile.resume_document_revisions
        ADD CONSTRAINT resume_document_revisions_schema_version
          CHECK (schema_version = 'resume-document-v1');

      ALTER TABLE profile.resume_evidence_revisions
        ADD CONSTRAINT resume_evidence_revisions_schema_document_pair
          CHECK (
            (schema_version = 'resume-evidence-v1' AND document_revision_id IS NULL)
            OR
            (schema_version = 'resume-evidence-v2' AND document_revision_id IS NOT NULL)
          );

      ALTER TABLE matching.resume_tailoring_segments
        ADD CONSTRAINT resume_tailoring_segments_block_identity_pair
          CHECK (num_nulls(source_block_id, section_id, section_title) IN (0, 3));
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // These ownership constraints protect immutable correctness history and are forward-only.
  },
};
