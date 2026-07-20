import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  JobRequirementSchema,
  ResumeDocumentSectionSchema,
  ResumeEvidenceSchema,
  type ResumeExport,
  ResumeExportSchema,
  type ResumeTailoringRun,
  ResumeTailoringRunSchema,
  type ResumeTailoringSegment,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import type { Kysely, Selectable, Transaction } from "kysely";
import { z } from "zod";
import { AiProviderError, OpenAiCompatibleProvider } from "../ai/provider.js";
import { STRUCTURED_BLOCK_REWRITE_OUTPUT_INSTRUCTION } from "../ai/selection-contract.js";
import { assertActiveOwnerEpoch } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { lockOwnerIdempotencyKey } from "../lib/idempotency.js";
import { ServiceError } from "../lib/service-error.js";
import type { OwnerContext } from "../matching/service.js";
import {
  decryptResumePayload,
  type EncryptedResumePayload,
  encryptResumePayload,
} from "../resume/crypto.js";
import { createAtsResumeDocx } from "../resume/export-docx.js";
import { redactPersonalInformation } from "../resume/security.js";
import type { OwnerTaskLease } from "../workers/owner-task-lease.js";
import { withOwnerTaskLease } from "../workers/owner-task-lease.js";
import { purgeExpiredResumeExport } from "./export-retention.js";

const PROVIDER_ADAPTER = "openai-compatible-v1";
const TEMPLATE_PROVIDER = "deterministic-template";
const PROMPT_VERSION = "resume-tailoring-block-rewrite-v3";
const SCHEMA_VERSION = "resume-tailoring-block-rewrite-v1";
const TEMPLATE_VERSION = "resume-tailoring-safe-fallback-v2";
const EXPORT_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FrozenExportInputSchema = z.object({
  version: z.literal("resume-export-input-v2"),
  sections: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        heading: z.string().trim().min(1).max(100),
        paragraphs: z.array(z.string().trim().min(1).max(10_000)).min(1).max(500),
      }),
    )
    .min(1)
    .max(100),
});

type DbExecutor = Kysely<Database> | Transaction<Database>;
type TailoringRunRow = Selectable<Database["matching.resume_tailoring_runs"]>;
type TailoringSegmentRow = Selectable<Database["matching.resume_tailoring_segments"]>;

interface TailoringRequestIdentity {
  resumeAnalysisId: string;
  publishedJobVersionId: string;
  evidenceRevisionId: string;
  privacyConsent: true;
}

function tailoringRequestHash(config: AppConfig, request: TailoringRequestIdentity): string {
  return hashCanonicalJson({
    request,
    execution: {
      providerAdapter: config.ai.enabled ? PROVIDER_ADAPTER : TEMPLATE_PROVIDER,
      model: config.ai.enabled ? (config.ai.model ?? "unconfigured") : TEMPLATE_VERSION,
      baseUrl: config.ai.enabled ? (config.ai.baseUrl ?? null) : null,
      apiKeyConfigured: config.ai.enabled ? Boolean(config.ai.apiKey) : false,
      requestTimeoutMs: config.ai.requestTimeoutMs,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      templateVersion: TEMPLATE_VERSION,
      safetyPolicyVersion: "structured-selection-v1",
    },
  });
}

const ProviderSegmentSchema = z.object({
  sourceBlockId: z.string().uuid(),
  sectionId: z.string().uuid(),
  sectionTitle: z.string().trim().min(1).max(100),
  originalText: z.string().trim().min(1).max(10_000),
  suggestedText: z.string().trim().min(1).max(10_000),
  reason: z.string().trim().min(1).max(2_000),
  requirementIds: z.array(z.string().trim().min(1)),
  evidenceIds: z.array(z.string().trim().min(1)),
});

const ProviderRewriteSchema = z.object({
  sourceBlockId: z.string().uuid(),
  suggestedText: z.string().trim().min(1).max(10_000),
  reason: z.string().trim().min(1).max(2_000),
  requirementIds: z.array(z.string().trim().min(1)).min(1),
  evidenceIds: z.array(z.string().trim().min(1)).min(1),
});

const ProviderOutputSchema = z.object({
  rewrites: z.array(ProviderRewriteSchema).min(1).max(100),
});

export type ProviderTailoringSegment = z.infer<typeof ProviderSegmentSchema>;

function json(value: unknown): JsonValue {
  return JSON.stringify(value) as JsonValue;
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toIso(value: unknown): string | null {
  if (value === null) return null;
  return asDate(value).toISOString();
}

function numericClaims(text: string): Set<string> {
  const claims = new Set<string>();
  for (const match of text
    .normalize("NFKC")
    .matchAll(
      /(?<![\d.])(\d+(?:\.\d+)?)\s*(百分点|小时|分钟|%|人|次|个|天|周|月|年|元|万|亿|家|项|篇|字|条|倍)?(?![\d.])/g,
    )) {
    claims.add(`${match[1]}${match[2] ?? ""}`);
  }
  return claims;
}

const PROTECTED_SKILL_TERMS = [
  "SQL",
  "Python",
  "Java",
  "JavaScript",
  "TypeScript",
  "Excel",
  "Tableau",
  "Power BI",
  "Axure",
  "Figma",
  "Photoshop",
  "数据分析",
  "用户研究",
  "需求分析",
  "项目管理",
  "竞品分析",
  "A/B测试",
  "A/B 测试",
] as const;

const PROTECTED_RESULT_TERMS = [
  "提升",
  "增长",
  "降低",
  "减少",
  "节省",
  "转化率",
  "留存率",
  "营收",
  "收入",
  "GMV",
  "ROI",
  "达成",
  "超额",
  "翻倍",
] as const;

function normalizedClaimText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

function unsupportedFactualClaims(suggestedText: string, evidenceText: string): string[] {
  const suggested = normalizedClaimText(suggestedText);
  const evidence = normalizedClaimText(evidenceText);
  const protectedClaims = new Set<string>();

  for (const token of suggestedText.match(/[A-Za-z][A-Za-z0-9.+#/_-]{1,}/g) ?? []) {
    protectedClaims.add(token);
  }
  for (const term of [...PROTECTED_SKILL_TERMS, ...PROTECTED_RESULT_TERMS]) {
    if (suggested.includes(normalizedClaimText(term))) protectedClaims.add(term);
  }
  for (const match of suggestedText.matchAll(
    /[\p{Script=Han}A-Za-z0-9]{2,}(?:公司|集团|研究院|实验室|项目|平台|系统|产品|小程序|公众号|应用)/gu,
  )) {
    protectedClaims.add(match[0]);
  }

  return [...protectedClaims].filter((claim) => !evidence.includes(normalizedClaimText(claim)));
}

export function validateTailoringSegments(input: {
  segments: ProviderTailoringSegment[];
  requirementIds: Set<string>;
  evidence: Array<{
    id: string;
    sourceBlockId: string;
    statement: string;
    skills?: string[];
    outcomes?: string[];
  }>;
}): ProviderTailoringSegment[] {
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const seenBlocks = new Set<string>();

  for (const segment of input.segments) {
    if (seenBlocks.has(segment.sourceBlockId)) {
      throw new ServiceError(422, "AI_SOURCE_BLOCK_DUPLICATE", "模型重复改写了同一个简历区块。");
    }
    seenBlocks.add(segment.sourceBlockId);
    const unchanged = segment.suggestedText.trim() === segment.originalText.trim();
    if (unchanged && segment.requirementIds.length === 0 && segment.evidenceIds.length === 0) {
      continue;
    }
    if (unchanged) {
      throw new ServiceError(422, "AI_REWRITE_UNCHANGED", "模型没有为所选区块返回真实修改稿。");
    }
    if (segment.requirementIds.length === 0 || segment.evidenceIds.length === 0) {
      throw new ServiceError(422, "AI_REWRITE_UNCITED", "模型修改稿缺少岗位要求或经历证据引用。");
    }
    if (segment.requirementIds.some((id) => !input.requirementIds.has(id))) {
      throw new ServiceError(
        422,
        "AI_REQUIREMENT_REFERENCE_INVALID",
        "模型建议引用了不存在的岗位要求。",
      );
    }
    const referencedEvidence = segment.evidenceIds.map((id) => {
      const item = evidenceById.get(id);
      if (item === undefined) {
        throw new ServiceError(
          422,
          "AI_EVIDENCE_REFERENCE_INVALID",
          "模型建议引用了不存在或未确认的简历证据。",
        );
      }
      return {
        id,
        sourceBlockId: item.sourceBlockId,
        factualText: [item.statement, ...(item.skills ?? []), ...(item.outcomes ?? [])].join(" "),
      };
    });
    if (!referencedEvidence.some((item) => item.sourceBlockId === segment.sourceBlockId)) {
      throw new ServiceError(
        422,
        "AI_SOURCE_BLOCK_UNTRACEABLE",
        "模型修改稿无法回指该区块内的已确认原子证据。",
      );
    }
    const evidenceText = referencedEvidence.map((item) => item.factualText).join(" ");
    const allowedNumbers = numericClaims(evidenceText);
    const suggestedNumbers = numericClaims(segment.suggestedText);
    if ([...suggestedNumbers].some((value) => !allowedNumbers.has(value))) {
      throw new ServiceError(
        422,
        "AI_UNSUPPORTED_NUMERIC_CLAIM",
        "模型建议加入了简历证据中不存在的数字，已拒绝展示。",
      );
    }
    const unsupportedClaims = unsupportedFactualClaims(segment.suggestedText, evidenceText);
    if (unsupportedClaims.length > 0) {
      throw new ServiceError(
        422,
        "AI_UNSUPPORTED_FACTUAL_CLAIM",
        "模型建议加入了简历证据中不存在的技能、主体、项目或结果，已拒绝展示。",
      );
    }
  }
  return input.segments;
}

export function createTemplateTailoringSegments(input: {
  requirements: Array<z.infer<typeof JobRequirementSchema>>;
  evidence: Array<z.infer<typeof ResumeEvidenceSchema>>;
  sections: Array<z.infer<typeof ResumeDocumentSectionSchema>>;
}): ProviderTailoringSegment[] {
  const expressiveRequirements = input.requirements.filter(({ kind }) =>
    ["skill", "experience", "other"].includes(kind),
  );
  const firstExpressiveRequirement =
    expressiveRequirements.find(({ necessity }) => necessity === "required") ??
    expressiveRequirements[0];
  if (input.sections.length === 0) {
    throw new ServiceError(422, "TAILORING_NEEDS_DOCUMENT", "请先确认包含有序区块的简历文档。");
  }
  const evidenceByBlock = new Map(
    input.evidence.map((item) => [item.sourceBlockId, item] as const),
  );
  return input.sections.flatMap((section) =>
    section.blocks.map((block) => {
      const evidence = evidenceByBlock.get(block.id);
      const requirement = evidence
        ? (expressiveRequirements.find((candidate) => {
            const terms = Array.isArray(candidate.expectedValue)
              ? candidate.expectedValue
              : [candidate.expectedValue];
            return terms.some(
              (value) => typeof value === "string" && evidence.statement.includes(value),
            );
          }) ?? firstExpressiveRequirement)
        : undefined;
      return {
        sourceBlockId: block.id,
        sectionId: section.id,
        sectionTitle: section.title,
        originalText: block.text,
        suggestedText: block.text,
        reason: evidence
          ? "固定模板不改写事实，只保留已确认区块供你对照岗位原句人工编辑。"
          : "该区块没有被选为经历证据，按原章节与原顺序保留。",
        requirementIds: requirement ? [requirement.id] : [],
        evidenceIds: evidence ? [evidence.id] : [],
      };
    }),
  );
}

export function renderStructuredTailoringRewrites(input: {
  rewrites: Array<z.infer<typeof ProviderRewriteSchema>>;
  requirements: Array<z.infer<typeof JobRequirementSchema>>;
  evidence: Array<z.infer<typeof ResumeEvidenceSchema>>;
  sections: Array<z.infer<typeof ResumeDocumentSectionSchema>>;
}): ProviderTailoringSegment[] {
  const requirementIds = new Set(input.requirements.map(({ id }) => id));
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const blocks = input.sections.flatMap((section) =>
    section.blocks.map((block) => ({
      ...block,
      sectionId: section.id,
      sectionTitle: section.title,
    })),
  );
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const rewriteByBlock = new Map<string, z.infer<typeof ProviderRewriteSchema>>();
  for (const rewrite of input.rewrites) {
    if (rewriteByBlock.has(rewrite.sourceBlockId) || !blockById.has(rewrite.sourceBlockId)) {
      throw new ServiceError(422, "AI_SOURCE_BLOCK_INVALID", "模型选择了不存在或重复的简历区块。");
    }
    if (rewrite.requirementIds.some((id) => !requirementIds.has(id))) {
      throw new ServiceError(
        422,
        "AI_REQUIREMENT_REFERENCE_INVALID",
        "模型选择了不存在的岗位要求。",
      );
    }
    if (rewrite.evidenceIds.some((id) => !evidenceById.has(id))) {
      throw new ServiceError(422, "AI_EVIDENCE_REFERENCE_INVALID", "模型引用了不存在的经历证据。");
    }
    rewriteByBlock.set(rewrite.sourceBlockId, rewrite);
  }

  const segments = blocks.map((block) => {
    const rewrite = rewriteByBlock.get(block.id);
    return {
      sourceBlockId: block.id,
      sectionId: block.sectionId,
      sectionTitle: block.sectionTitle,
      originalText: block.text,
      suggestedText: rewrite?.suggestedText ?? block.text,
      reason: rewrite?.reason ?? "该区块未被模型选择，按原章节与原顺序保留。",
      requirementIds: rewrite?.requirementIds ?? [],
      evidenceIds: rewrite?.evidenceIds ?? [],
    };
  });

  return validateTailoringSegments({
    segments,
    requirementIds,
    evidence: input.evidence,
  });
}

async function tailoringInputs(db: DbExecutor, run: TailoringRunRow) {
  if (!run.resume_document_revision_id) {
    throw new ServiceError(
      409,
      "LEGACY_TAILORING_READ_ONLY",
      "旧版简历优化只保留历史读取，不能重新生成。",
    );
  }
  const [requirementSet, evidenceRevision, documentRevision] = await Promise.all([
    db
      .selectFrom("catalog.job_requirement_sets")
      .selectAll()
      .where("id", "=", run.requirement_set_id)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("profile.resume_evidence_revisions")
      .selectAll()
      .where("id", "=", run.evidence_revision_id)
      .where("owner_id", "=", run.owner_id)
      .where("owner_epoch", "=", run.owner_epoch)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("profile.resume_document_revisions")
      .selectAll()
      .where("id", "=", run.resume_document_revision_id)
      .where("owner_id", "=", run.owner_id)
      .where("owner_epoch", "=", run.owner_epoch)
      .executeTakeFirstOrThrow(),
  ]);
  if (
    evidenceRevision.schema_version !== "resume-evidence-v2" ||
    evidenceRevision.document_revision_id !== documentRevision.id
  ) {
    throw new ServiceError(409, "TAILORING_DOCUMENT_MISMATCH", "简历文档与原子证据修订不一致。");
  }
  const requirements = JobRequirementSchema.array().parse(requirementSet.requirements);
  const evidence = ResumeEvidenceSchema.array().parse(evidenceRevision.evidence);
  const sections = ResumeDocumentSectionSchema.array().parse(documentRevision.sections);
  return { requirements, evidence, sections };
}

async function generateSegments(input: {
  config: AppConfig;
  requirements: Array<z.infer<typeof JobRequirementSchema>>;
  evidence: Array<z.infer<typeof ResumeEvidenceSchema>>;
  sections: Array<z.infer<typeof ResumeDocumentSectionSchema>>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ segments: ProviderTailoringSegment[]; usedTemplateFallback: boolean }> {
  const fallback = () => ({
    segments: createTemplateTailoringSegments({
      requirements: input.requirements,
      evidence: input.evidence,
      sections: input.sections,
    }),
    usedTemplateFallback: true,
  });
  if (!input.config.ai.enabled) return fallback();

  const redactedEvidence = input.evidence.map((item) => ({
    id: item.id,
    resumeAnalysisId: item.resumeAnalysisId,
    section: redactPersonalInformation(item.section).redactedText,
    sourceBlockId: item.sourceBlockId,
    evidenceType: item.evidenceType,
    statement: redactPersonalInformation(item.statement).redactedText,
    skills: item.skills.map((skill) => redactPersonalInformation(skill).redactedText),
    outcomes: item.outcomes.map((outcome) => redactPersonalInformation(outcome).redactedText),
    confirmed: true as const,
  }));
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
  const providerInput = {
    requirements: input.requirements.map((requirement) => ({
      id: requirement.id,
      sourceText: requirement.sourceText,
      kind: requirement.kind,
      expectedValue: requirement.expectedValue,
      necessity: requirement.necessity,
    })),
    confirmedEvidence: redactedEvidence,
    sourceBlocks: input.sections.flatMap((section) =>
      section.blocks.map((block) => ({
        sourceBlockId: block.id,
        section: section.title,
        text: redactPersonalInformation(block.text).redactedText,
      })),
    ),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const output = await provider.completeStructured({
        systemInstruction:
          "你是简历区块改写器。每条输出只能针对一个 sourceBlockId 返回真实 suggestedText、reason、岗位要求 ID 和证据 ID。" +
          "只能重组该区块及其已确认证据中的事实，不得新增数字、技能、主体、项目或结果；不需要修改的区块不要输出。" +
          "不得修改资格结论，也不得输出未提供的 ID。" +
          STRUCTURED_BLOCK_REWRITE_OUTPUT_INSTRUCTION,
        untrustedPayload: providerInput,
        schema: ProviderOutputSchema,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      return {
        segments: renderStructuredTailoringRewrites({
          rewrites: output.rewrites,
          requirements: input.requirements,
          evidence: redactedEvidence,
          sections: input.sections,
        }),
        usedTemplateFallback: false,
      };
    } catch (error) {
      if (
        attempt === 1 ||
        (!(error instanceof AiProviderError) && !(error instanceof ServiceError))
      ) {
        break;
      }
    }
  }
  return fallback();
}

function mapSegment(row: TailoringSegmentRow): ResumeTailoringSegment {
  return {
    id: row.id,
    ordinal: row.ordinal,
    sourceBlockId: row.source_block_id ?? row.id,
    sectionId: row.section_id ?? row.id,
    sectionTitle: row.section_title ?? "旧版简历内容",
    originalText: row.original_text,
    suggestedText: row.suggested_text,
    reason: row.reason,
    requirementIds: z.array(z.string()).parse(row.requirement_ids),
    evidenceIds: z.array(z.string()).parse(row.evidence_ids),
    decision: row.decision as ResumeTailoringSegment["decision"],
    editedText: row.edited_text,
  };
}

async function segmentsForRun(db: DbExecutor, runId: string): Promise<ResumeTailoringSegment[]> {
  const rows = await db
    .selectFrom("matching.resume_tailoring_segments")
    .selectAll()
    .where("tailoring_run_id", "=", runId)
    .orderBy("ordinal", "asc")
    .execute();
  return rows.map(mapSegment);
}

async function mapRun(db: DbExecutor, row: TailoringRunRow): Promise<ResumeTailoringRun> {
  let segments = await segmentsForRun(db, row.id);
  if (row.resume_document_revision_id) {
    try {
      const inputs = await tailoringInputs(db, row);
      const requirements = new Map(inputs.requirements.map((item) => [item.id, item]));
      const evidence = new Map(inputs.evidence.map((item) => [item.id, item]));
      segments = segments.map((segment) => ({
        ...segment,
        requirementCitations: segment.requirementIds.flatMap((id) => {
          const item = requirements.get(id);
          return item ? [{ id, sourceText: item.sourceText, necessity: item.necessity }] : [];
        }),
        evidenceCitations: segment.evidenceIds.flatMap((id) => {
          const item = evidence.get(id);
          return item ? [{ id, statement: item.statement }] : [];
        }),
      }));
    } catch {
      // Historical runs remain readable even when their source revisions are legacy-only.
    }
  }
  return ResumeTailoringRunSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    status: row.status,
    resumeAnalysisId: row.resume_analysis_id,
    publishedJobVersionId: row.published_job_version_id,
    requirementSetId: row.requirement_set_id,
    evidenceRevisionId: row.evidence_revision_id,
    usedTemplateFallback: row.used_template_fallback,
    segments,
    failureCode: row.failure_code,
    createdAt: toIso(row.created_at),
    completedAt: toIso(row.completed_at),
  });
}

export async function enqueueTailoringRun(
  db: Kysely<Database>,
  config: AppConfig,
  owner: OwnerContext,
  request: TailoringRequestIdentity,
  idempotencyKey: string,
): Promise<ResumeTailoringRun> {
  if (!idempotencyKey.trim()) {
    throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "创建简历优化任务时必须提供幂等键。");
  }
  const requestHash = tailoringRequestHash(config, request);
  const row = await db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: owner.ownerId,
      scope: "resume-tailoring-run",
      idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, owner.ownerId, owner.ownerEpoch);
    const previous = await transaction
      .selectFrom("matching.resume_tailoring_runs")
      .selectAll()
      .where("owner_id", "=", owner.ownerId)
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
    if (previous) {
      if (previous.request_hash !== requestHash) {
        throw new ServiceError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "同一个幂等键不能用于不同的简历优化请求。",
        );
      }
      return previous;
    }

    const [analysis, evidenceRevision, requirementSet] = await Promise.all([
      transaction
        .selectFrom("profile.resume_analyses")
        .select(["id", "status"])
        .where("id", "=", request.resumeAnalysisId)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .executeTakeFirst(),
      transaction
        .selectFrom("profile.resume_evidence_revisions")
        .select(["id", "resume_analysis_id", "schema_version", "document_revision_id"])
        .where("id", "=", request.evidenceRevisionId)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .executeTakeFirst(),
      transaction
        .selectFrom("catalog.published_job_versions as version")
        .innerJoin(
          "catalog.job_requirement_sets as requirements",
          "requirements.id",
          "version.active_requirement_set_id",
        )
        .selectAll("requirements")
        .where("version.id", "=", request.publishedJobVersionId)
        .executeTakeFirst(),
    ]);
    if (!analysis || analysis.status !== "succeeded") {
      throw new ServiceError(422, "RESUME_ANALYSIS_NOT_READY", "简历尚未完成解析和确认。");
    }
    if (
      !evidenceRevision ||
      evidenceRevision.resume_analysis_id !== analysis.id ||
      evidenceRevision.schema_version !== "resume-evidence-v2" ||
      !evidenceRevision.document_revision_id
    ) {
      throw new ServiceError(
        422,
        "EVIDENCE_REVISION_MISMATCH",
        "请选择由当前简历确认得到的证据修订。",
      );
    }
    if (!requirementSet) {
      throw new ServiceError(422, "JOB_REQUIREMENTS_NOT_READY", "岗位要求尚未完成拆解。");
    }

    const id = randomUUID();
    const created = await transaction
      .insertInto("matching.resume_tailoring_runs")
      .values({
        id,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        resume_analysis_id: request.resumeAnalysisId,
        resume_document_revision_id: evidenceRevision.document_revision_id,
        published_job_version_id: request.publishedJobVersionId,
        requirement_set_id: requirementSet.id,
        evidence_revision_id: request.evidenceRevisionId,
        provider_adapter: config.ai.enabled ? PROVIDER_ADAPTER : TEMPLATE_PROVIDER,
        model: config.ai.enabled ? (config.ai.model ?? "unconfigured") : TEMPLATE_VERSION,
        prompt_version: PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
        template_version: TEMPLATE_VERSION,
        privacy_consent_at: new Date(),
        used_template_fallback: !config.ai.enabled,
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
        task_type: "resume_tailoring",
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        payload: json({ runId: id }),
        idempotency_key: `owner:${owner.ownerId}:tailoring:${idempotencyKey}`,
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
    return created;
  });
  return mapRun(db, row);
}

export async function getTailoringRun(
  db: Kysely<Database>,
  owner: OwnerContext,
  runId: string,
): Promise<ResumeTailoringRun | null> {
  const row = await db
    .selectFrom("matching.resume_tailoring_runs")
    .selectAll()
    .where("id", "=", runId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .executeTakeFirst();
  return row ? mapRun(db, row) : null;
}

export async function processTailoringRun(
  db: Kysely<Database>,
  config: AppConfig,
  owner: OwnerContext,
  runId: string,
  lease: OwnerTaskLease,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<void> {
  const run = await withOwnerTaskLease(db, lease, async (transaction) => {
    const current = await transaction
      .selectFrom("matching.resume_tailoring_runs")
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
      .updateTable("matching.resume_tailoring_runs")
      .set({ status: "processing" })
      .where("id", "=", current.id)
      .executeTakeFirstOrThrow();
    return current;
  });
  if (!run || run.status === "deleted" || run.status === "succeeded") return;
  try {
    const inputs = await tailoringInputs(db, run);
    if (!run.resume_analysis_id) {
      throw new ServiceError(409, "LEGACY_TAILORING_READ_ONLY", "旧版简历优化不能重新生成。");
    }
    if (signal?.aborted) throw new Error("OWNER_TASK_ABORTED");
    await withOwnerTaskLease(db, lease, async () => undefined);
    if (signal?.aborted) throw new Error("OWNER_TASK_ABORTED");
    const executionConfig =
      run.request_hash ===
      tailoringRequestHash(config, {
        resumeAnalysisId: run.resume_analysis_id,
        publishedJobVersionId: run.published_job_version_id,
        evidenceRevisionId: run.evidence_revision_id,
        privacyConsent: true,
      })
        ? config
        : { ...config, ai: { ...config.ai, enabled: false } };
    const generated = await generateSegments({
      config: executionConfig,
      ...inputs,
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(signal ? { signal } : {}),
    });
    await withOwnerTaskLease(db, lease, async (transaction) => {
      await transaction
        .deleteFrom("matching.resume_tailoring_segments")
        .where("tailoring_run_id", "=", run.id)
        .execute();
      await transaction
        .insertInto("matching.resume_tailoring_segments")
        .values(
          generated.segments.map((segment, ordinal) => ({
            id: randomUUID(),
            tailoring_run_id: run.id,
            ordinal,
            original_text: segment.originalText,
            source_block_id: segment.sourceBlockId,
            section_id: segment.sectionId,
            section_title: segment.sectionTitle,
            suggested_text: segment.suggestedText,
            reason: segment.reason,
            requirement_ids: json(segment.requirementIds),
            evidence_ids: json(segment.evidenceIds),
            decision: "pending",
            edited_text: null,
            updated_at: new Date(),
          })),
        )
        .execute();
      await transaction
        .updateTable("matching.resume_tailoring_runs")
        .set({
          status: "succeeded",
          used_template_fallback: generated.usedTemplateFallback,
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
        .updateTable("matching.resume_tailoring_runs")
        .set({
          status: "failed",
          failure_code: error instanceof ServiceError ? error.code : "TAILORING_PROCESSING_FAILED",
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

export async function updateTailoringSegment(
  db: Kysely<Database>,
  owner: OwnerContext,
  runId: string,
  segmentId: string,
  input:
    | { decision: "accepted" }
    | { decision: "rejected" }
    | { decision: "edited"; editedText: string },
): Promise<ResumeTailoringSegment> {
  const segment = await db.transaction().execute(async (transaction) => {
    await assertActiveOwnerEpoch(transaction, owner.ownerId, owner.ownerEpoch);
    return transaction
      .updateTable("matching.resume_tailoring_segments")
      .set({
        decision: input.decision,
        edited_text: input.decision === "edited" ? input.editedText : null,
        updated_at: new Date(),
      })
      .where("id", "=", segmentId)
      .where("tailoring_run_id", "=", runId)
      .where(({ exists, selectFrom }) =>
        exists(
          selectFrom("matching.resume_tailoring_runs")
            .select("id")
            .whereRef("id", "=", "matching.resume_tailoring_segments.tailoring_run_id")
            .where("owner_id", "=", owner.ownerId)
            .where("owner_epoch", "=", owner.ownerEpoch),
        ),
      )
      .returningAll()
      .executeTakeFirst();
  });
  if (!segment) {
    throw new ServiceError(404, "TAILORING_SEGMENT_NOT_FOUND", "没有找到该简历建议片段。");
  }
  return mapSegment(segment);
}

function mapExport(row: Selectable<Database["matching.resume_exports"]>): ResumeExport {
  return ResumeExportSchema.parse({
    id: row.id,
    tailoringRunId: row.tailoring_run_id,
    status: row.status,
    mediaType: row.media_type,
    fileName: row.file_name,
    byteSize: row.byte_size,
    expiresAt: toIso(row.expires_at),
    failureCode: row.failure_code,
    createdAt: toIso(row.created_at),
    completedAt: toIso(row.completed_at),
  });
}

export async function enqueueResumeExport(
  db: Kysely<Database>,
  config: AppConfig,
  owner: OwnerContext,
  runId: string,
  idempotencyKey: string,
): Promise<ResumeExport> {
  if (!idempotencyKey.trim()) {
    throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "创建导出任务时必须提供幂等键。");
  }
  const row = await db.transaction().execute(async (transaction) => {
    await assertActiveOwnerEpoch(transaction, owner.ownerId, owner.ownerEpoch);
    const run = await transaction
      .selectFrom("matching.resume_tailoring_runs")
      .select(["id", "status"])
      .where("id", "=", runId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .executeTakeFirst();
    if (!run || run.status !== "succeeded") {
      throw new ServiceError(422, "TAILORING_NOT_READY", "简历建议尚未生成完成。");
    }
    const previousTask = await transaction
      .selectFrom("task_queue.tasks")
      .select("payload")
      .where("idempotency_key", "=", `owner:${owner.ownerId}:export:${runId}:${idempotencyKey}`)
      .executeTakeFirst();
    if (previousTask) {
      const exportId = z.object({ exportId: z.string() }).parse(previousTask.payload).exportId;
      return transaction
        .selectFrom("matching.resume_exports")
        .selectAll()
        .where("id", "=", exportId)
        .where("owner_id", "=", owner.ownerId)
        .executeTakeFirstOrThrow();
    }
    const segments = await segmentsForRun(transaction, runId);
    const sectionMap = new Map<string, { id: string; heading: string; paragraphs: string[] }>();
    for (const segment of segments) {
      const section = sectionMap.get(segment.sectionId) ?? {
        id: segment.sectionId,
        heading: segment.sectionTitle,
        paragraphs: [],
      };
      section.paragraphs.push(
        segment.decision === "edited"
          ? (segment.editedText as string)
          : segment.decision === "accepted"
            ? segment.suggestedText
            : segment.originalText,
      );
      sectionMap.set(segment.sectionId, section);
    }
    const frozenInput = FrozenExportInputSchema.parse({
      version: "resume-export-input-v2",
      sections: [...sectionMap.values()],
    });
    const encryptedInput = encryptResumePayload(
      Buffer.from(JSON.stringify(frozenInput), "utf8"),
      config.resumeEncryptionKey,
    );
    const exportId = randomUUID();
    const created = await transaction
      .insertInto("matching.resume_exports")
      .values({
        id: exportId,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        tailoring_run_id: runId,
        status: "queued",
        file_name: "Aijob-岗位定向简历.docx",
        media_type: EXPORT_MEDIA_TYPE,
        byte_size: null,
        encryption_key_version: "local-v1",
        ciphertext: encryptedInput.ciphertext,
        nonce: encryptedInput.initializationVector,
        auth_tag: encryptedInput.authenticationTag,
        failure_code: null,
        completed_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto("task_queue.tasks")
      .values({
        id: randomUUID(),
        task_type: "resume_export",
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        payload: json({ exportId }),
        idempotency_key: `owner:${owner.ownerId}:export:${runId}:${idempotencyKey}`,
        status: "queued",
        attempt: 0,
        max_attempts: 2,
        available_at: new Date(),
        backoff_policy: json({ kind: "fixed", seconds: 1 }),
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
  return mapExport(row);
}

export async function getResumeExport(
  db: Kysely<Database>,
  owner: OwnerContext,
  exportId: string,
): Promise<ResumeExport | null> {
  const now = new Date();
  await purgeExpiredResumeExport({
    db,
    ownerId: owner.ownerId,
    exportId,
    now,
  });
  const row = await db
    .selectFrom("matching.resume_exports")
    .selectAll()
    .where("id", "=", exportId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .executeTakeFirst();
  return row ? mapExport(row) : null;
}

export async function processResumeExport(
  db: Kysely<Database>,
  config: AppConfig,
  owner: OwnerContext,
  exportId: string,
  lease: OwnerTaskLease,
  clock: () => Date = () => new Date(),
): Promise<void> {
  const expireWithinLease = async (
    transaction: Transaction<Database>,
    expiredAt: Date,
  ): Promise<void> => {
    await transaction
      .updateTable("task_queue.tasks")
      .set({
        status: "dead",
        lease_owner: null,
        lease_until: null,
        heartbeat_at: expiredAt,
        last_error_code: "RESUME_EXPORT_EXPIRED",
        last_error_summary: null,
        completed_at: expiredAt,
      })
      .where("id", "=", lease.taskId)
      .where("lease_owner", "=", lease.leaseOwner)
      .where("fencing_token", "=", lease.fencingToken)
      .where("status", "=", "running")
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("matching.resume_exports")
      .set({
        status: "deleted",
        byte_size: null,
        ciphertext: null,
        nonce: null,
        auth_tag: null,
        failure_code: "RESUME_EXPORT_EXPIRED",
        completed_at: expiredAt,
      })
      .where("id", "=", exportId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .executeTakeFirstOrThrow();
  };

  const startedAt = clock();
  const row = await withOwnerTaskLease(db, lease, async (transaction) => {
    const current = await transaction
      .selectFrom("matching.resume_exports")
      .selectAll()
      .where("id", "=", exportId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .forUpdate()
      .executeTakeFirst();
    if (!current) return null;
    if (new Date(current.expires_at).getTime() <= startedAt.getTime()) {
      await expireWithinLease(transaction, startedAt);
      return null;
    }
    if (current.status === "deleted" || current.status === "succeeded") {
      return current;
    }
    await transaction
      .updateTable("matching.resume_exports")
      .set({ status: "processing" })
      .where("id", "=", current.id)
      .executeTakeFirstOrThrow();
    return current;
  });
  if (!row || row.status === "deleted" || row.status === "succeeded") return;
  try {
    if (!row.ciphertext || !row.nonce || !row.auth_tag) {
      throw new ServiceError(
        422,
        "RESUME_EXPORT_INPUT_MISSING",
        "导出任务缺少已冻结的最终文本，请重新创建导出。",
      );
    }
    const frozenInput = FrozenExportInputSchema.parse(
      JSON.parse(
        decryptResumePayload(
          {
            ciphertext: Buffer.from(row.ciphertext),
            initializationVector: Buffer.from(row.nonce),
            authenticationTag: Buffer.from(row.auth_tag),
          },
          config.resumeEncryptionKey,
        ).toString("utf8"),
      ),
    );
    const buffer = await createAtsResumeDocx({
      title: "岗位定向简历",
      sections: frozenInput.sections,
    });
    const encrypted = encryptResumePayload(buffer, config.resumeEncryptionKey);
    const completedAt = clock();
    const stored = await withOwnerTaskLease(db, lease, async (transaction) => {
      const current = await transaction
        .selectFrom("matching.resume_exports")
        .select(["expires_at", "status"])
        .where("id", "=", exportId)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .forUpdate()
        .executeTakeFirst();
      if (!current || current.status === "deleted") return false;
      if (new Date(current.expires_at).getTime() <= completedAt.getTime()) {
        await expireWithinLease(transaction, completedAt);
        return false;
      }
      await transaction
        .updateTable("matching.resume_exports")
        .set({
          status: "succeeded",
          byte_size: buffer.byteLength,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.initializationVector,
          auth_tag: encrypted.authenticationTag,
          failure_code: null,
          completed_at: completedAt,
        })
        .where("id", "=", exportId)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("status", "=", "processing")
        .executeTakeFirstOrThrow();
      return true;
    });
    if (!stored) return;
  } catch (error) {
    const failedAt = clock();
    await withOwnerTaskLease(db, lease, async (transaction) => {
      const current = await transaction
        .selectFrom("matching.resume_exports")
        .select(["expires_at", "status"])
        .where("id", "=", exportId)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .forUpdate()
        .executeTakeFirst();
      if (!current || current.status === "deleted") return;
      if (new Date(current.expires_at).getTime() <= failedAt.getTime()) {
        await expireWithinLease(transaction, failedAt);
        return;
      }
      await transaction
        .updateTable("matching.resume_exports")
        .set({
          status: "failed",
          failure_code: "RESUME_EXPORT_FAILED",
          completed_at: failedAt,
        })
        .where("id", "=", exportId)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("status", "=", "processing")
        .execute();
    });
    throw error;
  }
}

export async function downloadResumeExport(
  db: Kysely<Database>,
  config: AppConfig,
  owner: OwnerContext,
  exportId: string,
): Promise<{ fileName: string; mediaType: string; buffer: Buffer } | null> {
  const now = new Date();
  await purgeExpiredResumeExport({
    db,
    ownerId: owner.ownerId,
    exportId,
    now,
  });
  const row = await db
    .selectFrom("matching.resume_exports")
    .selectAll()
    .where("id", "=", exportId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("status", "=", "succeeded")
    .where("expires_at", ">", now)
    .executeTakeFirst();
  if (!row || !row.ciphertext || !row.nonce || !row.auth_tag) return null;
  const encrypted: Pick<
    EncryptedResumePayload,
    "ciphertext" | "initializationVector" | "authenticationTag"
  > = {
    ciphertext: Buffer.from(row.ciphertext),
    initializationVector: Buffer.from(row.nonce),
    authenticationTag: Buffer.from(row.auth_tag),
  };
  return {
    fileName: row.file_name,
    mediaType: row.media_type,
    buffer: decryptResumePayload(encrypted, config.resumeEncryptionKey),
  };
}
