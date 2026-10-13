import { type Migration, sql } from "kysely";
/** Keep pinned job/base references and historical evidence; evidence is no longer an admission gate. */
export const resumeDerivationWithoutEvidenceGate: Migration = {
  async up(db) {
    await sql`
      ALTER TABLE profile.resume_documents DROP CONSTRAINT resume_documents_forward_reference_pair;
      ALTER TABLE profile.resume_documents ADD CONSTRAINT resume_documents_forward_reference_pair CHECK (
        (kind = 'base' AND num_nulls(case_id, published_job_id, published_job_version_id, requirement_set_id, private_job_snapshot_id, job_context_kind, job_context_revision, detached_from_case_id, base_document_id, base_document_revision_id, evidence_revision_id) = 11)
        OR (kind = 'case_derived' AND num_nulls(case_id, detached_from_case_id) = 1
          AND job_context_revision IS NOT NULL AND base_document_id IS NOT NULL AND base_document_revision_id IS NOT NULL
          AND ((job_context_kind = 'public' AND published_job_id IS NOT NULL AND published_job_version_id IS NOT NULL AND requirement_set_id IS NOT NULL AND private_job_snapshot_id IS NULL)
            OR (job_context_kind = 'private' AND published_job_id IS NULL AND published_job_version_id IS NULL AND requirement_set_id IS NULL AND private_job_snapshot_id IS NOT NULL)))
      );
    `.execute(db);
  },
  async down() {
    throw new Error("Forward-only: preserve documents created without historical evidence.");
  },
};
