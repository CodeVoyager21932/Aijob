import { randomUUID } from "node:crypto";
import {
  type CreateInterviewSessionRequest,
  type CreateInterviewSessionResponse,
  CreateInterviewSessionResponseSchema,
  type InterviewSession,
  type InterviewSessionDetail,
  InterviewSessionDetailSchema,
  type InterviewTurn,
  InterviewTurnSchema,
  type JobContext,
  type JobRequirement,
  JobRequirementSchema,
  type ListInterviewSessionsQuery,
  type ListInterviewSessionsResponse,
  ListInterviewSessionsResponseSchema,
  type SubmitInterviewAnswerRequest,
  type SubmitInterviewAnswerResponse,
  SubmitInterviewAnswerResponseSchema,
  InterviewSessionCursorSchema,
  InterviewSessionSchema,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, type Selectable, sql, type Transaction } from "kysely";
import { z } from "zod";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { lockOwnerIdempotencyKey } from "../lib/idempotency.js";
import { ServiceError } from "../lib/service-error.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;
type InterviewSessionRow = Selectable<Database["application.interview_sessions"]>;
type InterviewTurnRow = Selectable<Database["application.interview_turns"]>;

interface SessionReadRow extends InterviewSessionRow {
  public_official_url: string | null;
  private_title: string | null;
  private_company_name: string | null;
  private_source_label: string | null;
  private_official_url: string | null;
  private_requirement_set_revision: number | null;
  private_source_provided: boolean | null;
}

interface CaseMutationRow {
  id: string;
  owner_id: string;
  owner_epoch: number;
  job_context_kind: string;
  published_job_id: string | null;
  published_job_version_id: string | null;
  requirement_set_id: string | null;
  private_job_snapshot_id: string | null;
  job_context_revision: number;
  revision: number;
}

interface InterviewQuestionSeed {
  content: string;
  requirementIds: string[];
}

const TEMPLATE_VERSION = "deterministic-zh-cn-v1";
const MAX_REQUIREMENT_QUESTIONS = 3;
const MAX_QUESTION_SOURCE_CHARS = 6_000;
const JobRequirementArraySchema = z.array(JobRequirementSchema);
const CursorEnvelopeSchema = z
  .object({
    version: z.literal(1),
    caseId: z.string().uuid(),
    position: InterviewSessionCursorSchema,
  })
  .strict();

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

function deterministicUuid(value: unknown): string {
  const source = hashCanonicalJson(value).slice(0, 32).split("");
  source[12] = "5";
  source[16] = "8";
  const hex = source.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function applicationCaseNotFound(): ServiceError {
  return new ServiceError(
    404,
    "APPLICATION_CASE_NOT_FOUND",
    "求职项目不存在、已删除或不属于当前用户。",
  );
}

function applicationCaseRevisionConflict(): ServiceError {
  return new ServiceError(
    409,
    "APPLICATION_CASE_REVISION_CONFLICT",
    "求职项目已在其他页面更新，请刷新并核对后重试。",
  );
}

function interviewSessionNotFound(): ServiceError {
  return new ServiceError(
    404,
    "INTERVIEW_SESSION_NOT_FOUND",
    "面试练习不存在、已删除或不属于当前用户。",
  );
}

function interviewSessionRevisionConflict(): ServiceError {
  return new ServiceError(
    409,
    "INTERVIEW_SESSION_REVISION_CONFLICT",
    "面试练习已在其他页面更新，请刷新并核对后重试。",
  );
}

function interviewInputsNotReady(): ServiceError {
  return new ServiceError(
    409,
    "INTERVIEW_INPUTS_NOT_READY",
    "请先在当前求职项目中创建岗位简历，并确认基础简历证据。",
  );
}

function idempotencyKeyReused(): ServiceError {
  return new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "同一个请求编号不能用于不同的面试操作。");
}

function sessionReadQuery(db: DbExecutor) {
  return db
    .selectFrom("application.interview_sessions as session")
    .leftJoin(
      "catalog.published_job_versions as public_version",
      "public_version.id",
      "session.published_job_version_id",
    )
    .leftJoin("application.private_job_snapshot_revisions as private_revision", (join) =>
      join
        .onRef("private_revision.owner_id", "=", "session.owner_id")
        .onRef("private_revision.snapshot_id", "=", "session.private_job_snapshot_id")
        .onRef("private_revision.content_revision", "=", "session.job_context_revision"),
    )
    .selectAll("session")
    .select([
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

function mapJobContext(row: SessionReadRow): JobContext {
  if (row.job_context_kind === "public") {
    return {
      kind: "public",
      publishedJobId: row.published_job_id ?? "",
      publishedJobVersionId: row.published_job_version_id ?? "",
      requirementSetId: row.requirement_set_id ?? "",
      officialUrl: row.public_official_url ?? "",
    };
  }
  return {
    kind: "private",
    snapshotId: row.private_job_snapshot_id ?? "",
    ownerId: row.owner_id,
    title: row.private_title ?? "",
    companyName: row.private_company_name,
    sourceLabel: row.private_source_label ?? "",
    ...(row.private_official_url ? { officialUrl: row.private_official_url } : {}),
    contentRevision: Number(row.job_context_revision),
    requirementSetRevision: Number(row.private_requirement_set_revision),
    sourceProvided: row.private_source_provided ?? false,
  };
}

function mapSession(row: SessionReadRow): InterviewSession {
  return InterviewSessionSchema.parse({
    schemaVersion: "interview-session-v1",
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    caseId: row.case_id,
    detachedFromCaseId: row.detached_from_case_id,
    jobContext: mapJobContext(row),
    evidenceRevisionId: row.evidence_revision_id,
    resumeDocumentId: row.resume_document_id,
    resumeContentRevisionId: row.resume_content_revision_id,
    mode: row.mode,
    status: row.status,
    templateVersion: row.template_version,
    promptVersion: row.prompt_version,
    providerAdapter: row.provider_adapter,
    model: row.model,
    revision: Number(row.revision),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function mapTurn(row: InterviewTurnRow): InterviewTurn {
  return InterviewTurnSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    interviewSessionId: row.interview_session_id,
    sequence: Number(row.sequence),
    kind: row.kind,
    content: row.content,
    requirementIds: parseJsonValue(row.requirement_ids),
    evidenceIds: parseJsonValue(row.evidence_ids),
    createdAt: toIso(row.created_at),
  });
}

async function loadCaseForUpdate(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  caseId: string,
): Promise<CaseMutationRow | null> {
  const row = await transaction
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
      "revision",
    ])
    .where("id", "=", caseId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("deleted_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
  return (row as CaseMutationRow | undefined) ?? null;
}

async function assertCaseExists(db: DbExecutor, owner: OwnerScope, caseId: string): Promise<void> {
  const row = await db
    .selectFrom("application.application_cases")
    .select("id")
    .where("id", "=", caseId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!row) throw applicationCaseNotFound();
}

async function loadSessionRow(
  db: DbExecutor,
  owner: OwnerScope,
  caseId: string,
  sessionId: string,
): Promise<SessionReadRow | null> {
  const row = await sessionReadQuery(db)
    .where("session.id", "=", sessionId)
    .where("session.case_id", "=", caseId)
    .where("session.owner_id", "=", owner.ownerId)
    .where("session.owner_epoch", "=", owner.ownerEpoch)
    .where("session.deleted_at", "is", null)
    .executeTakeFirst();
  return (row as SessionReadRow | undefined) ?? null;
}

async function loadTurns(
  db: DbExecutor,
  owner: OwnerScope,
  sessionId: string,
): Promise<InterviewTurn[]> {
  const rows = await db
    .selectFrom("application.interview_turns")
    .selectAll()
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("interview_session_id", "=", sessionId)
    .orderBy("sequence", "asc")
    .limit(200)
    .execute();
  return (rows as InterviewTurnRow[]).map(mapTurn);
}

async function loadFixedRequirements(
  db: DbExecutor,
  owner: OwnerScope,
  input: {
    jobContextKind: string;
    publishedJobVersionId: string | null;
    requirementSetId: string | null;
    privateJobSnapshotId: string | null;
    jobContextRevision: number;
  },
): Promise<JobRequirement[]> {
  if (input.jobContextKind === "public" && input.publishedJobVersionId && input.requirementSetId) {
    const row = await db
      .selectFrom("catalog.job_requirement_sets")
      .select("requirements")
      .where("id", "=", input.requirementSetId)
      .where("published_job_version_id", "=", input.publishedJobVersionId)
      .executeTakeFirst();
    if (!row) throw new Error("INTERVIEW_PUBLIC_REQUIREMENT_CONTEXT_MISSING");
    return JobRequirementArraySchema.parse(parseJsonValue(row.requirements));
  }
  if (input.jobContextKind === "private" && input.privateJobSnapshotId) {
    const row = await db
      .selectFrom("application.private_job_snapshot_revisions")
      .select("requirements")
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("snapshot_id", "=", input.privateJobSnapshotId)
      .where("content_revision", "=", input.jobContextRevision)
      .executeTakeFirst();
    if (!row) throw new Error("INTERVIEW_PRIVATE_REQUIREMENT_CONTEXT_MISSING");
    return JobRequirementArraySchema.parse(parseJsonValue(row.requirements));
  }
  throw new Error("INTERVIEW_REQUIREMENT_CONTEXT_INVALID");
}

async function loadPersistedRequirementIds(
  db: DbExecutor,
  owner: OwnerScope,
  input: {
    caseId: string;
    jobContextKind: string;
    requirementSetId: string | null;
    jobContextRevision: number;
    createdBefore?: Date;
  },
): Promise<Set<string>> {
  let query = db
    .selectFrom("application.case_requirement_states")
    .select("requirement_id")
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("case_id", "=", input.caseId)
    .where("requirement_context_kind", "=", input.jobContextKind);
  query =
    input.jobContextKind === "public"
      ? query
          .where("requirement_set_id", "=", input.requirementSetId)
          .where("requirement_set_revision", "is", null)
      : query
          .where("requirement_set_id", "is", null)
          .where("requirement_set_revision", "=", input.jobContextRevision);
  if (input.createdBefore) query = query.where("created_at", "<=", input.createdBefore);
  const rows = await query.execute();
  return new Set(rows.map((row) => row.requirement_id));
}

export function buildTemplateInterviewQuestions(input: {
  requirements: JobRequirement[];
  persistedRequirementIds: ReadonlySet<string>;
}): InterviewQuestionSeed[] {
  const requirementQuestions = input.requirements
    .filter(
      (requirement) =>
        input.persistedRequirementIds.has(requirement.id) &&
        requirement.operator !== "unknown" &&
        requirement.kind !== "other",
    )
    .slice(0, MAX_REQUIREMENT_QUESTIONS)
    .map((requirement) => {
      const sourceText =
        requirement.sourceText.length > MAX_QUESTION_SOURCE_CHARS
          ? `${requirement.sourceText.slice(0, MAX_QUESTION_SOURCE_CHARS)}……（原文过长，完整内容仍保留在要求页）`
          : requirement.sourceText;
      return {
        content: `岗位要求原文：“${sourceText}”。请只基于真实经历说明你如何满足或准备补足这项要求；如果暂无相关经历，请直接说明。`,
        requirementIds: [requirement.id],
      };
    });
  return [
    ...requirementQuestions,
    {
      content:
        "请基于一段真实经历，说明你如何明确目标、采取行动、协作并复盘结果；如果暂无合适经历，请直接说明。",
      requirementIds: [],
    },
  ];
}

async function questionPlanForSession(
  db: DbExecutor,
  owner: OwnerScope,
  session: InterviewSessionRow,
): Promise<InterviewQuestionSeed[]> {
  if (!session.case_id) throw interviewSessionNotFound();
  const requirements = await loadFixedRequirements(db, owner, {
    jobContextKind: session.job_context_kind,
    publishedJobVersionId: session.published_job_version_id,
    requirementSetId: session.requirement_set_id,
    privateJobSnapshotId: session.private_job_snapshot_id,
    jobContextRevision: Number(session.job_context_revision),
  });
  const persistedRequirementIds = await loadPersistedRequirementIds(db, owner, {
    caseId: session.case_id,
    jobContextKind: session.job_context_kind,
    requirementSetId: session.requirement_set_id,
    jobContextRevision: Number(session.job_context_revision),
    createdBefore: session.created_at,
  });
  return buildTemplateInterviewQuestions({ requirements, persistedRequirementIds });
}

async function insertTurn(
  transaction: Transaction<Database>,
  input: {
    id: string;
    owner: OwnerScope;
    sessionId: string;
    sequence: number;
    kind: "question" | "answer";
    content: string;
    requirementIds: string[];
  },
): Promise<InterviewTurn> {
  const row = await transaction
    .insertInto("application.interview_turns")
    .values({
      id: input.id,
      owner_id: input.owner.ownerId,
      owner_epoch: input.owner.ownerEpoch,
      interview_session_id: input.sessionId,
      sequence: input.sequence,
      kind: input.kind,
      content: input.content,
      requirement_ids: JSON.stringify(input.requirementIds) as unknown as JsonValue,
      evidence_ids: JSON.stringify([]) as unknown as JsonValue,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return mapTurn(row as InterviewTurnRow);
}

function encodeCursor(session: InterviewSession): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      caseId: session.caseId,
      position: { createdAt: session.createdAt, id: session.id },
    }),
  ).toString("base64url");
}

function decodeCursor(value: string, caseId: string) {
  try {
    const parsed = CursorEnvelopeSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (parsed.caseId !== caseId) throw new Error("CURSOR_CASE_MISMATCH");
    return parsed.position;
  } catch {
    throw new ServiceError(
      400,
      "INVALID_INTERVIEW_SESSION_CURSOR",
      "面试练习列表游标无效，请从第一页重新加载。",
    );
  }
}

export async function listInterviewSessions(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  query: ListInterviewSessionsQuery;
}): Promise<ListInterviewSessionsResponse> {
  await assertCaseExists(input.db, input.owner, input.caseId);
  const cursor = input.query.cursor ? decodeCursor(input.query.cursor, input.caseId) : null;
  let query = sessionReadQuery(input.db)
    .where("session.owner_id", "=", input.owner.ownerId)
    .where("session.owner_epoch", "=", input.owner.ownerEpoch)
    .where("session.case_id", "=", input.caseId)
    .where("session.deleted_at", "is", null);
  if (cursor) {
    const createdAt = new Date(cursor.createdAt);
    query = query.where((expression) =>
      expression.or([
        expression("session.created_at", "<", createdAt),
        expression.and([
          expression("session.created_at", "=", createdAt),
          expression("session.id", "<", cursor.id),
        ]),
      ]),
    );
  }
  const rows = await query
    .orderBy("session.created_at", "desc")
    .orderBy("session.id", "desc")
    .limit(input.query.limit + 1)
    .execute();
  const hasMore = rows.length > input.query.limit;
  const items = (rows.slice(0, input.query.limit) as SessionReadRow[]).map(mapSession);
  const lastItem = items.at(-1);
  return ListInterviewSessionsResponseSchema.parse({
    items,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem) : null,
  });
}

export async function getInterviewSession(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  sessionId: string;
}): Promise<InterviewSessionDetail | null> {
  await assertCaseExists(input.db, input.owner, input.caseId);
  const row = await loadSessionRow(input.db, input.owner, input.caseId, input.sessionId);
  if (!row) return null;
  return InterviewSessionDetailSchema.parse({
    session: mapSession(row),
    turns: await loadTurns(input.db, input.owner, input.sessionId),
  });
}

export async function createInterviewSession(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  request: CreateInterviewSessionRequest;
  idempotencyKey: string;
}): Promise<CreateInterviewSessionResponse> {
  const requestHash = hashCanonicalJson({ caseId: input.caseId, request: input.request });
  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: "interview-session:create",
      idempotencyKey: input.idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);
    const replay = await transaction
      .selectFrom("application.interview_sessions")
      .select(["id", "owner_epoch", "case_id", "creation_request_hash"])
      .where("owner_id", "=", input.owner.ownerId)
      .where("creation_idempotency_key", "=", input.idempotencyKey)
      .executeTakeFirst();
    if (replay) {
      if (
        Number(replay.owner_epoch) !== input.owner.ownerEpoch ||
        replay.case_id !== input.caseId ||
        replay.creation_request_hash !== requestHash
      ) {
        throw idempotencyKeyReused();
      }
      const firstQuestion = await transaction
        .selectFrom("application.interview_turns")
        .selectAll()
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .where("interview_session_id", "=", replay.id)
        .where("sequence", "=", 1)
        .executeTakeFirst();
      if (!firstQuestion) throw new Error("INTERVIEW_REPLAY_QUESTION_MISSING");
      return CreateInterviewSessionResponseSchema.parse({
        sessionId: replay.id,
        firstQuestion: mapTurn(firstQuestion as InterviewTurnRow),
      });
    }

    const applicationCase = await loadCaseForUpdate(transaction, input.owner, input.caseId);
    if (!applicationCase) throw applicationCaseNotFound();
    if (Number(applicationCase.revision) !== input.request.expectedCaseRevision) {
      throw applicationCaseRevisionConflict();
    }
    const resumeDocument = await transaction
      .selectFrom("profile.resume_documents")
      .select(["id", "evidence_revision_id", "current_content_revision_id"])
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("kind", "=", "case_derived")
      .where("case_id", "=", input.caseId)
      .where("deleted_at", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!resumeDocument?.evidence_revision_id || !resumeDocument.current_content_revision_id) {
      throw interviewInputsNotReady();
    }

    const requirements = await loadFixedRequirements(transaction, input.owner, {
      jobContextKind: applicationCase.job_context_kind,
      publishedJobVersionId: applicationCase.published_job_version_id,
      requirementSetId: applicationCase.requirement_set_id,
      privateJobSnapshotId: applicationCase.private_job_snapshot_id,
      jobContextRevision: Number(applicationCase.job_context_revision),
    });
    const persistedRequirementIds = await loadPersistedRequirementIds(transaction, input.owner, {
      caseId: input.caseId,
      jobContextKind: applicationCase.job_context_kind,
      requirementSetId: applicationCase.requirement_set_id,
      jobContextRevision: Number(applicationCase.job_context_revision),
    });
    const firstSeed = buildTemplateInterviewQuestions({
      requirements,
      persistedRequirementIds,
    })[0];
    if (!firstSeed) throw new Error("INTERVIEW_TEMPLATE_QUESTION_MISSING");

    const sessionId = randomUUID();
    await transaction
      .insertInto("application.interview_sessions")
      .values({
        id: sessionId,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        case_id: input.caseId,
        detached_from_case_id: null,
        job_context_kind: applicationCase.job_context_kind,
        published_job_id: applicationCase.published_job_id,
        published_job_version_id: applicationCase.published_job_version_id,
        requirement_set_id: applicationCase.requirement_set_id,
        private_job_snapshot_id: applicationCase.private_job_snapshot_id,
        job_context_revision: applicationCase.job_context_revision,
        evidence_revision_id: resumeDocument.evidence_revision_id,
        resume_document_id: resumeDocument.id,
        resume_content_revision_id: resumeDocument.current_content_revision_id,
        mode: "template",
        status: "active",
        template_version: TEMPLATE_VERSION,
        prompt_version: null,
        provider_adapter: null,
        model: null,
        revision: 1,
        creation_idempotency_key: input.idempotencyKey,
        creation_request_hash: requestHash,
        completed_at: null,
        deleted_at: null,
      })
      .execute();
    const firstQuestion = await insertTurn(transaction, {
      id: randomUUID(),
      owner: input.owner,
      sessionId,
      sequence: 1,
      kind: "question",
      content: firstSeed.content,
      requirementIds: firstSeed.requirementIds,
    });

    const nextCaseRevision = input.request.expectedCaseRevision + 1;
    const updated = await transaction
      .updateTable("application.application_cases")
      .set({
        revision: nextCaseRevision,
        updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
      })
      .where("id", "=", input.caseId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("revision", "=", input.request.expectedCaseRevision)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) throw applicationCaseRevisionConflict();
    await transaction
      .insertInto("application.case_events")
      .values({
        id: randomUUID(),
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        case_id: input.caseId,
        sequence: nextCaseRevision,
        event_type: "interview_started",
        actor_type: "owner",
        event_data: JSON.stringify({
          schemaVersion: "case-event-v1",
          interviewSessionId: sessionId,
          mode: "template",
        }) as unknown as JsonValue,
        schema_version: "case-event-v1",
        idempotency_scope: "interview-session:create",
        idempotency_key: input.idempotencyKey,
        request_hash: requestHash,
      })
      .execute();
    return CreateInterviewSessionResponseSchema.parse({ sessionId, firstQuestion });
  });
}

async function replayAnswer(
  transaction: Transaction<Database>,
  input: {
    owner: OwnerScope;
    caseId: string;
    sessionId: string;
    answerId: string;
    request: SubmitInterviewAnswerRequest;
  },
): Promise<SubmitInterviewAnswerResponse | null> {
  const row = await transaction
    .selectFrom("application.interview_turns as turn")
    .innerJoin(
      "application.interview_sessions as session",
      "session.id",
      "turn.interview_session_id",
    )
    .selectAll("turn")
    .select(["session.case_id"])
    .where("turn.owner_id", "=", input.owner.ownerId)
    .where("turn.id", "=", input.answerId)
    .executeTakeFirst();
  if (!row) return null;
  const expectedSequence = input.request.expectedRevision * 2;
  if (
    Number(row.owner_epoch) !== input.owner.ownerEpoch ||
    row.interview_session_id !== input.sessionId ||
    row.case_id !== input.caseId ||
    Number(row.sequence) !== expectedSequence ||
    row.kind !== "answer" ||
    row.content !== input.request.answer
  ) {
    throw idempotencyKeyReused();
  }
  const nextRow = await transaction
    .selectFrom("application.interview_turns")
    .selectAll()
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("interview_session_id", "=", input.sessionId)
    .where("sequence", "=", expectedSequence + 1)
    .executeTakeFirst();
  return SubmitInterviewAnswerResponseSchema.parse({
    answer: mapTurn(row as InterviewTurnRow),
    nextQuestion: nextRow ? mapTurn(nextRow as InterviewTurnRow) : null,
    appliedRevision: input.request.expectedRevision + 1,
    completed: !nextRow,
  });
}

export async function submitInterviewAnswer(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  sessionId: string;
  request: SubmitInterviewAnswerRequest;
  idempotencyKey: string;
}): Promise<SubmitInterviewAnswerResponse> {
  const answerId = deterministicUuid({
    ownerId: input.owner.ownerId,
    scope: "interview-answer",
    idempotencyKey: input.idempotencyKey,
  });
  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: "interview-answer",
      idempotencyKey: input.idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);
    const replay = await replayAnswer(transaction, {
      owner: input.owner,
      caseId: input.caseId,
      sessionId: input.sessionId,
      answerId,
      request: input.request,
    });
    if (replay) return replay;

    const session = await transaction
      .selectFrom("application.interview_sessions")
      .selectAll()
      .where("id", "=", input.sessionId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("case_id", "=", input.caseId)
      .where("deleted_at", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!session) {
      await assertCaseExists(transaction, input.owner, input.caseId);
      throw interviewSessionNotFound();
    }
    if (Number(session.revision) !== input.request.expectedRevision) {
      throw interviewSessionRevisionConflict();
    }
    if (session.status !== "active") {
      throw new ServiceError(
        409,
        "INTERVIEW_SESSION_NOT_ACTIVE",
        "当前面试练习已结束，不能继续追加回答。",
      );
    }

    const pendingSequence = input.request.expectedRevision * 2 - 1;
    const pendingQuestion = await transaction
      .selectFrom("application.interview_turns")
      .selectAll()
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("interview_session_id", "=", input.sessionId)
      .where("sequence", "=", pendingSequence)
      .executeTakeFirst();
    if (!pendingQuestion || pendingQuestion.kind === "answer") {
      throw new Error("INTERVIEW_PENDING_QUESTION_MISSING");
    }
    const plan = await questionPlanForSession(
      transaction,
      input.owner,
      session as InterviewSessionRow,
    );
    const questionIndex = input.request.expectedRevision - 1;
    if (!plan[questionIndex]) throw new Error("INTERVIEW_QUESTION_PLAN_MISMATCH");

    const answer = await insertTurn(transaction, {
      id: answerId,
      owner: input.owner,
      sessionId: input.sessionId,
      sequence: pendingSequence + 1,
      kind: "answer",
      content: input.request.answer,
      requirementIds: parseJsonValue(pendingQuestion.requirement_ids) as string[],
    });
    const nextSeed = plan[questionIndex + 1] ?? null;
    const nextQuestion = nextSeed
      ? await insertTurn(transaction, {
          id: deterministicUuid({ answerId, purpose: "next-question" }),
          owner: input.owner,
          sessionId: input.sessionId,
          sequence: pendingSequence + 2,
          kind: "question",
          content: nextSeed.content,
          requirementIds: nextSeed.requirementIds,
        })
      : null;
    const appliedRevision = input.request.expectedRevision + 1;
    const updated = await transaction
      .updateTable("application.interview_sessions")
      .set({
        status: nextQuestion ? "active" : "completed",
        revision: appliedRevision,
        completed_at: nextQuestion ? null : sql<Date>`clock_timestamp()`,
        updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
      })
      .where("id", "=", input.sessionId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("revision", "=", input.request.expectedRevision)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) throw interviewSessionRevisionConflict();
    return SubmitInterviewAnswerResponseSchema.parse({
      answer,
      nextQuestion,
      appliedRevision,
      completed: nextQuestion === null,
    });
  });
}
