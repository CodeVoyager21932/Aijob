import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  type CreateResumeReviewRequest,
  type CreateResumeReviewResponse,
  CreateResumeReviewResponseSchema,
  type CurrentResumeReviewResponse,
  CurrentResumeReviewResponseSchema,
  type DecideResumeReviewSuggestionRequest,
  type DecideResumeReviewSuggestionResponse,
  DecideResumeReviewSuggestionResponseSchema,
  type JobRequirement,
  JobRequirementSchema,
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
import { z } from "zod";
import { AiProviderError, OpenAiCompatibleProvider } from "../ai/provider.js";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { lockOwnerIdempotencyKey } from "../lib/idempotency.js";
import { ServiceError } from "../lib/service-error.js";
import { redactPersonalInformation } from "../resume/security.js";
import {
  type ProviderTailoringSegment,
  validateTailoringSegments,
} from "../tailoring/service.js";
import type { OwnerTaskLease } from "../workers/owner-task-lease.js";
import { withOwnerTaskLease } from "../workers/owner-task-lease.js";
import { appendResumeDocumentContentRevisionInTransaction } from "./revision-service.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;
type ConfirmedEvidence = ResumeEvidenceRevision["evidence"][number];

const REVIEW_GENERATION_PROVENANCE_VERSION = "resume-review-generation-v1";
const REVIEW_TEMPLATE_VERSION = "resume-review-template-v2";
const REVIEW_PROMPT_VERSION = "resume-review-prompt-v1";
const REVIEW_OUTPUT_SCHEMA_VERSION = "resume-review-output-v1";
const REVIEW_SAFETY_POLICY_VERSION = "confirmed-evidence-and-fixed-requirements-v1";
const REVIEW_PARAMETERS_VERSION = "temperature-zero-v1";
const REVIEW_PROVIDER_ADAPTER = "openai-compatible-v1";

const ControlledAiReviewRewriteSchema = z
  .object({
    sourceBlockId: z.string().uuid(),
    suggestedText: z.string().trim().min(1).max(10_000),
    requirementIds: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length),
    evidenceIds: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();

const ControlledAiReviewOutputSchema = z
  .object({
    rewrites: z.array(ControlledAiReviewRewriteSchema).min(1).max(100),
  })
  .strict();

interface ReviewRunReadRow {
  id: string;
  schema_version: string;
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
  generation_provenance_version: string | null;
  template_version: string | null;
  privacy_consent_at: Date | null;
  provider_adapter: string | null;
  model: string | null;
  prompt_version: string | null;
  output_schema_version: string | null;
  safety_policy_version: string | null;
  parameters_version: string | null;
  used_template_fallback: boolean;
  fallback_reason_code: string | null;
  failure_code: string | null;
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
  requirementIds: string[];
  reasonCode: string;
  suggestion:
    | {
        changeType: "rewrite_block";
        suggestedText: string;
        evidenceIds: string[];
        requirementIds: string[];
      }
    | {
        changeType: "remove_block";
        suggestedText: null;
        evidenceIds: [];
        requirementIds: string[];
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

const FixedRequirementsSchema = z.array(JobRequirementSchema).max(500);

interface FixedRequirementContext {
  job_context_kind: string | null;
  published_job_version_id: string | null;
  requirement_set_id: string | null;
  private_job_snapshot_id: string | null;
  job_context_revision: number | null;
}

async function loadFixedRequirements(
  db: DbExecutor,
  owner: OwnerScope,
  context: FixedRequirementContext,
): Promise<JobRequirement[]> {
  if (context.job_context_kind === null) return [];
  const row =
    context.job_context_kind === "public"
      ? await db
          .selectFrom("catalog.job_requirement_sets")
          .select("requirements")
          .where("id", "=", context.requirement_set_id)
          .where("published_job_version_id", "=", context.published_job_version_id)
          .executeTakeFirst()
      : await db
          .selectFrom("application.private_job_snapshot_revisions")
          .select("requirements")
          .where("owner_id", "=", owner.ownerId)
          .where("owner_epoch", "=", owner.ownerEpoch)
          .where("snapshot_id", "=", context.private_job_snapshot_id)
          .where("content_revision", "=", context.job_context_revision)
          .executeTakeFirst();
  if (!row) {
    throw new ServiceError(
      409,
      "RESUME_REVIEW_REQUIREMENTS_UNAVAILABLE",
      "岗位简历固定的岗位要求已经不可用，不能生成或解释审阅结果。",
    );
  }
  return FixedRequirementsSchema.parse(parseJson(row.requirements));
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

const REQUIREMENT_MATCH_STOP_WORDS = new Set([
  "工作",
  "岗位",
  "要求",
  "相关",
  "负责",
  "完成",
  "具备",
  "能力",
  "经验",
  "优先",
]);

function matchingTerms(values: unknown[]): Set<string> {
  const terms = new Set<string>();
  for (const value of values) {
    const text = normalizedText(typeof value === "string" ? value : JSON.stringify(value ?? ""))
      .toLocaleLowerCase("zh-CN")
      .slice(0, 20_000);
    for (const token of text.match(/[a-z0-9+#.]{2,}|[\p{Script=Han}]{2,}/gu) ?? []) {
      if (!REQUIREMENT_MATCH_STOP_WORDS.has(token)) terms.add(token);
      if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 2) {
        for (let index = 0; index < token.length - 1; index += 1) {
          const pair = token.slice(index, index + 2);
          if (!REQUIREMENT_MATCH_STOP_WORDS.has(pair)) terms.add(pair);
        }
      }
    }
  }
  return terms;
}

function relatedRequirementIds(input: {
  blockText: string;
  evidence: ConfirmedEvidence[];
  requirements: JobRequirement[];
}): string[] {
  const evidenceTerms = matchingTerms([
    input.blockText,
    ...input.evidence.flatMap((item) => [
      evidencePrimaryText(item),
      ...item.skills,
      ...item.outcomes,
    ]),
  ]);
  return input.requirements.flatMap((requirement) => {
    const requirementTerms = matchingTerms([
      requirement.sourceText,
      requirement.kind,
      requirement.expectedValue,
    ]);
    return [...requirementTerms].some((term) => evidenceTerms.has(term)) ? [requirement.id] : [];
  });
}

export function createTemplateReviewDrafts(input: {
  content: ResumeSemanticContent;
  evidence: ResumeEvidenceRevision["evidence"];
  requirements?: JobRequirement[];
}): TemplateReviewDraft[] {
  const requirements = input.requirements ?? [];
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const drafts = input.content.sections.flatMap((section) =>
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
      const requirementIds = relatedRequirementIds({
        blockText: block.text,
        evidence: linkedEvidence,
        requirements,
      });
      if (evidenceIds.length === 0) {
        const removable = section.blocks.length > 1;
        return {
          sourceBlockId: block.id,
          category: "evidence_support" as const,
          severity: "warning" as const,
          evidenceIds: [],
          requirementIds,
          reasonCode: "BLOCK_WITHOUT_CONFIRMED_EVIDENCE",
          suggestion: removable
            ? {
                changeType: "remove_block" as const,
                suggestedText: null,
                evidenceIds: [] as [],
                requirementIds,
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
        requirementIds,
        reasonCode: changesExpression
          ? requirementIds.length > 0
            ? "JOB_REQUIREMENT_EVIDENCE_REWRITE"
            : "EVIDENCE_BACKED_ATS_REWRITE"
          : "BLOCK_ALREADY_EVIDENCE_ALIGNED",
        suggestion: changesExpression
          ? {
              changeType: "rewrite_block" as const,
              suggestedText: proposed,
              evidenceIds,
              requirementIds,
            }
          : null,
      };
    }),
  );
  const citedRequirementIds = new Set(drafts.flatMap((draft) => draft.requirementIds));
  const anchorBlockId = input.content.sections[0]?.blocks[0]?.id;
  if (!anchorBlockId) return drafts.slice(0, 500);
  const uncitedRequirements: TemplateReviewDraft[] = requirements
    .filter((requirement) => !citedRequirementIds.has(requirement.id))
    .map((requirement) => ({
      sourceBlockId: anchorBlockId,
      category: "content_relevance",
      severity: requirement.necessity === "required" ? "warning" : "info",
      evidenceIds: [],
      requirementIds: [requirement.id],
      reasonCode: "REQUIREMENT_EVIDENCE_NOT_LINKED",
      suggestion: null,
    }));
  return [...drafts, ...uncitedRequirements].slice(0, 500);
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
      "review.schema_version",
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
      "review.generation_provenance_version",
      "review.template_version",
      "review.privacy_consent_at",
      "review.provider_adapter",
      "review.model",
      "review.prompt_version",
      "review.output_schema_version",
      "review.safety_policy_version",
      "review.parameters_version",
      "review.used_template_fallback",
      "review.fallback_reason_code",
      "review.failure_code",
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
  const common = {
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
  };
  return ResumeReviewRunSchema.parse(
    row.schema_version === "resume-review-run-v2"
      ? {
          ...common,
          schemaVersion: "resume-review-run-v2",
          generationProvenanceVersion: row.generation_provenance_version,
          templateVersion: row.template_version,
          privacyConsentAt: row.privacy_consent_at ? toIso(row.privacy_consent_at) : null,
          providerAdapter: row.provider_adapter,
          model: row.model,
          promptVersion: row.prompt_version,
          outputSchemaVersion: row.output_schema_version,
          safetyPolicyVersion: row.safety_policy_version,
          parametersVersion: row.parameters_version,
          usedTemplateFallback: row.used_template_fallback,
          fallbackReasonCode: row.fallback_reason_code,
          failureCode: row.failure_code,
        }
      : { ...common, schemaVersion: "resume-review-run-v1" },
  );
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
  requirement_ids: JsonValue;
  schema_version: string;
  reason_code: string;
  created_at: Date;
}): ResumeReviewFinding {
  return ResumeReviewFindingSchema.parse({
    schemaVersion:
      row.schema_version === "resume-review-finding-v2"
        ? "resume-review-finding-v2"
        : "resume-review-finding-v1",
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    reviewRunId: row.review_run_id,
    category: row.category,
    severity: row.severity,
    sourceBlockId: row.source_block_id,
    evidenceIds: parseJson(row.evidence_ids),
    ...(row.schema_version === "resume-review-finding-v2"
      ? { requirementIds: parseJson(row.requirement_ids) }
      : {}),
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
  requirement_ids: JsonValue;
  schema_version: string;
  decision: string;
  revision: number;
  created_at: Date;
  updated_at: Date;
}): ResumeReviewSuggestion {
  return ResumeReviewSuggestionSchema.parse({
    schemaVersion:
      row.schema_version === "resume-review-suggestion-v2"
        ? "resume-review-suggestion-v2"
        : "resume-review-suggestion-v1",
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
    ...(row.schema_version === "resume-review-suggestion-v2"
      ? { requirementIds: parseJson(row.requirement_ids) }
      : {}),
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
    .select([
      "id",
      "job_context_kind",
      "published_job_version_id",
      "requirement_set_id",
      "private_job_snapshot_id",
      "job_context_revision",
    ])
    .where("id", "=", input.documentId)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!document) throw reviewDocumentNotFound();
  const requirements = await loadFixedRequirements(input.db, input.owner, document);
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
    requirements,
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
  reviewV2WriteEnabled?: boolean;
}): Promise<CreateResumeReviewResponse> {
  const writeV2 = input.reviewV2WriteEnabled === true;
  if (input.request.mode === "controlled_ai" && !writeV2) {
    throw new ServiceError(
      503,
      "RESUME_REVIEW_V2_WRITE_DISABLED",
      "受控 AI 审阅仍处于兼容部署关闭状态，请使用模板审阅或稍后重试。",
    );
  }
  const requestHash = hashCanonicalJson({
    operation: writeV2 ? "resume-review-run-v2" : "resume-review-run-v1",
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
      const replayRow = await reviewRunReadQuery(transaction)
        .where("review.id", "=", replay.id)
        .where("review.owner_id", "=", input.owner.ownerId)
        .where("review.owner_epoch", "=", input.owner.ownerEpoch)
        .where("review.deleted_at", "is", null)
        .executeTakeFirst();
      if (!replayRow) throw reviewDocumentNotFound();
      const requirements = await loadFixedRequirements(
        transaction,
        input.owner,
        replayRow as unknown as ReviewRunReadRow,
      );
      const review = await loadReviewBundleByRow(
        transaction,
        input.owner,
        replayRow as unknown as ReviewRunReadRow,
      );
      return CreateResumeReviewResponseSchema.parse({ review, requirements, created: false });
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
    const requirements = await loadFixedRequirements(transaction, input.owner, document);

    const reviewRunId = randomUUID();
    await transaction
      .insertInto("profile.resume_review_runs")
      .values({
        id: reviewRunId,
        schema_version: writeV2 ? "resume-review-run-v2" : "resume-review-run-v1",
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
        mode: input.request.mode,
        status: "pending",
        revision: 1,
        creation_idempotency_key: input.idempotencyKey,
        creation_request_hash: requestHash,
        generation_provenance_version: writeV2 ? REVIEW_GENERATION_PROVENANCE_VERSION : null,
        template_version: writeV2 ? REVIEW_TEMPLATE_VERSION : null,
        privacy_consent_at:
          writeV2 && input.request.mode === "controlled_ai"
            ? sql<Date>`clock_timestamp()`
            : null,
        provider_adapter: null,
        model: null,
        prompt_version:
          writeV2 && input.request.mode === "controlled_ai" ? REVIEW_PROMPT_VERSION : null,
        output_schema_version:
          writeV2 && input.request.mode === "controlled_ai" ? REVIEW_OUTPUT_SCHEMA_VERSION : null,
        safety_policy_version:
          writeV2 && input.request.mode === "controlled_ai" ? REVIEW_SAFETY_POLICY_VERSION : null,
        parameters_version:
          writeV2 && input.request.mode === "controlled_ai" ? REVIEW_PARAMETERS_VERSION : null,
        used_template_fallback: false,
        fallback_reason_code: null,
        failure_code: null,
        completed_at: null,
        deleted_at: null,
      })
      .execute();
    await transaction
      .insertInto("task_queue.tasks")
      .values({
        id: randomUUID(),
        task_type: writeV2 ? "resume_review_v2" : "resume_review",
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        payload: json({ runId: reviewRunId }),
        idempotency_key: `owner:${input.owner.ownerId}:resume-review:${writeV2 ? "v2:" : ""}${input.idempotencyKey}`,
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
    return CreateResumeReviewResponseSchema.parse({ review, requirements, created: true });
  });
}

interface ReviewV2GenerationOutcome {
  drafts: TemplateReviewDraft[];
  providerAdapter: string | null;
  model: string | null;
  usedTemplateFallback: boolean;
  fallbackReasonCode: string | null;
}

function fallbackReasonCode(error: unknown): string {
  if (error instanceof AiProviderError || error instanceof ServiceError) return error.code;
  return "AI_GENERATION_FAILED";
}

function redacted(value: string): string {
  return redactPersonalInformation(value).redactedText;
}

function controlledAiEvidence(input: {
  content: ResumeSemanticContent;
  evidence: ResumeEvidenceRevision["evidence"];
}) {
  const explicitBlockByEvidenceId = new Map<string, string>();
  for (const section of input.content.sections) {
    for (const block of section.blocks) {
      for (const evidenceId of block.evidenceIds) {
        if (!explicitBlockByEvidenceId.has(evidenceId)) {
          explicitBlockByEvidenceId.set(evidenceId, block.id);
        }
      }
    }
  }
  return input.evidence.flatMap((item) => {
    const sourceBlockId = evidenceSourceBlockId(item) ?? explicitBlockByEvidenceId.get(item.id);
    if (!sourceBlockId) return [];
    return [
      {
        id: item.id,
        sourceBlockId,
        statement: evidencePrimaryText(item),
        skills: item.skills,
        outcomes: item.outcomes,
      },
    ];
  });
}

function controlledAiProviderMetadata(config: AppConfig): {
  providerAdapter: string | null;
  model: string | null;
} {
  const configured =
    config.ai.enabled && Boolean(config.ai.baseUrl && config.ai.model && config.ai.apiKey);
  return configured
    ? { providerAdapter: REVIEW_PROVIDER_ADAPTER, model: config.ai.model ?? null }
    : { providerAdapter: null, model: null };
}

async function generateResumeReviewV2(input: {
  config: AppConfig;
  mode: string;
  content: ResumeSemanticContent;
  evidence: ResumeEvidenceRevision["evidence"];
  requirements: JobRequirement[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ReviewV2GenerationOutcome> {
  const template = () =>
    createTemplateReviewDrafts({
      content: input.content,
      evidence: input.evidence,
      requirements: input.requirements,
    }).map((draft) =>
      draft.suggestion?.changeType === "rewrite_block" &&
      draft.suggestion.requirementIds.length === 0
        ? { ...draft, suggestion: null }
        : draft,
    );
  if (input.mode === "template") {
    return {
      drafts: template(),
      providerAdapter: null,
      model: null,
      usedTemplateFallback: false,
      fallbackReasonCode: null,
    };
  }
  if (input.mode !== "controlled_ai") throw new Error("RESUME_REVIEW_MODE_UNSUPPORTED");

  const providerMetadata = controlledAiProviderMetadata(input.config);
  try {
    if (input.signal?.aborted) throw new Error("OWNER_TASK_ABORTED");
    if (input.requirements.length === 0) {
      throw new ServiceError(
        422,
        "AI_REQUIREMENTS_UNAVAILABLE",
        "固定岗位没有可供受控审阅引用的要求。",
      );
    }
    const evidence = controlledAiEvidence(input);
    if (evidence.length === 0) {
      throw new ServiceError(
        422,
        "AI_EVIDENCE_UNAVAILABLE",
        "当前简历没有可回指区块的已确认证据。",
      );
    }
    const provider = new OpenAiCompatibleProvider(
      {
        enabled: input.config.ai.enabled,
        requestTimeoutMs: input.config.ai.requestTimeoutMs,
        ...(input.config.ai.baseUrl ? { baseUrl: input.config.ai.baseUrl } : {}),
        ...(input.config.ai.model ? { model: input.config.ai.model } : {}),
        ...(input.config.ai.apiKey ? { apiKey: input.config.ai.apiKey } : {}),
      },
      input.fetchImpl ?? fetch,
    );
    const output = await provider.completeStructured({
      systemInstruction:
        "你是岗位简历逐区块审阅器。只返回需要修改的区块；每项必须引用给定的岗位要求 ID 和已确认证据 ID。" +
        "只能重组被引用证据中的事实，不得新增数字、技能、主体、项目或结果，不得修改资格结论。" +
        "返回严格 JSON：{\"rewrites\":[{\"sourceBlockId\":\"uuid\",\"suggestedText\":\"...\",\"requirementIds\":[\"...\"],\"evidenceIds\":[\"...\"]}]}",
      untrustedPayload: {
        requirements: input.requirements.map((requirement) => ({
          id: requirement.id,
          kind: requirement.kind,
          necessity: requirement.necessity,
          sourceText: redacted(requirement.sourceText),
          expectedValue: redacted(JSON.stringify(requirement.expectedValue ?? null)),
        })),
        confirmedEvidence: evidence.map((item) => ({
          id: item.id,
          sourceBlockId: item.sourceBlockId,
          statement: redacted(item.statement),
          skills: item.skills.map(redacted),
          outcomes: item.outcomes.map(redacted),
        })),
        sourceBlocks: input.content.sections.flatMap((section) =>
          section.blocks.map((block) => ({
            sourceBlockId: block.id,
            section: redacted(section.title),
            text: redacted(block.text),
          })),
        ),
      },
      schema: ControlledAiReviewOutputSchema,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (input.signal?.aborted) throw new Error("OWNER_TASK_ABORTED");

    const blocks = new Map(
      input.content.sections.flatMap((section) =>
        section.blocks.map((block) => [
          block.id,
          { ...block, sectionId: section.id, sectionTitle: section.title },
        ] as const),
      ),
    );
    const seenBlocks = new Set<string>();
    const segments: ProviderTailoringSegment[] = output.rewrites.map((rewrite) => {
      const block = blocks.get(rewrite.sourceBlockId);
      if (!block || seenBlocks.has(rewrite.sourceBlockId)) {
        throw new ServiceError(
          422,
          "AI_SOURCE_BLOCK_INVALID",
          "模型选择了不存在或重复的简历区块。",
        );
      }
      seenBlocks.add(rewrite.sourceBlockId);
      return {
        sourceBlockId: block.id,
        sectionId: block.sectionId,
        sectionTitle: block.sectionTitle,
        originalText: block.text,
        suggestedText: rewrite.suggestedText,
        reason: "基于固定岗位要求和已确认证据生成受控修改稿。",
        requirementIds: rewrite.requirementIds,
        evidenceIds: rewrite.evidenceIds,
      };
    });
    const validated = validateTailoringSegments({
      segments,
      requirementIds: new Set(input.requirements.map((requirement) => requirement.id)),
      evidence,
    });
    const aiDrafts: TemplateReviewDraft[] = validated.map((segment) => ({
      sourceBlockId: segment.sourceBlockId,
      category: "content_relevance",
      severity: "info",
      evidenceIds: segment.evidenceIds,
      requirementIds: segment.requirementIds,
      reasonCode: "CONTROLLED_AI_JOB_EVIDENCE_REWRITE",
      suggestion: {
        changeType: "rewrite_block",
        suggestedText: segment.suggestedText,
        evidenceIds: segment.evidenceIds,
        requirementIds: segment.requirementIds,
      },
    }));
    const aiBlockIds = new Set(aiDrafts.map((draft) => draft.sourceBlockId));
    const deterministicDiagnostics = template()
      .filter(
        (draft) =>
          !aiBlockIds.has(draft.sourceBlockId) &&
          (draft.reasonCode === "REQUIREMENT_EVIDENCE_NOT_LINKED" ||
            draft.reasonCode === "BLOCK_WITHOUT_CONFIRMED_EVIDENCE"),
      )
      .map((draft) => ({ ...draft, suggestion: null }));
    return {
      drafts: [...aiDrafts, ...deterministicDiagnostics].slice(0, 500),
      ...providerMetadata,
      usedTemplateFallback: false,
      fallbackReasonCode: null,
    };
  } catch (error) {
    if (input.signal?.aborted || (error instanceof Error && error.message === "OWNER_TASK_ABORTED")) {
      throw new Error("OWNER_TASK_ABORTED");
    }
    return {
      drafts: template(),
      ...providerMetadata,
      usedTemplateFallback: true,
      fallbackReasonCode: fallbackReasonCode(error),
    };
  }
}

export async function processResumeReviewV2(
  db: Kysely<Database>,
  config: AppConfig,
  owner: OwnerScope,
  reviewRunId: string,
  lease: OwnerTaskLease,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<void> {
  const snapshot = await withOwnerTaskLease(db, lease, async (transaction) => {
    let run = await transaction
      .selectFrom("profile.resume_review_runs")
      .selectAll()
      .where("id", "=", reviewRunId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .forUpdate()
      .executeTakeFirst();
    if (!run || ["completed", "superseded", "deleted"].includes(run.status)) return null;
    if (run.schema_version !== "resume-review-run-v2") {
      throw new Error("RESUME_REVIEW_V2_RUN_REQUIRED");
    }
    if (run.status === "failed") {
      run = await transaction
        .updateTable("profile.resume_review_runs")
        .set({
          status: "pending",
          revision: Number(run.revision) + 1,
          provider_adapter: null,
          model: null,
          used_template_fallback: false,
          fallback_reason_code: null,
          failure_code: null,
          completed_at: null,
          updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
        })
        .where("id", "=", run.id)
        .where("revision", "=", run.revision)
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    const [content, evidenceRevision, requirements] = await Promise.all([
      loadSemanticContent({
        db: transaction,
        owner,
        documentId: run.document_id,
        contentRevisionId: run.content_revision_id,
      }),
      loadEvidenceRevision({
        db: transaction,
        owner,
        evidenceRevisionId: run.evidence_revision_id,
      }),
      loadFixedRequirements(transaction, owner, run),
    ]);
    return {
      runId: run.id,
      mode: run.mode,
      content,
      evidence: evidenceRevision.evidence,
      requirements,
      requirementHash: hashCanonicalJson(requirements),
    };
  });
  if (!snapshot) return;

  let outcome: ReviewV2GenerationOutcome | null = null;
  try {
    const generated = await generateResumeReviewV2({
      config,
      mode: snapshot.mode,
      content: snapshot.content,
      evidence: snapshot.evidence,
      requirements: snapshot.requirements,
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(signal ? { signal } : {}),
    });
    outcome = generated;
    await withOwnerTaskLease(db, lease, async (transaction) => {
      const current = await transaction
        .selectFrom("profile.resume_review_runs")
        .selectAll()
        .where("id", "=", snapshot.runId)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .forUpdate()
        .executeTakeFirst();
      if (!current || ["completed", "superseded", "deleted"].includes(current.status)) return;
      if (current.schema_version !== "resume-review-run-v2" || current.status !== "pending") {
        throw new Error("RESUME_REVIEW_V2_STATE_INVALID");
      }
      const currentRequirements = await loadFixedRequirements(transaction, owner, current);
      if (hashCanonicalJson(currentRequirements) !== snapshot.requirementHash) {
        throw new ServiceError(
          409,
          "RESUME_REVIEW_REQUIREMENT_REFERENCE_INVALID",
          "固定岗位要求在生成期间发生变化，审阅结果未写入。",
        );
      }
      await transaction
        .deleteFrom("profile.resume_review_suggestions")
        .where("owner_id", "=", owner.ownerId)
        .where("review_run_id", "=", current.id)
        .execute();
      await transaction
        .deleteFrom("profile.resume_review_findings")
        .where("owner_id", "=", owner.ownerId)
        .where("review_run_id", "=", current.id)
        .execute();
      for (const draft of generated.drafts) {
        const findingId = randomUUID();
        await transaction
          .insertInto("profile.resume_review_findings")
          .values({
            id: findingId,
            owner_id: owner.ownerId,
            owner_epoch: owner.ownerEpoch,
            review_run_id: current.id,
            schema_version: "resume-review-finding-v2",
            category: draft.category,
            severity: draft.severity,
            source_block_id: draft.sourceBlockId,
            evidence_ids: json(draft.evidenceIds),
            requirement_ids: json(draft.requirementIds),
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
            review_run_id: current.id,
            finding_id: findingId,
            schema_version: "resume-review-suggestion-v2",
            target_type: "block",
            target_ids: json([draft.sourceBlockId]),
            change_type: draft.suggestion.changeType,
            suggested_text: draft.suggestion.suggestedText,
            evidence_ids: json(draft.suggestion.evidenceIds),
            requirement_ids: json(draft.suggestion.requirementIds),
            decision: "pending",
            revision: 1,
          })
          .execute();
      }
      await transaction
        .updateTable("profile.resume_review_runs")
        .set({
          status: "completed",
          revision: Number(current.revision) + 1,
          provider_adapter: generated.providerAdapter,
          model: generated.model,
          used_template_fallback: generated.usedTemplateFallback,
          fallback_reason_code: generated.fallbackReasonCode,
          failure_code: null,
          completed_at: sql<Date>`clock_timestamp()`,
          updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
        })
        .where("id", "=", current.id)
        .where("revision", "=", current.revision)
        .where("status", "=", "pending")
        .executeTakeFirstOrThrow();
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.message === "OWNER_TASK_ABORTED")) {
      throw new Error("OWNER_TASK_ABORTED");
    }
    await withOwnerTaskLease(db, lease, async (transaction) => {
      const current = await transaction
        .selectFrom("profile.resume_review_runs")
        .select(["schema_version", "status", "revision"])
        .where("id", "=", reviewRunId)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .forUpdate()
        .executeTakeFirst();
      if (
        !current ||
        current.schema_version !== "resume-review-run-v2" ||
        current.status !== "pending"
      ) {
        return;
      }
      await transaction
        .updateTable("profile.resume_review_runs")
        .set({
          status: "failed",
          revision: Number(current.revision) + 1,
          provider_adapter: outcome?.providerAdapter ?? null,
          model: outcome?.model ?? null,
          used_template_fallback: outcome?.usedTemplateFallback ?? false,
          fallback_reason_code: outcome?.fallbackReasonCode ?? null,
          failure_code: "RESUME_REVIEW_GENERATION_FAILED",
          completed_at: null,
          updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
        })
        .where("id", "=", reviewRunId)
        .where("revision", "=", current.revision)
        .executeTakeFirstOrThrow();
    });
    throw new Error("RESUME_REVIEW_GENERATION_FAILED");
  }
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
      if (run.schema_version !== "resume-review-run-v1") {
        throw new Error("RESUME_REVIEW_V1_RUN_REQUIRED");
      }
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
        .where("schema_version", "=", "resume-review-run-v1")
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
        "suggestion.requirement_ids",
        "suggestion.schema_version",
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
