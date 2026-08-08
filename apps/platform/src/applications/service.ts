import { randomUUID } from "node:crypto";
import {
  type ApplicationCaseCommandResponse,
  ApplicationCaseCommandResponseSchema,
  ApplicationCaseCursorSchema,
  type ApplicationCaseEvent,
  ApplicationCaseEventSchema,
  type ApplicationCaseJobVersionDiffResponse,
  ApplicationCaseJobVersionDiffResponseSchema,
  type ApplicationCaseWithJobContext,
  ApplicationCaseWithJobContextSchema,
  type CaseOutcome,
  type CaseStage,
  type CreateApplicationCaseResponse,
  CreateApplicationCaseResponseSchema,
  type CreateApplicationCaseWithJobContextRequest,
  type JobRequirement,
  JobRequirementSchema,
  type JobVersionDiffField,
  type ListApplicationCasesQuery,
  type ListApplicationCasesResponse,
  ListApplicationCasesResponseSchema,
  PublicJobReferenceSchema,
  type TransitionApplicationCaseRequest,
  type UpgradeApplicationCaseJobVersionRequest,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, type Selectable, sql, type Transaction } from "kysely";
import { z } from "zod";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { canonicalJson, hashCanonicalJson } from "../lib/canonical-json.js";
import { lockOwnerIdempotencyKey } from "../lib/idempotency.js";
import { ServiceError } from "../lib/service-error.js";
import { semanticRevisionValue } from "../sources/normalized-official-job.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

interface ApplicationCaseMutationRow {
  id: string;
  owner_id: string;
  owner_epoch: number;
  job_context_kind: string;
  published_job_id: string | null;
  published_job_version_id: string | null;
  requirement_set_id: string | null;
  stage: string;
  outcome: string | null;
  revision: number;
  ended_at: Date | null;
  deleted_at: Date | null;
}

interface CaseEventRow {
  id: string;
  owner_epoch: number;
  case_id: string;
  sequence: number;
  event_type: string;
  actor_type: string;
  event_data: JsonValue;
  request_hash: string;
  created_at: Date;
}

type PublicVersionRow = Selectable<Database["catalog.published_job_versions"]> & {
  diff_requirement_set_id: string;
  diff_requirements: JsonValue;
};

const JobRequirementArraySchema = z.array(JobRequirementSchema);

const AllowedTransitions: Readonly<Record<CaseStage, ReadonlySet<CaseStage>>> = {
  interested: new Set(["preparing", "resolved"]),
  preparing: new Set(["interested", "applied", "resolved"]),
  applied: new Set(["interviewing", "resolved"]),
  interviewing: new Set(["applied", "resolved"]),
  resolved: new Set(),
};

export function canTransitionApplicationCaseStage(from: CaseStage, to: CaseStage): boolean {
  return AllowedTransitions[from].has(to);
}

interface ApplicationCaseReadRow {
  id: string;
  owner_id: string;
  owner_epoch: number;
  job_context_kind: string;
  published_job_id: string | null;
  published_job_version_id: string | null;
  requirement_set_id: string | null;
  private_job_snapshot_id: string | null;
  job_context_revision: number;
  stage: string;
  outcome: string | null;
  revision: number;
  ended_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  public_official_url: string | null;
  private_title: string | null;
  private_company_name: string | null;
  private_source_label: string | null;
  private_official_url: string | null;
  private_requirement_set_revision: number | null;
  private_source_provided: boolean | null;
}

const CursorEnvelopeSchema = z
  .object({
    version: z.literal(1),
    query: z.string().regex(/^[a-f0-9]{16}$/),
    position: ApplicationCaseCursorSchema,
  })
  .strict();

type ResolvedJobContext =
  | {
      kind: "public";
      publishedJobId: string;
      publishedJobVersionId: string;
      requirementSetId: string;
      jobContextRevision: 1;
    }
  | {
      kind: "private";
      snapshotId: string;
      contentRevision: number;
      jobContextRevision: number;
    };

function toIso(value: Date): string {
  return value.toISOString();
}

function parseJsonValue(value: JsonValue): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapCaseEvent(row: CaseEventRow): ApplicationCaseEvent {
  return ApplicationCaseEventSchema.parse({
    id: row.id,
    caseId: row.case_id,
    sequence: Number(row.sequence),
    eventType: row.event_type,
    actorType: row.actor_type,
    eventData: parseJsonValue(row.event_data),
    createdAt: toIso(row.created_at),
  });
}

function emptyRequirementChanges() {
  return { added: [], removed: [], changed: [] };
}

function requirementSummary(requirement: JobRequirement) {
  return {
    id: requirement.id,
    kind: requirement.kind,
    necessity: requirement.necessity,
    sourceText: requirement.sourceText,
  };
}

function requirementSemanticKey(requirement: JobRequirement): string {
  return canonicalJson({
    kind: requirement.kind,
    operator: requirement.operator,
    expectedValue: requirement.expectedValue,
    sourceText: requirement.sourceText,
    necessity: requirement.necessity,
  });
}

function requirementPairKey(requirement: JobRequirement): string {
  return canonicalJson({ kind: requirement.kind, sourceText: requirement.sourceText });
}

function compareRequirements(fromValue: JsonValue, toValue: JsonValue) {
  const from = JobRequirementArraySchema.parse(parseJsonValue(fromValue));
  const to = JobRequirementArraySchema.parse(parseJsonValue(toValue));
  const remainingFrom = [...from];
  const remainingTo: JobRequirement[] = [];

  for (const target of to) {
    const semanticKey = requirementSemanticKey(target);
    const exactIndex = remainingFrom.findIndex(
      (candidate) => requirementSemanticKey(candidate) === semanticKey,
    );
    if (exactIndex >= 0) {
      remainingFrom.splice(exactIndex, 1);
    } else {
      remainingTo.push(target);
    }
  }

  const changed: Array<{
    from: ReturnType<typeof requirementSummary>;
    to: ReturnType<typeof requirementSummary>;
  }> = [];
  const added: ReturnType<typeof requirementSummary>[] = [];
  for (const target of remainingTo) {
    const pairKey = requirementPairKey(target);
    const changedIndex = remainingFrom.findIndex(
      (candidate) => requirementPairKey(candidate) === pairKey,
    );
    if (changedIndex < 0) {
      added.push(requirementSummary(target));
      continue;
    }
    const previous = remainingFrom.splice(changedIndex, 1)[0];
    if (previous) {
      changed.push({ from: requirementSummary(previous), to: requirementSummary(target) });
    }
  }

  const sortSummary = (
    left: ReturnType<typeof requirementSummary>,
    right: ReturnType<typeof requirementSummary>,
  ) =>
    `${left.kind}:${left.sourceText}:${left.id}`.localeCompare(
      `${right.kind}:${right.sourceText}:${right.id}`,
      "zh-CN",
    );
  return {
    added: added.sort(sortSummary),
    removed: remainingFrom.map(requirementSummary).sort(sortSummary),
    changed: changed.sort((left, right) => sortSummary(left.from, right.from)),
  };
}

function versionFields(row: PublicVersionRow): Record<JobVersionDiffField, unknown> {
  return {
    companyName: row.company_name,
    title: row.title,
    jobFamily: semanticRevisionValue(row.job_family),
    locations: semanticRevisionValue(row.locations),
    department: semanticRevisionValue(row.department),
    jobCode: semanticRevisionValue(row.job_code),
    recruitmentType: semanticRevisionValue(row.recruitment_type),
    employmentType: semanticRevisionValue(row.employment_type),
    recruitmentBatch: semanticRevisionValue(row.recruitment_batch),
    weeklyAttendanceDays: semanticRevisionValue(row.weekly_attendance_days),
    durationMonths: semanticRevisionValue(row.duration_months),
    earliestStartDate: semanticRevisionValue(row.earliest_start_date),
    graduationYears: semanticRevisionValue(row.graduation_years),
    educationLevels: semanticRevisionValue(row.education_levels),
    majors: semanticRevisionValue(row.majors),
    languages: semanticRevisionValue(row.languages),
    salary: semanticRevisionValue(row.salary),
    workMode: semanticRevisionValue(row.work_mode),
    postedAt: semanticRevisionValue(row.posted_at),
    deadlineAt: semanticRevisionValue(row.deadline_at),
    responsibilities: row.responsibilities,
    requirements: row.requirements,
    structuredFields: semanticRevisionValue(row.structured_fields),
    activityState: row.activity_state,
    sourceUrl: row.source_url,
    applyUrl: row.apply_url,
  };
}

function diffDisplayValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : canonicalJson(value);
}

function compareVersionFields(from: PublicVersionRow, to: PublicVersionRow) {
  const fromFields = versionFields(from);
  const toFields = versionFields(to);
  return (Object.keys(fromFields) as JobVersionDiffField[]).flatMap((field) => {
    if (canonicalJson(fromFields[field]) === canonicalJson(toFields[field])) return [];
    return [
      {
        field,
        fromValue: diffDisplayValue(fromFields[field]),
        toValue: diffDisplayValue(toFields[field]),
      },
    ];
  });
}

function caseReadQuery(db: DbExecutor) {
  return db
    .selectFrom("application.application_cases as application_case")
    .leftJoin(
      "catalog.published_job_versions as public_version",
      "public_version.id",
      "application_case.published_job_version_id",
    )
    .leftJoin("application.private_job_snapshot_revisions as private_revision", (join) =>
      join
        .onRef("private_revision.owner_id", "=", "application_case.owner_id")
        .onRef("private_revision.snapshot_id", "=", "application_case.private_job_snapshot_id")
        .onRef("private_revision.content_revision", "=", "application_case.job_context_revision"),
    )
    .select([
      "application_case.id",
      "application_case.owner_id",
      "application_case.owner_epoch",
      "application_case.job_context_kind",
      "application_case.published_job_id",
      "application_case.published_job_version_id",
      "application_case.requirement_set_id",
      "application_case.private_job_snapshot_id",
      "application_case.job_context_revision",
      "application_case.stage",
      "application_case.outcome",
      "application_case.revision",
      "application_case.ended_at",
      "application_case.deleted_at",
      "application_case.created_at",
      "application_case.updated_at",
      sql<string | null>`COALESCE(public_version.apply_url, public_version.source_url)`.as(
        "public_official_url",
      ),
      "private_revision.title as private_title",
      "private_revision.company_name as private_company_name",
      "private_revision.source_label as private_source_label",
      "private_revision.official_url as private_official_url",
      "private_revision.requirement_set_revision as private_requirement_set_revision",
      "private_revision.source_provided as private_source_provided",
    ]);
}

function mapCaseRow(row: ApplicationCaseReadRow): ApplicationCaseWithJobContext {
  const common = {
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    stage: row.stage,
    outcome: row.outcome,
    revision: Number(row.revision),
    endedAt: row.ended_at ? toIso(row.ended_at) : null,
    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };

  if (row.job_context_kind === "public") {
    return ApplicationCaseWithJobContextSchema.parse({
      ...common,
      jobContext: {
        kind: "public",
        publishedJobId: row.published_job_id,
        publishedJobVersionId: row.published_job_version_id,
        requirementSetId: row.requirement_set_id,
        officialUrl: row.public_official_url,
      },
    });
  }

  return ApplicationCaseWithJobContextSchema.parse({
    ...common,
    jobContext: {
      kind: "private",
      snapshotId: row.private_job_snapshot_id,
      ownerId: row.owner_id,
      title: row.private_title,
      companyName: row.private_company_name,
      sourceLabel: row.private_source_label,
      ...(row.private_official_url ? { officialUrl: row.private_official_url } : {}),
      contentRevision: Number(row.job_context_revision),
      requirementSetRevision: Number(row.private_requirement_set_revision),
      sourceProvided: row.private_source_provided,
    },
  });
}

async function loadCaseById(
  db: DbExecutor,
  owner: OwnerScope,
  caseId: string,
): Promise<ApplicationCaseWithJobContext | null> {
  const row = await caseReadQuery(db)
    .where("application_case.id", "=", caseId)
    .where("application_case.owner_id", "=", owner.ownerId)
    .where("application_case.owner_epoch", "=", owner.ownerEpoch)
    .where("application_case.deleted_at", "is", null)
    .executeTakeFirst();
  return row ? mapCaseRow(row as ApplicationCaseReadRow) : null;
}

async function loadCaseForUpdate(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  caseId: string,
): Promise<ApplicationCaseMutationRow | null> {
  return (
    ((await transaction
      .selectFrom("application.application_cases")
      .select([
        "id",
        "owner_id",
        "owner_epoch",
        "job_context_kind",
        "published_job_id",
        "published_job_version_id",
        "requirement_set_id",
        "stage",
        "outcome",
        "revision",
        "ended_at",
        "deleted_at",
      ])
      .where("id", "=", caseId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("deleted_at", "is", null)
      .forUpdate()
      .executeTakeFirst()) as ApplicationCaseMutationRow | undefined) ?? null
  );
}

function caseNotFound(): ServiceError {
  return new ServiceError(
    404,
    "APPLICATION_CASE_NOT_FOUND",
    "求职项目不存在、已删除或不属于当前账户。",
  );
}

function revisionConflict(): ServiceError {
  return new ServiceError(
    409,
    "APPLICATION_CASE_REVISION_CONFLICT",
    "求职项目已在其他页面更新，请刷新后重试。",
  );
}

async function replayCaseCommand(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  input: { scope: string; idempotencyKey: string; requestHash: string },
): Promise<ApplicationCaseCommandResponse | null> {
  const row = await transaction
    .selectFrom("application.case_events")
    .select([
      "id",
      "owner_epoch",
      "case_id",
      "sequence",
      "event_type",
      "actor_type",
      "event_data",
      "request_hash",
      "created_at",
    ])
    .where("owner_id", "=", owner.ownerId)
    .where("idempotency_scope", "=", input.scope)
    .where("idempotency_key", "=", input.idempotencyKey)
    .executeTakeFirst();
  if (!row) return null;
  if (Number(row.owner_epoch) !== owner.ownerEpoch || row.request_hash !== input.requestHash) {
    throw new ServiceError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "同一个请求编号不能用于不同的求职项目操作。",
    );
  }
  return ApplicationCaseCommandResponseSchema.parse({
    event: mapCaseEvent(row as CaseEventRow),
  });
}

async function appendCaseEvent(
  transaction: Transaction<Database>,
  input: {
    owner: OwnerScope;
    caseId: string;
    sequence: number;
    eventType: "stage_transitioned" | "outcome_corrected" | "job_version_upgraded";
    eventData: Record<string, unknown>;
    idempotencyScope: string;
    idempotencyKey: string;
    requestHash: string;
  },
): Promise<ApplicationCaseCommandResponse> {
  const row = await transaction
    .insertInto("application.case_events")
    .values({
      id: randomUUID(),
      owner_id: input.owner.ownerId,
      owner_epoch: input.owner.ownerEpoch,
      case_id: input.caseId,
      sequence: input.sequence,
      event_type: input.eventType,
      actor_type: "owner",
      event_data: JSON.stringify(input.eventData) as unknown as JsonValue,
      idempotency_scope: input.idempotencyScope,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
    })
    .returning([
      "id",
      "owner_epoch",
      "case_id",
      "sequence",
      "event_type",
      "actor_type",
      "event_data",
      "request_hash",
      "created_at",
    ])
    .executeTakeFirstOrThrow();
  return ApplicationCaseCommandResponseSchema.parse({ event: mapCaseEvent(row as CaseEventRow) });
}

function publicVersionQuery(db: DbExecutor) {
  return db
    .selectFrom("catalog.published_job_versions as version")
    .innerJoin(
      "catalog.job_requirement_sets as requirement_set",
      "requirement_set.id",
      "version.active_requirement_set_id",
    )
    .selectAll("version")
    .select([
      "requirement_set.id as diff_requirement_set_id",
      "requirement_set.requirements as diff_requirements",
    ]);
}

async function loadPinnedPublicVersion(
  db: DbExecutor,
  input: { publishedJobId: string; publishedJobVersionId: string; requirementSetId: string },
): Promise<PublicVersionRow> {
  const row = await db
    .selectFrom("catalog.published_job_versions as version")
    .innerJoin("catalog.job_requirement_sets as requirement_set", (join) =>
      join
        .onRef("requirement_set.published_job_version_id", "=", "version.id")
        .on("requirement_set.id", "=", input.requirementSetId),
    )
    .selectAll("version")
    .select([
      "requirement_set.id as diff_requirement_set_id",
      "requirement_set.requirements as diff_requirements",
    ])
    .where("version.published_job_id", "=", input.publishedJobId)
    .where("version.id", "=", input.publishedJobVersionId)
    .executeTakeFirst();
  if (!row) throw new Error("APPLICATION_CASE_PINNED_JOB_VERSION_MISSING");
  return row as PublicVersionRow;
}

async function loadEligibleCurrentPublicVersion(
  db: DbExecutor,
  input: {
    publishedJobId: string;
    enableLocalMvp: boolean;
    targetPublishedJobVersionId?: string;
    lockJob?: boolean;
  },
): Promise<PublicVersionRow | null> {
  let query = publicVersionQuery(db)
    .innerJoin("catalog.published_jobs as job", "job.id", "version.published_job_id")
    .innerJoin(
      "catalog.job_version_eligibility as eligibility",
      "eligibility.published_job_version_id",
      "version.id",
    )
    .leftJoin("catalog.company_quota_selections as quota", "quota.published_job_id", "job.id")
    .where("job.id", "=", input.publishedJobId)
    .whereRef(
      input.enableLocalMvp ? "job.current_version_id" : "job.public_version_id",
      "=",
      "version.id",
    )
    .where(
      input.enableLocalMvp
        ? "eligibility.eligible_for_local_mvp"
        : "eligibility.eligible_for_alpha",
      "=",
      true,
    );
  if (input.enableLocalMvp) {
    query = query.where(sql<boolean>`COALESCE(quota.selected, TRUE)`);
  }
  if (input.targetPublishedJobVersionId) {
    query = query.where("version.id", "=", input.targetPublishedJobVersionId);
  }
  if (input.lockJob) {
    query = query.forUpdate("job");
  }
  return ((await query.executeTakeFirst()) as PublicVersionRow | undefined) ?? null;
}

function cursorQueryHash(query: Pick<ListApplicationCasesQuery, "stage">): string {
  return hashCanonicalJson({ stage: query.stage ?? null }).slice(0, 16);
}

function encodeCursor(applicationCase: ApplicationCaseWithJobContext, queryHash: string): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      query: queryHash,
      position: { updatedAt: applicationCase.updatedAt, id: applicationCase.id },
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value: string, queryHash: string) {
  try {
    const cursor = CursorEnvelopeSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (cursor.query !== queryHash) throw new Error("CURSOR_QUERY_MISMATCH");
    return cursor.position;
  } catch {
    throw new ServiceError(
      400,
      "INVALID_APPLICATION_CASE_CURSOR",
      "求职项目列表游标无效，请从第一页重新加载。",
    );
  }
}

export async function listApplicationCases(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  query: ListApplicationCasesQuery;
}): Promise<ListApplicationCasesResponse> {
  const queryHash = cursorQueryHash(input.query);
  const cursor = input.query.cursor ? decodeCursor(input.query.cursor, queryHash) : null;
  let query = caseReadQuery(input.db)
    .where("application_case.owner_id", "=", input.owner.ownerId)
    .where("application_case.owner_epoch", "=", input.owner.ownerEpoch)
    .where("application_case.deleted_at", "is", null);

  if (input.query.stage) {
    query = query.where("application_case.stage", "=", input.query.stage);
  }
  if (cursor) {
    const updatedAt = new Date(cursor.updatedAt);
    query = query.where((expression) =>
      expression.or([
        expression("application_case.updated_at", "<", updatedAt),
        expression.and([
          expression("application_case.updated_at", "=", updatedAt),
          expression("application_case.id", "<", cursor.id),
        ]),
      ]),
    );
  }

  const rows = await query
    .orderBy("application_case.updated_at", "desc")
    .orderBy("application_case.id", "desc")
    .limit(input.query.limit + 1)
    .execute();
  const hasMore = rows.length > input.query.limit;
  const items = rows
    .slice(0, input.query.limit)
    .map((row) => mapCaseRow(row as ApplicationCaseReadRow));
  const lastItem = items.at(-1);
  return ListApplicationCasesResponseSchema.parse({
    items,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem, queryHash) : null,
  });
}

export async function getApplicationCase(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
}): Promise<ApplicationCaseWithJobContext | null> {
  return loadCaseById(input.db, input.owner, input.caseId);
}

async function resolvePublicJobContext(
  db: Transaction<Database>,
  request: Extract<CreateApplicationCaseWithJobContextRequest["jobContext"], { kind: "public" }>,
  enableLocalMvp: boolean,
): Promise<ResolvedJobContext> {
  let query = db
    .selectFrom("catalog.published_job_versions as version")
    .innerJoin("catalog.published_jobs as job", "job.id", "version.published_job_id")
    .innerJoin(
      "catalog.job_version_eligibility as eligibility",
      "eligibility.published_job_version_id",
      "version.id",
    )
    .innerJoin(
      "catalog.job_requirement_sets as requirement_set",
      "requirement_set.id",
      "version.active_requirement_set_id",
    )
    .leftJoin("catalog.company_quota_selections as quota", "quota.published_job_id", "job.id")
    .select([
      "job.id as publishedJobId",
      "version.id as publishedJobVersionId",
      "requirement_set.id as requirementSetId",
      "version.apply_url as officialUrl",
    ])
    .where("job.id", "=", request.publishedJobId)
    .where("version.id", "=", request.publishedJobVersionId)
    .whereRef(
      enableLocalMvp ? "job.current_version_id" : "job.public_version_id",
      "=",
      "version.id",
    )
    .where(
      enableLocalMvp ? "eligibility.eligible_for_local_mvp" : "eligibility.eligible_for_alpha",
      "=",
      true,
    )
    .forUpdate("job");
  if (enableLocalMvp) {
    query = query.where(sql<boolean>`COALESCE(quota.selected, TRUE)`);
  }
  const row = await query.executeTakeFirst();
  const parsed = row
    ? PublicJobReferenceSchema.safeParse({
        kind: "public",
        publishedJobId: row.publishedJobId,
        publishedJobVersionId: row.publishedJobVersionId,
        requirementSetId: row.requirementSetId,
        officialUrl: row.officialUrl,
      })
    : null;
  if (!parsed?.success) {
    throw new ServiceError(
      422,
      "PUBLIC_JOB_CONTEXT_UNAVAILABLE",
      "该岗位版本当前不在可创建求职项目的目录范围内，请刷新岗位后重试。",
    );
  }
  return {
    kind: "public",
    publishedJobId: parsed.data.publishedJobId,
    publishedJobVersionId: parsed.data.publishedJobVersionId,
    requirementSetId: parsed.data.requirementSetId,
    jobContextRevision: 1,
  };
}

async function resolvePrivateJobContext(
  db: Transaction<Database>,
  owner: OwnerScope,
  request: Extract<CreateApplicationCaseWithJobContextRequest["jobContext"], { kind: "private" }>,
): Promise<ResolvedJobContext> {
  const row = await db
    .selectFrom("application.private_job_snapshots as snapshot")
    .innerJoin("application.private_job_snapshot_revisions as revision", (join) =>
      join
        .onRef("revision.owner_id", "=", "snapshot.owner_id")
        .onRef("revision.snapshot_id", "=", "snapshot.id"),
    )
    .select(["snapshot.id as snapshotId", "revision.content_revision as contentRevision"])
    .where("snapshot.id", "=", request.snapshotId)
    .where("snapshot.owner_id", "=", owner.ownerId)
    .where("snapshot.owner_epoch", "=", owner.ownerEpoch)
    .where("snapshot.deleted_at", "is", null)
    .where("revision.owner_epoch", "=", owner.ownerEpoch)
    .where("revision.content_revision", "=", request.contentRevision)
    .forUpdate("snapshot")
    .executeTakeFirst();
  if (!row) {
    throw new ServiceError(
      404,
      "PRIVATE_JOB_CONTEXT_NOT_FOUND",
      "私有岗位不存在、已删除或不属于当前账户。",
    );
  }
  return {
    kind: "private",
    snapshotId: row.snapshotId,
    contentRevision: Number(row.contentRevision),
    jobContextRevision: Number(row.contentRevision),
  };
}

async function findActiveCaseId(
  db: Transaction<Database>,
  owner: OwnerScope,
  context: ResolvedJobContext,
): Promise<string | null> {
  let query = db
    .selectFrom("application.application_cases")
    .select("id")
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("ended_at", "is", null)
    .where("deleted_at", "is", null)
    .where("job_context_kind", "=", context.kind);
  query =
    context.kind === "public"
      ? query.where("published_job_id", "=", context.publishedJobId)
      : query.where("private_job_snapshot_id", "=", context.snapshotId);
  return (await query.executeTakeFirst())?.id ?? null;
}

function contextLockKey(context: ResolvedJobContext): string {
  return context.kind === "public"
    ? `public:${context.publishedJobId}`
    : `private:${context.snapshotId}`;
}

export async function createApplicationCase(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  request: CreateApplicationCaseWithJobContextRequest;
  idempotencyKey: string;
  enableLocalMvp: boolean;
}): Promise<CreateApplicationCaseResponse> {
  const requestHash = hashCanonicalJson(input.request);
  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: "application-case-create",
      idempotencyKey: input.idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);

    const replay = await transaction
      .selectFrom("application.application_cases")
      .select(["id", "creation_request_hash"])
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("creation_idempotency_key", "=", input.idempotencyKey)
      .executeTakeFirst();
    if (replay) {
      if (replay.creation_request_hash !== requestHash) {
        throw new ServiceError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "同一个请求编号不能用于不同的求职项目创建请求。",
        );
      }
      const applicationCase = await loadCaseById(transaction, input.owner, replay.id);
      if (!applicationCase) {
        throw new ServiceError(
          410,
          "APPLICATION_CASE_DELETED",
          "该请求曾创建的求职项目已经删除，请使用新的请求编号。",
        );
      }
      return CreateApplicationCaseResponseSchema.parse({ applicationCase, created: true });
    }

    const context =
      input.request.jobContext.kind === "public"
        ? await resolvePublicJobContext(transaction, input.request.jobContext, input.enableLocalMvp)
        : await resolvePrivateJobContext(transaction, input.owner, input.request.jobContext);
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: "application-case-context",
      idempotencyKey: contextLockKey(context),
    });

    const activeCaseId = await findActiveCaseId(transaction, input.owner, context);
    if (activeCaseId) {
      const applicationCase = await loadCaseById(transaction, input.owner, activeCaseId);
      if (!applicationCase) throw new Error("APPLICATION_CASE_ACTIVE_ROW_UNREADABLE");
      return CreateApplicationCaseResponseSchema.parse({ applicationCase, created: false });
    }

    const caseId = randomUUID();
    await transaction
      .insertInto("application.application_cases")
      .values({
        id: caseId,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        published_job_id: context.kind === "public" ? context.publishedJobId : null,
        published_job_version_id: context.kind === "public" ? context.publishedJobVersionId : null,
        requirement_set_id: context.kind === "public" ? context.requirementSetId : null,
        job_context_kind: context.kind,
        private_job_snapshot_id: context.kind === "private" ? context.snapshotId : null,
        job_context_revision: context.jobContextRevision,
        stage: "interested",
        outcome: null,
        revision: 1,
        creation_idempotency_key: input.idempotencyKey,
        creation_request_hash: requestHash,
        expires_at: null,
        ended_at: null,
        deleted_at: null,
      })
      .execute();
    await transaction
      .insertInto("application.case_events")
      .values({
        id: randomUUID(),
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        case_id: caseId,
        sequence: 1,
        event_type: "case_created",
        actor_type: "owner",
        event_data: JSON.stringify({
          schemaVersion: "case-event-v1",
          initialStage: "interested",
          jobContextKind: context.kind,
          jobContextRevision: context.jobContextRevision,
        }) as unknown as JsonValue,
        idempotency_scope: "application-case:create",
        idempotency_key: input.idempotencyKey,
        request_hash: requestHash,
      })
      .execute();

    const applicationCase = await loadCaseById(transaction, input.owner, caseId);
    if (!applicationCase) throw new Error("APPLICATION_CASE_INSERT_NOT_READABLE");
    return CreateApplicationCaseResponseSchema.parse({ applicationCase, created: true });
  });
}

export async function transitionApplicationCase(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  request: TransitionApplicationCaseRequest;
  idempotencyKey: string;
}): Promise<ApplicationCaseCommandResponse> {
  const idempotencyScope = "application-case:transition";
  const requestHash = hashCanonicalJson({ caseId: input.caseId, request: input.request });
  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: idempotencyScope,
      idempotencyKey: input.idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);
    const replay = await replayCaseCommand(transaction, input.owner, {
      scope: idempotencyScope,
      idempotencyKey: input.idempotencyKey,
      requestHash,
    });
    if (replay) return replay;

    const applicationCase = await loadCaseForUpdate(transaction, input.owner, input.caseId);
    if (!applicationCase) throw caseNotFound();
    if (Number(applicationCase.revision) !== input.request.expectedRevision) {
      throw revisionConflict();
    }

    const fromStage = applicationCase.stage as CaseStage;
    const fromOutcome = applicationCase.outcome as CaseOutcome | null;
    const toStage = input.request.toStage;
    const toOutcome = input.request.outcome ?? null;
    const nextRevision = Number(applicationCase.revision) + 1;
    const now = new Date();

    if (fromStage === toStage) {
      if (
        fromStage !== "resolved" ||
        fromOutcome === null ||
        toOutcome === null ||
        fromOutcome === toOutcome ||
        !input.request.reason
      ) {
        throw new ServiceError(
          409,
          "INVALID_CASE_TRANSITION",
          "该阶段没有发生有效变化；已结束项目只允许带原因码纠正结果。",
        );
      }
      await transaction
        .updateTable("application.application_cases")
        .set({ outcome: toOutcome, revision: nextRevision, updated_at: now })
        .where("id", "=", applicationCase.id)
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .where("revision", "=", input.request.expectedRevision)
        .executeTakeFirstOrThrow();
      return appendCaseEvent(transaction, {
        owner: input.owner,
        caseId: applicationCase.id,
        sequence: nextRevision,
        eventType: "outcome_corrected",
        eventData: {
          schemaVersion: "case-event-v1",
          fromOutcome,
          toOutcome,
          reasonCode: input.request.reason,
        },
        idempotencyScope,
        idempotencyKey: input.idempotencyKey,
        requestHash,
      });
    }

    if (!canTransitionApplicationCaseStage(fromStage, toStage)) {
      throw new ServiceError(
        409,
        "INVALID_CASE_TRANSITION",
        "当前阶段不能迁移到目标阶段，请刷新后按求职流程继续。",
      );
    }
    await transaction
      .updateTable("application.application_cases")
      .set({
        stage: toStage,
        outcome: toOutcome,
        ended_at: toStage === "resolved" ? now : null,
        revision: nextRevision,
        updated_at: now,
      })
      .where("id", "=", applicationCase.id)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("revision", "=", input.request.expectedRevision)
      .executeTakeFirstOrThrow();
    return appendCaseEvent(transaction, {
      owner: input.owner,
      caseId: applicationCase.id,
      sequence: nextRevision,
      eventType: "stage_transitioned",
      eventData: {
        schemaVersion: "case-event-v1",
        fromStage,
        toStage,
        outcome: toOutcome,
        reasonCode: input.request.reason ?? null,
      },
      idempotencyScope,
      idempotencyKey: input.idempotencyKey,
      requestHash,
    });
  });
}

export async function getApplicationCaseJobVersionDiff(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  enableLocalMvp: boolean;
}): Promise<ApplicationCaseJobVersionDiffResponse> {
  const applicationCase = await getApplicationCase(input);
  if (!applicationCase) throw caseNotFound();
  if (applicationCase.jobContext.kind !== "public") {
    throw new ServiceError(
      409,
      "JOB_VERSION_UPGRADE_NOT_APPLICABLE",
      "私有岗位使用用户固定的 JD 修订，不适用公共岗位版本升级。",
    );
  }
  const pinned = await loadPinnedPublicVersion(input.db, {
    publishedJobId: applicationCase.jobContext.publishedJobId,
    publishedJobVersionId: applicationCase.jobContext.publishedJobVersionId,
    requirementSetId: applicationCase.jobContext.requirementSetId,
  });
  const target = await loadEligibleCurrentPublicVersion(input.db, {
    publishedJobId: applicationCase.jobContext.publishedJobId,
    enableLocalMvp: input.enableLocalMvp,
  });
  const common = {
    caseId: applicationCase.id,
    publishedJobId: applicationCase.jobContext.publishedJobId,
    pinnedPublishedJobVersionId: applicationCase.jobContext.publishedJobVersionId,
    pinnedRequirementSetId: applicationCase.jobContext.requirementSetId,
  };
  if (!target) {
    return ApplicationCaseJobVersionDiffResponseSchema.parse({
      ...common,
      status: "target_unavailable",
      targetPublishedJobVersionId: null,
      targetRequirementSetId: null,
      fieldChanges: [],
      requirementChanges: emptyRequirementChanges(),
    });
  }
  if (target.id === pinned.id) {
    return ApplicationCaseJobVersionDiffResponseSchema.parse({
      ...common,
      status: "up_to_date",
      targetPublishedJobVersionId: target.id,
      targetRequirementSetId: target.diff_requirement_set_id,
      fieldChanges: [],
      requirementChanges: emptyRequirementChanges(),
    });
  }
  return ApplicationCaseJobVersionDiffResponseSchema.parse({
    ...common,
    status: "update_available",
    targetPublishedJobVersionId: target.id,
    targetRequirementSetId: target.diff_requirement_set_id,
    fieldChanges: compareVersionFields(pinned, target),
    requirementChanges: compareRequirements(pinned.diff_requirements, target.diff_requirements),
  });
}

export async function upgradeApplicationCaseJobVersion(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  request: UpgradeApplicationCaseJobVersionRequest;
  idempotencyKey: string;
  enableLocalMvp: boolean;
}): Promise<ApplicationCaseCommandResponse> {
  const idempotencyScope = "application-case:job-version-upgrade";
  const requestHash = hashCanonicalJson({ caseId: input.caseId, request: input.request });
  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: idempotencyScope,
      idempotencyKey: input.idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);
    const replay = await replayCaseCommand(transaction, input.owner, {
      scope: idempotencyScope,
      idempotencyKey: input.idempotencyKey,
      requestHash,
    });
    if (replay) return replay;

    const applicationCase = await loadCaseForUpdate(transaction, input.owner, input.caseId);
    if (!applicationCase) throw caseNotFound();
    if (Number(applicationCase.revision) !== input.request.expectedRevision) {
      throw revisionConflict();
    }
    if (
      applicationCase.job_context_kind !== "public" ||
      !applicationCase.published_job_id ||
      !applicationCase.published_job_version_id ||
      !applicationCase.requirement_set_id
    ) {
      throw new ServiceError(
        409,
        "JOB_VERSION_UPGRADE_NOT_APPLICABLE",
        "私有岗位使用用户固定的 JD 修订，不适用公共岗位版本升级。",
      );
    }
    if (applicationCase.published_job_version_id === input.request.targetPublishedJobVersionId) {
      throw new ServiceError(
        409,
        "JOB_VERSION_ALREADY_CURRENT",
        "求职项目已经固定到该岗位版本，无需重复升级。",
      );
    }
    const target = await loadEligibleCurrentPublicVersion(transaction, {
      publishedJobId: applicationCase.published_job_id,
      targetPublishedJobVersionId: input.request.targetPublishedJobVersionId,
      enableLocalMvp: input.enableLocalMvp,
      lockJob: true,
    });
    if (!target) {
      throw new ServiceError(
        422,
        "PUBLIC_JOB_CONTEXT_UNAVAILABLE",
        "目标岗位版本不是同一岗位当前可用的准入版本，请刷新差异后重试。",
      );
    }

    const nextRevision = Number(applicationCase.revision) + 1;
    await transaction
      .updateTable("application.application_cases")
      .set({
        published_job_version_id: target.id,
        requirement_set_id: target.diff_requirement_set_id,
        revision: nextRevision,
        updated_at: new Date(),
      })
      .where("id", "=", applicationCase.id)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("revision", "=", input.request.expectedRevision)
      .executeTakeFirstOrThrow();
    return appendCaseEvent(transaction, {
      owner: input.owner,
      caseId: applicationCase.id,
      sequence: nextRevision,
      eventType: "job_version_upgraded",
      eventData: {
        schemaVersion: "case-event-v1",
        fromPublishedJobVersionId: applicationCase.published_job_version_id,
        toPublishedJobVersionId: target.id,
        fromRequirementSetId: applicationCase.requirement_set_id,
        toRequirementSetId: target.diff_requirement_set_id,
        reasonCode: "USER_CONFIRMED",
      },
      idempotencyScope,
      idempotencyKey: input.idempotencyKey,
      requestHash,
    });
  });
}

type LegacyDecisionStatus = "undecided" | "saved" | "preparing_to_apply" | "applied" | "abandoned";

function legacyDecisionTarget(status: LegacyDecisionStatus): {
  stage: CaseStage;
  outcome: CaseOutcome | null;
} | null {
  if (status === "undecided") return null;
  if (status === "saved") return { stage: "interested", outcome: null };
  if (status === "preparing_to_apply") return { stage: "preparing", outcome: null };
  if (status === "applied") return { stage: "applied", outcome: null };
  return { stage: "resolved", outcome: "withdrawn" };
}

function legacyDecisionForCase(
  stage: CaseStage,
  outcome: CaseOutcome | null,
): LegacyDecisionStatus | null {
  if (stage === "interested") return "saved";
  if (stage === "preparing") return "preparing_to_apply";
  if (stage === "applied") return "applied";
  if (stage === "resolved" && outcome === "withdrawn") return "abandoned";
  return null;
}

export async function syncApplicationCaseFromLegacyDecision(
  transaction: Transaction<Database>,
  input: {
    owner: OwnerScope;
    publishedJobId: string;
    decisionExpectedRevision: number;
    status: LegacyDecisionStatus;
    reason: string | null;
  },
): Promise<void> {
  const applicationCase = await transaction
    .selectFrom("application.application_cases")
    .select([
      "id",
      "owner_id",
      "owner_epoch",
      "job_context_kind",
      "published_job_id",
      "published_job_version_id",
      "requirement_set_id",
      "stage",
      "outcome",
      "revision",
      "ended_at",
      "deleted_at",
    ])
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("job_context_kind", "=", "public")
    .where("published_job_id", "=", input.publishedJobId)
    .where("deleted_at", "is", null)
    .orderBy(sql<boolean>`ended_at IS NULL`, "desc")
    .orderBy("created_at", "desc")
    .limit(1)
    .forUpdate()
    .executeTakeFirst();
  if (!applicationCase) return;

  const fromStage = applicationCase.stage as CaseStage;
  const fromOutcome = applicationCase.outcome as CaseOutcome | null;
  const currentLegacyStatus = legacyDecisionForCase(fromStage, fromOutcome);
  const target = legacyDecisionTarget(input.status);
  if (!currentLegacyStatus || !target) {
    throw new ServiceError(
      409,
      "CAREER_OS_STATE_NOT_REPRESENTABLE",
      "当前求职项目状态不能由旧岗位状态无损表示，请在求职工作台中继续。",
    );
  }
  if (currentLegacyStatus === input.status) return;
  if (!canTransitionApplicationCaseStage(fromStage, target.stage)) {
    throw new ServiceError(
      409,
      "CAREER_OS_STATE_NOT_REPRESENTABLE",
      "该旧岗位状态会跳过或倒退求职阶段，请在求职工作台中继续。",
    );
  }

  const nextRevision = Number(applicationCase.revision) + 1;
  const now = new Date();
  const requestHash = hashCanonicalJson({
    source: "legacy-job-decision",
    publishedJobId: input.publishedJobId,
    expectedRevision: input.decisionExpectedRevision,
    status: input.status,
    reason: input.reason,
  });
  await transaction
    .updateTable("application.application_cases")
    .set({
      stage: target.stage,
      outcome: target.outcome,
      ended_at: target.stage === "resolved" ? now : null,
      revision: nextRevision,
      updated_at: now,
    })
    .where("id", "=", applicationCase.id)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("revision", "=", applicationCase.revision)
    .executeTakeFirstOrThrow();
  await appendCaseEvent(transaction, {
    owner: input.owner,
    caseId: applicationCase.id,
    sequence: nextRevision,
    eventType: "stage_transitioned",
    eventData: {
      schemaVersion: "case-event-v1",
      fromStage,
      toStage: target.stage,
      outcome: target.outcome,
      reasonCode: "LEGACY_DECISION_SYNC",
    },
    idempotencyScope: "legacy-job-decision-sync",
    idempotencyKey: `${input.publishedJobId}:${input.decisionExpectedRevision + 1}`,
    requestHash,
  });
}
