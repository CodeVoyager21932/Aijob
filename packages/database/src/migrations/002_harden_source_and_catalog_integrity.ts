import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

async function createInternalJobPreviewsView(
  db: Kysely<Database>,
  sourceTypeMode: "stored" | "legacy",
): Promise<void> {
  const sourceTypeExpression =
    sourceTypeMode === "stored" ? sql`source.source_type` : sql`'organization_career_site'::text`;

  await sql`
    CREATE VIEW catalog.internal_job_previews AS
    SELECT
      record.id AS job_id,
      revision.id AS revision_id,
      record.source_job_id,
      source.id AS source_id,
      source.source_key,
      source.name AS source_name,
      revision.company_name,
      organization.official_domain,
      ${sourceTypeExpression} AS source_type,
      policy.provenance_level,
      policy.policy_status,
      revision.title,
      revision.job_family,
      revision.locations,
      revision.business_groups,
      revision.entry_scope,
      revision.source_project_name,
      revision.recruit_label_name,
      revision.recruitment_type,
      revision.responsibilities,
      revision.requirements,
      revision.import_mode,
      revision.structured_fields,
      revision.ingestion_state,
      revision.publication_state,
      revision.activity_state,
      revision.source_url,
      revision.apply_url,
      revision.quality_flags,
      COALESCE(
        (
          SELECT jsonb_agg(item.reason_code ORDER BY item.reason_code)
          FROM ingestion.review_items AS item
          WHERE item.revision_id = revision.id AND item.status = 'open'
        ),
        '[]'::jsonb
      ) AS review_reasons,
      record.first_seen_at,
      record.last_seen_at AS last_verified_at
    FROM ingestion.source_job_records AS record
    JOIN LATERAL (
      SELECT candidate_revision.*
      FROM ingestion.source_job_revisions AS candidate_revision
      WHERE candidate_revision.source_job_record_id = record.id
      ORDER BY candidate_revision.created_at DESC, candidate_revision.id DESC
      LIMIT 1
    ) AS revision ON true
    JOIN source_control.sources AS source ON source.id = record.source_id
    JOIN source_control.organizations AS organization ON organization.id = source.organization_id
    JOIN source_control.source_policy_versions AS policy
      ON policy.source_id = source.id
      AND policy.version = source.current_policy_version;
  `.execute(db);
}

async function assertIntegrityMigration(db: Kysely<Database>): Promise<void> {
  const sameJobConstraint = await sql<{ definition: string }>`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conname = 'published_jobs_current_version_same_job_fk'
  `.execute(db);
  const definition = sameJobConstraint.rows[0]?.definition ?? "";
  if (
    !definition.includes("FOREIGN KEY (id, current_version_id)") ||
    !definition.includes("published_job_versions(published_job_id, id)")
  ) {
    throw new Error("MIGRATION_ASSERTION_FAILED: current version must belong to the same job");
  }

  const previewView = await sql<{ definition: string }>`
    SELECT pg_get_viewdef('catalog.internal_job_previews'::regclass, true) AS definition
  `.execute(db);
  if (!previewView.rows[0]?.definition.includes("source.source_type")) {
    throw new Error("MIGRATION_ASSERTION_FAILED: preview must read the stored source type");
  }
}

export const hardenSourceAndCatalogIntegrityMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`DROP VIEW catalog.internal_job_previews`.execute(db);

    await sql`
      ALTER TABLE source_control.sources
        ADD COLUMN source_type text;

      UPDATE source_control.sources
      SET source_type = 'organization_career_site'
      WHERE source_type IS NULL;

      ALTER TABLE source_control.sources
        ALTER COLUMN source_type SET NOT NULL,
        ADD CONSTRAINT sources_source_type_check CHECK (
          source_type IN (
            'organization_career_site',
            'official_ats',
            'university_employment_site'
          )
        );

      ALTER TABLE catalog.published_job_versions
        ADD CONSTRAINT published_job_versions_published_job_id_id_unique
        UNIQUE (published_job_id, id);

      ALTER TABLE catalog.published_jobs
        DROP CONSTRAINT published_jobs_current_version_fk,
        ADD CONSTRAINT published_jobs_current_version_same_job_fk
        FOREIGN KEY (id, current_version_id)
        REFERENCES catalog.published_job_versions(published_job_id, id);
    `.execute(db);

    await createInternalJobPreviewsView(db, "stored");
    await assertIntegrityMigration(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`DROP VIEW catalog.internal_job_previews`.execute(db);

    await sql`
      ALTER TABLE catalog.published_jobs
        DROP CONSTRAINT published_jobs_current_version_same_job_fk,
        ADD CONSTRAINT published_jobs_current_version_fk
        FOREIGN KEY (current_version_id) REFERENCES catalog.published_job_versions(id);

      ALTER TABLE catalog.published_job_versions
        DROP CONSTRAINT published_job_versions_published_job_id_id_unique;

      ALTER TABLE source_control.sources
        DROP COLUMN source_type;
    `.execute(db);

    await createInternalJobPreviewsView(db, "legacy");
  },
};
