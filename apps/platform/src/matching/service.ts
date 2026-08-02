import { randomUUID } from "node:crypto";
import {
  fieldValueSchema,
  JobFamilySchema,
  JobPreferenceSchema,
  JobRequirementSchema,
  type MatchRun,
  type MatchRunResult,
  MatchRunResultSchema,
  MatchRunSchema,
  ProfileFactSchema,
  type RecommendationCatalogState,
  type RecommendationRun,
  RecommendationRunSchema,
  ResumeEvidenceSchema,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, type Selectable, sql, type Transaction } from "kysely";
import { z } from "zod";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { lockOwnerIdempotencyKey } from "../lib/idempotency.js";
import { ServiceError } from "../lib/service-error.js";
import type { OwnerTaskLease } from "../workers/owner-task-lease.js";
import { withOwnerTaskLease } from "../workers/owner-task-lease.js";
import { CAPABILITY_DICTIONARY_VERSION } from "./capabilities.js";
import { evaluateThreeAxisMatch, type MatchableJob } from "./engine.js";
import {
  compareRecommendations,
  type RankableRecommendation,
  recommendationReasonCodes,
} from "./ranking.js";

const RULE_VERSION = "eligibility-rules-v3";
const DICTIONARY_VERSION = `zh-cn-internship-v3+${CAPABILITY_DICTIONARY_VERSION}`;
const TEMPLATE_VERSION = "three-axis-explanation-v3";
const RECOMMENDATION_STRATEGY_VERSION = "decision-readiness-v2";

const RecommendationCandidateFreshnessSnapshotSchema = z.object({
  publishedJobVersionId: z.string().trim().min(1),
  lastVerifiedAt: z.string().datetime(),
});
type RecommendationCandidateFreshnessSnapshot = z.infer<
  typeof RecommendationCandidateFreshnessSnapshotSchema
>;

type DbExecutor = Kysely<Database> | Transaction<Database>;
type OwnerContext = OwnerScope;
type MatchRunRow = Selectable<Database["matching.match_runs"]>;

const StringFieldSchema = fieldValueSchema(z.string().trim().min(1));
const StringListFieldSchema = fieldValueSchema(z.array(z.string().trim().min(1)).min(1));
const NumberFieldSchema = fieldValueSchema(z.number());
const JobFamilyFieldSchema = fieldValueSchema(JobFamilySchema);
const LegacyMatchRunResultSchema = MatchRunResultSchema.pick({
  eligibility: true,
  evidence: true,
  preference: true,
  unknownRequirementIds: true,
});

export function parseMatchJobFamily(value: unknown) {
  const parsed = JobFamilyFieldSchema.safeParse(value);
  return parsed.success ? parsed.data : ({ state: "unknown", reason: "parse_failed" } as const);
}

function json(value: unknown): JsonValue {
  return JSON.stringify(value) as JsonValue;
}

export function parseStoredMatchRunResult(value: unknown): MatchRunResult {
  const current = MatchRunResultSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = LegacyMatchRunResultSchema.parse(value);
  return {
    ...legacy,
    basisState: "insufficient",
    coverage: {
      eligibility: { required: 0, evaluated: 0, met: 0, conflicts: 0, unknown: 0 },
      evidence: { applicable: 0, supported: 0, partial: 0, missing: 0, unknown: 0 },
      preference: { configured: 0, compared: 0, conflicts: 0, unknown: 0 },
    },
    gaps: [],
  };
}

function toIso(value: unknown): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

async function assertOwnerRevision(
  db: DbExecutor,
  table:
    | "profile.profile_fact_revisions"
    | "profile.job_preference_revisions"
    | "profile.resume_evidence_revisions",
  id: string,
  owner: OwnerContext,
): Promise<void> {
  const row = await db
    .selectFrom(table)
    .select(["id"])
    .where("id", "=", id)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .executeTakeFirst();
  if (!row) {
    throw new ServiceError(
      422,
      "PROFILE_REVISION_NOT_FOUND",
      "没有找到属于当前会话的已确认画像修订。",
    );
  }
}

export interface MatchCatalogOptions {
  enableLocalMvp: boolean;
}

async function requirementSetForVersion(
  db: DbExecutor,
  versionId: string,
  options: MatchCatalogOptions,
) {
  const row = await db
    .selectFrom("catalog.published_job_versions as version")
    .innerJoin("catalog.published_jobs as job", "job.id", "version.published_job_id")
    .innerJoin(
      "catalog.job_requirement_sets as requirements",
      "requirements.id",
      "version.active_requirement_set_id",
    )
    .selectAll("requirements")
    .where("version.id", "=", versionId)
    .whereRef(
      options.enableLocalMvp ? "job.current_version_id" : "job.public_version_id",
      "=",
      "version.id",
    )
    .where(sql<boolean>`EXISTS (
      SELECT 1
      FROM catalog.current_job_effective_activity AS activity
      WHERE activity.published_job_version_id = version.id
        AND activity.effective_activity_state <> 'closed'
    )`)
    .executeTakeFirst();
  if (!row) {
    throw new ServiceError(
      422,
      "JOB_REQUIREMENTS_NOT_READY",
      "该岗位的要求尚未完成可追溯拆解，请稍后重试。",
    );
  }
  return row;
}

async function assertProfileInputs(
  db: DbExecutor,
  owner: OwnerContext,
  input: {
    profileFactRevisionId: string;
    preferenceRevisionId: string;
    evidenceRevisionId: string;
  },
): Promise<void> {
  await Promise.all([
    assertOwnerRevision(db, "profile.profile_fact_revisions", input.profileFactRevisionId, owner),
    assertOwnerRevision(db, "profile.job_preference_revisions", input.preferenceRevisionId, owner),
    assertOwnerRevision(db, "profile.resume_evidence_revisions", input.evidenceRevisionId, owner),
  ]);
}

async function existingMatchRun(
  db: DbExecutor,
  ownerId: string,
  idempotencyKey: string,
): Promise<MatchRunRow | undefined> {
  return db
    .selectFrom("matching.match_runs")
    .selectAll()
    .where("owner_id", "=", ownerId)
    .where("idempotency_key", "=", idempotencyKey)
    .executeTakeFirst();
}

export async function enqueueMatchRun(
  db: Kysely<Database>,
  owner: OwnerContext,
  request: {
    publishedJobVersionId: string;
    profileFactRevisionId: string;
    preferenceRevisionId: string;
    evidenceRevisionId: string;
  },
  idempotencyKey: string,
  options: MatchCatalogOptions = { enableLocalMvp: true },
): Promise<MatchRun> {
  if (!idempotencyKey.trim()) {
    throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "创建匹配任务时必须提供幂等键。");
  }
  const requestHash = hashCanonicalJson(request);
  const row = await db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: owner.ownerId,
      scope: "match-run",
      idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, owner.ownerId, owner.ownerEpoch);
    const previous = await existingMatchRun(transaction, owner.ownerId, idempotencyKey);
    if (previous) {
      if (previous.request_hash !== requestHash) {
        throw new ServiceError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "同一个幂等键不能用于不同的匹配请求。",
        );
      }
      return previous;
    }

    await assertProfileInputs(transaction, owner, request);
    const requirementSet = await requirementSetForVersion(
      transaction,
      request.publishedJobVersionId,
      options,
    );
    const id = randomUUID();
    const created = await transaction
      .insertInto("matching.match_runs")
      .values({
        id,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        published_job_version_id: request.publishedJobVersionId,
        requirement_set_id: requirementSet.id,
        profile_fact_revision_id: request.profileFactRevisionId,
        preference_revision_id: request.preferenceRevisionId,
        evidence_revision_id: request.evidenceRevisionId,
        rule_version: RULE_VERSION,
        dictionary_version: DICTIONARY_VERSION,
        template_version: TEMPLATE_VERSION,
        status: "queued",
        request_hash: requestHash,
        idempotency_key: idempotencyKey,
        result: null,
        failure_code: null,
        completed_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto("task_queue.tasks")
      .values({
        id: randomUUID(),
        task_type: "match_run",
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        payload: json({ runId: id }),
        idempotency_key: `owner:${owner.ownerId}:match:${idempotencyKey}`,
        status: "queued",
        attempt: 0,
        max_attempts: 3,
        available_at: new Date(),
        backoff_policy: json({ kind: "exponential", baseSeconds: 2, maxSeconds: 30 }),
        lease_owner: null,
        lease_until: null,
        heartbeat_at: null,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();
    return created;
  });
  return mapMatchRun(row);
}

function mapMatchRun(row: MatchRunRow): MatchRun {
  return MatchRunSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    status: row.status,
    publishedJobVersionId: row.published_job_version_id,
    requirementSetId: row.requirement_set_id,
    profileFactRevisionId: row.profile_fact_revision_id,
    preferenceRevisionId: row.preference_revision_id,
    evidenceRevisionId: row.evidence_revision_id,
    ruleVersion: row.rule_version,
    dictionaryVersion: row.dictionary_version,
    templateVersion: row.template_version,
    result: row.result === null ? null : parseStoredMatchRunResult(row.result),
    failureCode: row.failure_code,
    createdAt: toIso(row.created_at),
    completedAt: toIso(row.completed_at),
  });
}

export async function getMatchRun(
  db: Kysely<Database>,
  owner: OwnerContext,
  runId: string,
  options: MatchCatalogOptions = { enableLocalMvp: true },
): Promise<MatchRun | null> {
  let query = db
    .selectFrom("matching.match_runs as run")
    .innerJoin(
      "catalog.published_job_versions as version",
      "version.id",
      "run.published_job_version_id",
    )
    .selectAll("run")
    .where("run.id", "=", runId)
    .where("run.owner_id", "=", owner.ownerId)
    .where("run.owner_epoch", "=", owner.ownerEpoch);
  if (!options.enableLocalMvp) {
    query = query.where(sql<boolean>`EXISTS (
      SELECT 1
      FROM catalog.published_job_version_revision_links AS link
      JOIN ingestion.source_job_revisions AS revision
        ON revision.id = link.source_job_revision_id
      WHERE link.published_job_version_id = version.id
        AND revision.ingestion_state = 'validated'
        AND revision.publication_state = 'published'
    )`);
  }
  const row = await query.executeTakeFirst();
  return row ? mapMatchRun(row) : null;
}

async function loadMatchInputs(db: DbExecutor, run: MatchRunRow) {
  const [requirementSet, factRevision, preferenceRevision, evidenceRevision, jobVersion] =
    await Promise.all([
      db
        .selectFrom("catalog.job_requirement_sets")
        .selectAll()
        .where("id", "=", run.requirement_set_id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("profile.profile_fact_revisions")
        .selectAll()
        .where("id", "=", run.profile_fact_revision_id)
        .where("owner_id", "=", run.owner_id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("profile.job_preference_revisions")
        .selectAll()
        .where("id", "=", run.preference_revision_id)
        .where("owner_id", "=", run.owner_id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("profile.resume_evidence_revisions")
        .selectAll()
        .where("id", "=", run.evidence_revision_id)
        .where("owner_id", "=", run.owner_id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("catalog.published_job_versions as version")
        .innerJoin(
          "catalog.job_condition_projections as projection",
          "projection.published_job_version_id",
          "version.id",
        )
        .select([
          "version.company_name",
          "version.job_family",
          "version.work_mode",
          "projection.locations",
          "projection.weekly_attendance_days",
          "projection.duration_months",
        ])
        .where("version.id", "=", run.published_job_version_id)
        .where("projection.requirement_set_id", "=", run.requirement_set_id)
        .executeTakeFirstOrThrow(),
    ]);

  const job: MatchableJob = {
    companyName: jobVersion.company_name,
    jobFamily: parseMatchJobFamily(jobVersion.job_family),
    locations: StringListFieldSchema.parse(jobVersion.locations),
    weeklyAttendanceDays: NumberFieldSchema.parse(jobVersion.weekly_attendance_days),
    durationMonths: NumberFieldSchema.parse(jobVersion.duration_months),
    workMode: StringFieldSchema.parse(jobVersion.work_mode),
  };
  if (evidenceRevision.schema_version !== "resume-evidence-v2") {
    throw new ServiceError(
      409,
      "LEGACY_EVIDENCE_READ_ONLY",
      "旧版整段证据只保留历史读取，不能用于新的匹配运行。",
    );
  }
  return {
    requirements: JobRequirementSchema.array().parse(requirementSet.requirements),
    confirmedFacts: ProfileFactSchema.array().parse(factRevision.facts),
    preferences: JobPreferenceSchema.parse(preferenceRevision.preferences),
    confirmedEvidence: ResumeEvidenceSchema.array().parse(evidenceRevision.evidence),
    job,
  };
}

async function computeMatchResult(db: DbExecutor, run: MatchRunRow): Promise<MatchRunResult> {
  const inputs = await loadMatchInputs(db, run);
  return MatchRunResultSchema.parse(evaluateThreeAxisMatch(inputs));
}

export async function processMatchRun(
  db: Kysely<Database>,
  owner: OwnerContext,
  runId: string,
  lease: OwnerTaskLease,
): Promise<void> {
  const run = await withOwnerTaskLease(db, lease, async (transaction) => {
    const current = await transaction
      .selectFrom("matching.match_runs")
      .selectAll()
      .where("id", "=", runId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .forUpdate()
      .executeTakeFirst();
    if (!current || current.status === "deleted" || current.status === "succeeded") {
      return current;
    }
    await transaction
      .updateTable("matching.match_runs")
      .set({ status: "processing" })
      .where("id", "=", current.id)
      .executeTakeFirstOrThrow();
    return current;
  });
  if (!run || run.status === "deleted" || run.status === "succeeded") return;
  try {
    const result = await computeMatchResult(db, run);
    await withOwnerTaskLease(db, lease, async (transaction) => {
      await transaction
        .updateTable("matching.match_runs")
        .set({
          status: "succeeded",
          result: json(result),
          failure_code: null,
          completed_at: new Date(),
        })
        .where("id", "=", run.id)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("status", "=", "processing")
        .executeTakeFirstOrThrow();
    });
  } catch (error) {
    await withOwnerTaskLease(db, lease, async (transaction) => {
      await transaction
        .updateTable("matching.match_runs")
        .set({
          status: "failed",
          failure_code: error instanceof ServiceError ? error.code : "MATCH_PROCESSING_FAILED",
          completed_at: new Date(),
        })
        .where("id", "=", run.id)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("status", "=", "processing")
        .execute();
    });
    throw error;
  }
}

type RecommendationInput = {
  profileFactRevisionId: string;
  preferenceRevisionId: string;
  evidenceRevisionId: string;
  candidateJobVersionIds: string[];
};

export interface RecommendationCatalogOptions {
  enableLocalMvp: boolean;
}

function parseRecommendationCandidateIds(
  row: Selectable<Database["matching.recommendation_runs"]>,
): string[] {
  return z.array(z.string().trim().min(1)).min(1).parse(row.candidate_job_version_ids);
}

function parseRecommendationCandidateSnapshots(
  row: Selectable<Database["matching.recommendation_runs"]>,
): Map<string, RecommendationCandidateFreshnessSnapshot> {
  if (row.candidate_freshness_snapshots === null) return new Map();
  const snapshots = RecommendationCandidateFreshnessSnapshotSchema.array()
    .min(1)
    .parse(row.candidate_freshness_snapshots);
  return new Map(snapshots.map((snapshot) => [snapshot.publishedJobVersionId, snapshot]));
}

const FrozenRequirementSetSchema = z.object({
  publishedJobVersionId: z.string().trim().min(1),
  requirementSetId: z.string().trim().min(1),
});

function parseFrozenRequirementSets(
  row: Selectable<Database["matching.recommendation_runs"]>,
): Map<string, string> {
  const parsed = FrozenRequirementSetSchema.array().safeParse(row.candidate_requirement_set_ids);
  if (!parsed.success) return new Map();
  const entries = parsed.data;
  return new Map(entries.map((entry) => [entry.publishedJobVersionId, entry.requirementSetId]));
}

async function currentCatalogCandidateSnapshots(
  db: DbExecutor,
  candidateIds: string[],
  enableLocalMvp: boolean,
): Promise<RecommendationCandidateFreshnessSnapshot[]> {
  let query = db
    .selectFrom("catalog.published_job_versions as version")
    .innerJoin("catalog.published_jobs as job", "job.id", "version.published_job_id")
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
    .innerJoin("source_control.sources as source", "source.id", "record.source_id")
    .innerJoin("source_control.source_policy_versions as policy", (join) =>
      join
        .onRef("policy.source_id", "=", "source.id")
        .onRef("policy.version", "=", "source.current_policy_version"),
    )
    .select(({ fn }) => [
      "version.id as publishedJobVersionId",
      fn.max("record.last_seen_at").as("lastVerifiedAt"),
    ])
    .where("version.id", "in", candidateIds)
    .where(sql<boolean>`EXISTS (
      SELECT 1
      FROM catalog.current_job_effective_activity AS activity
      WHERE activity.published_job_version_id = version.id
        AND activity.effective_activity_state <> 'closed'
    )`)
    .where("revision.ingestion_state", "=", "validated")
    .groupBy("version.id");
  query = enableLocalMvp
    ? query
        .whereRef("job.current_version_id", "=", "version.id")
        .where("revision.ingestion_state", "=", "validated")
        .where("revision.publication_state", "in", ["review", "published"])
        .where("policy.policy_status", "in", ["pending_review", "approved"])
    : query
        .whereRef("job.public_version_id", "=", "version.id")
        .where("revision.ingestion_state", "=", "validated")
        .where("revision.publication_state", "=", "published")
        .where("policy.policy_status", "=", "approved");
  const rows = await query.execute();
  const snapshots = new Map(
    rows.map((row) => [
      row.publishedJobVersionId,
      {
        publishedJobVersionId: row.publishedJobVersionId,
        lastVerifiedAt: asDate(row.lastVerifiedAt).toISOString(),
      },
    ]),
  );
  return candidateIds.flatMap((candidateId) => {
    const snapshot = snapshots.get(candidateId);
    return snapshot ? [snapshot] : [];
  });
}

interface RecommendationCatalogContext {
  runState: RecommendationCatalogState;
  itemStates: Map<string, RecommendationCatalogState>;
  snapshots: Map<string, RecommendationCandidateFreshnessSnapshot>;
}

async function recommendationCatalogContext(
  db: DbExecutor,
  row: Selectable<Database["matching.recommendation_runs"]>,
  enableLocalMvp: boolean,
): Promise<RecommendationCatalogContext> {
  const candidateIds = parseRecommendationCandidateIds(row);
  const snapshots = parseRecommendationCandidateSnapshots(row);
  const frozenRequirementSets = parseFrozenRequirementSets(row);
  let query = db
    .selectFrom("catalog.published_job_versions as candidate")
    .innerJoin("catalog.published_jobs as job", "job.id", "candidate.published_job_id")
    .leftJoin(
      "catalog.published_job_versions as current",
      "current.id",
      enableLocalMvp ? "job.current_version_id" : "job.public_version_id",
    )
    .innerJoin(
      "ingestion.source_job_revisions as currentRevision",
      "currentRevision.id",
      "current.source_job_revision_id",
    )
    .innerJoin(
      "ingestion.source_job_records as currentRecord",
      "currentRecord.id",
      "currentRevision.source_job_record_id",
    )
    .innerJoin(
      "source_control.sources as currentSource",
      "currentSource.id",
      "currentRecord.source_id",
    )
    .innerJoin("source_control.source_policy_versions as currentPolicy", (join) =>
      join
        .onRef("currentPolicy.source_id", "=", "currentSource.id")
        .onRef("currentPolicy.version", "=", "currentSource.current_policy_version"),
    )
    .select([
      "candidate.id as candidateId",
      "current.id as currentVersionId",
      "current.active_requirement_set_id as currentRequirementSetId",
      sql<string | null>`(
        SELECT activity.effective_activity_state
        FROM catalog.current_job_effective_activity AS activity
        WHERE activity.published_job_version_id = current.id
        LIMIT 1
      )`.as("effectiveActivityState"),
      "currentRevision.ingestion_state as ingestionState",
      "currentRevision.publication_state as publicationState",
      "currentPolicy.policy_status as policyStatus",
    ])
    .where("candidate.id", "in", candidateIds);
  query = enableLocalMvp
    ? query
        .where("currentRevision.publication_state", "in", ["review", "published"])
        .where("currentPolicy.policy_status", "in", ["pending_review", "approved"])
    : query
        .where("currentRevision.ingestion_state", "=", "validated")
        .where("currentRevision.publication_state", "=", "published")
        .where("currentPolicy.policy_status", "=", "approved");
  const rows = await query.execute();

  const rowsByCandidate = new Map(rows.map((candidate) => [candidate.candidateId, candidate]));
  const itemStates = new Map<string, RecommendationCatalogState>();
  for (const candidateId of candidateIds) {
    const candidate = rowsByCandidate.get(candidateId);
    if (
      !snapshots.has(candidateId) ||
      !candidate ||
      candidate.currentVersionId === null ||
      (candidate.effectiveActivityState !== "active" &&
        candidate.effectiveActivityState !== "uncertain") ||
      candidate.ingestionState !== "validated" ||
      (enableLocalMvp
        ? candidate.publicationState !== "review" && candidate.publicationState !== "published"
        : candidate.publicationState !== "published") ||
      (enableLocalMvp
        ? candidate.policyStatus !== "pending_review" && candidate.policyStatus !== "approved"
        : candidate.policyStatus !== "approved")
    ) {
      itemStates.set(candidateId, "invalid");
      continue;
    }
    itemStates.set(
      candidateId,
      candidate.currentVersionId === candidateId &&
        candidate.currentRequirementSetId === frozenRequirementSets.get(candidateId)
        ? "current"
        : "stale",
    );
  }

  const states = [...itemStates.values()];
  const runState: RecommendationCatalogState = states.includes("invalid")
    ? "invalid"
    : states.includes("stale")
      ? "stale"
      : states.length === candidateIds.length && states.length > 0
        ? "current"
        : "invalid";
  return { runState, itemStates, snapshots };
}

export async function enqueueRecommendationRun(
  db: Kysely<Database>,
  owner: OwnerContext,
  request: RecommendationInput,
  idempotencyKey: string,
  options: RecommendationCatalogOptions,
): Promise<RecommendationRun> {
  if (!idempotencyKey.trim()) {
    throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "创建推荐任务时必须提供幂等键。");
  }
  const normalizedRequest = {
    ...request,
    candidateJobVersionIds: [...new Set(request.candidateJobVersionIds)].sort(),
  };
  const requestHash = hashCanonicalJson(normalizedRequest);
  const candidateSetHash = hashCanonicalJson(normalizedRequest.candidateJobVersionIds);
  const row = await db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: owner.ownerId,
      scope: "recommendation-run",
      idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, owner.ownerId, owner.ownerEpoch);
    const previous = await transaction
      .selectFrom("matching.recommendation_runs")
      .selectAll()
      .where("owner_id", "=", owner.ownerId)
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
    if (previous) {
      if (previous.request_hash !== requestHash) {
        throw new ServiceError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "同一个幂等键不能用于不同的推荐请求。",
        );
      }
      return previous;
    }
    await assertProfileInputs(transaction, owner, request);

    const existingCandidates = await transaction
      .selectFrom("catalog.published_job_versions")
      .select(["id", "active_requirement_set_id"])
      .where("id", "in", normalizedRequest.candidateJobVersionIds)
      .execute();
    if (
      existingCandidates.length !== normalizedRequest.candidateJobVersionIds.length ||
      existingCandidates.some(({ active_requirement_set_id }) => !active_requirement_set_id)
    ) {
      throw new ServiceError(422, "CANDIDATE_JOB_NOT_FOUND", "候选集合中包含不存在的岗位版本。");
    }

    const candidateSnapshots = await currentCatalogCandidateSnapshots(
      transaction,
      normalizedRequest.candidateJobVersionIds,
      options.enableLocalMvp,
    );
    if (candidateSnapshots.length !== normalizedRequest.candidateJobVersionIds.length) {
      throw new ServiceError(
        422,
        "CANDIDATE_JOB_NOT_IN_CURRENT_CATALOG",
        "候选岗位必须是当前目录中仍在招聘、来源政策允许且处于最新版本的岗位。",
      );
    }

    const id = randomUUID();
    const frozenRequirementSets = normalizedRequest.candidateJobVersionIds.map(
      (publishedJobVersionId) => ({
        publishedJobVersionId,
        requirementSetId: existingCandidates.find(({ id }) => id === publishedJobVersionId)
          ?.active_requirement_set_id as string,
      }),
    );
    const evidenceRevision = await transaction
      .selectFrom("profile.resume_evidence_revisions")
      .select("document_revision_id")
      .where("id", "=", request.evidenceRevisionId)
      .where("owner_id", "=", owner.ownerId)
      .executeTakeFirstOrThrow();
    const created = await transaction
      .insertInto("matching.recommendation_runs")
      .values({
        id,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        profile_fact_revision_id: request.profileFactRevisionId,
        preference_revision_id: request.preferenceRevisionId,
        evidence_revision_id: request.evidenceRevisionId,
        candidate_job_version_ids: json(normalizedRequest.candidateJobVersionIds),
        candidate_freshness_snapshots: json(candidateSnapshots),
        candidate_requirement_set_ids: json(frozenRequirementSets),
        resume_document_revision_id: evidenceRevision.document_revision_id,
        candidate_set_hash: candidateSetHash,
        strategy_version: RECOMMENDATION_STRATEGY_VERSION,
        status: "queued",
        request_hash: requestHash,
        idempotency_key: idempotencyKey,
        failure_code: null,
        completed_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto("task_queue.tasks")
      .values({
        id: randomUUID(),
        task_type: "recommendation_run",
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        payload: json({ runId: id }),
        idempotency_key: `owner:${owner.ownerId}:recommendation:${idempotencyKey}`,
        status: "queued",
        attempt: 0,
        max_attempts: 3,
        available_at: new Date(),
        backoff_policy: json({ kind: "exponential", baseSeconds: 2, maxSeconds: 30 }),
        lease_owner: null,
        lease_until: null,
        heartbeat_at: null,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();
    return created;
  });
  const context = await recommendationCatalogContext(db, row, options.enableLocalMvp);
  return mapRecommendationRun(row, [], context.runState);
}

async function recommendationItems(
  db: DbExecutor,
  ownerId: string,
  runId: string,
  context: RecommendationCatalogContext,
): Promise<RecommendationRun["items"]> {
  const rows = await db
    .selectFrom("matching.recommendation_items")
    .innerJoin(
      "matching.match_runs",
      "matching.match_runs.id",
      "matching.recommendation_items.match_run_id",
    )
    .select([
      "matching.recommendation_items.ordinal",
      "matching.recommendation_items.published_job_version_id",
      "matching.recommendation_items.match_run_id",
      "matching.recommendation_items.reason_codes",
      "matching.recommendation_items.basis_state",
      "matching.recommendation_items.coverage",
      "matching.recommendation_items.gaps",
      "matching.recommendation_items.unknown_requirement_ids",
      "matching.match_runs.result",
    ])
    .where("matching.recommendation_items.recommendation_run_id", "=", runId)
    .where("matching.recommendation_items.owner_id", "=", ownerId)
    .orderBy("matching.recommendation_items.ordinal", "asc")
    .execute();
  return rows.map((row) => {
    const result = parseStoredMatchRunResult(row.result);
    const storedBasisState = MatchRunResultSchema.shape.basisState.safeParse(row.basis_state);
    const storedCoverage = MatchRunResultSchema.shape.coverage.safeParse(row.coverage);
    const storedGaps = MatchRunResultSchema.shape.gaps.safeParse(row.gaps);
    return {
      ordinal: row.ordinal,
      publishedJobVersionId: row.published_job_version_id,
      matchRunId: row.match_run_id,
      eligibility: result.eligibility.status,
      evidence: result.evidence.status,
      preference: result.preference.status,
      reasonCodes: z.array(z.string()).parse(row.reason_codes),
      basisState: storedBasisState.success ? storedBasisState.data : result.basisState,
      coverage: storedCoverage.success ? storedCoverage.data : result.coverage,
      gaps: storedGaps.success ? storedGaps.data : result.gaps,
      unknownRequirementIds: z.array(z.string()).parse(row.unknown_requirement_ids),
      lastVerifiedAt: context.snapshots.get(row.published_job_version_id)?.lastVerifiedAt ?? null,
      catalogState: context.itemStates.get(row.published_job_version_id) ?? "invalid",
    };
  });
}

function mapRecommendationRun(
  row: Selectable<Database["matching.recommendation_runs"]>,
  items: RecommendationRun["items"],
  catalogState: RecommendationCatalogState,
): RecommendationRun {
  return RecommendationRunSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    status: row.status,
    candidateSetHash: row.candidate_set_hash,
    strategyVersion: row.strategy_version,
    catalogState,
    items,
    failureCode: row.failure_code,
    createdAt: toIso(row.created_at),
    completedAt: toIso(row.completed_at),
  });
}

export async function getRecommendationRun(
  db: Kysely<Database>,
  owner: OwnerContext,
  runId: string,
  options: RecommendationCatalogOptions,
): Promise<RecommendationRun | null> {
  const row = await db
    .selectFrom("matching.recommendation_runs")
    .selectAll()
    .where("id", "=", runId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .executeTakeFirst();
  if (!row) return null;
  const context = await recommendationCatalogContext(db, row, options.enableLocalMvp);
  return mapRecommendationRun(
    row,
    await recommendationItems(db, owner.ownerId, row.id, context),
    context.runState,
  );
}

export async function processRecommendationRun(
  db: Kysely<Database>,
  owner: OwnerContext,
  runId: string,
  lease: OwnerTaskLease,
): Promise<void> {
  const recommendation = await withOwnerTaskLease(db, lease, async (transaction) => {
    const current = await transaction
      .selectFrom("matching.recommendation_runs")
      .selectAll()
      .where("id", "=", runId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .forUpdate()
      .executeTakeFirst();
    if (!current || current.status === "deleted" || current.status === "succeeded") {
      return current;
    }
    await transaction
      .updateTable("matching.recommendation_runs")
      .set({ status: "processing" })
      .where("id", "=", current.id)
      .executeTakeFirstOrThrow();
    return current;
  });
  if (
    !recommendation ||
    recommendation.status === "deleted" ||
    recommendation.status === "succeeded"
  ) {
    return;
  }
  try {
    const candidateIds = parseRecommendationCandidateIds(recommendation);
    const candidateSnapshots = parseRecommendationCandidateSnapshots(recommendation);
    const frozenRequirementSets = parseFrozenRequirementSets(recommendation);
    if (
      candidateSnapshots.size !== candidateIds.length ||
      candidateIds.some(
        (candidateId) =>
          !candidateSnapshots.has(candidateId) || !frozenRequirementSets.has(candidateId),
      )
    ) {
      throw new ServiceError(
        409,
        "RECOMMENDATION_FRESHNESS_NOT_FROZEN",
        "这次旧推荐没有可复现的来源核验时间，请重新生成推荐。",
      );
    }
    const ranked: Array<
      RankableRecommendation & { matchRun: MatchRunRow; result: MatchRunResult }
    > = [];
    for (const candidateId of candidateIds) {
      const candidateSnapshot = candidateSnapshots.get(candidateId);
      if (!candidateSnapshot) {
        throw new ServiceError(
          409,
          "RECOMMENDATION_FRESHNESS_NOT_FROZEN",
          "这次旧推荐没有可复现的来源核验时间，请重新生成推荐。",
        );
      }
      const requirementSetId = frozenRequirementSets.get(candidateId);
      if (!requirementSetId) {
        throw new ServiceError(
          409,
          "RECOMMENDATION_REQUIREMENTS_NOT_FROZEN",
          "这次推荐没有冻结岗位要求集，请重新生成推荐。",
        );
      }
      const idempotencyKey = `recommendation:${runId}:job:${candidateId}`;
      let matchRun = await existingMatchRun(db, owner.ownerId, idempotencyKey);
      if (!matchRun) {
        matchRun = await withOwnerTaskLease(db, lease, async (transaction) => {
          const existing = await existingMatchRun(transaction, owner.ownerId, idempotencyKey);
          if (existing) return existing;
          return transaction
            .insertInto("matching.match_runs")
            .values({
              id: randomUUID(),
              owner_id: owner.ownerId,
              owner_epoch: owner.ownerEpoch,
              published_job_version_id: candidateId,
              requirement_set_id: requirementSetId,
              profile_fact_revision_id: recommendation.profile_fact_revision_id,
              preference_revision_id: recommendation.preference_revision_id,
              evidence_revision_id: recommendation.evidence_revision_id,
              rule_version: RULE_VERSION,
              dictionary_version: DICTIONARY_VERSION,
              template_version: TEMPLATE_VERSION,
              status: "processing",
              request_hash: hashCanonicalJson({
                candidateId,
                profileFactRevisionId: recommendation.profile_fact_revision_id,
                preferenceRevisionId: recommendation.preference_revision_id,
                evidenceRevisionId: recommendation.evidence_revision_id,
              }),
              idempotency_key: idempotencyKey,
              result: null,
              failure_code: null,
              completed_at: null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        });
      }
      const result =
        matchRun.status === "succeeded" && matchRun.result
          ? parseStoredMatchRunResult(matchRun.result)
          : await computeMatchResult(db, matchRun);
      if (matchRun.status !== "succeeded") {
        await withOwnerTaskLease(db, lease, async (transaction) => {
          await transaction
            .updateTable("matching.match_runs")
            .set({
              status: "succeeded",
              result: json(result),
              failure_code: null,
              completed_at: new Date(),
            })
            .where("id", "=", matchRun.id)
            .where("owner_id", "=", owner.ownerId)
            .where("owner_epoch", "=", owner.ownerEpoch)
            .executeTakeFirstOrThrow();
        });
      }
      ranked.push({
        publishedJobVersionId: candidateId,
        result,
        lastVerifiedAt: asDate(candidateSnapshot.lastVerifiedAt),
        matchRun,
      });
    }
    ranked.sort(compareRecommendations);

    await withOwnerTaskLease(db, lease, async (transaction) => {
      await transaction
        .deleteFrom("matching.recommendation_items")
        .where("owner_id", "=", owner.ownerId)
        .where("recommendation_run_id", "=", recommendation.id)
        .execute();
      if (ranked.length > 0) {
        await transaction
          .insertInto("matching.recommendation_items")
          .values(
            ranked.map((item, ordinal) => ({
              owner_id: owner.ownerId,
              recommendation_run_id: recommendation.id,
              ordinal,
              published_job_version_id: item.publishedJobVersionId,
              match_run_id: item.matchRun.id,
              reason_codes: json(recommendationReasonCodes(item.result)),
              unknown_requirement_ids: json(item.result.unknownRequirementIds),
              basis_state: item.result.basisState,
              coverage: json(item.result.coverage),
              gaps: json(item.result.gaps),
            })),
          )
          .execute();
      }
      await transaction
        .updateTable("matching.recommendation_runs")
        .set({
          status: "succeeded",
          failure_code: null,
          completed_at: new Date(),
        })
        .where("id", "=", recommendation.id)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("status", "=", "processing")
        .executeTakeFirstOrThrow();
    });
  } catch (error) {
    await withOwnerTaskLease(db, lease, async (transaction) => {
      await transaction
        .updateTable("matching.recommendation_runs")
        .set({
          status: "failed",
          failure_code:
            error instanceof ServiceError ? error.code : "RECOMMENDATION_PROCESSING_FAILED",
          completed_at: new Date(),
        })
        .where("id", "=", recommendation.id)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("status", "=", "processing")
        .execute();
    });
    throw error;
  }
}
