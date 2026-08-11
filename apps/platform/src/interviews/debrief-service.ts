import { randomUUID } from "node:crypto";
import {
  type Debrief,
  DebriefSchema,
  type GetCaseDebriefResponse,
  GetCaseDebriefResponseSchema,
  type InterviewFeedback,
  type InterviewFeedbackItem,
  type InterviewFeedbackPayload,
  InterviewFeedbackPayloadSchema,
  InterviewFeedbackSchema,
  type InterviewTurn,
  InterviewTurnSchema,
  type JobContext,
  type PrepareCaseDebriefRequest,
  type PrepareCaseDebriefResponse,
  PrepareCaseDebriefResponseSchema,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, type Selectable, sql, type Transaction } from "kysely";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { lockOwnerIdempotencyKey } from "../lib/idempotency.js";
import { ServiceError } from "../lib/service-error.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;
type DebriefRow = Selectable<Database["application.debriefs"]>;
type FeedbackRow = Selectable<Database["application.interview_feedback"]>;
type InterviewTurnRow = Selectable<Database["application.interview_turns"]>;

interface DebriefReadRow extends DebriefRow {
  public_official_url: string | null;
  private_title: string | null;
  private_company_name: string | null;
  private_source_label: string | null;
  private_official_url: string | null;
  private_requirement_set_revision: number | null;
  private_source_provided: boolean | null;
}

interface ReviewContent {
  feedback: InterviewFeedbackPayload;
  expressionIssues: Debrief["expressionIssues"];
  evidenceGaps: Debrief["evidenceGaps"];
  practicePlan: Debrief["practicePlan"];
}

const MIN_DETAIL_CHARS = 80;
const STRUCTURE_SIGNALS = [
  /(背景|情境|当时|项目|场景)/,
  /(任务|目标|职责|负责)/,
  /(行动|做法|采取|通过|首先|随后|协作)/,
  /(结果|最终|达成|完成|提升|降低|复盘|收获)/,
] as const;

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

function interviewSessionNotFound(): ServiceError {
  return new ServiceError(
    404,
    "INTERVIEW_SESSION_NOT_FOUND",
    "面试练习不存在、已删除或不属于当前用户。",
  );
}

function interviewSessionNotCompleted(): ServiceError {
  return new ServiceError(
    409,
    "INTERVIEW_SESSION_NOT_COMPLETED",
    "请先完成当前面试练习，再生成反馈与复盘。",
  );
}

function interviewSessionRevisionConflict(): ServiceError {
  return new ServiceError(
    409,
    "INTERVIEW_SESSION_REVISION_CONFLICT",
    "面试练习已在其他页面更新，请刷新并核对后重试。",
  );
}

function debriefAlreadyExists(): ServiceError {
  return new ServiceError(
    409,
    "CASE_DEBRIEF_ALREADY_EXISTS",
    "当前求职项目已经有一份基于其他面试练习的复盘，请先查看现有复盘。",
  );
}

function debriefNotAvailable(): ServiceError {
  return new ServiceError(
    409,
    "CASE_DEBRIEF_NOT_AVAILABLE",
    "这份复盘已经不可用，不能用原请求编号重新创建。",
  );
}

function idempotencyKeyReused(): ServiceError {
  return new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "同一个请求编号不能用于不同的复盘操作。");
}

function debriefReadQuery(db: DbExecutor) {
  return db
    .selectFrom("application.debriefs as debrief")
    .leftJoin(
      "catalog.published_job_versions as public_version",
      "public_version.id",
      "debrief.published_job_version_id",
    )
    .leftJoin("application.private_job_snapshot_revisions as private_revision", (join) =>
      join
        .onRef("private_revision.owner_id", "=", "debrief.owner_id")
        .onRef("private_revision.snapshot_id", "=", "debrief.private_job_snapshot_id")
        .onRef("private_revision.content_revision", "=", "debrief.job_context_revision"),
    )
    .selectAll("debrief")
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

function mapJobContext(row: DebriefReadRow): JobContext {
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

function mapDebrief(row: DebriefReadRow): Debrief {
  return DebriefSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    caseId: row.case_id,
    detachedFromCaseId: row.detached_from_case_id,
    jobContext: mapJobContext(row),
    interviewSessionId: row.interview_session_id,
    evidenceRevisionId: row.evidence_revision_id,
    expressionIssues: parseJsonValue(row.expression_issues),
    evidenceGaps: parseJsonValue(row.evidence_gaps),
    practicePlan: parseJsonValue(row.practice_plan),
    status: row.status,
    revision: Number(row.revision),
    confirmedAt: row.confirmed_at ? toIso(row.confirmed_at) : null,
    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function mapFeedback(row: FeedbackRow): InterviewFeedback {
  return InterviewFeedbackSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    interviewSessionId: row.interview_session_id,
    revision: Number(row.revision),
    generatorMode: row.generator_mode,
    feedback: parseJsonValue(row.feedback),
    createdAt: toIso(row.created_at),
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

async function loadActiveDebrief(
  db: DbExecutor,
  owner: OwnerScope,
  caseId: string,
): Promise<DebriefReadRow | null> {
  const row = await debriefReadQuery(db)
    .where("debrief.owner_id", "=", owner.ownerId)
    .where("debrief.owner_epoch", "=", owner.ownerEpoch)
    .where("debrief.case_id", "=", caseId)
    .where("debrief.deleted_at", "is", null)
    .executeTakeFirst();
  return (row as DebriefReadRow | undefined) ?? null;
}

async function loadDebriefById(
  db: DbExecutor,
  owner: OwnerScope,
  debriefId: string,
): Promise<DebriefReadRow | null> {
  const row = await debriefReadQuery(db)
    .where("debrief.owner_id", "=", owner.ownerId)
    .where("debrief.owner_epoch", "=", owner.ownerEpoch)
    .where("debrief.id", "=", debriefId)
    .where("debrief.deleted_at", "is", null)
    .executeTakeFirst();
  return (row as DebriefReadRow | undefined) ?? null;
}

async function loadLatestFeedback(
  db: DbExecutor,
  owner: OwnerScope,
  sessionId: string,
): Promise<FeedbackRow | null> {
  const row = await db
    .selectFrom("application.interview_feedback")
    .selectAll()
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("interview_session_id", "=", sessionId)
    .orderBy("revision", "desc")
    .limit(1)
    .executeTakeFirst();
  return (row as FeedbackRow | undefined) ?? null;
}

async function detailForDebrief(
  db: DbExecutor,
  owner: OwnerScope,
  row: DebriefReadRow,
): Promise<GetCaseDebriefResponse> {
  const feedback = row.interview_session_id
    ? await loadLatestFeedback(db, owner, row.interview_session_id)
    : null;
  return GetCaseDebriefResponseSchema.parse({
    feedback: feedback ? mapFeedback(feedback) : null,
    debrief: mapDebrief(row),
  });
}

function structureSignalCount(content: string): number {
  return STRUCTURE_SIGNALS.reduce((count, signal) => count + Number(signal.test(content)), 0);
}

export function buildDeterministicInterviewReview(input: {
  sessionId: string;
  turns: InterviewTurn[];
}): ReviewContent {
  const questionsBySequence = new Map(
    input.turns
      .filter((turn) => turn.kind !== "answer")
      .map((turn) => [turn.sequence, turn] as const),
  );
  const answers = input.turns.filter((turn) => turn.kind === "answer");
  const feedbackItems: InterviewFeedbackItem[] = [];

  for (const answer of answers) {
    const question = questionsBySequence.get(answer.sequence - 1);
    const visibleLength = answer.content.replace(/\s/g, "").length;
    if (visibleLength < MIN_DETAIL_CHARS) {
      feedbackItems.push({
        id: deterministicUuid({ sessionId: input.sessionId, answerId: answer.id, kind: "clarity" }),
        category: "clarity",
        severity: "warning",
        message: `第 ${answer.sequence / 2} 段回答较短，尚未呈现足够的可核对细节。`,
        improvement: "补充具体情境、你的行动与可核对结果；没有结果数据时明确说明，不要补写。",
        turnIds: [answer.id],
        requirementIds: question?.requirementIds ?? answer.requirementIds,
        evidenceIds: [],
      });
    }
    if (structureSignalCount(answer.content) < 3) {
      feedbackItems.push({
        id: deterministicUuid({
          sessionId: input.sessionId,
          answerId: answer.id,
          kind: "structure",
        }),
        category: "structure",
        severity: "warning",
        message: `第 ${answer.sequence / 2} 段回答没有显式呈现完整的情境、任务、行动和结果链条。`,
        improvement: "按情境—任务—行动—结果—复盘顺序重组原回答，仍只使用真实发生的内容。",
        turnIds: [answer.id],
        requirementIds: question?.requirementIds ?? answer.requirementIds,
        evidenceIds: [],
      });
    }
    const requirementIds = question?.requirementIds ?? answer.requirementIds;
    if (requirementIds.length > 0 && answer.evidenceIds.length === 0) {
      feedbackItems.push({
        id: deterministicUuid({
          sessionId: input.sessionId,
          answerId: answer.id,
          kind: "evidence",
        }),
        category: "evidence",
        severity: "warning",
        message: `第 ${answer.sequence / 2} 段回答尚未与已确认证据建立显式关联。`,
        improvement: "前往 JD 能力页核对这项要求；有证据时建立关联，没有时保留为待补充。",
        turnIds: [answer.id],
        requirementIds,
        evidenceIds: [],
      });
    }
  }

  const expressionItems = feedbackItems.filter(
    (item) => item.category === "clarity" || item.category === "structure",
  );
  const evidenceItems = feedbackItems.filter((item) => item.category === "evidence");
  const detailedAnswerCount = answers.filter(
    (answer) => answer.content.replace(/\s/g, "").length >= MIN_DETAIL_CHARS,
  ).length;
  const strengths = [
    `已完成 ${answers.length} 段模板回答并保留用户原始表述。`,
    ...(detailedAnswerCount > 0
      ? [`其中 ${detailedAnswerCount} 段回答达到 ${MIN_DETAIL_CHARS} 字以上，提供了更多可见细节。`]
      : []),
  ];
  const practicePriorities = [
    ...(expressionItems.length > 0 ? ["用情境—任务—行动—结果—复盘结构重写一段回答"] : []),
    ...(evidenceItems.length > 0 ? ["核对回答涉及的 JD 要求与已确认证据关联"] : []),
    "再次练习时保持真实、具体、可核对，不补写不存在的经历",
  ];
  const feedback = InterviewFeedbackPayloadSchema.parse({
    schemaVersion: "interview-feedback-v1",
    summary: `本次模板只检查可观察的表达结构与显式证据关联：共 ${answers.length} 段回答，发现 ${expressionItems.length} 个表达提示和 ${evidenceItems.length} 个证据待核对项。`,
    strengths,
    items: feedbackItems,
    practicePriorities,
  });

  const expressionIssues = expressionItems.map((item) => ({
    id: deterministicUuid({ feedbackItemId: item.id, projection: "expression-issue" }),
    description: item.improvement ? `${item.message} ${item.improvement}` : item.message,
    turnIds: item.turnIds,
  }));
  const evidenceGaps = evidenceItems.map((item) => ({
    id: deterministicUuid({ feedbackItemId: item.id, projection: "evidence-gap" }),
    description: item.improvement ? `${item.message} ${item.improvement}` : item.message,
    requirementIds: item.requirementIds,
  }));
  const practiceActions = [
    ...(expressionIssues.length > 0
      ? ["选择一段原回答，按情境—任务—行动—结果—复盘重新组织表达。"]
      : []),
    ...(evidenceGaps.length > 0
      ? ["回到 JD 能力页，逐项核对本轮涉及要求的证据关联或待补状态。"]
      : []),
    "再次完成一轮模板面试，对照本次复盘检查表达是否更具体。",
  ];
  const practicePlan = practiceActions.map((action, index) => ({
    id: deterministicUuid({ sessionId: input.sessionId, action, index }),
    action,
    targetDate: null,
  }));

  return { feedback, expressionIssues, evidenceGaps, practicePlan };
}

export async function getCaseDebrief(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
}): Promise<GetCaseDebriefResponse> {
  await assertCaseExists(input.db, input.owner, input.caseId);
  const row = await loadActiveDebrief(input.db, input.owner, input.caseId);
  if (!row) return GetCaseDebriefResponseSchema.parse({ feedback: null, debrief: null });
  return detailForDebrief(input.db, input.owner, row);
}

async function prepareResponse(
  db: DbExecutor,
  owner: OwnerScope,
  debriefId: string,
  created: boolean,
): Promise<PrepareCaseDebriefResponse> {
  const row = await loadDebriefById(db, owner, debriefId);
  if (!row?.interview_session_id) throw debriefNotAvailable();
  const feedback = await loadLatestFeedback(db, owner, row.interview_session_id);
  if (!feedback) throw new Error("CASE_DEBRIEF_FEEDBACK_MISSING");
  return PrepareCaseDebriefResponseSchema.parse({
    created,
    feedback: mapFeedback(feedback),
    debrief: mapDebrief(row),
  });
}

export async function prepareCaseDebrief(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  request: PrepareCaseDebriefRequest;
  idempotencyKey: string;
}): Promise<PrepareCaseDebriefResponse> {
  const requestHash = hashCanonicalJson({ caseId: input.caseId, request: input.request });
  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: "case-debrief:prepare",
      idempotencyKey: input.idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);

    const replay = await transaction
      .selectFrom("application.debriefs")
      .select([
        "id",
        "owner_epoch",
        "case_id",
        "interview_session_id",
        "creation_request_hash",
        "deleted_at",
      ])
      .where("owner_id", "=", input.owner.ownerId)
      .where("creation_idempotency_key", "=", input.idempotencyKey)
      .executeTakeFirst();
    if (replay) {
      if (
        Number(replay.owner_epoch) !== input.owner.ownerEpoch ||
        replay.case_id !== input.caseId ||
        replay.interview_session_id !== input.request.interviewSessionId ||
        replay.creation_request_hash !== requestHash
      ) {
        throw idempotencyKeyReused();
      }
      if (replay.deleted_at) throw debriefNotAvailable();
      return prepareResponse(transaction, input.owner, replay.id, true);
    }

    const applicationCase = await transaction
      .selectFrom("application.application_cases")
      .select("id")
      .where("id", "=", input.caseId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("deleted_at", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!applicationCase) throw applicationCaseNotFound();

    const existing = await transaction
      .selectFrom("application.debriefs")
      .select(["id", "interview_session_id", "creation_request_hash"])
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("case_id", "=", input.caseId)
      .where("deleted_at", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (existing) {
      if (
        existing.interview_session_id !== input.request.interviewSessionId ||
        existing.creation_request_hash !== requestHash
      ) {
        throw debriefAlreadyExists();
      }
      return prepareResponse(transaction, input.owner, existing.id, false);
    }

    const session = await transaction
      .selectFrom("application.interview_sessions")
      .selectAll()
      .where("id", "=", input.request.interviewSessionId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("case_id", "=", input.caseId)
      .where("deleted_at", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!session) throw interviewSessionNotFound();
    if (session.status !== "completed") throw interviewSessionNotCompleted();
    if (Number(session.revision) !== input.request.expectedSessionRevision) {
      throw interviewSessionRevisionConflict();
    }

    const turnRows = await transaction
      .selectFrom("application.interview_turns")
      .selectAll()
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("interview_session_id", "=", session.id)
      .orderBy("sequence", "asc")
      .limit(200)
      .execute();
    const turns = (turnRows as InterviewTurnRow[]).map(mapTurn);
    const review = buildDeterministicInterviewReview({ sessionId: session.id, turns });
    const feedbackId = randomUUID();
    await transaction
      .insertInto("application.interview_feedback")
      .values({
        id: feedbackId,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        interview_session_id: session.id,
        revision: 1,
        generator_mode: "template",
        feedback: JSON.stringify(review.feedback) as unknown as JsonValue,
      })
      .execute();
    const debriefId = randomUUID();
    await transaction
      .insertInto("application.debriefs")
      .values({
        id: debriefId,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        case_id: input.caseId,
        detached_from_case_id: null,
        interview_session_id: session.id,
        job_context_kind: session.job_context_kind,
        published_job_id: session.published_job_id,
        published_job_version_id: session.published_job_version_id,
        requirement_set_id: session.requirement_set_id,
        private_job_snapshot_id: session.private_job_snapshot_id,
        job_context_revision: session.job_context_revision,
        evidence_revision_id: session.evidence_revision_id,
        expression_issues: JSON.stringify(review.expressionIssues) as unknown as JsonValue,
        evidence_gaps: JSON.stringify(review.evidenceGaps) as unknown as JsonValue,
        practice_plan: JSON.stringify(review.practicePlan) as unknown as JsonValue,
        status: "draft",
        revision: 1,
        creation_idempotency_key: input.idempotencyKey,
        creation_request_hash: requestHash,
        confirmed_at: null,
        deleted_at: null,
      })
      .execute();
    return prepareResponse(transaction, input.owner, debriefId, true);
  });
}
