import { randomUUID } from "node:crypto";
import {
  type CaseMatchCatalogState,
  type CaseMatchInput,
  type CaseMatchMissingInput,
  type CaseMatchStaleReason,
  type CaseMatchState,
  CaseMatchStateSchema,
  type CasePinnedMatchExecutionContext,
  type CreateRecommendationRunFromSearchRequest,
  CreateRecommendationRunFromSearchRequestSchema,
  type CreateRecommendationRunRequest,
  CreateRecommendationRunRequestSchema,
  fieldValueSchema,
  JobFamilySchema,
  JobPreferenceSchema,
  type JobRecommendationRunView,
  JobRecommendationRunViewSchema,
  JobRequirementSchema,
  MAX_RECOMMENDATION_CANDIDATES,
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
import {
  createCatalogRepository,
  getImmutableRecommendationJobProjections,
} from "../catalog/repository.js";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { lockOwnerIdempotencyKey } from "../lib/idempotency.js";
import { ServiceError } from "../lib/service-error.js";
import {
  getCurrentJobPreferences,
  getCurrentProfileFacts,
  getCurrentResumeEvidence,
} from "../profile/revision-repository.js";
import type { OwnerTaskLease } from "../workers/owner-task-lease.js";
import { OwnerTaskLeaseLostError, withOwnerTaskLease } from "../workers/owner-task-lease.js";
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
type RecommendationRunRow = Selectable<Database["matching.recommendation_runs"]>;

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
  const eligibilityColumn = options.enableLocalMvp
    ? ("versionEligibility.eligible_for_local_mvp" as const)
    : ("versionEligibility.eligible_for_alpha" as const);
  const row = await db
    .selectFrom("catalog.published_job_versions as version")
    .innerJoin("catalog.published_jobs as job", "job.id", "version.published_job_id")
    .innerJoin(
      "catalog.job_version_eligibility as versionEligibility",
      "versionEligibility.published_job_version_id",
      "version.id",
    )
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
    .where(eligibilityColumn, "=", true)
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

function caseMatchNotFound(): ServiceError {
  return new ServiceError(
    404,
    "APPLICATION_CASE_NOT_FOUND",
    "求职项目不存在、已删除或不属于当前账户。",
  );
}

function caseMatchRevisionConflict(): ServiceError {
  return new ServiceError(
    409,
    "APPLICATION_CASE_REVISION_CONFLICT",
    "求职项目已在其他页面更新，请刷新后重试。",
  );
}

function caseMatchContextChanged(): ServiceError {
  return new ServiceError(
    409,
    "CASE_MATCH_CONTEXT_CHANGED",
    "求职项目的固定岗位上下文已经变化，请刷新后重新核对。",
  );
}

function caseMatchContextUnavailable(): ServiceError {
  return new ServiceError(
    409,
    "CASE_MATCH_CONTEXT_UNAVAILABLE",
    "求职项目固定的岗位版本或要求集当前不可读取，系统不会改用其他版本。",
  );
}

async function loadCaseMatchContext(
  db: DbExecutor,
  owner: OwnerContext,
  caseId: string,
  lock = false,
) {
  let query = db
    .selectFrom("application.application_cases")
    .select([
      "id",
      "owner_id",
      "owner_epoch",
      "job_context_kind",
      "published_job_id",
      "published_job_version_id",
      "requirement_set_id",
      "revision",
    ])
    .where("id", "=", caseId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("deleted_at", "is", null);
  if (lock) query = query.forUpdate();
  return query.executeTakeFirst();
}

async function currentCaseMatchProfileInputs(
  db: DbExecutor,
  owner: OwnerContext,
): Promise<{
  input: Omit<CaseMatchInput, "publishedJobVersionId" | "requirementSetId"> | null;
  missingInputs: CaseMatchMissingInput[];
}> {
  const [facts, preferences, evidence] = await Promise.all([
    db
      .selectFrom("profile.profile_fact_revisions")
      .select("id")
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .orderBy("revision", "desc")
      .executeTakeFirst(),
    db
      .selectFrom("profile.job_preference_revisions")
      .select("id")
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .orderBy("revision", "desc")
      .executeTakeFirst(),
    db
      .selectFrom("profile.resume_evidence_revisions")
      .select(["id", "schema_version"])
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .orderBy("revision", "desc")
      .executeTakeFirst(),
  ]);
  const missingInputs: CaseMatchMissingInput[] = [];
  if (!facts) missingInputs.push("facts");
  if (!preferences) missingInputs.push("preferences");
  if (!evidence || evidence.schema_version !== "resume-evidence-v2") {
    missingInputs.push("evidence");
  }
  return {
    input:
      facts && preferences && evidence?.schema_version === "resume-evidence-v2"
        ? {
            profileFactRevisionId: facts.id,
            preferenceRevisionId: preferences.id,
            evidenceRevisionId: evidence.id,
          }
        : null,
    missingInputs,
  };
}

function sameCaseMatchProfileInputs(
  left: Awaited<ReturnType<typeof currentCaseMatchProfileInputs>>,
  right: Awaited<ReturnType<typeof currentCaseMatchProfileInputs>>,
): boolean {
  return hashCanonicalJson(left) === hashCanonicalJson(right);
}

async function lockCaseMatchProfileInputs(db: DbExecutor, ownerId: string): Promise<void> {
  // Keep the same order as atomic profile confirmation to avoid cross-command deadlocks.
  for (const scope of ["job-preferences", "profile-facts", "resume-evidence"] as const) {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${scope}:${ownerId}`}, 0))`.execute(
      db,
    );
  }
}

async function pinnedCaseMatchContextAvailable(
  db: DbExecutor,
  applicationCase: {
    published_job_id: string | null;
    published_job_version_id: string | null;
    requirement_set_id: string | null;
  },
): Promise<boolean> {
  if (
    !applicationCase.published_job_id ||
    !applicationCase.published_job_version_id ||
    !applicationCase.requirement_set_id
  ) {
    return false;
  }
  const row = await db
    .selectFrom("catalog.published_job_versions as version")
    .innerJoin("catalog.job_requirement_sets as requirement", (join) =>
      join
        .onRef("requirement.published_job_version_id", "=", "version.id")
        .on("requirement.id", "=", applicationCase.requirement_set_id),
    )
    .innerJoin("catalog.job_condition_projections as projection", (join) =>
      join
        .onRef("projection.published_job_version_id", "=", "version.id")
        .on("projection.requirement_set_id", "=", applicationCase.requirement_set_id),
    )
    .select("version.id")
    .where("version.id", "=", applicationCase.published_job_version_id)
    .where("version.published_job_id", "=", applicationCase.published_job_id)
    .executeTakeFirst();
  return Boolean(row);
}

async function caseMatchCatalogState(
  db: DbExecutor,
  applicationCase: {
    published_job_id: string | null;
    published_job_version_id: string | null;
    requirement_set_id: string | null;
  },
  options: MatchCatalogOptions,
): Promise<CaseMatchCatalogState> {
  if (!(await pinnedCaseMatchContextAvailable(db, applicationCase))) return "unavailable";
  const pointerColumn = options.enableLocalMvp
    ? ("job.current_version_id" as const)
    : ("job.public_version_id" as const);
  const row = await db
    .selectFrom("catalog.published_jobs as job")
    .leftJoin("catalog.published_job_versions as version", "version.id", pointerColumn)
    .leftJoin(
      "catalog.job_version_eligibility as eligibility",
      "eligibility.published_job_version_id",
      "version.id",
    )
    .leftJoin(
      "catalog.current_job_effective_activity as activity",
      "activity.published_job_version_id",
      "version.id",
    )
    .leftJoin("catalog.company_quota_selections as quota", "quota.published_job_id", "job.id")
    .select([
      "version.id as current_version_id",
      "version.active_requirement_set_id as current_requirement_set_id",
      "eligibility.eligible_for_local_mvp",
      "eligibility.eligible_for_alpha",
      "activity.effective_activity_state",
      "quota.selected as quota_selected",
    ])
    .where("job.id", "=", applicationCase.published_job_id)
    .executeTakeFirst();
  const eligible = options.enableLocalMvp ? row?.eligible_for_local_mvp : row?.eligible_for_alpha;
  if (
    !row?.current_version_id ||
    !row.current_requirement_set_id ||
    !eligible ||
    !row.effective_activity_state ||
    (options.enableLocalMvp && row.quota_selected === false)
  ) {
    return "unavailable";
  }
  if (row.effective_activity_state === "closed") return "closed";
  return row.current_version_id === applicationCase.published_job_version_id &&
    row.current_requirement_set_id === applicationCase.requirement_set_id
    ? "current"
    : "stale";
}

function matchRunState(run: MatchRunRow): "queued" | "processing" | "current" | "failed" {
  if (run.status === "queued") return "queued";
  if (run.status === "processing") return "processing";
  if (run.status === "succeeded") return "current";
  return "failed";
}

function caseMatchStaleReasons(run: MatchRunRow, input: CaseMatchInput): CaseMatchStaleReason[] {
  const reasons: CaseMatchStaleReason[] = [];
  if (
    run.published_job_version_id !== input.publishedJobVersionId ||
    run.requirement_set_id !== input.requirementSetId
  ) {
    reasons.push("case_job_version");
  }
  if (run.profile_fact_revision_id !== input.profileFactRevisionId) {
    reasons.push("profile_facts");
  }
  if (run.preference_revision_id !== input.preferenceRevisionId) reasons.push("preferences");
  if (run.evidence_revision_id !== input.evidenceRevisionId) reasons.push("evidence");
  return reasons;
}

async function latestExactCaseMatchRun(
  db: DbExecutor,
  owner: OwnerContext,
  input: CaseMatchInput,
): Promise<MatchRunRow | undefined> {
  return db
    .selectFrom("matching.match_runs")
    .selectAll()
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("published_job_version_id", "=", input.publishedJobVersionId)
    .where("requirement_set_id", "=", input.requirementSetId)
    .where("profile_fact_revision_id", "=", input.profileFactRevisionId)
    .where("preference_revision_id", "=", input.preferenceRevisionId)
    .where("evidence_revision_id", "=", input.evidenceRevisionId)
    .where("status", "!=", "deleted")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
}

async function latestRelatedCaseMatchRun(
  db: DbExecutor,
  owner: OwnerContext,
  publishedJobId: string,
): Promise<MatchRunRow | undefined> {
  return db
    .selectFrom("matching.match_runs as run")
    .innerJoin(
      "catalog.published_job_versions as version",
      "version.id",
      "run.published_job_version_id",
    )
    .selectAll("run")
    .where("run.owner_id", "=", owner.ownerId)
    .where("run.owner_epoch", "=", owner.ownerEpoch)
    .where("version.published_job_id", "=", publishedJobId)
    .where("run.status", "!=", "deleted")
    .orderBy("run.created_at", "desc")
    .orderBy("run.id", "desc")
    .executeTakeFirst();
}

async function resolveCaseMatchState(input: {
  db: DbExecutor;
  owner: OwnerContext;
  applicationCase: NonNullable<Awaited<ReturnType<typeof loadCaseMatchContext>>>;
  options: MatchCatalogOptions;
  profile?: Awaited<ReturnType<typeof currentCaseMatchProfileInputs>>;
  preferredRun?: MatchRunRow;
}): Promise<CaseMatchState> {
  const common = {
    schemaVersion: "case-match-state-v1" as const,
    caseId: input.applicationCase.id,
    caseRevision: Number(input.applicationCase.revision),
  };
  if (input.applicationCase.job_context_kind === "private") {
    return CaseMatchStateSchema.parse({
      ...common,
      status: "not_applicable_private",
      input: null,
      catalogState: null,
      missingInputs: [],
      staleReasons: [],
      run: null,
    });
  }
  if (
    !input.applicationCase.published_job_id ||
    !input.applicationCase.published_job_version_id ||
    !input.applicationCase.requirement_set_id
  ) {
    throw caseMatchContextUnavailable();
  }
  const [profile, catalogState] = await Promise.all([
    input.profile ?? currentCaseMatchProfileInputs(input.db, input.owner),
    caseMatchCatalogState(input.db, input.applicationCase, input.options),
  ]);
  if (!profile.input) {
    return CaseMatchStateSchema.parse({
      ...common,
      status: "profile_incomplete",
      input: null,
      catalogState,
      missingInputs: profile.missingInputs,
      staleReasons: [],
      run: null,
    });
  }
  const matchInput: CaseMatchInput = {
    publishedJobVersionId: input.applicationCase.published_job_version_id,
    requirementSetId: input.applicationCase.requirement_set_id,
    ...profile.input,
  };
  const exactRun =
    input.preferredRun ?? (await latestExactCaseMatchRun(input.db, input.owner, matchInput));
  if (exactRun) {
    return CaseMatchStateSchema.parse({
      ...common,
      status: matchRunState(exactRun),
      input: matchInput,
      catalogState,
      missingInputs: [],
      staleReasons: [],
      run: mapMatchRun(exactRun),
    });
  }
  const previousRun = await latestRelatedCaseMatchRun(
    input.db,
    input.owner,
    input.applicationCase.published_job_id,
  );
  if (previousRun) {
    return CaseMatchStateSchema.parse({
      ...common,
      status: "stale",
      input: matchInput,
      catalogState,
      missingInputs: [],
      staleReasons: caseMatchStaleReasons(previousRun, matchInput),
      run: mapMatchRun(previousRun),
    });
  }
  return CaseMatchStateSchema.parse({
    ...common,
    status: "not_run",
    input: matchInput,
    catalogState,
    missingInputs: [],
    staleReasons: [],
    run: null,
  });
}

export async function getCaseMatchState(
  db: Kysely<Database>,
  owner: OwnerContext,
  caseId: string,
  options: MatchCatalogOptions,
): Promise<CaseMatchState> {
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .execute(async (transaction) => {
      const applicationCase = await loadCaseMatchContext(transaction, owner, caseId);
      if (!applicationCase) throw caseMatchNotFound();
      return resolveCaseMatchState({ db: transaction, owner, applicationCase, options });
    });
}

export async function enqueueCaseMatchRun(
  db: Kysely<Database>,
  owner: OwnerContext,
  caseId: string,
  expectedCaseRevision: number,
  idempotencyKey: string,
  options: MatchCatalogOptions,
): Promise<CaseMatchState> {
  if (!idempotencyKey.trim()) {
    throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "创建匹配任务时必须提供幂等键。");
  }
  return db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: owner.ownerId,
      scope: "match-run",
      idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, owner.ownerId, owner.ownerEpoch);
    const applicationCase = await loadCaseMatchContext(transaction, owner, caseId, true);
    if (!applicationCase) throw caseMatchNotFound();
    if (applicationCase.job_context_kind === "private") {
      throw new ServiceError(
        422,
        "CASE_MATCH_NOT_APPLICABLE_PRIVATE",
        "用户私有 JD 不进入公共岗位三轴匹配；请继续逐项核对要求与证据。",
      );
    }
    if (!applicationCase.published_job_version_id || !applicationCase.requirement_set_id) {
      throw caseMatchContextUnavailable();
    }

    const initialProfile = await currentCaseMatchProfileInputs(transaction, owner);
    await lockCaseMatchProfileInputs(transaction, owner.ownerId);
    const profile = await currentCaseMatchProfileInputs(transaction, owner);
    if (!sameCaseMatchProfileInputs(initialProfile, profile)) {
      throw new ServiceError(
        409,
        "CASE_MATCH_INPUT_CHANGED",
        "已确认资料在创建匹配任务期间发生了变化，请刷新后重试。",
      );
    }
    const derivedInput = profile.input
      ? {
          publishedJobVersionId: applicationCase.published_job_version_id,
          requirementSetId: applicationCase.requirement_set_id,
          ...profile.input,
        }
      : null;
    const requestHash = hashCanonicalJson({
      caseId,
      expectedCaseRevision,
      input: derivedInput,
      missingInputs: profile.missingInputs,
    });
    const previous = await existingMatchRun(transaction, owner.ownerId, idempotencyKey);
    if (previous) {
      if (previous.request_hash !== requestHash) {
        throw new ServiceError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "同一个幂等键不能用于变化后的求职项目或资料输入。",
        );
      }
      return resolveCaseMatchState({
        db: transaction,
        owner,
        applicationCase,
        options,
        profile,
        preferredRun: previous,
      });
    }
    if (Number(applicationCase.revision) !== expectedCaseRevision) {
      throw caseMatchRevisionConflict();
    }
    if (!derivedInput) {
      throw new ServiceError(
        422,
        "CASE_MATCH_PROFILE_INCOMPLETE",
        "请先确认求职事实、岗位偏好和经历证据，再核对这个求职项目。",
      );
    }
    if (!(await pinnedCaseMatchContextAvailable(transaction, applicationCase))) {
      throw caseMatchContextUnavailable();
    }
    await assertProfileInputs(transaction, owner, derivedInput);

    const runId = randomUUID();
    const row = await transaction
      .insertInto("matching.match_runs")
      .values({
        id: runId,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        published_job_version_id: derivedInput.publishedJobVersionId,
        requirement_set_id: derivedInput.requirementSetId,
        profile_fact_revision_id: derivedInput.profileFactRevisionId,
        preference_revision_id: derivedInput.preferenceRevisionId,
        evidence_revision_id: derivedInput.evidenceRevisionId,
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
        payload: json({
          runId,
          executionContext: {
            kind: "case_pinned",
            caseId,
            expectedCaseRevision,
            publishedJobVersionId: derivedInput.publishedJobVersionId,
            requirementSetId: derivedInput.requirementSetId,
          },
        }),
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
    return resolveCaseMatchState({
      db: transaction,
      owner,
      applicationCase,
      options,
      profile,
      preferredRun: row,
    });
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

interface MatchProcessingOptions extends MatchCatalogOptions {
  executionContext?: CasePinnedMatchExecutionContext;
}

async function assertCasePinnedMatchContext(
  db: DbExecutor,
  owner: OwnerContext,
  run: MatchRunRow,
  executionContext: CasePinnedMatchExecutionContext,
): Promise<void> {
  if (
    run.published_job_version_id !== executionContext.publishedJobVersionId ||
    run.requirement_set_id !== executionContext.requirementSetId
  ) {
    throw caseMatchContextChanged();
  }
  const applicationCase = await loadCaseMatchContext(db, owner, executionContext.caseId, true);
  if (
    !applicationCase ||
    Number(applicationCase.revision) !== executionContext.expectedCaseRevision ||
    applicationCase.job_context_kind !== "public" ||
    applicationCase.published_job_version_id !== executionContext.publishedJobVersionId ||
    applicationCase.requirement_set_id !== executionContext.requirementSetId
  ) {
    throw caseMatchContextChanged();
  }
  if (!(await pinnedCaseMatchContextAvailable(db, applicationCase))) {
    throw caseMatchContextUnavailable();
  }
}

async function loadMatchJobVersion(
  db: DbExecutor,
  run: MatchRunRow,
  options: MatchProcessingOptions,
) {
  const base = db
    .selectFrom("catalog.published_job_versions as version")
    .innerJoin("catalog.published_jobs as job", "job.id", "version.published_job_id")
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
    .where("projection.requirement_set_id", "=", run.requirement_set_id);
  if (options.executionContext?.kind === "case_pinned") {
    return base.executeTakeFirst();
  }
  return base
    .innerJoin(
      "catalog.job_version_eligibility as eligibility",
      "eligibility.published_job_version_id",
      "version.id",
    )
    .whereRef(
      options.enableLocalMvp ? "job.current_version_id" : "job.public_version_id",
      "=",
      "version.id",
    )
    .where(
      options.enableLocalMvp
        ? "eligibility.eligible_for_local_mvp"
        : "eligibility.eligible_for_alpha",
      "=",
      true,
    )
    .executeTakeFirst();
}

async function loadMatchInputs(db: DbExecutor, run: MatchRunRow, options: MatchProcessingOptions) {
  const [requirementSet, factRevision, preferenceRevision, evidenceRevision, jobVersion] =
    await Promise.all([
      db
        .selectFrom("catalog.job_requirement_sets")
        .selectAll()
        .where("id", "=", run.requirement_set_id)
        .where("published_job_version_id", "=", run.published_job_version_id)
        .executeTakeFirst(),
      db
        .selectFrom("profile.profile_fact_revisions")
        .selectAll()
        .where("id", "=", run.profile_fact_revision_id)
        .where("owner_id", "=", run.owner_id)
        .where("owner_epoch", "=", run.owner_epoch)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("profile.job_preference_revisions")
        .selectAll()
        .where("id", "=", run.preference_revision_id)
        .where("owner_id", "=", run.owner_id)
        .where("owner_epoch", "=", run.owner_epoch)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("profile.resume_evidence_revisions")
        .selectAll()
        .where("id", "=", run.evidence_revision_id)
        .where("owner_id", "=", run.owner_id)
        .where("owner_epoch", "=", run.owner_epoch)
        .executeTakeFirstOrThrow(),
      loadMatchJobVersion(db, run, options),
    ]);

  if (!requirementSet || !jobVersion) {
    if (options.executionContext?.kind === "case_pinned") {
      throw caseMatchContextUnavailable();
    }
    throw new ServiceError(
      422,
      "JOB_REQUIREMENTS_NOT_READY",
      "该岗位的要求尚未完成可追溯拆解，请稍后重试。",
    );
  }

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

async function computeMatchResult(
  db: DbExecutor,
  run: MatchRunRow,
  options: MatchProcessingOptions,
): Promise<MatchRunResult> {
  const inputs = await loadMatchInputs(db, run, options);
  return MatchRunResultSchema.parse(evaluateThreeAxisMatch(inputs));
}

export async function processMatchRun(
  db: Kysely<Database>,
  owner: OwnerContext,
  runId: string,
  lease: OwnerTaskLease,
  options: MatchProcessingOptions,
): Promise<void> {
  try {
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
      if (options.executionContext?.kind === "case_pinned") {
        await assertCasePinnedMatchContext(transaction, owner, current, options.executionContext);
      }
      await transaction
        .updateTable("matching.match_runs")
        .set({ status: "processing" })
        .where("id", "=", current.id)
        .executeTakeFirstOrThrow();
      return current;
    });
    if (!run || run.status === "deleted" || run.status === "succeeded") return;
    const result = await computeMatchResult(db, run, options);
    await withOwnerTaskLease(db, lease, async (transaction) => {
      if (options.executionContext?.kind === "case_pinned") {
        await assertCasePinnedMatchContext(transaction, owner, run, options.executionContext);
      }
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
    if (error instanceof OwnerTaskLeaseLostError) throw error;
    await withOwnerTaskLease(db, lease, async (transaction) => {
      await transaction
        .updateTable("matching.match_runs")
        .set({
          status: "failed",
          failure_code: error instanceof ServiceError ? error.code : "MATCH_PROCESSING_FAILED",
          completed_at: new Date(),
        })
        .where("id", "=", runId)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("status", "in", ["queued", "processing", "failed"])
        .execute();
    });
    throw error;
  }
}

type RecommendationInput = CreateRecommendationRunRequest;

export interface RecommendationCatalogOptions {
  enableLocalMvp: boolean;
}

function parseRecommendationCandidateIds(
  row: Selectable<Database["matching.recommendation_runs"]>,
): string[] {
  return z
    .array(z.string().trim().min(1))
    .min(1)
    .max(MAX_RECOMMENDATION_CANDIDATES)
    .parse(row.candidate_job_version_ids);
}

function parseRecommendationCandidateSnapshots(
  row: Selectable<Database["matching.recommendation_runs"]>,
): Map<string, RecommendationCandidateFreshnessSnapshot> {
  if (row.candidate_freshness_snapshots === null) return new Map();
  const snapshots = RecommendationCandidateFreshnessSnapshotSchema.array()
    .min(1)
    .max(MAX_RECOMMENDATION_CANDIDATES)
    .parse(row.candidate_freshness_snapshots);
  return new Map(snapshots.map((snapshot) => [snapshot.publishedJobVersionId, snapshot]));
}

const FrozenRequirementSetSchema = z.object({
  publishedJobVersionId: z.string().trim().min(1),
  requirementSetId: z.string().trim().min(1),
});
type FrozenRequirementSet = z.infer<typeof FrozenRequirementSetSchema>;

function parseFrozenRequirementSets(
  row: Selectable<Database["matching.recommendation_runs"]>,
): Map<string, string> {
  const parsed = FrozenRequirementSetSchema.array()
    .max(MAX_RECOMMENDATION_CANDIDATES)
    .safeParse(row.candidate_requirement_set_ids);
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
    .innerJoin(
      "catalog.job_version_eligibility as versionEligibility",
      "versionEligibility.published_job_version_id",
      "version.id",
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
        .where("versionEligibility.eligible_for_local_mvp", "=", true)
        .whereRef("job.current_version_id", "=", "version.id")
        .where("revision.ingestion_state", "=", "validated")
        .where("revision.publication_state", "in", ["review", "published"])
        .where("policy.policy_status", "in", ["pending_review", "approved"])
    : query
        .where("versionEligibility.eligible_for_alpha", "=", true)
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
  row: RecommendationRunRow,
  enableLocalMvp: boolean,
): Promise<RecommendationCatalogContext> {
  const candidateIds = parseRecommendationCandidateIds(row);
  const snapshots = parseRecommendationCandidateSnapshots(row);
  const frozenRequirementSets = parseFrozenRequirementSets(row);
  const eligibilityColumn = enableLocalMvp
    ? ("versionEligibility.eligible_for_local_mvp as catalogEligible" as const)
    : ("versionEligibility.eligible_for_alpha as catalogEligible" as const);
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
      "catalog.job_version_eligibility as versionEligibility",
      "versionEligibility.published_job_version_id",
      "current.id",
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
      eligibilityColumn,
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
      !candidate.catalogEligible ||
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

async function insertRecommendationRunAndTask(
  transaction: Transaction<Database>,
  owner: OwnerContext,
  input: {
    request: CreateRecommendationRunRequest;
    candidateSnapshots: RecommendationCandidateFreshnessSnapshot[];
    frozenRequirementSets: FrozenRequirementSet[];
    resumeDocumentRevisionId: string | null;
    requestHash: string;
    idempotencyKey: string;
  },
): Promise<RecommendationRunRow> {
  const id = randomUUID();
  const created = await transaction
    .insertInto("matching.recommendation_runs")
    .values({
      id,
      owner_id: owner.ownerId,
      owner_epoch: owner.ownerEpoch,
      profile_fact_revision_id: input.request.profileFactRevisionId,
      preference_revision_id: input.request.preferenceRevisionId,
      evidence_revision_id: input.request.evidenceRevisionId,
      candidate_job_version_ids: json(input.request.candidateJobVersionIds),
      candidate_freshness_snapshots: json(input.candidateSnapshots),
      candidate_requirement_set_ids: json(input.frozenRequirementSets),
      resume_document_revision_id: input.resumeDocumentRevisionId,
      candidate_set_hash: hashCanonicalJson(input.request.candidateJobVersionIds),
      strategy_version: RECOMMENDATION_STRATEGY_VERSION,
      status: "queued",
      request_hash: input.requestHash,
      idempotency_key: input.idempotencyKey,
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
      idempotency_key: `owner:${owner.ownerId}:recommendation:${input.idempotencyKey}`,
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
  const parsedRequest = CreateRecommendationRunRequestSchema.parse(request);
  const normalizedRequest = {
    ...parsedRequest,
    candidateJobVersionIds: [...new Set(parsedRequest.candidateJobVersionIds)].sort(),
  };
  const requestHash = hashCanonicalJson(normalizedRequest);
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
    await assertProfileInputs(transaction, owner, parsedRequest);

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
      .where("id", "=", parsedRequest.evidenceRevisionId)
      .where("owner_id", "=", owner.ownerId)
      .executeTakeFirstOrThrow();
    return insertRecommendationRunAndTask(transaction, owner, {
      request: normalizedRequest,
      candidateSnapshots,
      frozenRequirementSets,
      resumeDocumentRevisionId: evidenceRevision.document_revision_id,
      requestHash,
      idempotencyKey,
    });
  });
  const context = await recommendationCatalogContext(db, row, options.enableLocalMvp);
  return mapRecommendationRun(row, [], context.runState);
}

function recommendationInputChanged(previousHash: string, requestHash: string): never {
  throw new ServiceError(
    409,
    "RECOMMENDATION_INPUT_CHANGED",
    previousHash === requestHash
      ? "岗位候选或已确认资料在推荐创建期间发生了变化，请刷新后重试。"
      : "同一个幂等键对应的筛选条件、候选岗位或已确认资料已经变化，请刷新后重试。",
  );
}

function retryableRecommendationCreationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  if (candidate.code === "40001") return true;
  return (
    candidate.code === "23505" &&
    candidate.constraint === "recommendation_runs_owner_id_idempotency_key_key"
  );
}

async function executeRepeatableRecommendationCreation<T>(
  db: Kysely<Database>,
  operation: (transaction: Transaction<Database>) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await db.transaction().setIsolationLevel("repeatable read").execute(operation);
    } catch (error) {
      if (!retryableRecommendationCreationError(error)) throw error;
      if (attempt === 3) {
        throw new ServiceError(
          503,
          "RECOMMENDATION_CREATE_RETRY_EXHAUSTED",
          "岗位目录或已确认资料正在更新，请稍后重新生成推荐。",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 5));
    }
  }
  throw new Error("RECOMMENDATION_CREATE_RETRY_UNREACHABLE");
}

export async function enqueueRecommendationRunFromSearch(
  db: Kysely<Database>,
  owner: OwnerContext,
  request: CreateRecommendationRunFromSearchRequest,
  idempotencyKey: string,
  options: RecommendationCatalogOptions,
): Promise<JobRecommendationRunView> {
  if (!idempotencyKey.trim()) {
    throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "创建推荐任务时必须提供幂等键。");
  }
  const parsedRequest = CreateRecommendationRunFromSearchRequestSchema.parse(request);
  const adapterKey = `from-search:${idempotencyKey}`;
  const row = await executeRepeatableRecommendationCreation(db, async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: owner.ownerId,
      scope: "recommendation-run",
      idempotencyKey: adapterKey,
    });
    await assertActiveOwnerEpoch(transaction, owner.ownerId, owner.ownerEpoch);
    const [facts, preferences, evidence] = await Promise.all([
      getCurrentProfileFacts({ db: transaction, ownerId: owner.ownerId }),
      getCurrentJobPreferences({ db: transaction, ownerId: owner.ownerId }),
      getCurrentResumeEvidence({ db: transaction, ownerId: owner.ownerId }),
    ]);
    if (!facts || !preferences || !evidence) {
      throw new ServiceError(
        422,
        "RECOMMENDATION_PROFILE_INCOMPLETE",
        "请先确认求职事实、岗位偏好和经历证据，再生成推荐。",
      );
    }
    const candidates = await createCatalogRepository({
      db: transaction,
      enableLocalMvp: options.enableLocalMvp,
    }).collectRecommendationCandidates(parsedRequest.scope, MAX_RECOMMENDATION_CANDIDATES);
    if (candidates.length === 0) {
      throw new ServiceError(
        422,
        "RECOMMENDATION_CANDIDATES_EMPTY",
        "当前筛选条件下没有可用于推荐的可信岗位。",
      );
    }
    if (candidates.length > MAX_RECOMMENDATION_CANDIDATES) {
      throw new ServiceError(
        422,
        "RECOMMENDATION_CANDIDATE_LIMIT_EXCEEDED",
        `当前筛选条件下的岗位超过 ${MAX_RECOMMENDATION_CANDIDATES} 条，请缩小范围后重试。`,
      );
    }
    const candidateJobVersionIds = candidates.map(({ publishedJobVersionId }) => {
      if (!publishedJobVersionId) {
        throw new ServiceError(
          422,
          "RECOMMENDATION_CANDIDATES_EMPTY",
          "当前筛选条件下没有完成要求拆解的可信岗位。",
        );
      }
      return publishedJobVersionId;
    });
    const input: CreateRecommendationRunRequest = {
      profileFactRevisionId: facts.id,
      preferenceRevisionId: preferences.id,
      evidenceRevisionId: evidence.id,
      candidateJobVersionIds,
    };
    const normalizedInput = {
      ...input,
      candidateJobVersionIds: [...new Set(candidateJobVersionIds)].sort(),
    };
    const requestHash = hashCanonicalJson({ scope: parsedRequest.scope, input: normalizedInput });
    const previous = await transaction
      .selectFrom("matching.recommendation_runs")
      .selectAll()
      .where("owner_id", "=", owner.ownerId)
      .where("idempotency_key", "=", adapterKey)
      .executeTakeFirst();
    if (previous) {
      if (previous.request_hash !== requestHash) {
        recommendationInputChanged(previous.request_hash, requestHash);
      }
      return previous;
    }
    await assertProfileInputs(transaction, owner, input);
    const existingCandidates = await transaction
      .selectFrom("catalog.published_job_versions")
      .select(["id", "active_requirement_set_id"])
      .where("id", "in", normalizedInput.candidateJobVersionIds)
      .execute();
    if (
      existingCandidates.length !== normalizedInput.candidateJobVersionIds.length ||
      existingCandidates.some(({ active_requirement_set_id }) => !active_requirement_set_id)
    ) {
      throw new ServiceError(
        409,
        "RECOMMENDATION_INPUT_CHANGED",
        "岗位候选在推荐创建期间发生了变化，请刷新后重试。",
      );
    }
    const candidateSnapshots = await currentCatalogCandidateSnapshots(
      transaction,
      normalizedInput.candidateJobVersionIds,
      options.enableLocalMvp,
    );
    if (candidateSnapshots.length !== normalizedInput.candidateJobVersionIds.length) {
      throw new ServiceError(
        409,
        "RECOMMENDATION_INPUT_CHANGED",
        "岗位目录在推荐创建期间发生了变化，请刷新后重试。",
      );
    }
    const frozenRequirementSets = normalizedInput.candidateJobVersionIds.map(
      (publishedJobVersionId) => ({
        publishedJobVersionId,
        requirementSetId: existingCandidates.find(({ id }) => id === publishedJobVersionId)
          ?.active_requirement_set_id as string,
      }),
    );
    return insertRecommendationRunAndTask(transaction, owner, {
      request: normalizedInput,
      candidateSnapshots,
      frozenRequirementSets,
      resumeDocumentRevisionId: evidence.documentRevisionId,
      requestHash,
      idempotencyKey: adapterKey,
    });
  });
  return recommendationView(db, row, owner, options);
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

async function recommendationView(
  db: DbExecutor,
  row: RecommendationRunRow,
  owner: OwnerContext,
  options: RecommendationCatalogOptions,
): Promise<JobRecommendationRunView> {
  const context = await recommendationCatalogContext(db, row, options.enableLocalMvp);
  const run = mapRecommendationRun(
    row,
    await recommendationItems(db, owner.ownerId, row.id, context),
    context.runState,
  );
  if (run.status !== "succeeded") {
    return JobRecommendationRunViewSchema.parse({
      schemaVersion: "job-recommendation-run-view-v1",
      run,
      jobs: [],
    });
  }
  const projections = await getImmutableRecommendationJobProjections(
    db,
    run.items.map(({ publishedJobVersionId }) => publishedJobVersionId),
  );
  const jobs = run.items.map((item) => {
    const projection = projections.get(item.publishedJobVersionId);
    if (!projection) {
      throw new ServiceError(
        409,
        "RECOMMENDATION_INPUT_CHANGED",
        "本次推荐固定的岗位版本已经不可读取，请重新生成推荐。",
      );
    }
    return {
      ordinal: item.ordinal,
      ...projection,
      display: {
        ...projection.display,
        lastVerifiedAt: item.lastVerifiedAt,
      },
      catalogState: item.catalogState,
    };
  });
  return JobRecommendationRunViewSchema.parse({
    schemaVersion: "job-recommendation-run-view-v1",
    run,
    jobs,
  });
}

export async function getRecommendationRunView(
  db: Kysely<Database>,
  owner: OwnerContext,
  runId: string,
  options: RecommendationCatalogOptions,
): Promise<JobRecommendationRunView | null> {
  const row = await db
    .selectFrom("matching.recommendation_runs")
    .selectAll()
    .where("id", "=", runId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .executeTakeFirst();
  return row ? recommendationView(db, row, owner, options) : null;
}

export async function processRecommendationRun(
  db: Kysely<Database>,
  owner: OwnerContext,
  runId: string,
  lease: OwnerTaskLease,
  options: RecommendationCatalogOptions,
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
    const currentCandidates = await currentCatalogCandidateSnapshots(
      db,
      candidateIds,
      options.enableLocalMvp,
    );
    if (currentCandidates.length !== candidateIds.length) {
      throw new ServiceError(
        409,
        "CANDIDATE_JOB_NOT_IN_CURRENT_CATALOG",
        "候选岗位在任务执行前已退出当前可信目录，请重新生成推荐。",
      );
    }
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
          : await computeMatchResult(db, matchRun, options);
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
