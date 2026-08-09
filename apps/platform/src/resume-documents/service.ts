import { randomUUID } from "node:crypto";
import {
  type CreateResumeDocumentRequest,
  type CreateResumeDocumentResponse,
  CreateResumeDocumentResponseSchema,
  type LegacyResumeDocumentSourceSummary,
  LegacyResumeDocumentSourceSummarySchema,
  type ListResumeDocumentsQuery,
  type ListResumeDocumentsResponse,
  ListResumeDocumentsResponseSchema,
  type ResumeDocument,
  ResumeDocumentCursorSchema,
  ResumeDocumentSchema,
  ResumeEvidenceRevisionSchema,
  ResumeLayoutSettingsSchema,
  ResumeSemanticContentRevisionSchema,
  ResumeTemplateKeySchema,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { z } from "zod";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { lockOwnerIdempotencyKey } from "../lib/idempotency.js";
import { ServiceError } from "../lib/service-error.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

interface ResumeDocumentReadRow {
  id: string;
  owner_id: string;
  owner_epoch: number;
  kind: string;
  title: string;
  case_id: string | null;
  detached_from_case_id: string | null;
  job_context_kind: string | null;
  published_job_id: string | null;
  published_job_version_id: string | null;
  requirement_set_id: string | null;
  private_job_snapshot_id: string | null;
  job_context_revision: number | null;
  base_document_id: string | null;
  base_document_revision_id: string | null;
  evidence_revision_id: string | null;
  current_content_revision_id: string | null;
  current_layout_revision_id: string | null;
  revision: number;
  expires_at: Date | null;
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

interface CaseReferenceRow {
  id: string;
  job_context_kind: string;
  published_job_id: string | null;
  published_job_version_id: string | null;
  requirement_set_id: string | null;
  private_job_snapshot_id: string | null;
  job_context_revision: number;
  revision: number;
}

const CursorEnvelopeSchema = z
  .object({
    version: z.literal(1),
    query: z.string().regex(/^[a-f0-9]{16}$/),
    position: ResumeDocumentCursorSchema,
  })
  .strict();

const DefaultLayoutSettings = ResumeLayoutSettingsSchema.parse({
  schemaVersion: "resume-layout-settings-v1",
  fontSizeToken: "standard",
  lineSpacingToken: "standard",
  sectionSpacingToken: "standard",
  colorToken: "charcoal",
  pageBreakPolicy: "keep_sections",
});

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

function documentReadQuery(db: DbExecutor) {
  return db
    .selectFrom("profile.resume_documents as document")
    .leftJoin(
      "catalog.published_job_versions as public_version",
      "public_version.id",
      "document.published_job_version_id",
    )
    .leftJoin("application.private_job_snapshot_revisions as private_revision", (join) =>
      join
        .onRef("private_revision.owner_id", "=", "document.owner_id")
        .onRef("private_revision.snapshot_id", "=", "document.private_job_snapshot_id")
        .onRef("private_revision.content_revision", "=", "document.job_context_revision"),
    )
    .select([
      "document.id",
      "document.owner_id",
      "document.owner_epoch",
      "document.kind",
      "document.title",
      "document.case_id",
      "document.detached_from_case_id",
      "document.job_context_kind",
      "document.published_job_id",
      "document.published_job_version_id",
      "document.requirement_set_id",
      "document.private_job_snapshot_id",
      "document.job_context_revision",
      "document.base_document_id",
      "document.base_document_revision_id",
      "document.evidence_revision_id",
      "document.current_content_revision_id",
      "document.current_layout_revision_id",
      "document.revision",
      "document.expires_at",
      "document.deleted_at",
      "document.created_at",
      "document.updated_at",
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

function mapResumeDocument(row: ResumeDocumentReadRow): ResumeDocument {
  const common = {
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    title: row.title,
    revision: Number(row.revision),
    currentContentRevisionId: row.current_content_revision_id,
    currentLayoutRevisionId: row.current_layout_revision_id,
    expiresAt: row.expires_at ? toIso(row.expires_at) : null,
    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };

  const candidate =
    row.kind === "base"
      ? {
          ...common,
          kind: "base",
          caseId: null,
          detachedFromCaseId: null,
          jobContext: null,
          baseDocumentId: null,
          baseDocumentRevisionId: null,
          evidenceRevisionId: null,
        }
      : row.job_context_kind === "public"
        ? {
            ...common,
            kind: "case_derived",
            caseId: row.case_id,
            detachedFromCaseId: row.detached_from_case_id,
            jobContext: {
              kind: "public",
              publishedJobId: row.published_job_id,
              publishedJobVersionId: row.published_job_version_id,
              requirementSetId: row.requirement_set_id,
              officialUrl: row.public_official_url,
            },
            baseDocumentId: row.base_document_id,
            baseDocumentRevisionId: row.base_document_revision_id,
            evidenceRevisionId: row.evidence_revision_id,
          }
        : {
            ...common,
            kind: "case_derived",
            caseId: row.case_id,
            detachedFromCaseId: row.detached_from_case_id,
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
            baseDocumentId: row.base_document_id,
            baseDocumentRevisionId: row.base_document_revision_id,
            evidenceRevisionId: row.evidence_revision_id,
          };
  const parsed = ResumeDocumentSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("RESUME_DOCUMENT_READ_MODEL_INVALID");
  return parsed.data;
}

async function loadResumeDocument(
  db: DbExecutor,
  owner: OwnerScope,
  documentId: string,
): Promise<ResumeDocument | null> {
  const row = await documentReadQuery(db)
    .where("document.id", "=", documentId)
    .where("document.owner_id", "=", owner.ownerId)
    .where("document.owner_epoch", "=", owner.ownerEpoch)
    .where("document.deleted_at", "is", null)
    .executeTakeFirst();
  return row ? mapResumeDocument(row as ResumeDocumentReadRow) : null;
}

async function loadLegacySource(
  db: DbExecutor,
  owner: OwnerScope,
): Promise<LegacyResumeDocumentSourceSummary | null> {
  const row = await db
    .selectFrom("profile.resume_document_revisions")
    .select(["id", "owner_id", "owner_epoch", "revision", "confirmed_at"])
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("schema_version", "=", "resume-document-v1")
    .where("document_id", "is", null)
    .orderBy("revision", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  return row
    ? LegacyResumeDocumentSourceSummarySchema.parse({
        legacySourceRevisionId: row.id,
        legacySchemaVersion: "resume-document-v1",
        legacyRevision: Number(row.revision),
        ownerId: row.owner_id,
        ownerEpoch: Number(row.owner_epoch),
        confirmedAt: toIso(row.confirmed_at),
        readOnly: true,
      })
    : null;
}

function cursorQueryHash(query: ListResumeDocumentsQuery): string {
  return hashCanonicalJson({
    schemaVersion: "resume-document-list-v2",
    kind: query.kind ?? null,
    caseId: query.caseId ?? null,
  }).slice(0, 16);
}

function encodeCursor(resumeDocument: ResumeDocument, query: ListResumeDocumentsQuery): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      query: cursorQueryHash(query),
      position: { updatedAt: resumeDocument.updatedAt, id: resumeDocument.id },
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value: string, query: ListResumeDocumentsQuery) {
  try {
    const cursor = CursorEnvelopeSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (cursor.query !== cursorQueryHash(query)) throw new Error("CURSOR_QUERY_MISMATCH");
    return cursor.position;
  } catch {
    throw new ServiceError(
      400,
      "INVALID_RESUME_DOCUMENT_CURSOR",
      "简历文档列表游标无效，请从第一页重新加载。",
    );
  }
}

export async function listResumeDocuments(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  query: ListResumeDocumentsQuery;
}): Promise<ListResumeDocumentsResponse> {
  const cursor = input.query.cursor ? decodeCursor(input.query.cursor, input.query) : null;
  let query = documentReadQuery(input.db)
    .where("document.owner_id", "=", input.owner.ownerId)
    .where("document.owner_epoch", "=", input.owner.ownerEpoch)
    .where("document.deleted_at", "is", null);
  if (input.query.kind) query = query.where("document.kind", "=", input.query.kind);
  if (input.query.caseId) query = query.where("document.case_id", "=", input.query.caseId);
  if (cursor) {
    const updatedAt = new Date(cursor.updatedAt);
    query = query.where((expression) =>
      expression.or([
        expression("document.updated_at", "<", updatedAt),
        expression.and([
          expression("document.updated_at", "=", updatedAt),
          expression("document.id", "<", cursor.id),
        ]),
      ]),
    );
  }
  const [rows, legacySource] = await Promise.all([
    query
      .orderBy("document.updated_at", "desc")
      .orderBy("document.id", "desc")
      .limit(input.query.limit + 1)
      .execute(),
    input.query.kind === "case_derived" || input.query.caseId
      ? Promise.resolve(null)
      : loadLegacySource(input.db, input.owner),
  ]);
  const hasMore = rows.length > input.query.limit;
  const items = rows
    .slice(0, input.query.limit)
    .map((row) => mapResumeDocument(row as ResumeDocumentReadRow));
  const lastItem = items.at(-1);
  return ListResumeDocumentsResponseSchema.parse({
    items,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem, input.query) : null,
    legacySource,
  });
}

export async function getResumeDocument(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  documentId: string;
}): Promise<ResumeDocument | null> {
  return loadResumeDocument(input.db, input.owner, input.documentId);
}

function resumeDocumentDeleted(): ServiceError {
  return new ServiceError(
    410,
    "RESUME_DOCUMENT_DELETED",
    "该请求曾创建的简历文档已经删除，请使用新的请求编号。",
  );
}

function resumeCaseNotFound(): ServiceError {
  return new ServiceError(
    404,
    "APPLICATION_CASE_NOT_FOUND",
    "求职项目不存在、已删除或不属于当前账户。",
  );
}

function resumeBaseRevisionInvalid(): ServiceError {
  return new ServiceError(
    422,
    "RESUME_BASE_REVISION_INVALID",
    "基础简历修订不存在、已删除、不是当前账户的 V2 基础简历或内容不符合契约。",
  );
}

function resumeEvidenceRequired(): ServiceError {
  return new ServiceError(
    409,
    "RESUME_EVIDENCE_REQUIRED",
    "创建岗位简历前，请先确认至少一条属于当前账户的经历证据。",
  );
}

function resumeForCaseExists(): ServiceError {
  return new ServiceError(
    409,
    "RESUME_DOCUMENT_FOR_CASE_EXISTS",
    "该求职项目已经有一份未删除的岗位简历，请打开现有文档继续。",
  );
}

function applicationCaseRevisionConflict(): ServiceError {
  return new ServiceError(
    409,
    "APPLICATION_CASE_REVISION_CONFLICT",
    "求职项目已在其他页面更新，请重新核对后再创建岗位简历。",
  );
}

function resumeBaseEvidenceInvalid(): ServiceError {
  return new ServiceError(
    422,
    "RESUME_BASE_EVIDENCE_INVALID",
    "基础简历引用了当前未确认的经历证据，请先重新确认基础简历。",
  );
}

async function loadCaseReferenceForUpdate(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  caseId: string,
): Promise<CaseReferenceRow | null> {
  return (
    (await transaction
      .selectFrom("application.application_cases")
      .select([
        "id",
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
      .executeTakeFirst()) ?? null
  );
}

async function loadStrictBaseRevision(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  revisionId: string,
) {
  const row = await transaction
    .selectFrom("profile.resume_document_revisions as content_revision")
    .innerJoin("profile.resume_documents as base_document", (join) =>
      join
        .onRef("base_document.owner_id", "=", "content_revision.owner_id")
        .onRef("base_document.id", "=", "content_revision.document_id"),
    )
    .select([
      "content_revision.id",
      "content_revision.owner_id",
      "content_revision.owner_epoch",
      "content_revision.document_id",
      "content_revision.document_revision",
      "content_revision.base_document_revision_id",
      "content_revision.content_hash",
      "content_revision.confirmed_at",
      "content_revision.created_at",
      "content_revision.sections",
      "base_document.kind as document_kind",
    ])
    .where("content_revision.id", "=", revisionId)
    .where("content_revision.owner_id", "=", owner.ownerId)
    .where("content_revision.owner_epoch", "=", owner.ownerEpoch)
    .where("content_revision.schema_version", "=", "resume-content-v1")
    .where("base_document.owner_epoch", "=", owner.ownerEpoch)
    .where("base_document.kind", "=", "base")
    .where("base_document.deleted_at", "is", null)
    .forUpdate("base_document")
    .executeTakeFirst();
  if (!row?.document_id || !row.document_revision || row.document_kind !== "base") {
    throw resumeBaseRevisionInvalid();
  }
  const parsed = ResumeSemanticContentRevisionSchema.safeParse({
    schemaVersion: "resume-content-revision-v1",
    id: row.id,
    documentId: row.document_id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    documentRevision: Number(row.document_revision),
    baseDocumentRevisionId: row.base_document_revision_id,
    contentHash: row.content_hash,
    confirmedAt: toIso(row.confirmed_at),
    createdAt: toIso(row.created_at),
    content: {
      schemaVersion: "resume-content-v1",
      sections: parseJsonValue(row.sections),
    },
  });
  if (!parsed.success) throw resumeBaseRevisionInvalid();
  return parsed.data;
}

async function loadCurrentEvidenceRevision(transaction: Transaction<Database>, owner: OwnerScope) {
  const row = await transaction
    .selectFrom("profile.resume_evidence_revisions")
    .selectAll()
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .orderBy("revision", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  const parsed = row
    ? ResumeEvidenceRevisionSchema.safeParse({
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
      })
    : null;
  if (!parsed?.success || !parsed.data.evidence.some((item) => item.confirmed)) {
    throw resumeEvidenceRequired();
  }
  return parsed.data;
}

function assertBaseContentEvidence(
  baseRevision: z.infer<typeof ResumeSemanticContentRevisionSchema>,
  evidenceRevision: z.infer<typeof ResumeEvidenceRevisionSchema>,
): void {
  const confirmedIds = new Set(
    evidenceRevision.evidence.filter((item) => item.confirmed).map((item) => item.id),
  );
  const referencedIds = baseRevision.content.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.evidenceIds),
  );
  if (referencedIds.some((id) => !confirmedIds.has(id))) throw resumeBaseEvidenceInvalid();
}

async function nextGlobalResumeRevision(
  transaction: Transaction<Database>,
  owner: OwnerScope,
): Promise<number> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`resume-evidence:${owner.ownerId}`}, 0))`.execute(
    transaction,
  );
  const row = await transaction
    .selectFrom("profile.resume_document_revisions")
    .select("revision")
    .where("owner_id", "=", owner.ownerId)
    .orderBy("revision", "desc")
    .executeTakeFirst();
  return Number(row?.revision ?? 0) + 1;
}

function orderedSectionIds(
  baseRevision: z.infer<typeof ResumeSemanticContentRevisionSchema>,
): string[] {
  return [...baseRevision.content.sections]
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
    .map((section) => section.id);
}

async function loadDerivedLayoutSeed(input: {
  transaction: Transaction<Database>;
  owner: OwnerScope;
  baseDocumentId: string;
  baseRevision: z.infer<typeof ResumeSemanticContentRevisionSchema>;
}) {
  const fallback = {
    templateKey: "cn_classic_single_column" as const,
    sectionOrder: orderedSectionIds(input.baseRevision),
    settings: DefaultLayoutSettings,
  };
  const row = await input.transaction
    .selectFrom("profile.resume_documents as document")
    .innerJoin(
      "profile.resume_layout_revisions as layout",
      "layout.id",
      "document.current_layout_revision_id",
    )
    .select(["layout.template_key", "layout.section_order", "layout.settings"])
    .where("document.id", "=", input.baseDocumentId)
    .where("document.owner_id", "=", input.owner.ownerId)
    .where("document.owner_epoch", "=", input.owner.ownerEpoch)
    .where("document.kind", "=", "base")
    .where("document.deleted_at", "is", null)
    .executeTakeFirst();
  if (!row) return fallback;

  const templateKey = ResumeTemplateKeySchema.safeParse(row.template_key);
  const settings = ResumeLayoutSettingsSchema.safeParse(parseJsonValue(row.settings));
  const sectionOrder = z.array(z.string().uuid()).safeParse(parseJsonValue(row.section_order));
  const expectedIds = fallback.sectionOrder;
  if (
    !templateKey.success ||
    !settings.success ||
    !sectionOrder.success ||
    sectionOrder.data.length !== expectedIds.length ||
    new Set(sectionOrder.data).size !== expectedIds.length ||
    expectedIds.some((id) => !sectionOrder.data.includes(id))
  ) {
    return fallback;
  }
  return {
    templateKey: templateKey.data,
    sectionOrder: sectionOrder.data,
    settings: settings.data,
  };
}

function derivedLayoutHash(input: {
  templateKey: z.infer<typeof ResumeTemplateKeySchema>;
  sectionOrder: string[];
  settings: z.infer<typeof ResumeLayoutSettingsSchema>;
}): string {
  return hashCanonicalJson({
    schemaVersion: "resume-layout-v2",
    templateKey: input.templateKey,
    sectionOrder: input.sectionOrder,
    settings: input.settings,
  });
}

function postgresConstraint(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === "23505" && typeof candidate.constraint === "string"
    ? candidate.constraint
    : null;
}

export async function createResumeDocument(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  request: CreateResumeDocumentRequest;
  idempotencyKey: string;
}): Promise<CreateResumeDocumentResponse> {
  const requestHash = hashCanonicalJson(input.request);
  try {
    return await input.db.transaction().execute(async (transaction) => {
      await lockOwnerIdempotencyKey(transaction, {
        ownerId: input.owner.ownerId,
        scope: "resume-document-create",
        idempotencyKey: input.idempotencyKey,
      });
      await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);

      const replay = await transaction
        .selectFrom("profile.resume_documents")
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
            "同一个请求编号不能用于不同的简历文档创建请求。",
          );
        }
        const resumeDocument = await loadResumeDocument(transaction, input.owner, replay.id);
        if (!resumeDocument) throw resumeDocumentDeleted();
        return CreateResumeDocumentResponseSchema.parse({ resumeDocument, created: true });
      }

      const documentId = randomUUID();
      if (input.request.kind === "base") {
        await transaction
          .insertInto("profile.resume_documents")
          .values({
            id: documentId,
            owner_id: input.owner.ownerId,
            owner_epoch: input.owner.ownerEpoch,
            kind: "base",
            title: input.request.title,
            case_id: null,
            detached_from_case_id: null,
            job_context_kind: null,
            published_job_id: null,
            published_job_version_id: null,
            requirement_set_id: null,
            private_job_snapshot_id: null,
            job_context_revision: null,
            base_document_id: null,
            base_document_revision_id: null,
            evidence_revision_id: null,
            current_content_revision_id: null,
            current_layout_revision_id: null,
            revision: 1,
            creation_idempotency_key: input.idempotencyKey,
            creation_request_hash: requestHash,
            expires_at: null,
            deleted_at: null,
          })
          .execute();
      } else {
        await lockOwnerIdempotencyKey(transaction, {
          ownerId: input.owner.ownerId,
          scope: "resume-document-case",
          idempotencyKey: input.request.caseId,
        });
        const applicationCase = await loadCaseReferenceForUpdate(
          transaction,
          input.owner,
          input.request.caseId,
        );
        if (!applicationCase) throw resumeCaseNotFound();
        if (Number(applicationCase.revision) !== input.request.expectedCaseRevision) {
          throw applicationCaseRevisionConflict();
        }
        const existing = await transaction
          .selectFrom("profile.resume_documents")
          .select("id")
          .where("owner_id", "=", input.owner.ownerId)
          .where("owner_epoch", "=", input.owner.ownerEpoch)
          .where("case_id", "=", input.request.caseId)
          .where("deleted_at", "is", null)
          .executeTakeFirst();
        if (existing) throw resumeForCaseExists();
        const baseRevision = await loadStrictBaseRevision(
          transaction,
          input.owner,
          input.request.baseDocumentRevisionId,
        );
        const evidenceRevision = await loadCurrentEvidenceRevision(transaction, input.owner);
        assertBaseContentEvidence(baseRevision, evidenceRevision);
        const layout = await loadDerivedLayoutSeed({
          transaction,
          owner: input.owner,
          baseDocumentId: baseRevision.documentId,
          baseRevision,
        });
        const contentRevisionId = randomUUID();
        const layoutRevisionId = randomUUID();
        await transaction
          .insertInto("profile.resume_documents")
          .values({
            id: documentId,
            owner_id: input.owner.ownerId,
            owner_epoch: input.owner.ownerEpoch,
            kind: "case_derived",
            title: input.request.title,
            case_id: applicationCase.id,
            detached_from_case_id: null,
            job_context_kind: applicationCase.job_context_kind,
            published_job_id: applicationCase.published_job_id,
            published_job_version_id: applicationCase.published_job_version_id,
            requirement_set_id: applicationCase.requirement_set_id,
            private_job_snapshot_id: applicationCase.private_job_snapshot_id,
            job_context_revision: applicationCase.job_context_revision,
            base_document_id: baseRevision.documentId,
            base_document_revision_id: baseRevision.id,
            evidence_revision_id: evidenceRevision.id,
            current_content_revision_id: null,
            current_layout_revision_id: null,
            revision: 1,
            creation_idempotency_key: input.idempotencyKey,
            creation_request_hash: requestHash,
            expires_at: null,
            deleted_at: null,
          })
          .execute();
        await transaction
          .insertInto("profile.resume_document_revisions")
          .values({
            id: contentRevisionId,
            owner_id: input.owner.ownerId,
            owner_epoch: input.owner.ownerEpoch,
            resume_analysis_id: null,
            revision: await nextGlobalResumeRevision(transaction, input.owner),
            base_revision: null,
            schema_version: "resume-content-v1",
            sections: JSON.stringify(baseRevision.content.sections) as unknown as JsonValue,
            content_hash: hashCanonicalJson(baseRevision.content),
            confirmed_at: sql<Date>`clock_timestamp()`,
            document_id: documentId,
            document_revision: 1,
            base_document_revision_id: null,
            legacy_source_revision_id: null,
            mutation_idempotency_key: null,
            mutation_request_hash: null,
            result_document_revision: null,
          })
          .execute();
        await transaction
          .insertInto("profile.resume_layout_revisions")
          .values({
            id: layoutRevisionId,
            owner_id: input.owner.ownerId,
            owner_epoch: input.owner.ownerEpoch,
            document_id: documentId,
            layout_revision: 1,
            base_layout_revision: null,
            schema_version: "resume-layout-v2",
            template_key: layout.templateKey,
            section_order: JSON.stringify(layout.sectionOrder) as unknown as JsonValue,
            settings: JSON.stringify(layout.settings) as unknown as JsonValue,
            content_hash: derivedLayoutHash(layout),
            mutation_idempotency_key: null,
            mutation_request_hash: null,
            result_document_revision: null,
          })
          .execute();
        await transaction
          .updateTable("profile.resume_documents")
          .set({
            current_content_revision_id: contentRevisionId,
            current_layout_revision_id: layoutRevisionId,
            updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
          })
          .where("id", "=", documentId)
          .where("owner_id", "=", input.owner.ownerId)
          .where("owner_epoch", "=", input.owner.ownerEpoch)
          .where("revision", "=", 1)
          .executeTakeFirstOrThrow();

        const nextCaseRevision = Number(applicationCase.revision) + 1;
        const updatedCase = await transaction
          .updateTable("application.application_cases")
          .set({
            revision: nextCaseRevision,
            updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
          })
          .where("id", "=", applicationCase.id)
          .where("owner_id", "=", input.owner.ownerId)
          .where("owner_epoch", "=", input.owner.ownerEpoch)
          .where("revision", "=", input.request.expectedCaseRevision)
          .where("deleted_at", "is", null)
          .executeTakeFirst();
        if (Number(updatedCase.numUpdatedRows) !== 1) {
          throw applicationCaseRevisionConflict();
        }
        await transaction
          .insertInto("application.case_events")
          .values({
            id: randomUUID(),
            owner_id: input.owner.ownerId,
            owner_epoch: input.owner.ownerEpoch,
            case_id: applicationCase.id,
            sequence: nextCaseRevision,
            event_type: "resume_document_derived",
            actor_type: "owner",
            event_data: JSON.stringify({
              schemaVersion: "case-event-v1",
              documentId,
              contentRevisionId,
            }) as unknown as JsonValue,
            schema_version: "case-event-v1",
            idempotency_scope: "resume-document:derive",
            idempotency_key: input.idempotencyKey,
            request_hash: requestHash,
          })
          .execute();
      }

      const resumeDocument = await loadResumeDocument(transaction, input.owner, documentId);
      if (!resumeDocument) throw new Error("RESUME_DOCUMENT_INSERT_NOT_READABLE");
      return CreateResumeDocumentResponseSchema.parse({ resumeDocument, created: true });
    });
  } catch (error) {
    const constraint = postgresConstraint(error);
    if (constraint === "resume_documents_one_active_case_derived_idx") {
      throw resumeForCaseExists();
    }
    if (constraint === "resume_documents_owner_idempotency_unique") {
      throw new ServiceError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "同一个请求编号不能用于不同的简历文档创建请求。",
      );
    }
    throw error;
  }
}
