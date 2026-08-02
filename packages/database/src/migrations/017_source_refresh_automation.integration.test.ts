import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../index.js";
import { migrateToLatest } from "../migrate.js";
import { backfillHistoricalPublicVersionPointers } from "./017_source_refresh_automation.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("source refresh automation migration", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");

  beforeAll(async () => {
    await migrateToLatest(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("backfills the latest historically published version after current advanced to review", async () => {
    const rollbackSignal = new Error("ROLLBACK_PUBLIC_VERSION_BACKFILL_FIXTURE");

    await expect(
      db.transaction().execute(async (transaction) => {
        const organizationId = randomUUID();
        const sourceId = randomUUID();
        const recordId = randomUUID();
        const jobId = randomUUID();
        const versions = {
          olderPublished: randomUUID(),
          tieLowPublished: randomUUID(),
          tieHighPublished: randomUUID(),
          currentReview: randomUUID(),
          rejectedPublished: randomUUID(),
        };
        const revisions = {
          olderPublished: "00000000-0000-4000-8000-000000000101",
          tieLowPublished: "00000000-0000-4000-8000-000000000102",
          tieHighPublished: "00000000-0000-4000-8000-000000000103",
          currentReview: "00000000-0000-4000-8000-000000000104",
          rejectedPublished: "00000000-0000-4000-8000-000000000105",
        };
        const publishedAt = new Date("2026-07-30T08:00:00.000Z");
        const sourceUrl = `https://migration-pointer-${recordId}.example.test/jobs/1`;

        await transaction
          .insertInto("source_control.organizations")
          .values({
            id: organizationId,
            slug: `migration-pointer-${organizationId}`,
            name: "Migration Pointer Test Company",
            official_domain: "migration-pointer.example.test",
          })
          .execute();
        await transaction
          .insertInto("source_control.sources")
          .values({
            id: sourceId,
            organization_id: organizationId,
            source_candidate_id: null,
            source_key: `migration-pointer-${sourceId}`,
            source_type: "organization_career_site",
            name: "Migration Pointer Test Source",
            current_policy_version: 1,
          })
          .execute();
        await transaction
          .insertInto("ingestion.source_job_records")
          .values({
            id: recordId,
            source_id: sourceId,
            source_job_id: `migration-pointer-${recordId}`,
            canonical_source_url: sourceUrl,
            first_seen_at: new Date("2026-07-29T08:00:00.000Z"),
            last_seen_at: new Date("2026-08-01T08:00:00.000Z"),
          })
          .execute();

        const revision = (input: {
          id: string;
          hashCharacter: string;
          title: string;
          createdAt: Date;
          ingestionState: "validated" | "rejected";
          publicationState: "published" | "review";
        }) => ({
          id: input.id,
          source_job_record_id: recordId,
          revision_content_hash: input.hashCharacter.repeat(64),
          import_mode: "manual" as const,
          adapter_version: "1",
          normalizer_version: "1",
          company_name: "Migration Pointer Test Company",
          title: input.title,
          job_family: JSON.stringify({
            state: "known",
            value: "product",
            evidenceRefs: [`${input.id}#family`],
          }),
          locations: JSON.stringify({
            state: "known",
            value: ["Shanghai"],
            evidenceRefs: [`${input.id}#location`],
          }),
          business_groups: JSON.stringify([]),
          entry_scope: "internship",
          source_project_name: null,
          recruit_label_name: "internship",
          recruitment_type: JSON.stringify({
            state: "known",
            value: "internship",
            evidenceRefs: [`${input.id}#type`],
          }),
          responsibilities: `Responsibilities for ${input.title}.`,
          requirements: "Current student with product research experience.",
          structured_fields: JSON.stringify({}),
          ingestion_state: input.ingestionState,
          publication_state: input.publicationState,
          activity_state: "active",
          source_url: sourceUrl,
          apply_url: `${sourceUrl}/apply`,
          quality_flags: JSON.stringify([]),
          created_at: input.createdAt,
        });

        await transaction
          .insertInto("ingestion.source_job_revisions")
          .values([
            revision({
              id: revisions.olderPublished,
              hashCharacter: "1",
              title: "Older Published Role",
              createdAt: new Date("2026-07-29T08:00:00.000Z"),
              ingestionState: "validated",
              publicationState: "published",
            }),
            revision({
              id: revisions.tieLowPublished,
              hashCharacter: "2",
              title: "Tie Low Published Role",
              createdAt: publishedAt,
              ingestionState: "validated",
              publicationState: "published",
            }),
            revision({
              id: revisions.tieHighPublished,
              hashCharacter: "3",
              title: "Tie High Published Role",
              createdAt: publishedAt,
              ingestionState: "validated",
              publicationState: "published",
            }),
            revision({
              id: revisions.currentReview,
              hashCharacter: "4",
              title: "Current Review Role",
              createdAt: new Date("2026-07-31T08:00:00.000Z"),
              ingestionState: "validated",
              publicationState: "review",
            }),
            revision({
              id: revisions.rejectedPublished,
              hashCharacter: "5",
              title: "Rejected Published Role",
              createdAt: new Date("2026-08-01T08:00:00.000Z"),
              ingestionState: "rejected",
              publicationState: "published",
            }),
          ])
          .execute();

        await transaction
          .insertInto("catalog.published_jobs")
          .values({ id: jobId, current_version_id: null, public_version_id: null })
          .execute();

        const version = (input: {
          id: string;
          revisionId: string;
          hashCharacter: string;
          title: string;
          effectiveAt: Date;
        }) => ({
          id: input.id,
          published_job_id: jobId,
          source_job_revision_id: input.revisionId,
          content_hash: input.hashCharacter.repeat(64),
          company_name: "Migration Pointer Test Company",
          title: input.title,
          job_family: JSON.stringify({ state: "known", value: "product", evidenceRefs: [] }),
          locations: JSON.stringify({ state: "known", value: ["Shanghai"], evidenceRefs: [] }),
          responsibilities: `Responsibilities for ${input.title}.`,
          requirements: "Current student with product research experience.",
          structured_fields: JSON.stringify({}),
          activity_state: "active",
          source_url: sourceUrl,
          apply_url: `${sourceUrl}/apply`,
          effective_at: input.effectiveAt,
        });

        await transaction
          .insertInto("catalog.published_job_versions")
          .values([
            version({
              id: versions.olderPublished,
              revisionId: revisions.olderPublished,
              hashCharacter: "a",
              title: "Older Published Role",
              effectiveAt: new Date("2026-07-29T08:00:00.000Z"),
            }),
            version({
              id: versions.tieLowPublished,
              revisionId: revisions.tieLowPublished,
              hashCharacter: "b",
              title: "Tie Low Published Role",
              effectiveAt: publishedAt,
            }),
            version({
              id: versions.tieHighPublished,
              revisionId: revisions.tieHighPublished,
              hashCharacter: "c",
              title: "Tie High Published Role",
              effectiveAt: publishedAt,
            }),
            version({
              id: versions.currentReview,
              revisionId: revisions.currentReview,
              hashCharacter: "d",
              title: "Current Review Role",
              effectiveAt: new Date("2026-07-31T08:00:00.000Z"),
            }),
            version({
              id: versions.rejectedPublished,
              revisionId: revisions.rejectedPublished,
              hashCharacter: "e",
              title: "Rejected Published Role",
              effectiveAt: new Date("2026-08-01T08:00:00.000Z"),
            }),
          ])
          .execute();
        await transaction
          .insertInto("catalog.published_job_version_revision_links")
          .values([
            {
              published_job_version_id: versions.olderPublished,
              source_job_revision_id: revisions.olderPublished,
            },
            {
              published_job_version_id: versions.tieLowPublished,
              source_job_revision_id: revisions.tieLowPublished,
            },
            {
              published_job_version_id: versions.tieHighPublished,
              source_job_revision_id: revisions.tieHighPublished,
            },
            {
              published_job_version_id: versions.currentReview,
              source_job_revision_id: revisions.currentReview,
            },
            {
              published_job_version_id: versions.rejectedPublished,
              source_job_revision_id: revisions.rejectedPublished,
            },
          ])
          .execute();
        await transaction
          .updateTable("catalog.published_jobs")
          .set({ current_version_id: versions.currentReview, public_version_id: null })
          .where("id", "=", jobId)
          .executeTakeFirstOrThrow();

        await backfillHistoricalPublicVersionPointers(transaction);

        const pointers = await transaction
          .selectFrom("catalog.published_jobs")
          .select(["current_version_id", "public_version_id"])
          .where("id", "=", jobId)
          .executeTakeFirstOrThrow();
        expect(pointers).toEqual({
          current_version_id: versions.currentReview,
          public_version_id: versions.tieHighPublished,
        });

        throw rollbackSignal;
      }),
    ).rejects.toBe(rollbackSignal);
  }, 15_000);
});
