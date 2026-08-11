import { randomUUID } from "node:crypto";
import {
  type CreateResumeReviewRequest,
  type CreateResumeReviewResponse,
  CreateResumeReviewResponseSchema,
  type CurrentResumeReviewResponse,
  CurrentResumeReviewResponseSchema,
  type DecideResumeReviewSuggestionRequest,
  type DecideResumeReviewSuggestionResponse,
  DecideResumeReviewSuggestionResponseSchema,
  type ResumeEvidenceRevision,
  ResumeEvidenceRevisionSchema,
  type ResumeReviewBundle,
  type ResumeReviewDecision,
  ResumeReviewDecisionSchema,
  type ResumeReviewFinding,
  ResumeReviewFindingSchema,
  type ResumeReviewRun,
  ResumeReviewRunSchema,
  type ResumeReviewSuggestion,
  ResumeReviewSuggestionSchema,
  type ResumeSemanticContent,
  ResumeSemanticContentSchema,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { lockOwnerIdempotencyKey } from "../lib/idempotency.js";
import { ServiceError } from "../lib/service-error.js";
import type { OwnerTaskLease } from "../workers/owner-task-lease.js";
import { withOwnerTaskLease } from "../workers/owner-task-lease.js";
import { appendResumeDocumentContentRevisionInTransaction } from "./revision-service.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;
type ConfirmedEvidence = ResumeEvidenceRevision["evidence"][number];

interface ReviewRunReadRow {
  id: string;
  owner_id: string;
  owner_epoch: number;
  case_id: string | null;
  detached_from_case_id: string | null;
  document_id: string;
  content_revision_id: string;
  job_context_kind: string;
  published_job_id: string | null;
  published_job_version_id: string | null;
  requirement_set_id: string | null;
  private_job_snapshot_id: string | null;
  job_context_revision: number;
  evidence_revision_id: string;
  mode: string;
  status: string;
  revision: number;
  creation_idempotency_key: string;
  creation_request_hash: string;
  completed_at: Date | null;
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

interface ReviewDocumentRow {
  id: string;
  owner_id: string;
  owner_epoch: number;
  kind: string;
  case_id: string | null;
  detached_from_case_id: string | null;
  job_context_kind: string | null;
  published_job_id: string | null;
  published_job_version_id: string | null;
  requirement_set_id: string | null;
  private_job_snapshot_id: string | null;
  job_context_revision: number | null;
  evidence_revision_id: string | null;
  current_content_revision_id: string | null;
  revision: number;
}

export interface TemplateReviewDraft {
  sourceBlockId: string;
  category:
    | "content_relevance"
    | "evidence_support"
    | "expression_clarity"
    | "structure_order"
    | "ats_readability";
  severity: "info" | "warning" | "critical";
  evidenceIds: string[];
  reasonCode: string;
  suggestion:
    | {
        changeType: "rewrite_block";
        suggestedText: string;
        evidenceIds: string[];
      }
    | {
        changeType: "remove_block";
        suggestedText: null;
        evidenceIds: [];
      }
    | null;
}

function parseJson(value: JsonValue): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function json(value: unknown): JsonValue {
  return JSON.stringify(value) as unknown as JsonValue;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function evidencePrimaryText(evidence: ConfirmedEvidence): string {
  return "statement" in evidence ? evidence.statement : evidence.claim;
}

function evidenceSourceBlockId(evidence: ConfirmedEvidence): string | null {
  return "sourceBlockId" in evidence ? evidence.sourceBlockId : null;
}

function uniqueText(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizedText(value).toLocaleLowerCase("zh-CN");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evidenceBackedRewrite(evidence: ConfirmedEvidence[]): string {
  const claims = uniqueText(
    evidence.map(evidencePrimaryText).map((claim) => claim.replace(/[。；;]+$/u, "").trim()),
  );
  const proposed = claims.join("；");
  return proposed.length <= 10_000 ? proposed : (claims[0] ?? "");
}

export function createTemplateReviewDrafts(input: {
  content: ResumeSemanticContent;
  evidence: ResumeEvidenceRevision["evidence"];
}): TemplateReviewDraft[] {
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  return input.content.sections.flatMap((section) =>
    section.blocks.map((block) => {
      const explicitEvidence = block.evidenceIds.flatMap((id) => {
        const item = evidenceById.get(id);
        return item ? [item] : [];
      });
      const linkedEvidence =
        explicitEvidence.length > 0
          ? explicitEvidence
          : input.evidence.filter((item) => evidenceSourceBlockId(item) === block.id);
      const evidenceIds = [...new Set(linkedEvidence.map((item) => item.id))];
      if (evidenceIds.length === 0) {
        const removable = section.blocks.length > 1;
        return {
          sourceBlockId: block.id,
          category: "evidence_support" as const,
          severity: "warning" as const,
          evidenceIds: [],
          reasonCode: "BLOCK_WITHOUT_CONFIRMED_EVIDENCE",
          suggestion: removable
            ? {
                changeType: "remove_block" as const,
                suggestedText: null,
                evidenceIds: [] as [],
              }
            : null,
        };
      }

      const proposed = evidenceBackedRewrite(linkedEvidence);
      const changesExpression =
        proposed.length > 0 && normalizedText(proposed) !== normalizedText(block.text);
      return {
        sourceBlockId: block.id,
        category: changesExpression ? ("ats_readability" as const) : ("evidence_support" as const),
        severity: "info" as const,
        evidenceIds,
        reasonCode: changesExpression
          ? "EVIDENCE_BACKED_ATS_REWRITE"
          : "BLOCK_ALREADY_EVIDENCE_ALIGNED",
        suggestion: changesExpression
          ? {
              changeType: "rewrite_block" as const,
              suggestedText: proposed,
              evidenceIds,
            }
          : null,
      };
    }),
  );
}

function reviewRunReadQuery(db: DbExecutor) {
  return db
    .selectFrom("profile.resume_review_runs as review")
    .leftJoin(
      "catalog.published_job_versions as public_version",
      "public_version.id",
      "review.published_job_version_id",
    )
    .leftJoin("application.private_job_snapshot_revisions as private_revision", (join) =>
      join
        .onRef("private_revision.owner_id", "=", "review.owner_id")
        .onRef("private_revision.snapshot_id", "=", "review.private_job_snapshot_id")
        .onRef("private_revision.content_revision", "=", "review.job_context_revision"),
    )
    .select([
      "review.id",
      "review.owner_id",
      "review.owner_epoch",
      "review.case_id",
      "review.detached_from_case_id",
      "review.document_id",
      "review.content_revision_id",
      "review.job_context_kind",
      "review.published_job_id",
      "review.published_job_version_id",
      "review.requirement_set_id",
      "review.private_job_snapshot_id",
      "review.job_context_revision",
      "review.evidence_revision_id",
      "review.mode",
      "review.status",
      "review.revision",
      "review.creation_idempotency_key",
      "review.creation_request_hash",
      "review.completed_at",
      "review.deleted_at",
      "review.created_at",
      "review.updated_at",
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

function mapReviewRun(row: ReviewRunReadRow): ResumeReviewRun {
  const jobContext =
    row.job_context_kind === "public"
      ? {
          kind: "public" as const,
          publishedJobId: row.published_job_id,
          publishedJobVersionId: row.published_job_version_id,
          requirementSetId: row.requirement_set_id,
          officialUrl: row.public_official_url,
        }
      : {
          kind: "private" as const,
          snapshotId: row.private_job_snapshot_id,
          ownerId: row.owner_id,
          title: row.private_title,
          companyName: row.private_company_name,
          sourceLabel: row.private_source_label,
          ...(row.private_official_url ? { officialUrl: row.private_official_url } : {}),
          contentRevision: Number(row.job_context_revision),
          requirementSetRevision: Number(row.private_requirement_set_revision),
          sourceProvided: row.private_source_provided,
        };
  return ResumeReviewRunSchema.parse({
    schemaVersion: "resume-review-run-v1",
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    caseId: row.case_id,
    detachedFromCaseId: row.detached_from_case_id,
    documentId: row.document_id,
    contentRevisionId: row.content_revision_id,
    jobContext,
    evidenceRevisionId: row.evidence_revision_id,
    mode: row.mode,
    status: row.status,
    revision: Number(row.revision),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function mapFinding(row: {
  id: string;
  owner_id: string;
  owner_epoch: number;
  review_run_id: string;
  category: string;
  severity: string;
  source_block_id: string;
  evidence_ids: JsonValue;
  reason_code: string;
  created_at: Date;
}): ResumeReviewFinding {
  return ResumeReviewFindingSchema.parse({
    schemaVersion: "resume-review-finding-v1",
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    reviewRunId: row.review_run_id,
    category: row.category,
    severity: row.severity,
    sourceBlockId: row.source_block_id,
    evidenceIds: parseJson(row.evidence_ids),
    reasonCode: row.reason_code,
    createdAt: toIso(row.created_at),
  });
}

function mapSuggestion(row: {
  id: string;
  owner_id: string;
  owner_epoch: number;
  review_run_id: string;
  finding_id: string;
  target_type: string;
  target_ids: JsonValue;
  change_type: string;
  suggested_text: string | null;
  evidence_ids: JsonValue;
  decision: string;
  revision: number;
  created_at: Date;
  updated_at: Date;
}): ResumeReviewSuggestion {
  return ResumeReviewSuggestionSchema.parse({
    schemaVersion: "resume-review-suggestion-v1",
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    reviewRunId: row.review_run_id,
    findingId: row.finding_id,
    targetType: row.target_type,
    targetIds: parseJson(row.target_ids),
    changeType: row.change_type,
    suggestedText: row.suggested_text,
    evidenceIds: parseJson(row.evidence_ids),
    decision: row.decision,
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function mapDecision(row: {
  id: string;
  owner_id: string;
  owner_epoch: number;
  review_run_id: string;
  suggestion_id: string;
  based_on_suggestion_revision: number;
  idempotency_key_hash: string;
  decision: string;
  edited_text: string | null;
  result_content_revision_id: string | null;
  reason_code: string | null;
  created_at: Date;
}): ResumeReviewDecision {
  return ResumeReviewDecisionSchema.parse({
    schemaVersion: "resume-review-decision-v1",
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    reviewRunId: row.review_run_id,
    suggestionId: row.suggestion_id,
    basedOnSuggestionRevision: Number(row.based_on_suggestion_revision),
    idempotencyKeyHash: row.idempotency_key_hash,
    decision: row.decision,
    editedText: row.edited_text,
    resultContentRevisionId: row.result_content_revision_id,
    reasonCode: row.reason_code,
    createdAt: toIso(row.created_at),
  });
}

async function loadReviewBundleByRow(
  db: DbExecutor,
  owner: OwnerScope,
  row: ReviewRunReadRow,
): Promise<ResumeReviewBundle> {
  const [findingRows, suggestionRows, decisionRows] = await Promise.all([
    db
      .selectFrom("profile.resume_review_findings")
      .selectAll()
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("review_run_id", "=", row.id)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute(),
    db
      .selectFrom("profile.resume_review_suggestions")
      .selectAll()
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("review_run_id", "=", row.id)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute(),
    db
      .selectFrom("profile.resume_review_decisions")
      .selectAll()
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("review_run_id", "=", row.id)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute(),
  ]);
  return {
    reviewRun: mapReviewRun(row),
    findings: findingRows.map((item) => mapFinding(item)),
    suggestions: suggestionRows.map((item) => mapSuggestion(item)),
    decisions: decisionRows.map((item) => mapDecision(item)),
  };
}

async function loadReviewBundle(
  db: DbExecutor,
  owner: OwnerScope,
  reviewRunId: string,
): Promise<ResumeReviewBundle | null> {
  const row = await reviewRunReadQuery(db)
    .where("review.id", "=", reviewRunId)
    .where("review.owner_id", "=", owner.ownerId)
    .where("review.owner_epoch", "=", owner.ownerEpoch)
    .where("review.deleted_at", "is", null)
    .executeTakeFirst();
  return row ? loadReviewBundleByRow(db, owner, row as unknown as ReviewRunReadRow) : null;
}

export async function getCurrentResumeReview(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  documentId: string;
}): Promise<CurrentResumeReviewResponse> {
  const document = await input.db
    .selectFrom("profile.resume_documents")
    .select("id")
    .where("id", "=", input.documentId)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!document) throw reviewDocumentNotFound();
  const row = await reviewRunReadQuery(input.db)
    .where("review.document_id", "=", input.documentId)
    .where("review.owner_id", "=", input.owner.ownerId)
    .where("review.owner_epoch", "=", input.owner.ownerEpoch)
    .where("review.deleted_at", "is", null)
    .orderBy("review.updated_at", "desc")
    .orderBy("review.created_at", "desc")
    .orderBy("review.id", "desc")
    .executeTakeFirst();
  return CurrentResumeReviewResponseSchema.parse({
    review: row
      ? await loadReviewBundleByRow(input.db, input.owner, row as unknown as ReviewRunReadRow)
      : null,
  });
}

function reviewDocumentNotFound(): ServiceError {
  return new ServiceError(
    404,
    "RESUME_DOCUMENT_NOT_FOUND",
    "简历文档不存在、已删除或不属于当前账户。",
  );
}

function reviewNeedsDerivedDocument(): ServiceError {
  return new ServiceError(
    409,
    "RESUME_REVIEW_REQUIRES_CASE_DOCUMENT",
    "专业审阅只用于已经固定岗位与证据版本的岗位派生简历。",
  );
}

function reviewRevisionConflict(currentRevision: number): ServiceError {
  return new ServiceError(
    409,
    "RESUME_DOCUMENT_REVISION_CONFLICT",
    `简历已经更新，当前修订为 ${currentRevision}，请重新读取后再开始审阅。`,
  );
}

function reviewIdempotencyKeyReused(): ServiceError {
  return new ServiceError(
    409,
    "IDEMPOTENCY_KEY_REUSED",
    "同一个请求编号不能用于不同的简历审阅操作。",
  );
}

function reviewNotReady(): ServiceError {
  return new ServiceError(409, "RESUME_REVIEW_NOT_READY", "审阅任务尚未完成，请稍后重新读取。");
}

function reviewSuggestionConflict(): ServiceError {
  return new ServiceError(
    409,
    "RESUME_REVIEW_SUGGESTION_CONFLICT",
    "该建议已经被处理或修订已变化，请重新读取审阅结果。",
  );
}

function reviewSuggestionStale(): ServiceError {
  return new ServiceError(
    409,
    "RESUME_REVIEW_SUGGESTION_STALE",
    "目标区块在审阅后已经变化，系统没有覆盖你的新内容；请重新发起审阅。",
  );
}

async function loadReviewDocumentForUpdate(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  documentId: string,
): Promise<ReviewDocumentRow | null> {
  return (await transaction
    .selectFrom("profile.resume_documents")
    .select([
      "id",
      "owner_id",
      "owner_epoch",
      "kind",
      "case_id",
      "detached_from_case_id",
      "job_context_kind",
      "published_job_id",
      "published_job_version_id",
      "requirement_set_id",
      "private_job_snapshot_id",
      "job_context_revision",
      "evidence_revision_id",
      "current_content_revision_id",
      "revision",
    ])
    .where("id", "=", documentId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("deleted_at", "is", null)
    .forUpdate()
    .executeTakeFirst()) as ReviewDocumentRow | null;
}

async function loadSemanticContent(input: {
  db: DbExecutor;
  owner: OwnerScope;
  documentId: string;
  contentRevisionId: string;
}): Promise<ResumeSemanticContent> {
  const row = await input.db
    .selectFrom("profile.resume_document_revisions")
    .select(["schema_version", "sections"])
    .where("id", "=", input.contentRevisionId)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("document_id", "=", input.documentId)
    .executeTakeFirst();
  if (!row || row.schema_version !== "resume-content-v1") {
    throw new ServiceError(
      409,
      "RESUME_REVIEW_CONTENT_UNAVAILABLE",
      "当前岗位简历没有可审阅的结构化正文。",
    );
  }
  return ResumeSemanticContentSchema.parse({
    schemaVersion: "resume-content-v1",
    sections: parseJson(row.sections),
  });
}

async function loadEvidenceRevision(input: {
  db: DbExecutor;
  owner: OwnerScope;
  evidenceRevisionId: string;
}): Promise<ResumeEvidenceRevision> {
  const row = await input.db
    .selectFrom("profile.resume_evidence_revisions")
    .selectAll()
    .where("id", "=", input.evidenceRevisionId)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .executeTakeFirst();
  if (!row) {
    throw new ServiceError(
      409,
      "RESUME_REVIEW_EVIDENCE_UNAVAILABLE",
      "岗位简历固定的证据修订已经不可用，不能生成建议。",
    );
  }
  return ResumeEvidenceRevisionSchema.parse({
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
    evidence: parseJson(row.evidence),
  });
}

export async function createResumeReview(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  documentId: string;
  request: CreateResumeReviewRequest;
  idempotencyKey: string;
}): Promise<CreateResumeReviewResponse> {
  const requestHash = hashCanonicalJson({
    operation: "resume-review-run-v1",
    documentId: input.documentId,
    request: input.request,
  });
  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: "resume-review-run",
      idempotencyKey: input.idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);
    const replay = await transaction
      .selectFrom("profile.resume_review_runs")
      .select(["id", "creation_request_hash", "deleted_at"])
      .where("owner_id", "=", input.owner.ownerId)
      .where("creation_idempotency_key", "=", input.idempotencyKey)
      .executeTakeFirst();
    if (replay) {
      if (replay.creation_request_hash !== requestHash) throw reviewIdempotencyKeyReused();
      if (replay.deleted_at) {
        throw new ServiceError(
          410,
          "RESUME_REVIEW_DELETED",
          "该请求曾创建的审阅已删除，请使用新的请求编号。",
        );
      }
      const review = await loadReviewBundle(transaction, input.owner, replay.id);
      if (!review) throw reviewDocumentNotFound();
      return CreateResumeReviewResponseSchema.parse({ review, created: false });
    }

    const document = await loadReviewDocumentForUpdate(transaction, input.owner, input.documentId);
    if (!document) throw reviewDocumentNotFound();
    if (
      document.kind !== "case_derived" ||
      !document.current_content_revision_id ||
      !document.evidence_revision_id ||
      !document.job_context_kind ||
      !document.job_context_revision ||
      (!document.case_id && !document.detached_from_case_id)
    ) {
      throw reviewNeedsDerivedDocument();
    }
    if (Number(document.revision) !== input.request.expectedRevision) {
      throw reviewRevisionConflict(Number(document.revision));
    }
    await loadSemanticContent({
      db: transaction,
      owner: input.owner,
      documentId: document.id,
      contentRevisionId: document.current_content_revision_id,
    });
    await loadEvidenceRevision({
      db: transaction,
      owner: input.owner,
      evidenceRevisionId: document.evidence_revision_id,
    });

    const reviewRunId = randomUUID();
    await transaction
      .insertInto("profile.resume_review_runs")
      .values({
        id: reviewRunId,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        case_id: document.case_id,
        detached_from_case_id: document.detached_from_case_id,
        document_id: document.id,
        content_revision_id: document.current_content_revision_id,
        job_context_kind: document.job_context_kind,
        published_job_id: document.published_job_id,
        published_job_version_id: document.published_job_version_id,
        requirement_set_id: document.requirement_set_id,
        private_job_snapshot_id: document.private_job_snapshot_id,
        job_context_revision: document.job_context_revision,
        evidence_revision_id: document.evidence_revision_id,
        mode: "template",
        status: "pending",
        revision: 1,
        creation_idempotency_key: input.idempotencyKey,
        creation_request_hash: requestHash,
        completed_at: null,
        deleted_at: null,
      })
      .execute();
    await transaction
      .insertInto("task_queue.tasks")
      .values({
        id: randomUUID(),
        task_type: "resume_review",
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        payload: json({ runId: reviewRunId }),
        idempotency_key: `owner:${input.owner.ownerId}:resume-review:${input.idempotencyKey}`,
        status: "queued",
        attempt: 0,
        max_attempts: 2,
        available_at: new Date(),
        backoff_policy: json({ kind: "fixed", seconds: 2 }),
        lease_owner: null,
        lease_until: null,
        heartbeat_at: null,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();
    const review = await loadReviewBundle(transaction, input.owner, reviewRunId);
    if (!review) throw new Error("RESUME_REVIEW_CREATE_READBACK_FAILED");
    return CreateResumeReviewResponseSchema.parse({ review, created: true });
  });
}

export async function processResumeReview(
  db: Kysely<Database>,
  owner: OwnerScope,
  reviewRunId: string,
  lease: OwnerTaskLease,
): Promise<void> {
  try {
    await withOwnerTaskLease(db, lease, async (transaction) => {
      let run = await transaction
        .selectFrom("profile.resume_review_runs")
        .selectAll()
        .where("id", "=", reviewRunId)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .forUpdate()
        .executeTakeFirst();
      if (!run || ["completed", "superseded", "deleted"].includes(run.status)) return;
      if (run.status === "failed") {
        run = await transaction
          .updateTable("profile.resume_review_runs")
          .set({
            status: "pending",
            revision: Number(run.revision) + 1,
            updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
          })
          .where("id", "=", run.id)
          .where("owner_id", "=", owner.ownerId)
          .where("owner_epoch", "=", owner.ownerEpoch)
          .where("revision", "=", run.revision)
          .returningAll()
          .executeTakeFirstOrThrow();
      }
      const content = await loadSemanticContent({
        db: transaction,
        owner,
        documentId: run.document_id,
        contentRevisionId: run.content_revision_id,
      });
      const evidenceRevision = await loadEvidenceRevision({
        db: transaction,
        owner,
        evidenceRevisionId: run.evidence_revision_id,
      });
      const drafts = createTemplateReviewDrafts({
        content,
        evidence: evidenceRevision.evidence,
      });
      for (const draft of drafts) {
        const findingId = randomUUID();
        await transaction
          .insertInto("profile.resume_review_findings")
          .values({
            id: findingId,
            owner_id: owner.ownerId,
            owner_epoch: owner.ownerEpoch,
            review_run_id: run.id,
            category: draft.category,
            severity: draft.severity,
            source_block_id: draft.sourceBlockId,
            evidence_ids: json(draft.evidenceIds),
            reason_code: draft.reasonCode,
          })
          .execute();
        if (!draft.suggestion) continue;
        await transaction
          .insertInto("profile.resume_review_suggestions")
          .values({
            id: randomUUID(),
            owner_id: owner.ownerId,
            owner_epoch: owner.ownerEpoch,
            review_run_id: run.id,
            finding_id: findingId,
            target_type: "block",
            target_ids: json([draft.sourceBlockId]),
            change_type: draft.suggestion.changeType,
            suggested_text: draft.suggestion.suggestedText,
            evidence_ids: json(draft.suggestion.evidenceIds),
            decision: "pending",
            revision: 1,
          })
          .execute();
      }
      await transaction
        .updateTable("profile.resume_review_runs")
        .set({
          status: "completed",
          revision: Number(run.revision) + 1,
          completed_at: sql<Date>`clock_timestamp()`,
          updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
        })
        .where("id", "=", run.id)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("revision", "=", run.revision)
        .where("status", "=", "pending")
        .executeTakeFirstOrThrow();
    });
  } catch (error) {
    await withOwnerTaskLease(db, lease, async (transaction) => {
      const current = await transaction
        .selectFrom("profile.resume_review_runs")
        .select(["status", "revision"])
        .where("id", "=", reviewRunId)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .forUpdate()
        .executeTakeFirst();
      if (!current || current.status !== "pending") return;
      await transaction
        .updateTable("profile.resume_review_runs")
        .set({
          status: "failed",
          revision: Number(current.revision) + 1,
          completed_at: null,
          updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
        })
        .where("id", "=", reviewRunId)
        .where("revision", "=", current.revision)
        .executeTakeFirstOrThrow();
    });
    throw error;
  }
}

function cloneContent(content: ResumeSemanticContent): ResumeSemanticContent {
  return {
    schemaVersion: "resume-content-v1",
    sections: content.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({ ...block, evidenceIds: [...block.evidenceIds] })),
    })),
  };
}

function findBlock(content: ResumeSemanticContent, blockId: string) {
  for (const section of content.sections) {
    const block = section.blocks.find((candidate) => candidate.id === blockId);
    if (block) return { section, block };
  }
  return null;
}

function sameEvidenceIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function applySuggestion(input: {
  reviewedContent: ResumeSemanticContent;
  currentContent: ResumeSemanticContent;
  suggestion: ResumeReviewSuggestion;
  request: DecideResumeReviewSuggestionRequest;
}): ResumeSemanticContent {
  const targetId = input.suggestion.targetIds[0];
  if (
    !targetId ||
    input.suggestion.targetType !== "block" ||
    input.suggestion.targetIds.length !== 1
  ) {
    throw new ServiceError(
      422,
      "RESUME_REVIEW_CHANGE_UNSUPPORTED",
      "当前版本只支持逐个区块的改写或删除建议。",
    );
  }
  const reviewed = findBlock(input.reviewedContent, targetId);
  const current = findBlock(input.currentContent, targetId);
  if (
    !reviewed ||
    !current ||
    normalizedText(reviewed.block.text) !== normalizedText(current.block.text) ||
    !sameEvidenceIds(reviewed.block.evidenceIds, current.block.evidenceIds)
  ) {
    throw reviewSuggestionStale();
  }

  const next = cloneContent(input.currentContent);
  const nextTarget = findBlock(next, targetId);
  if (!nextTarget) throw reviewSuggestionStale();
  if (input.request.decision === "edited") {
    nextTarget.block.text = input.request.editedText;
    nextTarget.block.evidenceIds = [...input.request.evidenceIds];
    return next;
  }
  if (input.request.decision !== "accepted") return next;
  if (input.suggestion.changeType === "rewrite_block" && input.suggestion.suggestedText) {
    nextTarget.block.text = input.suggestion.suggestedText;
    nextTarget.block.evidenceIds = [...input.suggestion.evidenceIds];
    return next;
  }
  if (input.suggestion.changeType === "remove_block") {
    if (nextTarget.section.blocks.length <= 1) throw reviewSuggestionStale();
    nextTarget.section.blocks = nextTarget.section.blocks
      .filter((block) => block.id !== targetId)
      .map((block, ordinal) => ({ ...block, ordinal }));
    return next;
  }
  throw new ServiceError(
    422,
    "RESUME_REVIEW_CHANGE_UNSUPPORTED",
    "当前版本只支持逐个区块的改写或删除建议。",
  );
}

async function replayDecisionResponse(input: {
  transaction: Transaction<Database>;
  owner: OwnerScope;
  existing: ResumeReviewDecision;
  reviewRunId: string;
  suggestionId: string;
  documentId: string;
  request: DecideResumeReviewSuggestionRequest;
}): Promise<DecideResumeReviewSuggestionResponse> {
  if (
    input.existing.reviewRunId !== input.reviewRunId ||
    input.existing.suggestionId !== input.suggestionId ||
    input.existing.basedOnSuggestionRevision !== input.request.expectedRevision ||
    input.existing.decision !== input.request.decision ||
    (input.request.decision === "edited" &&
      input.existing.editedText !== input.request.editedText) ||
    (input.request.decision === "rejected" &&
      input.existing.reasonCode !== input.request.reasonCode)
  ) {
    throw reviewIdempotencyKeyReused();
  }
  const suggestionRow = await input.transaction
    .selectFrom("profile.resume_review_suggestions")
    .selectAll()
    .where("id", "=", input.suggestionId)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .executeTakeFirstOrThrow();
  const run = await input.transaction
    .selectFrom("profile.resume_review_runs")
    .select("document_id")
    .where("id", "=", input.reviewRunId)
    .where("owner_id", "=", input.owner.ownerId)
    .where("document_id", "=", input.documentId)
    .executeTakeFirstOrThrow();
  const documentState = await input.transaction
    .selectFrom("profile.resume_documents")
    .select("revision")
    .where("id", "=", run.document_id)
    .where("owner_id", "=", input.owner.ownerId)
    .executeTakeFirstOrThrow();
  let contentRevision = null;
  if (input.existing.resultContentRevisionId) {
    const content = await loadSemanticContent({
      db: input.transaction,
      owner: input.owner,
      documentId: run.document_id,
      contentRevisionId: input.existing.resultContentRevisionId,
    });
    const row = await input.transaction
      .selectFrom("profile.resume_document_revisions")
      .select([
        "id",
        "owner_id",
        "owner_epoch",
        "document_id",
        "document_revision",
        "base_document_revision_id",
        "content_hash",
        "confirmed_at",
        "created_at",
      ])
      .where("id", "=", input.existing.resultContentRevisionId)
      .where("owner_id", "=", input.owner.ownerId)
      .executeTakeFirstOrThrow();
    contentRevision = {
      schemaVersion: "resume-content-revision-v1" as const,
      id: row.id,
      documentId: row.document_id,
      ownerId: row.owner_id,
      ownerEpoch: Number(row.owner_epoch),
      documentRevision: Number(row.document_revision),
      baseDocumentRevisionId: row.base_document_revision_id,
      contentHash: row.content_hash,
      confirmedAt: toIso(row.confirmed_at),
      createdAt: toIso(row.created_at),
      content,
    };
    if (input.request.decision === "edited") {
      const targetId = mapSuggestion(suggestionRow).targetIds[0];
      const target = targetId ? findBlock(content, targetId) : null;
      if (!target || !sameEvidenceIds(target.block.evidenceIds, input.request.evidenceIds)) {
        throw reviewIdempotencyKeyReused();
      }
    }
  }
  return DecideResumeReviewSuggestionResponseSchema.parse({
    decision: input.existing,
    suggestion: mapSuggestion(suggestionRow),
    contentRevision,
    documentRevision: Number(documentState.revision),
  });
}

export async function decideResumeReviewSuggestion(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  reviewRunId: string;
  suggestionId: string;
  documentId: string;
  request: DecideResumeReviewSuggestionRequest;
}): Promise<DecideResumeReviewSuggestionResponse> {
  const idempotencyKeyHash = hashCanonicalJson({
    scope: "resume-review-decision-v1",
    ownerId: input.owner.ownerId,
    idempotencyKey: input.request.idempotencyKey,
  });
  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: "resume-review-decision",
      idempotencyKey: input.request.idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);
    const existingRow = await transaction
      .selectFrom("profile.resume_review_decisions")
      .selectAll()
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("idempotency_key_hash", "=", idempotencyKeyHash)
      .executeTakeFirst();
    if (existingRow) {
      return replayDecisionResponse({
        transaction,
        owner: input.owner,
        existing: mapDecision(existingRow),
        reviewRunId: input.reviewRunId,
        suggestionId: input.suggestionId,
        documentId: input.documentId,
        request: input.request,
      });
    }

    const suggestionRow = await transaction
      .selectFrom("profile.resume_review_suggestions as suggestion")
      .innerJoin("profile.resume_review_runs as review", (join) =>
        join
          .onRef("review.owner_id", "=", "suggestion.owner_id")
          .onRef("review.owner_epoch", "=", "suggestion.owner_epoch")
          .onRef("review.id", "=", "suggestion.review_run_id"),
      )
      .select([
        "suggestion.id",
        "suggestion.owner_id",
        "suggestion.owner_epoch",
        "suggestion.review_run_id",
        "suggestion.finding_id",
        "suggestion.target_type",
        "suggestion.target_ids",
        "suggestion.change_type",
        "suggestion.suggested_text",
        "suggestion.evidence_ids",
        "suggestion.decision",
        "suggestion.revision",
        "suggestion.created_at",
        "suggestion.updated_at",
        "review.document_id",
        "review.content_revision_id",
        "review.status as review_status",
      ])
      .where("suggestion.id", "=", input.suggestionId)
      .where("suggestion.review_run_id", "=", input.reviewRunId)
      .where("suggestion.owner_id", "=", input.owner.ownerId)
      .where("suggestion.owner_epoch", "=", input.owner.ownerEpoch)
      .where("review.document_id", "=", input.documentId)
      .forUpdate("suggestion")
      .executeTakeFirst();
    if (!suggestionRow) {
      throw new ServiceError(
        404,
        "RESUME_REVIEW_SUGGESTION_NOT_FOUND",
        "建议不存在、已删除或不属于当前账户。",
      );
    }
    if (suggestionRow.review_status !== "completed") throw reviewNotReady();
    if (
      suggestionRow.decision !== "pending" ||
      Number(suggestionRow.revision) !== input.request.expectedRevision
    ) {
      throw reviewSuggestionConflict();
    }
    const suggestion = mapSuggestion(suggestionRow);
    const document = await loadReviewDocumentForUpdate(
      transaction,
      input.owner,
      suggestionRow.document_id,
    );
    if (!document || !document.current_content_revision_id) throw reviewDocumentNotFound();

    let contentMutation = null;
    if (input.request.decision !== "rejected") {
      const [reviewedContent, currentContent] = await Promise.all([
        loadSemanticContent({
          db: transaction,
          owner: input.owner,
          documentId: document.id,
          contentRevisionId: suggestionRow.content_revision_id,
        }),
        loadSemanticContent({
          db: transaction,
          owner: input.owner,
          documentId: document.id,
          contentRevisionId: document.current_content_revision_id,
        }),
      ]);
      const content = applySuggestion({
        reviewedContent,
        currentContent,
        suggestion,
        request: input.request,
      });
      contentMutation = await appendResumeDocumentContentRevisionInTransaction({
        transaction,
        owner: input.owner,
        documentId: document.id,
        request: {
          expectedRevision: Number(document.revision),
          baseDocumentRevisionId: document.current_content_revision_id,
          content,
        },
        idempotencyKey: `review-decision:${input.request.idempotencyKey}`,
      });
    }

    const decisionRow = await transaction
      .insertInto("profile.resume_review_decisions")
      .values({
        id: randomUUID(),
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        review_run_id: input.reviewRunId,
        suggestion_id: input.suggestionId,
        document_id: document.id,
        based_on_suggestion_revision: input.request.expectedRevision,
        idempotency_key_hash: idempotencyKeyHash,
        decision: input.request.decision,
        edited_text: input.request.decision === "edited" ? input.request.editedText : null,
        result_content_revision_id: contentMutation?.contentRevision.id ?? null,
        reason_code: input.request.decision === "rejected" ? input.request.reasonCode : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const updatedSuggestionRow = await transaction
      .selectFrom("profile.resume_review_suggestions")
      .selectAll()
      .where("id", "=", input.suggestionId)
      .where("owner_id", "=", input.owner.ownerId)
      .executeTakeFirstOrThrow();
    return DecideResumeReviewSuggestionResponseSchema.parse({
      decision: mapDecision(decisionRow),
      suggestion: mapSuggestion(updatedSuggestionRow),
      contentRevision: contentMutation?.contentRevision ?? null,
      documentRevision: contentMutation?.documentRevision ?? Number(document.revision),
    });
  });
}
