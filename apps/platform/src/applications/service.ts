import { randomUUID } from "node:crypto";
import {
  type ApplicationCaseCommandResponse,
  ApplicationCaseCommandResponseSchema,
  ApplicationCaseCursorSchema,
  type ApplicationCaseEvent,
  ApplicationCaseEventSchema,
  type ApplicationCaseJobVersionDiffResponse,
  ApplicationCaseJobVersionDiffResponseSchema,
  ApplicationCaseJobDisplaySchema,
  type ApplicationCaseMutationResponse,
  ApplicationCaseMutationResponseSchema,
  type ApplicationCaseRequirements,
  ApplicationCaseRequirementsSchema,
  type ApplicationCaseWithJobContext,
  ApplicationCaseWithJobContextSchema,
  type CaseEventType,
  type CaseOutcome,
  type CaseQuestion,
  CaseQuestionSchema,
  type CaseRequirementEvidenceLink,
  CaseRequirementEvidenceLinkSchema,
  type CaseRequirementStateReadModel,
  CaseRequirementStateReadModelSchema,
  type CaseStage,
  type CreateApplicationCaseResponse,
  CreateApplicationCaseResponseSchema,
  type CreateApplicationCaseWithJobContextRequest,
  type CreateCaseQuestionRequest,
  type JobRequirement,
  JobRequirementSchema,
  type JobVersionDiffField,
  type ListApplicationCasesQuery,
  type ListApplicationCasesResponse,
  ListApplicationCasesResponseSchema,
  PublicJobReferenceSchema,
  type PutCaseRequirementEvidenceLinksRequest,
  type PutCaseRequirementStateRequest,
  type RequirementContext,
  ResumeEvidenceRevisionSchema,
  type TransitionApplicationCaseRequest,
  type UpdateCaseQuestionRequest,
  type UpgradeApplicationCaseJobVersionRequest,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, type Selectable, sql, type Transaction } from "kysely";
import { z } from "zod";
import { decomposeTextualJobRequirements } from "../catalog/requirements.js";
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
  private_job_snapshot_id: string | null;
  job_context_revision: number;
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
type CaseRequirementStateRow = Selectable<Database["application.case_requirement_states"]>;
type CaseRequirementEvidenceLinkRow = Selectable<
  Database["application.case_requirement_evidence_links"]
>;
type CaseQuestionRow = Selectable<Database["application.case_questions"]>;

interface FixedRequirementContext {
  requirementContext: RequirementContext;
  requirements: JobRequirement[];
}

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
  public_title: string | null;
  public_company_name: string | null;
  public_locations: JsonValue | null;
  public_work_mode: JsonValue | null;
  public_deadline_at: JsonValue | null;
  public_source_name: string | null;
  public_policy_status: string | null;
  public_provenance_level: string | null;
  public_last_verified_at: Date | null;
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

function monotonicUpdatedAt() {
  return sql<Date>`GREATEST(updated_at, clock_timestamp())`;
}

function caseEndedAt() {
  return sql<Date>`GREATEST(created_at, clock_timestamp())`;
}

function evidenceRemovedAt() {
  return sql<Date>`GREATEST(linked_at, clock_timestamp())`;
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
    .leftJoin(
      "ingestion.source_job_revisions as public_source_revision",
      "public_source_revision.id",
      "public_version.source_job_revision_id",
    )
    .leftJoin(
      "ingestion.source_job_records as public_source_record",
      "public_source_record.id",
      "public_source_revision.source_job_record_id",
    )
    .leftJoin(
      "source_control.sources as public_source",
      "public_source.id",
      "public_source_record.source_id",
    )
    .leftJoin("source_control.source_policy_versions as public_policy", (join) =>
      join
        .onRef("public_policy.source_id", "=", "public_source.id")
        .onRef("public_policy.version", "=", "public_source.current_policy_version"),
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
      "public_version.title as public_title",
      "public_version.company_name as public_company_name",
      "public_version.locations as public_locations",
      "public_version.work_mode as public_work_mode",
      "public_version.deadline_at as public_deadline_at",
      "public_source.name as public_source_name",
      "public_policy.policy_status as public_policy_status",
      "public_policy.provenance_level as public_provenance_level",
      sql<Date | null>`COALESCE(public_policy.reviewed_at, public_source_revision.created_at)`.as(
        "public_last_verified_at",
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
    const jobDisplay = ApplicationCaseJobDisplaySchema.parse({
      title: row.public_title,
      companyName: row.public_company_name,
      locations: row.public_locations,
      workMode: row.public_work_mode,
      deadlineAt: row.public_deadline_at,
      source: {
        kind: "catalog",
        displayName:
          row.public_policy_status === "pending_review" ? "本地待复核来源" : row.public_source_name,
        policyStatus: row.public_policy_status,
        provenanceLevel: row.public_provenance_level,
        lastVerifiedAt: row.public_last_verified_at ? toIso(row.public_last_verified_at) : null,
      },
    });
    return ApplicationCaseWithJobContextSchema.parse({
      ...common,
      jobContext: {
        kind: "public",
        publishedJobId: row.published_job_id,
        publishedJobVersionId: row.published_job_version_id,
        requirementSetId: row.requirement_set_id,
        officialUrl: row.public_official_url,
      },
      jobDisplay,
    });
  }

  const jobDisplay = ApplicationCaseJobDisplaySchema.parse({
    title: row.private_title,
    companyName: row.private_company_name,
    locations: { state: "unknown", reason: "source_not_stated" },
    workMode: { state: "unknown", reason: "source_not_stated" },
    deadlineAt: { state: "unknown", reason: "source_not_stated" },
    source: {
      kind: "owner_private",
      displayName: row.private_source_label,
      sourceProvided: row.private_source_provided,
      verified: false,
    },
  });
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
    jobDisplay,
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
        "private_job_snapshot_id",
        "job_context_revision",
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
    eventType: CaseEventType;
    eventData: Record<string, unknown>;
    schemaVersion?: "case-event-v1" | "case-event-v2";
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
      schema_version: input.schemaVersion ?? "case-event-v1",
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

function mutationResponse(
  caseRevision: number,
  event: ApplicationCaseEvent | null,
): ApplicationCaseMutationResponse {
  return ApplicationCaseMutationResponseSchema.parse({ caseRevision, event });
}

function requirementReferenceInvalid(): ServiceError {
  return new ServiceError(
    422,
    "REQUIREMENT_REFERENCE_INVALID",
    "该要求不属于求职项目当前固定的岗位版本，请刷新后重试。",
  );
}

function evidenceReferenceInvalid(): ServiceError {
  return new ServiceError(
    422,
    "EVIDENCE_REFERENCE_INVALID",
    "所选经历证据不存在、尚未确认或不属于当前账户。",
  );
}

function questionNotFound(): ServiceError {
  return new ServiceError(404, "CASE_QUESTION_NOT_FOUND", "问题不存在、已删除或不属于当前账户。");
}

async function loadCaseForRequirements(
  db: DbExecutor,
  owner: OwnerScope,
  caseId: string,
): Promise<ApplicationCaseMutationRow | null> {
  return (
    ((await db
      .selectFrom("application.application_cases")
      .select([
        "id",
        "owner_id",
        "owner_epoch",
        "job_context_kind",
        "published_job_id",
        "published_job_version_id",
        "requirement_set_id",
        "private_job_snapshot_id",
        "job_context_revision",
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
      .executeTakeFirst()) as ApplicationCaseMutationRow | undefined) ?? null
  );
}

function parseFixedRequirements(value: JsonValue): JobRequirement[] {
  const requirements = JobRequirementArraySchema.parse(parseJsonValue(value));
  if (new Set(requirements.map((requirement) => requirement.id)).size !== requirements.length) {
    throw new Error("APPLICATION_CASE_REQUIREMENT_IDS_NOT_UNIQUE");
  }
  return requirements;
}

async function loadFixedRequirementContext(
  db: DbExecutor,
  owner: OwnerScope,
  applicationCase: ApplicationCaseMutationRow,
): Promise<FixedRequirementContext> {
  if (
    applicationCase.job_context_kind === "public" &&
    applicationCase.published_job_version_id &&
    applicationCase.requirement_set_id
  ) {
    const row = await db
      .selectFrom("catalog.job_requirement_sets")
      .select("requirements")
      .where("id", "=", applicationCase.requirement_set_id)
      .where("published_job_version_id", "=", applicationCase.published_job_version_id)
      .executeTakeFirst();
    if (!row) throw new Error("APPLICATION_CASE_PUBLIC_REQUIREMENT_CONTEXT_MISSING");
    return {
      requirementContext: {
        kind: "public",
        requirementSetId: applicationCase.requirement_set_id,
      },
      requirements: parseFixedRequirements(row.requirements),
    };
  }

  if (applicationCase.job_context_kind === "private" && applicationCase.private_job_snapshot_id) {
    const row = await db
      .selectFrom("application.private_job_snapshot_revisions")
      .select(["requirement_set_revision", "requirements"])
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("snapshot_id", "=", applicationCase.private_job_snapshot_id)
      .where("content_revision", "=", applicationCase.job_context_revision)
      .executeTakeFirst();
    if (!row) throw new Error("APPLICATION_CASE_PRIVATE_REQUIREMENT_CONTEXT_MISSING");
    return {
      requirementContext: {
        kind: "private",
        requirementSetRevision: Number(row.requirement_set_revision),
      },
      requirements: parseFixedRequirements(row.requirements),
    };
  }

  throw new Error("APPLICATION_CASE_REQUIREMENT_CONTEXT_INVALID");
}

function stateMatchesContext(
  row: CaseRequirementStateRow,
  requirementContext: RequirementContext,
): boolean {
  return requirementContext.kind === "public"
    ? row.requirement_context_kind === "public" &&
        row.requirement_set_id === requirementContext.requirementSetId
    : row.requirement_context_kind === "private" &&
        Number(row.requirement_set_revision) === requirementContext.requirementSetRevision;
}

function mapRequirementState(
  applicationCase: ApplicationCaseMutationRow,
  requirementContext: RequirementContext,
  requirementId: string,
  row?: CaseRequirementStateRow,
): CaseRequirementStateReadModel {
  return CaseRequirementStateReadModelSchema.parse({
    id: row?.id ?? null,
    caseId: applicationCase.id,
    requirementContext,
    requirementId,
    state: row?.state ?? "unconfirmed",
    userNote: row?.user_note ?? null,
    revision: row ? Number(row.revision) : null,
    persisted: row !== undefined,
    createdAt: row ? toIso(row.created_at) : null,
    updatedAt: row ? toIso(row.updated_at) : null,
  });
}

function mapRequirementEvidenceLink(
  row: CaseRequirementEvidenceLinkRow,
  requirementContext: RequirementContext,
): CaseRequirementEvidenceLink {
  return CaseRequirementEvidenceLinkSchema.parse({
    id: row.id,
    caseId: row.case_id,
    requirementStateId: row.requirement_state_id,
    requirementContext,
    requirementId: row.requirement_id,
    evidenceRevisionId: row.evidence_revision_id,
    evidenceId: row.evidence_id,
    revision: Number(row.revision),
    linkedAt: toIso(row.linked_at),
    removedAt: row.removed_at ? toIso(row.removed_at) : null,
  });
}

function mapCaseQuestion(
  row: CaseQuestionRow,
  requirementContext: RequirementContext,
): CaseQuestion {
  const requirementScoped = row.requirement_state_id !== null;
  return CaseQuestionSchema.parse({
    id: row.id,
    caseId: row.case_id,
    requirementStateId: row.requirement_state_id,
    requirementContext: requirementScoped ? requirementContext : null,
    requirementId: row.requirement_id,
    question: row.question,
    answer: row.answer,
    status: row.status,
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

async function loadRequirementsReadModel(
  db: DbExecutor,
  owner: OwnerScope,
  applicationCase: ApplicationCaseMutationRow,
): Promise<ApplicationCaseRequirements> {
  const fixed = await loadFixedRequirementContext(db, owner, applicationCase);
  const [allStates, allLinks, allQuestions] = await Promise.all([
    db
      .selectFrom("application.case_requirement_states")
      .selectAll()
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("case_id", "=", applicationCase.id)
      .execute(),
    db
      .selectFrom("application.case_requirement_evidence_links")
      .selectAll()
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("case_id", "=", applicationCase.id)
      .orderBy("linked_at", "asc")
      .orderBy("id", "asc")
      .execute(),
    db
      .selectFrom("application.case_questions")
      .selectAll()
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("case_id", "=", applicationCase.id)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute(),
  ]);
  const currentStates = (allStates as CaseRequirementStateRow[]).filter((row) =>
    stateMatchesContext(row, fixed.requirementContext),
  );
  const currentStateByRequirement = new Map(
    currentStates.map((row) => [row.requirement_id, row] as const),
  );
  const currentStateIds = new Set(currentStates.map((row) => row.id));

  return ApplicationCaseRequirementsSchema.parse({
    caseId: applicationCase.id,
    requirementContext: fixed.requirementContext,
    revision: Number(applicationCase.revision),
    requirements: fixed.requirements,
    states: fixed.requirements.map((requirement) =>
      mapRequirementState(
        applicationCase,
        fixed.requirementContext,
        requirement.id,
        currentStateByRequirement.get(requirement.id),
      ),
    ),
    evidenceLinks: (allLinks as CaseRequirementEvidenceLinkRow[])
      .filter((row) => currentStateIds.has(row.requirement_state_id))
      .map((row) => mapRequirementEvidenceLink(row, fixed.requirementContext)),
    questions: (allQuestions as CaseQuestionRow[])
      .filter(
        (row) => row.requirement_state_id === null || currentStateIds.has(row.requirement_state_id),
      )
      .map((row) => mapCaseQuestion(row, fixed.requirementContext)),
  });
}

async function loadRequirementStateForUpdate(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  applicationCase: ApplicationCaseMutationRow,
  requirementContext: RequirementContext,
  requirementId: string,
): Promise<CaseRequirementStateRow | null> {
  let query = transaction
    .selectFrom("application.case_requirement_states")
    .selectAll()
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("case_id", "=", applicationCase.id)
    .where("requirement_id", "=", requirementId)
    .where("requirement_context_kind", "=", requirementContext.kind);
  query =
    requirementContext.kind === "public"
      ? query
          .where("requirement_set_id", "=", requirementContext.requirementSetId)
          .where("requirement_set_revision", "is", null)
      : query
          .where("requirement_set_id", "is", null)
          .where("requirement_set_revision", "=", requirementContext.requirementSetRevision);
  return (
    ((await query.forUpdate().executeTakeFirst()) as CaseRequirementStateRow | undefined) ?? null
  );
}

function requirementStateContextValues(requirementContext: RequirementContext) {
  return requirementContext.kind === "public"
    ? {
        requirement_context_kind: "public",
        requirement_set_id: requirementContext.requirementSetId,
        requirement_set_revision: null,
      }
    : {
        requirement_context_kind: "private",
        requirement_set_id: null,
        requirement_set_revision: requirementContext.requirementSetRevision,
      };
}

function requirementEventContextValues(requirementContext: RequirementContext) {
  return requirementContext.kind === "public"
    ? { requirementSetId: requirementContext.requirementSetId }
    : {
        requirementContextKind: "private" as const,
        requirementSetRevision: requirementContext.requirementSetRevision,
      };
}

function requireRequirement(fixed: FixedRequirementContext, requirementId: string): JobRequirement {
  const requirement = fixed.requirements.find((candidate) => candidate.id === requirementId);
  if (!requirement) throw requirementReferenceInvalid();
  return requirement;
}

async function incrementCaseRevision(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  applicationCase: ApplicationCaseMutationRow,
  expectedRevision: number,
): Promise<number> {
  const nextRevision = expectedRevision + 1;
  const result = await transaction
    .updateTable("application.application_cases")
    .set({ revision: nextRevision, updated_at: monotonicUpdatedAt() })
    .where("id", "=", applicationCase.id)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("revision", "=", expectedRevision)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) throw revisionConflict();
  return nextRevision;
}

function revisionScopedIdempotencyKey(input: {
  caseId: string;
  resourceId: string;
  expectedRevision: number;
  requestHash: string;
}): string {
  return hashCanonicalJson(input);
}

async function insertRequirementState(
  transaction: Transaction<Database>,
  input: {
    owner: OwnerScope;
    applicationCase: ApplicationCaseMutationRow;
    requirementContext: RequirementContext;
    requirementId: string;
    state: "confirmed" | "needs_work" | "unconfirmed";
    userNote: string | null;
    revision: number;
  },
): Promise<CaseRequirementStateRow> {
  return (await transaction
    .insertInto("application.case_requirement_states")
    .values({
      id: randomUUID(),
      owner_id: input.owner.ownerId,
      owner_epoch: input.owner.ownerEpoch,
      case_id: input.applicationCase.id,
      ...requirementStateContextValues(input.requirementContext),
      requirement_id: input.requirementId,
      state: input.state,
      user_note: input.userNote,
      revision: input.revision,
    })
    .returningAll()
    .executeTakeFirstOrThrow()) as CaseRequirementStateRow;
}

async function loadEvidenceRevision(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  evidenceRevisionId: string,
) {
  const row = await transaction
    .selectFrom("profile.resume_evidence_revisions")
    .selectAll()
    .where("id", "=", evidenceRevisionId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .executeTakeFirst();
  if (!row) throw evidenceReferenceInvalid();
  const parsed = ResumeEvidenceRevisionSchema.safeParse({
    id: row.id,
    ownerId: row.owner_id,
    revision: Number(row.revision),
    baseRevision: row.base_revision === null ? null : Number(row.base_revision),
    contentHash: row.content_hash,
    confirmedAt: toIso(row.confirmed_at),
    createdAt: toIso(row.created_at),
    resumeAnalysisId: row.resume_analysis_id,
    schemaVersion: row.schema_version,
    documentRevisionId: row.document_revision_id,
    evidence: parseJsonValue(row.evidence),
  });
  if (!parsed.success) throw evidenceReferenceInvalid();
  return parsed.data;
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

export async function getApplicationCaseRequirements(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
}): Promise<ApplicationCaseRequirements> {
  return input.db
    .transaction()
    .setIsolationLevel("repeatable read")
    .execute(async (transaction) => {
      await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);
      const applicationCase = await loadCaseForRequirements(transaction, input.owner, input.caseId);
      if (!applicationCase) throw caseNotFound();
      return loadRequirementsReadModel(transaction, input.owner, applicationCase);
    });
}

export async function putApplicationCaseRequirementState(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  requirementId: string;
  request: PutCaseRequirementStateRequest;
}): Promise<ApplicationCaseMutationResponse> {
  const idempotencyScope = "application-case:requirement-state";
  const requestHash = hashCanonicalJson({
    caseId: input.caseId,
    requirementId: input.requirementId,
    request: input.request,
  });
  const idempotencyKey = revisionScopedIdempotencyKey({
    caseId: input.caseId,
    resourceId: input.requirementId,
    expectedRevision: input.request.expectedRevision,
    requestHash,
  });

  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: idempotencyScope,
      idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);
    const replay = await replayCaseCommand(transaction, input.owner, {
      scope: idempotencyScope,
      idempotencyKey,
      requestHash,
    });
    if (replay) return mutationResponse(replay.event.sequence, replay.event);

    const applicationCase = await loadCaseForUpdate(transaction, input.owner, input.caseId);
    if (!applicationCase) throw caseNotFound();
    if (Number(applicationCase.revision) !== input.request.expectedRevision) {
      throw revisionConflict();
    }
    const fixed = await loadFixedRequirementContext(transaction, input.owner, applicationCase);
    requireRequirement(fixed, input.requirementId);
    const existing = await loadRequirementStateForUpdate(
      transaction,
      input.owner,
      applicationCase,
      fixed.requirementContext,
      input.requirementId,
    );
    const currentState = existing?.state ?? "unconfirmed";
    const currentNote = existing?.user_note ?? null;
    if (currentState === input.request.state && currentNote === input.request.userNote) {
      return mutationResponse(Number(applicationCase.revision), null);
    }

    const nextRevision = await incrementCaseRevision(
      transaction,
      input.owner,
      applicationCase,
      input.request.expectedRevision,
    );
    if (existing) {
      await transaction
        .updateTable("application.case_requirement_states")
        .set({
          state: input.request.state,
          user_note: input.request.userNote,
          revision: nextRevision,
          updated_at: monotonicUpdatedAt(),
        })
        .where("id", "=", existing.id)
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .executeTakeFirstOrThrow();
    } else {
      await insertRequirementState(transaction, {
        owner: input.owner,
        applicationCase,
        requirementContext: fixed.requirementContext,
        requirementId: input.requirementId,
        state: input.request.state,
        userNote: input.request.userNote,
        revision: nextRevision,
      });
    }
    const command = await appendCaseEvent(transaction, {
      owner: input.owner,
      caseId: applicationCase.id,
      sequence: nextRevision,
      eventType: "requirement_state_changed",
      eventData: {
        schemaVersion: "case-event-v2",
        ...requirementEventContextValues(fixed.requirementContext),
        requirementId: input.requirementId,
        fromState: existing ? currentState : null,
        toState: input.request.state,
        noteChanged: currentNote !== input.request.userNote,
        reasonCode: "USER_UPDATED",
      },
      schemaVersion: "case-event-v2",
      idempotencyScope,
      idempotencyKey,
      requestHash,
    });
    return mutationResponse(nextRevision, command.event);
  });
}

export async function putApplicationCaseRequirementEvidenceLinks(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  requirementId: string;
  request: PutCaseRequirementEvidenceLinksRequest;
}): Promise<ApplicationCaseMutationResponse> {
  const idempotencyScope = "application-case:requirement-evidence";
  const requestHash = hashCanonicalJson({
    caseId: input.caseId,
    requirementId: input.requirementId,
    request: input.request,
  });
  const idempotencyKey = revisionScopedIdempotencyKey({
    caseId: input.caseId,
    resourceId: input.requirementId,
    expectedRevision: input.request.expectedRevision,
    requestHash,
  });

  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: idempotencyScope,
      idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);
    const replay = await replayCaseCommand(transaction, input.owner, {
      scope: idempotencyScope,
      idempotencyKey,
      requestHash,
    });
    if (replay) return mutationResponse(replay.event.sequence, replay.event);

    const applicationCase = await loadCaseForUpdate(transaction, input.owner, input.caseId);
    if (!applicationCase) throw caseNotFound();
    if (Number(applicationCase.revision) !== input.request.expectedRevision) {
      throw revisionConflict();
    }
    const fixed = await loadFixedRequirementContext(transaction, input.owner, applicationCase);
    requireRequirement(fixed, input.requirementId);
    const evidenceRevision = await loadEvidenceRevision(
      transaction,
      input.owner,
      input.request.evidenceRevisionId,
    );
    const validEvidenceIds = new Set(evidenceRevision.evidence.map((evidence) => evidence.id));
    if (input.request.evidenceIds.some((evidenceId) => !validEvidenceIds.has(evidenceId))) {
      throw evidenceReferenceInvalid();
    }

    let requirementState = await loadRequirementStateForUpdate(
      transaction,
      input.owner,
      applicationCase,
      fixed.requirementContext,
      input.requirementId,
    );
    const existingLinks = requirementState
      ? ((await transaction
          .selectFrom("application.case_requirement_evidence_links")
          .selectAll()
          .where("owner_id", "=", input.owner.ownerId)
          .where("owner_epoch", "=", input.owner.ownerEpoch)
          .where("case_id", "=", applicationCase.id)
          .where("requirement_state_id", "=", requirementState.id)
          .where("evidence_revision_id", "=", input.request.evidenceRevisionId)
          .forUpdate()
          .execute()) as CaseRequirementEvidenceLinkRow[])
      : [];
    const activeIds = new Set(
      existingLinks.filter((link) => link.removed_at === null).map((link) => link.evidence_id),
    );
    const desiredIds = new Set(input.request.evidenceIds);
    const linkedEvidenceIds = input.request.evidenceIds.filter(
      (evidenceId) => !activeIds.has(evidenceId),
    );
    const removedEvidenceIds = [...activeIds]
      .filter((evidenceId) => !desiredIds.has(evidenceId))
      .sort((left, right) => left.localeCompare(right));
    if (linkedEvidenceIds.length === 0 && removedEvidenceIds.length === 0) {
      return mutationResponse(Number(applicationCase.revision), null);
    }

    const nextRevision = await incrementCaseRevision(
      transaction,
      input.owner,
      applicationCase,
      input.request.expectedRevision,
    );
    if (!requirementState) {
      requirementState = await insertRequirementState(transaction, {
        owner: input.owner,
        applicationCase,
        requirementContext: fixed.requirementContext,
        requirementId: input.requirementId,
        state: "unconfirmed",
        userNote: null,
        revision: nextRevision,
      });
    }
    for (const evidenceId of linkedEvidenceIds) {
      const existing = existingLinks.find((link) => link.evidence_id === evidenceId);
      if (existing) {
        await transaction
          .updateTable("application.case_requirement_evidence_links")
          .set({ removed_at: null, revision: nextRevision })
          .where("id", "=", existing.id)
          .where("owner_id", "=", input.owner.ownerId)
          .where("owner_epoch", "=", input.owner.ownerEpoch)
          .executeTakeFirstOrThrow();
      } else {
        await transaction
          .insertInto("application.case_requirement_evidence_links")
          .values({
            id: randomUUID(),
            owner_id: input.owner.ownerId,
            owner_epoch: input.owner.ownerEpoch,
            case_id: applicationCase.id,
            requirement_state_id: requirementState.id,
            requirement_set_id:
              fixed.requirementContext.kind === "public"
                ? fixed.requirementContext.requirementSetId
                : null,
            requirement_id: input.requirementId,
            evidence_revision_id: input.request.evidenceRevisionId,
            evidence_id: evidenceId,
            revision: nextRevision,
            removed_at: null,
          })
          .execute();
      }
    }
    if (removedEvidenceIds.length > 0) {
      await transaction
        .updateTable("application.case_requirement_evidence_links")
        .set({ removed_at: evidenceRemovedAt(), revision: nextRevision })
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .where("case_id", "=", applicationCase.id)
        .where("requirement_state_id", "=", requirementState.id)
        .where("evidence_revision_id", "=", input.request.evidenceRevisionId)
        .where("evidence_id", "in", removedEvidenceIds)
        .where("removed_at", "is", null)
        .execute();
    }

    const command = await appendCaseEvent(transaction, {
      owner: input.owner,
      caseId: applicationCase.id,
      sequence: nextRevision,
      eventType: "requirement_evidence_changed",
      eventData: {
        schemaVersion: "case-event-v2",
        ...requirementEventContextValues(fixed.requirementContext),
        requirementId: input.requirementId,
        evidenceRevisionId: input.request.evidenceRevisionId,
        linkedEvidenceIds,
        removedEvidenceIds,
      },
      schemaVersion: "case-event-v2",
      idempotencyScope,
      idempotencyKey,
      requestHash,
    });
    return mutationResponse(nextRevision, command.event);
  });
}

export async function createApplicationCaseQuestion(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  request: CreateCaseQuestionRequest;
  idempotencyKey: string;
}): Promise<ApplicationCaseMutationResponse> {
  const idempotencyScope = "application-case:question-create";
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
    if (replay) return mutationResponse(replay.event.sequence, replay.event);

    const applicationCase = await loadCaseForUpdate(transaction, input.owner, input.caseId);
    if (!applicationCase) throw caseNotFound();
    if (Number(applicationCase.revision) !== input.request.expectedRevision) {
      throw revisionConflict();
    }
    const fixed = await loadFixedRequirementContext(transaction, input.owner, applicationCase);
    if (input.request.requirementId) requireRequirement(fixed, input.request.requirementId);
    let requirementState = input.request.requirementId
      ? await loadRequirementStateForUpdate(
          transaction,
          input.owner,
          applicationCase,
          fixed.requirementContext,
          input.request.requirementId,
        )
      : null;
    const nextRevision = await incrementCaseRevision(
      transaction,
      input.owner,
      applicationCase,
      input.request.expectedRevision,
    );
    if (input.request.requirementId && !requirementState) {
      requirementState = await insertRequirementState(transaction, {
        owner: input.owner,
        applicationCase,
        requirementContext: fixed.requirementContext,
        requirementId: input.request.requirementId,
        state: "unconfirmed",
        userNote: null,
        revision: nextRevision,
      });
    }
    const questionId = randomUUID();
    await transaction
      .insertInto("application.case_questions")
      .values({
        id: questionId,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        case_id: applicationCase.id,
        requirement_state_id: requirementState?.id ?? null,
        requirement_set_id:
          input.request.requirementId && fixed.requirementContext.kind === "public"
            ? fixed.requirementContext.requirementSetId
            : null,
        requirement_id: input.request.requirementId ?? null,
        question: input.request.question,
        answer: null,
        status: "open",
        revision: nextRevision,
      })
      .execute();
    const command = await appendCaseEvent(transaction, {
      owner: input.owner,
      caseId: applicationCase.id,
      sequence: nextRevision,
      eventType: "question_added",
      eventData: {
        schemaVersion: "case-event-v1",
        questionId,
        requirementId: input.request.requirementId ?? null,
      },
      idempotencyScope,
      idempotencyKey: input.idempotencyKey,
      requestHash,
    });
    return mutationResponse(nextRevision, command.event);
  });
}

export async function updateApplicationCaseQuestion(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  questionId: string;
  request: UpdateCaseQuestionRequest;
}): Promise<ApplicationCaseMutationResponse> {
  const idempotencyScope = "application-case:question-update";
  const requestHash = hashCanonicalJson({
    caseId: input.caseId,
    questionId: input.questionId,
    request: input.request,
  });
  const idempotencyKey = revisionScopedIdempotencyKey({
    caseId: input.caseId,
    resourceId: input.questionId,
    expectedRevision: input.request.expectedRevision,
    requestHash,
  });

  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: idempotencyScope,
      idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);
    const replay = await replayCaseCommand(transaction, input.owner, {
      scope: idempotencyScope,
      idempotencyKey,
      requestHash,
    });
    if (replay) return mutationResponse(replay.event.sequence, replay.event);

    const applicationCase = await loadCaseForUpdate(transaction, input.owner, input.caseId);
    if (!applicationCase) throw caseNotFound();
    if (Number(applicationCase.revision) !== input.request.expectedRevision) {
      throw revisionConflict();
    }
    const question = (await transaction
      .selectFrom("application.case_questions")
      .selectAll()
      .where("id", "=", input.questionId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("case_id", "=", applicationCase.id)
      .forUpdate()
      .executeTakeFirst()) as CaseQuestionRow | undefined;
    if (!question) throw questionNotFound();
    if (question.requirement_state_id) {
      const fixed = await loadFixedRequirementContext(transaction, input.owner, applicationCase);
      const requirementState = (await transaction
        .selectFrom("application.case_requirement_states")
        .selectAll()
        .where("id", "=", question.requirement_state_id)
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .where("case_id", "=", applicationCase.id)
        .executeTakeFirst()) as CaseRequirementStateRow | undefined;
      if (!requirementState || !stateMatchesContext(requirementState, fixed.requirementContext)) {
        throw questionNotFound();
      }
    }
    const answer = input.request.answer ?? null;
    if (question.status === input.request.status && question.answer === answer) {
      return mutationResponse(Number(applicationCase.revision), null);
    }
    const nextRevision = await incrementCaseRevision(
      transaction,
      input.owner,
      applicationCase,
      input.request.expectedRevision,
    );
    await transaction
      .updateTable("application.case_questions")
      .set({
        status: input.request.status,
        answer,
        revision: nextRevision,
        updated_at: monotonicUpdatedAt(),
      })
      .where("id", "=", question.id)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .executeTakeFirstOrThrow();
    const command = await appendCaseEvent(transaction, {
      owner: input.owner,
      caseId: applicationCase.id,
      sequence: nextRevision,
      eventType: "question_updated",
      eventData: {
        schemaVersion: "case-event-v2",
        questionId: question.id,
        fromStatus: question.status,
        toStatus: input.request.status,
        answerChanged: question.answer !== answer,
      },
      schemaVersion: "case-event-v2",
      idempotencyScope,
      idempotencyKey,
      requestHash,
    });
    return mutationResponse(nextRevision, command.event);
  });
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

function normalizePrivateJobContent(contentText: string): string {
  return contentText.replace(/\r\n?/g, "\n").trim();
}

function privateJobSourceMetadata(
  source: Extract<
    CreateApplicationCaseWithJobContextRequest["jobContext"],
    { kind: "private_input" }
  >["source"],
) {
  if (source.kind === "provided_url") {
    return {
      sourceLabel: "用户提供链接，平台未核验",
      officialUrl: source.url,
      sourceProvided: true,
    };
  }
  if (source.kind === "referral") {
    return {
      sourceLabel: "用户转发/内推，平台未核验",
      officialUrl: null,
      sourceProvided: true,
    };
  }
  return {
    sourceLabel: "来源未提供，请自行核验",
    officialUrl: null,
    sourceProvided: false,
  };
}

const PurePrivateJobHeading =
  /^(?:职责|要求|岗位职责|职位描述|工作内容|任职要求|岗位要求|资格条件|职位要求)[:：]?$/;

function isPrivateJobMetadataLine(sourceText: string, title: string): boolean {
  const normalizedSourceText = sourceText.normalize("NFKC").replace(/\s+/g, "").trim();
  const normalizedTitle = title.normalize("NFKC").replace(/\s+/g, "").trim();
  return (
    normalizedSourceText === normalizedTitle || PurePrivateJobHeading.test(normalizedSourceText)
  );
}

async function resolvePrivateInputJobContext(
  db: Transaction<Database>,
  owner: OwnerScope,
  request: Extract<
    CreateApplicationCaseWithJobContextRequest["jobContext"],
    { kind: "private_input" }
  >,
  idempotencyKey: string,
  requestHash: string,
): Promise<ResolvedJobContext> {
  const contentText = normalizePrivateJobContent(request.contentText);
  const contentHash = hashCanonicalJson(contentText);

  if (request.duplicateHandling === "reuse") {
    await lockOwnerIdempotencyKey(db, {
      ownerId: owner.ownerId,
      scope: "private-job-content",
      idempotencyKey: contentHash,
    });
    const existing = await db
      .selectFrom("application.private_job_snapshots as snapshot")
      .innerJoin("application.private_job_snapshot_revisions as revision", (join) =>
        join
          .onRef("revision.owner_id", "=", "snapshot.owner_id")
          .onRef("revision.snapshot_id", "=", "snapshot.id")
          .onRef("revision.content_revision", "=", "snapshot.current_content_revision"),
      )
      .select(["snapshot.id as snapshotId", "revision.content_revision as contentRevision"])
      .where("snapshot.owner_id", "=", owner.ownerId)
      .where("snapshot.owner_epoch", "=", owner.ownerEpoch)
      .where("snapshot.deleted_at", "is", null)
      .where("revision.owner_epoch", "=", owner.ownerEpoch)
      .where("revision.content_hash", "=", contentHash)
      .orderBy("snapshot.updated_at", "desc")
      .orderBy("snapshot.id", "desc")
      .forUpdate("snapshot")
      .executeTakeFirst();
    if (existing) {
      return {
        kind: "private",
        snapshotId: existing.snapshotId,
        contentRevision: Number(existing.contentRevision),
        jobContextRevision: Number(existing.contentRevision),
      };
    }
  }

  const snapshotId = randomUUID();
  const source = privateJobSourceMetadata(request.source);
  const requirements = decomposeTextualJobRequirements({
    publishedJobVersionId: snapshotId,
    sourceText: contentText,
    evidenceRefPrefix: `private-job-snapshot:${snapshotId}:revision:1`,
  }).filter((requirement) => !isPrivateJobMetadataLine(requirement.sourceText, request.title));

  await db
    .insertInto("application.private_job_snapshots")
    .values({
      id: snapshotId,
      owner_id: owner.ownerId,
      owner_epoch: owner.ownerEpoch,
      current_content_revision: null,
      current_requirement_set_revision: null,
      creation_idempotency_key: idempotencyKey,
      creation_request_hash: requestHash,
      deleted_at: null,
    })
    .execute();
  await db
    .insertInto("application.private_job_snapshot_revisions")
    .values({
      id: randomUUID(),
      owner_id: owner.ownerId,
      owner_epoch: owner.ownerEpoch,
      snapshot_id: snapshotId,
      content_revision: 1,
      requirement_set_revision: 1,
      title: request.title,
      company_name: request.companyName,
      source_label: source.sourceLabel,
      official_url: source.officialUrl,
      source_provided: source.sourceProvided,
      content_text: contentText,
      requirements: JSON.stringify(requirements) as unknown as JsonValue,
      content_hash: contentHash,
    })
    .execute();
  await db
    .updateTable("application.private_job_snapshots")
    .set({
      current_content_revision: 1,
      current_requirement_set_revision: 1,
      updated_at: monotonicUpdatedAt(),
    })
    .where("id", "=", snapshotId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .executeTakeFirstOrThrow();

  return {
    kind: "private",
    snapshotId,
    contentRevision: 1,
    jobContextRevision: 1,
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

    let context: ResolvedJobContext;
    if (input.request.jobContext.kind === "public") {
      context = await resolvePublicJobContext(
        transaction,
        input.request.jobContext,
        input.enableLocalMvp,
      );
    } else if (input.request.jobContext.kind === "private") {
      context = await resolvePrivateJobContext(transaction, input.owner, input.request.jobContext);
    } else {
      context = await resolvePrivateInputJobContext(
        transaction,
        input.owner,
        input.request.jobContext,
        input.idempotencyKey,
        requestHash,
      );
    }
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
        .set({
          outcome: toOutcome,
          revision: nextRevision,
          updated_at: monotonicUpdatedAt(),
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
        ended_at: toStage === "resolved" ? caseEndedAt() : null,
        revision: nextRevision,
        updated_at: monotonicUpdatedAt(),
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
        updated_at: monotonicUpdatedAt(),
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
      ended_at: target.stage === "resolved" ? caseEndedAt() : null,
      revision: nextRevision,
      updated_at: monotonicUpdatedAt(),
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
