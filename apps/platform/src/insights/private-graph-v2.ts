import { GraphEvidenceV2Schema, JOB_DIRECTIONS, PersonalGraphComparisonSchema, ResumeStudioEntrySchema, resumeRichPlain, type GraphItemV2, type JobGraphScope } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { sql, type Kysely } from "kysely";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { interpretJobV2 } from "../catalog/job-semantics-v2.js";
import { aggregateGraphV2, directionsFromCounts, normalizeGraphScopeV2, type GraphRecordV2 } from "./graph-v2.js";

type Input = { db: Kysely<Database>; owner: OwnerScope; scope: JobGraphScope };
async function privateRecords(input: Input) {
  return input.db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    const { rows } = await sql<{ case_id: string; snapshot_id: string; revision_id: string; title: string; company_name: string | null; content_text: string }>`
      SELECT DISTINCT ON(r.snapshot_id,r.content_revision) c.id AS case_id,r.snapshot_id,r.id AS revision_id,r.title,r.company_name,r.content_text
      FROM application.application_cases c JOIN application.private_job_snapshots s ON s.owner_id=c.owner_id AND s.owner_epoch=c.owner_epoch AND s.id=c.private_job_snapshot_id AND s.deleted_at IS NULL
      JOIN application.private_job_snapshot_revisions r ON r.owner_id=c.owner_id AND r.owner_epoch=c.owner_epoch AND r.snapshot_id=s.id AND r.content_revision=c.job_context_revision
      WHERE c.owner_id=${input.owner.ownerId} AND c.owner_epoch=${input.owner.ownerEpoch} AND c.deleted_at IS NULL AND c.job_context_kind='private'
      ORDER BY r.snapshot_id,r.content_revision,c.created_at DESC`.execute(tx);
    const scope = normalizeGraphScopeV2(input.scope);
    return rows.flatMap((r) => {
      const semantic = interpretJobV2({ jobVersionId: r.revision_id, title: r.title, requirements: r.content_text, responsibilities: "", unstructured: true });
      const familyMatch = !scope.jobFamily || (scope.jobFamily === "unclassified" ? semantic.role.families.length === 0 : semantic.role.families.includes(scope.jobFamily));
      if (!familyMatch || (scope.subrole && (scope.subrole === "__general__" ? semantic.role.subrole !== null : scope.subrole !== semantic.role.subrole))) return [];
      if (scope.educationLevels.length && !scope.educationLevels.some((l) => l === "unknown" ? !semantic.educationLevels.length : semantic.educationLevels.includes(l))) return [];
      if (scope.cities.length || scope.batch || scope.recruitmentTypes.some((t) => t !== "unknown")) return [];
      const record: GraphRecordV2 = { jobId: r.snapshot_id, jobVersionId: r.revision_id, caseId: r.case_id, companyId: r.company_name ? hashCanonicalJson(r.company_name.normalize("NFKC").trim()) : null,
        companyName: r.company_name ?? "企业未说明", title: r.title, verifiedAt: null, parsed: true, context: "private", atoms: semantic.atoms };
      return [{ ...record, role: semantic.role }];
    });
  });
}
export async function getPrivateGraphV2(input: Input) {
  const rows = await privateRecords(input);
  return aggregateGraphV2(rows, normalizeGraphScopeV2(input.scope), hashCanonicalJson(rows.map((r) => r.jobVersionId)), "private");
}
export async function getPrivateDirectionsV2(input: Input) {
  const scope = { ...input.scope }; delete scope.jobFamily; delete scope.subrole;
  const rows = await privateRecords({ ...input, scope });
  const counts = new Map<string, { family: typeof JOB_DIRECTIONS[number]["family"] | "unclassified"; subrole: string | null; jobs: number }>();
  for (const r of rows) for (const family of r.role.families.length ? r.role.families : ["unclassified" as const]) {
    const key = `${family}:${r.role.subrole}`, current = counts.get(key) ?? { family, subrole: r.role.subrole, jobs: 0 }; current.jobs++; counts.set(key, current);
  }
  return directionsFromCounts([...counts.values()]);
}
export async function getPrivateEvidenceV2(input: Input & { key: string; offset: number; limit: number }) {
  const rows = await privateRecords(input);
  const items = rows.flatMap((r) => r.atoms.filter((a) => a.key === input.key).map((atom) => ({ jobId: r.jobId, jobVersionId: r.jobVersionId, companyName: r.companyName, title: r.title, context: "private", caseId: r.caseId, atom })));
  return GraphEvidenceV2Schema.parse({ items: items.slice(input.offset, input.offset + input.limit), total: items.length, nextOffset: input.offset + input.limit < items.length ? input.offset + input.limit : null });
}
export async function compareExperiencesV2(input: { db: Kysely<Database>; owner: OwnerScope; item: GraphItemV2 }) {
  return input.db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    const { rows } = await sql<{ id: string; revision: number; title: string; entry: unknown }>`SELECT id,revision,title,entry FROM profile.experiences WHERE owner_id=${input.owner.ownerId} AND owner_epoch=${input.owner.ownerEpoch} ORDER BY updated_at DESC,id`.execute(tx);
    const candidates = rows.flatMap((r) => {
      const entry = ResumeStudioEntrySchema.parse(r.entry), statement = resumeRichPlain(entry.body);
      const indexed = interpretJobV2({ jobVersionId: r.id, title: entry.title, requirements: "", responsibilities: [entry.role, statement].join("\n") });
      if (!indexed.atoms.some((a) => a.key === input.item.key && !a.negated)) return [];
      return [{ evidenceId: null, experienceId: r.id, experienceRevision: r.revision, title: r.title, statement,
        section: [entry.organization, entry.role].filter(Boolean).join(" · ") || r.title, reason: "这段完整经历中有相关任务或工具的线索，可继续核对具体做法" }];
    }).slice(0, 10);
    return PersonalGraphComparisonSchema.parse({ key: input.item.key, evidenceRevisionId: null, mode: "rules-reference", candidates });
  });
}
