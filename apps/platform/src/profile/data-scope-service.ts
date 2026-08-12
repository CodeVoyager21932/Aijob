import {
  type CareerDataScopeCounts,
  type CareerDataScopeResponse,
  CareerDataScopeResponseSchema,
  type DetachedCareerAsset,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import {
  assertActiveOwnerEpoch,
  getCareerOwner,
  type OwnerContext,
} from "../identity/session-repository.js";

const DETACHED_ASSET_LIMIT = 5_000;

interface CountsRow {
  current_facts: number;
  current_preferences: number;
  current_evidence: number;
  profile_fact_revisions: number;
  preference_revisions: number;
  evidence_revisions: number;
  resume_document_revisions: number;
  resume_analysis_metadata: number;
  resume_analysis_content_pending_deletion: number;
  application_cases: number;
  private_job_snapshots: number;
  resume_documents: number;
  detached_resume_documents: number;
  resume_review_runs: number;
  interview_sessions: number;
  detached_interview_sessions: number;
  debriefs: number;
  detached_debriefs: number;
  knowledge_clips: number;
  legacy_job_decisions: number;
  legacy_match_runs: number;
  legacy_recommendation_runs: number;
  legacy_insight_runs: number;
  legacy_tailoring_runs: number;
  legacy_exports: number;
  deletion_audits: number;
}

interface DetachedAssetRow {
  id: string;
  revision: number;
  status: string;
  created_at: Date | string;
  public_title: string | null;
  public_company_name: string | null;
  private_title: string | null;
  private_company_name: string | null;
}

function asCount(value: number): number {
  return Number(value);
}

function toCounts(row: CountsRow): CareerDataScopeCounts {
  return {
    currentFacts: asCount(row.current_facts),
    currentPreferences: asCount(row.current_preferences),
    currentEvidence: asCount(row.current_evidence),
    profileFactRevisions: asCount(row.profile_fact_revisions),
    preferenceRevisions: asCount(row.preference_revisions),
    evidenceRevisions: asCount(row.evidence_revisions),
    resumeDocumentRevisions: asCount(row.resume_document_revisions),
    resumeAnalysisMetadata: asCount(row.resume_analysis_metadata),
    resumeAnalysisContentPendingDeletion: asCount(row.resume_analysis_content_pending_deletion),
    applicationCases: asCount(row.application_cases),
    privateJobSnapshots: asCount(row.private_job_snapshots),
    resumeDocuments: asCount(row.resume_documents),
    detachedResumeDocuments: asCount(row.detached_resume_documents),
    resumeReviewRuns: asCount(row.resume_review_runs),
    interviewSessions: asCount(row.interview_sessions),
    detachedInterviewSessions: asCount(row.detached_interview_sessions),
    debriefs: asCount(row.debriefs),
    detachedDebriefs: asCount(row.detached_debriefs),
    knowledgeClips: asCount(row.knowledge_clips),
    legacyJobDecisions: asCount(row.legacy_job_decisions),
    legacyMatchRuns: asCount(row.legacy_match_runs),
    legacyRecommendationRuns: asCount(row.legacy_recommendation_runs),
    legacyInsightRuns: asCount(row.legacy_insight_runs),
    legacyTailoringRuns: asCount(row.legacy_tailoring_runs),
    legacyExports: asCount(row.legacy_exports),
    deletionAudits: asCount(row.deletion_audits),
  };
}

async function loadCounts(
  db: Kysely<Database>,
  owner: OwnerContext,
): Promise<CareerDataScopeCounts> {
  const result = await sql<CountsRow>`
    SELECT
      COALESCE((
        SELECT jsonb_array_length(facts)
        FROM profile.profile_fact_revisions
        WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}
        ORDER BY revision DESC LIMIT 1
      ), 0)::integer AS current_facts,
      COALESCE((
        SELECT 1
        FROM profile.job_preference_revisions
        WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}
        ORDER BY revision DESC LIMIT 1
      ), 0)::integer AS current_preferences,
      COALESCE((
        SELECT jsonb_array_length(evidence)
        FROM profile.resume_evidence_revisions
        WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}
        ORDER BY revision DESC LIMIT 1
      ), 0)::integer AS current_evidence,
      (SELECT count(*)::integer FROM profile.profile_fact_revisions WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}) AS profile_fact_revisions,
      (SELECT count(*)::integer FROM profile.job_preference_revisions WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}) AS preference_revisions,
      (SELECT count(*)::integer FROM profile.resume_evidence_revisions WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}) AS evidence_revisions,
      (SELECT count(*)::integer FROM profile.resume_document_revisions WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}) AS resume_document_revisions,
      (SELECT count(*)::integer FROM profile.resume_analyses WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}) AS resume_analysis_metadata,
      (SELECT count(*)::integer FROM profile.resume_analyses WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch} AND purged_at IS NULL AND (raw_ciphertext IS NOT NULL OR extracted_text_ciphertext IS NOT NULL OR analysis_result IS NOT NULL)) AS resume_analysis_content_pending_deletion,
      (SELECT count(*)::integer FROM application.application_cases WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch} AND deleted_at IS NULL) AS application_cases,
      (SELECT count(*)::integer FROM application.private_job_snapshots WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch} AND deleted_at IS NULL) AS private_job_snapshots,
      (SELECT count(*)::integer FROM profile.resume_documents WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch} AND deleted_at IS NULL) AS resume_documents,
      (SELECT count(*)::integer FROM profile.resume_documents WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch} AND deleted_at IS NULL AND detached_from_case_id IS NOT NULL) AS detached_resume_documents,
      (SELECT count(*)::integer FROM profile.resume_review_runs WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch} AND deleted_at IS NULL) AS resume_review_runs,
      (SELECT count(*)::integer FROM application.interview_sessions WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch} AND deleted_at IS NULL) AS interview_sessions,
      (SELECT count(*)::integer FROM application.interview_sessions WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch} AND deleted_at IS NULL AND detached_from_case_id IS NOT NULL) AS detached_interview_sessions,
      (SELECT count(*)::integer FROM application.debriefs WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch} AND deleted_at IS NULL) AS debriefs,
      (SELECT count(*)::integer FROM application.debriefs WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch} AND deleted_at IS NULL AND detached_from_case_id IS NOT NULL) AS detached_debriefs,
      (SELECT count(*)::integer FROM application.knowledge_clips WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch} AND deleted_at IS NULL) AS knowledge_clips,
      (SELECT count(*)::integer FROM decision.job_decisions WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}) AS legacy_job_decisions,
      (SELECT count(*)::integer FROM matching.match_runs WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}) AS legacy_match_runs,
      (SELECT count(*)::integer FROM matching.recommendation_runs WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}) AS legacy_recommendation_runs,
      (SELECT count(*)::integer FROM matching.job_insight_runs WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}) AS legacy_insight_runs,
      (SELECT count(*)::integer FROM matching.resume_tailoring_runs WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}) AS legacy_tailoring_runs,
      (SELECT count(*)::integer FROM matching.resume_exports WHERE owner_id = ${owner.ownerId} AND owner_epoch = ${owner.ownerEpoch}) AS legacy_exports,
      (SELECT count(*)::integer FROM decision.owner_deletions WHERE owner_id = ${owner.ownerId} AND requested_owner_epoch = ${owner.ownerEpoch}) AS deletion_audits
  `.execute(db);
  const row = result.rows[0];
  if (!row) throw new Error("CAREER_DATA_SCOPE_COUNTS_MISSING");
  return toCounts(row);
}

async function loadDetachedInterviewSessions(
  db: Kysely<Database>,
  owner: OwnerContext,
): Promise<DetachedAssetRow[]> {
  return db
    .selectFrom("application.interview_sessions as asset")
    .leftJoin(
      "catalog.published_job_versions as public_job",
      "public_job.id",
      "asset.published_job_version_id",
    )
    .leftJoin("application.private_job_snapshot_revisions as private_revision", (join) =>
      join
        .onRef("private_revision.owner_id", "=", "asset.owner_id")
        .onRef("private_revision.owner_epoch", "=", "asset.owner_epoch")
        .onRef("private_revision.snapshot_id", "=", "asset.private_job_snapshot_id")
        .onRef("private_revision.content_revision", "=", "asset.job_context_revision"),
    )
    .select([
      "asset.id",
      "asset.revision",
      "asset.status",
      "asset.created_at",
      "public_job.title as public_title",
      "public_job.company_name as public_company_name",
      "private_revision.title as private_title",
      "private_revision.company_name as private_company_name",
    ])
    .where("asset.owner_id", "=", owner.ownerId)
    .where("asset.owner_epoch", "=", owner.ownerEpoch)
    .where("asset.deleted_at", "is", null)
    .where("asset.detached_from_case_id", "is not", null)
    .orderBy("asset.created_at", "desc")
    .limit(DETACHED_ASSET_LIMIT + 1)
    .execute();
}

async function loadDetachedDebriefs(
  db: Kysely<Database>,
  owner: OwnerContext,
): Promise<DetachedAssetRow[]> {
  return db
    .selectFrom("application.debriefs as asset")
    .leftJoin(
      "catalog.published_job_versions as public_job",
      "public_job.id",
      "asset.published_job_version_id",
    )
    .leftJoin("application.private_job_snapshot_revisions as private_revision", (join) =>
      join
        .onRef("private_revision.owner_id", "=", "asset.owner_id")
        .onRef("private_revision.owner_epoch", "=", "asset.owner_epoch")
        .onRef("private_revision.snapshot_id", "=", "asset.private_job_snapshot_id")
        .onRef("private_revision.content_revision", "=", "asset.job_context_revision"),
    )
    .select([
      "asset.id",
      "asset.revision",
      "asset.status",
      "asset.created_at",
      "public_job.title as public_title",
      "public_job.company_name as public_company_name",
      "private_revision.title as private_title",
      "private_revision.company_name as private_company_name",
    ])
    .where("asset.owner_id", "=", owner.ownerId)
    .where("asset.owner_epoch", "=", owner.ownerEpoch)
    .where("asset.deleted_at", "is", null)
    .where("asset.detached_from_case_id", "is not", null)
    .orderBy("asset.created_at", "desc")
    .limit(DETACHED_ASSET_LIMIT + 1)
    .execute();
}

function toDetachedAsset(
  kind: DetachedCareerAsset["kind"],
  row: DetachedAssetRow,
): DetachedCareerAsset {
  return {
    kind,
    id: row.id,
    revision: Number(row.revision),
    title: row.public_title ?? row.private_title ?? "已保留的岗位上下文",
    companyName: row.public_company_name ?? row.private_company_name,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getCareerDataScope(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
}): Promise<CareerDataScopeResponse> {
  await assertActiveOwnerEpoch(input.db, input.owner.ownerId, input.owner.ownerEpoch);
  const owner = await getCareerOwner({
    db: input.db,
    ownerId: input.owner.ownerId,
    ownerEpoch: input.owner.ownerEpoch,
  });
  if (!owner) throw new Error("OWNER_EPOCH_STALE");

  const [counts, interviewRows, debriefRows] = await Promise.all([
    loadCounts(input.db, input.owner),
    loadDetachedInterviewSessions(input.db, input.owner),
    loadDetachedDebriefs(input.db, input.owner),
  ]);
  const detachedAssets = [
    ...interviewRows.map((row) => toDetachedAsset("interview_session", row)),
    ...debriefRows.map((row) => toDetachedAsset("debrief", row)),
  ]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, DETACHED_ASSET_LIMIT);

  return CareerDataScopeResponseSchema.parse({
    owner,
    sessionExpiresAt: input.owner.sessionExpiresAt.toISOString(),
    counts,
    detachedAssets,
    detachedAssetsTruncated:
      counts.detachedInterviewSessions + counts.detachedDebriefs > detachedAssets.length,
  });
}
