import {
  JobGraphResultSchema,
  JobGraphEvidencePageSchema,
  type JobGraphScope,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { sql, type Kysely } from "kysely";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { interpretOfficialJob } from "../catalog/job-semantics.js";
import { aggregateCurrentGraph, type GraphRecord } from "./current-graph.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";

async function records(input: { db: Kysely<Database>; owner: OwnerScope; scope: JobGraphScope }) {
  return input.db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    const { rows } = await sql<{
      case_id: string;
      snapshot_id: string;
      revision_id: string;
      title: string;
      company_name: string | null;
      content_text: string;
      created_at: Date;
    }>`
      SELECT DISTINCT ON (revision.snapshot_id, revision.content_revision)
        c.id AS case_id, revision.snapshot_id, revision.id AS revision_id, revision.title, revision.company_name, revision.content_text, revision.created_at
      FROM application.application_cases c
      JOIN application.private_job_snapshots snapshot ON snapshot.owner_id = c.owner_id AND snapshot.owner_epoch = c.owner_epoch AND snapshot.id = c.private_job_snapshot_id AND snapshot.deleted_at IS NULL
      JOIN application.private_job_snapshot_revisions revision ON revision.owner_id = c.owner_id AND revision.owner_epoch = c.owner_epoch AND revision.snapshot_id = snapshot.id AND revision.content_revision = c.job_context_revision
      WHERE c.owner_id = ${input.owner.ownerId}::uuid AND c.owner_epoch = ${input.owner.ownerEpoch} AND c.deleted_at IS NULL AND c.job_context_kind = 'private'
      ORDER BY revision.snapshot_id, revision.content_revision, c.created_at DESC
    `.execute(tx);
    const output: GraphRecord[] = [];
    for (const row of rows) {
      const semantic = interpretOfficialJob({
        jobVersionId: row.revision_id,
        title: row.title,
        requirements: row.content_text,
        responsibilities: "",
        unstructured: true,
      });
      const scope = input.scope;
      if (
        scope.jobFamily &&
        (scope.jobFamily === "unclassified"
          ? semantic.role.primaryFamily !== null
          : !semantic.role.families.includes(scope.jobFamily))
      )
        continue;
      if (scope.subrole && semantic.role.subrole !== scope.subrole) continue;
      if (
        scope.educationLevels.length &&
        !scope.educationLevels.some((level) =>
          level === "unknown"
            ? semantic.educationLevels.length === 0
            : semantic.educationLevels.includes(level),
        )
      )
        continue;
      // Private pasted text has no verified city, batch or recruitment-type field. Do not fabricate those filters.
      if (
        scope.cities.length ||
        scope.batch ||
        scope.recruitmentTypes.some((value) => value !== "unknown")
      )
        continue;
      output.push({
        jobId: row.snapshot_id,
        jobVersionId: row.revision_id,
        caseId: row.case_id,
        context: "private",
        companyId: row.company_name
          ? hashCanonicalJson(row.company_name.normalize("NFKC").trim())
          : null,
        companyName: row.company_name ?? "企业未说明",
        title: row.title,
        verifiedAt: new Date(row.created_at).toISOString(),
        parsed: true,
        atoms: semantic.atoms,
      });
    }
    return output;
  });
}
export async function getPrivateJobGraph(input: Parameters<typeof records>[0]) {
  const rows = await records(input);
  const graph = aggregateCurrentGraph(
    rows,
    input.scope,
    hashCanonicalJson(rows.map((row) => row.jobVersionId)),
  );
  return JobGraphResultSchema.parse({
    ...graph,
    dataset: "private",
    sample: { ...graph.sample, firstVerifiedAt: null, lastVerifiedAt: null },
  });
}
export async function getPrivateGraphEvidence(
  input: Parameters<typeof records>[0] & { key: string; offset: number; limit: number },
) {
  const rows = await records(input);
  const items = rows.flatMap((row) =>
    row.atoms
      .filter((atom) => atom.key === input.key)
      .map((atom) => ({
        jobId: row.jobId,
        jobVersionId: row.jobVersionId,
        companyName: row.companyName,
        title: row.title,
        context: "private",
        caseId: row.caseId,
        atom,
      })),
  );
  return JobGraphEvidencePageSchema.parse({
    items: items.slice(input.offset, input.offset + input.limit),
    total: items.length,
    nextOffset: input.offset + input.limit < items.length ? input.offset + input.limit : null,
  });
}
