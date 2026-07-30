import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

/**
 * A source revision can change because the adapter/normalizer version changed
 * even when the published job semantics did not. Keep that observation link
 * separate from the immutable published version so one semantic version can
 * remain current for multiple equivalent source revisions.
 */
export const linkSourceRevisionsToPublishedVersionsMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      CREATE TABLE catalog.published_job_version_revision_links (
        published_job_version_id uuid NOT NULL
          REFERENCES catalog.published_job_versions(id) ON DELETE CASCADE,
        source_job_revision_id uuid NOT NULL
          REFERENCES ingestion.source_job_revisions(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (published_job_version_id, source_job_revision_id)
      );

      CREATE INDEX published_job_revision_links_source_revision_idx
        ON catalog.published_job_version_revision_links(source_job_revision_id);

      INSERT INTO catalog.published_job_version_revision_links (
        published_job_version_id,
        source_job_revision_id
      )
      SELECT id, source_job_revision_id
      FROM catalog.published_job_versions
      ON CONFLICT DO NOTHING;
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      DROP TABLE catalog.published_job_version_revision_links;
    `.execute(db);
  },
};
