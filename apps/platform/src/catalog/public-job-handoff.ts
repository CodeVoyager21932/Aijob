import type { ApplicationHandoff, ApplicationLinkKind } from "@aijob/contracts";
import { ApplicationLinkKindSchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { Kysely, Transaction } from "kysely";
import { buildApplicationHandoff, exactOfficialLink } from "./application-handoff.js";
import { approvedOfficialLinks } from "./repository.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

/**
 * The raw public-version fields a read model needs to build an honest application handoff.
 * These come straight from `catalog.published_job_versions` plus the owning source id, and the
 * apply URL is only actionable once it survives the current navigation allowlist.
 */
export interface PublicJobHandoffInput {
  sourceId: string;
  applyUrl: string | null;
  applicationLinkKind: ApplicationLinkKind;
  title: string;
  sourceJobId: string;
}

export interface PublicJobHandoff {
  applicationHandoff: ApplicationHandoff;
  /** Exact-only compatibility URL: null for fallback and missing. Never `source_url`. */
  officialUrl: string | null;
}

/**
 * Builds the application handoff for a single public job reference (Case / interview / resume
 * read models load one row at a time). The stored apply URL is re-validated against the source's
 * current allowlist before it can become `exact` or `official_list_fallback`; a rejected or
 * absent URL collapses to `missing`. We never substitute `source_url` for a missing apply entry.
 */
export async function resolvePublicJobHandoff(
  db: DbExecutor,
  input: PublicJobHandoffInput,
): Promise<PublicJobHandoff> {
  const approved = await approvedOfficialLinks(db, [
    { key: input.sourceId, sourceId: input.sourceId, applyUrl: input.applyUrl },
  ]);
  const approvedApplyUrl = approved.get(input.sourceId) ?? null;
  const applicationHandoff = buildApplicationHandoff({
    applicationLinkKind: input.applicationLinkKind,
    approvedApplyUrl,
    title: input.title,
    sourceJobId: input.sourceJobId,
  });
  return {
    applicationHandoff,
    officialUrl: exactOfficialLink(applicationHandoff),
  };
}

/** One allowlist query for a whole collection, keyed by row rather than source/URL. */
export async function resolvePublicJobHandoffs(
  db: DbExecutor,
  inputs: PublicJobHandoffInput[],
): Promise<PublicJobHandoff[]> {
  const approved = await approvedOfficialLinks(
    db,
    inputs.map((input, index) => ({
      key: String(index),
      sourceId: input.sourceId,
      applyUrl: input.applyUrl,
    })),
  );
  return inputs.map((input, index) => {
    const applicationHandoff = buildApplicationHandoff({
      ...input,
      approvedApplyUrl: approved.get(String(index)) ?? null,
    });
    return { applicationHandoff, officialUrl: exactOfficialLink(applicationHandoff) };
  });
}

export async function loadPublicJobHandoffs(
  db: DbExecutor,
  versionIds: string[],
): Promise<Map<string, PublicJobHandoff>> {
  if (versionIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("catalog.published_job_versions as version")
    .innerJoin(
      "ingestion.source_job_revisions as revision",
      "revision.id",
      "version.source_job_revision_id",
    )
    .innerJoin(
      "ingestion.source_job_records as record",
      "record.id",
      "revision.source_job_record_id",
    )
    .select([
      "version.id",
      "version.title",
      "version.apply_url",
      "version.application_link_kind",
      "record.source_id",
      "record.source_job_id",
    ])
    .where("version.id", "in", [...new Set(versionIds)])
    .execute();
  const handoffs = await resolvePublicJobHandoffs(
    db,
    rows.map((row) => ({
      sourceId: row.source_id,
      applyUrl: row.apply_url,
      applicationLinkKind: ApplicationLinkKindSchema.parse(row.application_link_kind),
      title: row.title,
      sourceJobId: row.source_job_id,
    })),
  );
  return new Map(rows.map((row, index) => [row.id, handoffs[index] ?? missingPublicJobHandoff]));
}

export const missingPublicJobHandoff: PublicJobHandoff = {
  officialUrl: null,
  applicationHandoff: { kind: "missing", reasonCode: "APPLICATION_LINK_MISSING" },
};
