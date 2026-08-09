import { randomUUID } from "node:crypto";
import {
  type LegacyResumeContentConversion,
  LegacyResumeContentConversionSchema,
  type ListResumeDocumentContentRevisionsResponse,
  ListResumeDocumentContentRevisionsResponseSchema,
  type ListResumeDocumentLayoutRevisionsResponse,
  ListResumeDocumentLayoutRevisionsResponseSchema,
  type PutResumeDocumentContentRevisionRequest,
  type PutResumeDocumentContentRevisionResponse,
  PutResumeDocumentContentRevisionResponseSchema,
  type PutResumeDocumentLayoutRevisionRequest,
  type PutResumeDocumentLayoutRevisionResponse,
  PutResumeDocumentLayoutRevisionResponseSchema,
  type ResumeDocumentContentRevisionReadModel,
  ResumeDocumentContentRevisionSchema,
  ResumeDocumentInputSchema,
  type ResumeDocumentLayoutRevisionReadModel,
  ResumeDocumentLayoutRevisionSchema,
  ResumeDocumentLayoutRevisionV2Schema,
  type ResumeDocumentRevisionPageQuery,
  ResumeEvidenceRevisionSchema,
  ResumeLayoutSettingsSchema,
  type ResumeSemanticContent,
  ResumeSemanticContentRevisionSchema,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { lockOwnerIdempotencyKey } from "../lib/idempotency.js";
import { ServiceError } from "../lib/service-error.js";

interface ResumeDocumentMutationRow {
  id: string;
  owner_id: string;
  owner_epoch: number;
  kind: string;
  base_document_id: string | null;
  base_document_revision_id: string | null;
  evidence_revision_id: string | null;
  current_content_revision_id: string | null;
  current_layout_revision_id: string | null;
  revision: number;
}

interface ResumeContentRevisionRow {
  id: string;
  owner_id: string;
  owner_epoch: number;
  revision: number;
  base_revision: number | null;
  schema_version: string;
  sections: JsonValue;
  content_hash: string;
  confirmed_at: Date;
  created_at: Date;
  document_id: string | null;
  document_revision: number | null;
  base_document_revision_id: string | null;
  legacy_source_revision_id: string | null;
  mutation_idempotency_key: string | null;
  mutation_request_hash: string | null;
  result_document_revision: number | null;
}

interface ResumeLayoutRevisionRow {
  id: string;
  owner_id: string;
  owner_epoch: number;
  document_id: string;
  layout_revision: number;
  base_layout_revision: number | null;
  schema_version: string;
  template_key: string;
  section_order: JsonValue;
  settings: JsonValue;
  content_hash: string;
  mutation_idempotency_key: string | null;
  mutation_request_hash: string | null;
  result_document_revision: number | null;
  created_at: Date;
}

interface LegacyResumeRevisionRow {
  id: string;
  owner_id: string;
  owner_epoch: number;
  revision: number;
  schema_version: string;
  sections: JsonValue;
  confirmed_at: Date;
}

const DEFAULT_LAYOUT_SETTINGS = ResumeLayoutSettingsSchema.parse({
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

function contentRevisionSelect(db: Kysely<Database> | Transaction<Database>) {
  return db
    .selectFrom("profile.resume_document_revisions")
    .select([
      "id",
      "owner_id",
      "owner_epoch",
      "revision",
      "base_revision",
      "schema_version",
      "sections",
      "content_hash",
      "confirmed_at",
      "created_at",
      "document_id",
      "document_revision",
      "base_document_revision_id",
      "legacy_source_revision_id",
      "mutation_idempotency_key",
      "mutation_request_hash",
      "result_document_revision",
    ]);
}

function layoutRevisionSelect(db: Kysely<Database> | Transaction<Database>) {
  return db
    .selectFrom("profile.resume_layout_revisions")
    .select([
      "id",
      "owner_id",
      "owner_epoch",
      "document_id",
      "layout_revision",
      "base_layout_revision",
      "schema_version",
      "template_key",
      "section_order",
      "settings",
      "content_hash",
      "mutation_idempotency_key",
      "mutation_request_hash",
      "result_document_revision",
      "created_at",
    ]);
}

function mapContentRevision(row: ResumeContentRevisionRow): ResumeDocumentContentRevisionReadModel {
  if (!row.document_id || !row.document_revision) {
    throw new Error("RESUME_CONTENT_REVISION_DOCUMENT_REFERENCE_INVALID");
  }
  const common = {
    id: row.id,
    documentId: row.document_id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    documentRevision: Number(row.document_revision),
    baseDocumentRevisionId: row.base_document_revision_id,
    contentHash: row.content_hash,
    confirmedAt: toIso(row.confirmed_at),
    createdAt: toIso(row.created_at),
  };
  if (row.schema_version === "resume-content-v1") {
    return ResumeSemanticContentRevisionSchema.parse({
      ...common,
      schemaVersion: "resume-content-revision-v1",
      content: {
        schemaVersion: "resume-content-v1",
        sections: parseJsonValue(row.sections),
      },
    });
  }
  if (row.schema_version === "resume-document-v2") {
    return ResumeDocumentContentRevisionSchema.parse({
      ...common,
      schemaVersion: "resume-document-v2",
      content: { sections: parseJsonValue(row.sections) },
    });
  }
  throw new Error("RESUME_CONTENT_REVISION_SCHEMA_UNSUPPORTED");
}

function mapSemanticContentRevision(row: ResumeContentRevisionRow) {
  const mapped = mapContentRevision(row);
  const parsed = ResumeSemanticContentRevisionSchema.safeParse(mapped);
  if (!parsed.success) throw new Error("RESUME_SEMANTIC_CONTENT_REVISION_INVALID");
  return parsed.data;
}

function mapLayoutRevision(row: ResumeLayoutRevisionRow): ResumeDocumentLayoutRevisionReadModel {
  const common = {
    id: row.id,
    documentId: row.document_id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    layoutRevision: Number(row.layout_revision),
    baseLayoutRevision: row.base_layout_revision === null ? null : Number(row.base_layout_revision),
    templateKey: row.template_key,
    sectionOrder: parseJsonValue(row.section_order),
    settings: parseJsonValue(row.settings),
    contentHash: row.content_hash,
    createdAt: toIso(row.created_at),
  };
  if (row.schema_version === "resume-layout-v2") {
    return ResumeDocumentLayoutRevisionV2Schema.parse({
      ...common,
      schemaVersion: "resume-layout-v2",
    });
  }
  if (row.schema_version === "resume-layout-v1") {
    return ResumeDocumentLayoutRevisionSchema.parse({
      ...common,
      schemaVersion: "resume-layout-v1",
    });
  }
  throw new Error("RESUME_LAYOUT_REVISION_SCHEMA_UNSUPPORTED");
}

function mapLayoutRevisionV2(row: ResumeLayoutRevisionRow) {
  const mapped = mapLayoutRevision(row);
  const parsed = ResumeDocumentLayoutRevisionV2Schema.safeParse(mapped);
  if (!parsed.success) throw new Error("RESUME_LAYOUT_REVISION_V2_INVALID");
  return parsed.data;
}

function resumeDocumentNotFound(): ServiceError {
  return new ServiceError(
    404,
    "RESUME_DOCUMENT_NOT_FOUND",
    "简历文档不存在、已删除或不属于当前账户。",
  );
}

function legacyResumeSourceNotFound(): ServiceError {
  return new ServiceError(
    404,
    "LEGACY_RESUME_SOURCE_NOT_FOUND",
    "旧版简历来源不存在、不是当前最新版本或不属于当前账户。",
  );
}

function documentRevisionConflict(currentRevision: number): ServiceError {
  return new ServiceError(
    409,
    "RESUME_DOCUMENT_REVISION_CONFLICT",
    `简历文档已经更新，当前修订为 ${currentRevision}，请刷新后重试。`,
  );
}

function idempotencyKeyReused(): ServiceError {
  return new ServiceError(
    409,
    "IDEMPOTENCY_KEY_REUSED",
    "同一个请求编号不能用于不同的简历修订请求。",
  );
}

function contentPointerInvalid(): ServiceError {
  return new ServiceError(
    409,
    "RESUME_CONTENT_POINTER_INVALID",
    "简历正文修订链与当前指针不一致，请停止编辑并联系维护者。",
  );
}

function layoutPointerInvalid(): ServiceError {
  return new ServiceError(
    409,
    "RESUME_LAYOUT_POINTER_INVALID",
    "简历布局修订链与当前指针不一致，请停止编辑并联系维护者。",
  );
}

function firstBaseEditInvalid(): ServiceError {
  return new ServiceError(
    409,
    "RESUME_FIRST_EDIT_INVALID",
    "旧版简历只能初始化一个仍为空的基础简历，请刷新文档状态后重试。",
  );
}

function contentBaseRevisionInvalid(): ServiceError {
  return new ServiceError(
    409,
    "RESUME_CONTENT_BASE_REVISION_INVALID",
    "正文基修订不是该文档当前固定的修订，请刷新后再编辑。",
  );
}

function legacySourceAlreadyMigrated(): ServiceError {
  return new ServiceError(
    409,
    "LEGACY_RESUME_SOURCE_ALREADY_MIGRATED",
    "该旧版简历已经初始化过一份基础简历，请打开现有文档继续。",
  );
}

function contentUnchanged(): ServiceError {
  return new ServiceError(
    409,
    "RESUME_CONTENT_UNCHANGED",
    "正文没有发生语义变化，因此未创建伪修订。",
  );
}

function layoutUnchanged(): ServiceError {
  return new ServiceError(409, "RESUME_LAYOUT_UNCHANGED", "布局没有发生变化，因此未创建伪修订。");
}

function contentStructureMismatch(): ServiceError {
  return new ServiceError(
    422,
    "RESUME_SOURCE_STRUCTURE_MISMATCH",
    "首个正文必须保留来源中的 section 和 block 编号；结构调整请在初始化后另存修订。",
  );
}

function evidenceReferenceInvalid(): ServiceError {
  return new ServiceError(
    422,
    "RESUME_EVIDENCE_REFERENCE_INVALID",
    "正文引用了当前账户未确认或不属于固定证据版本的经历证据。",
  );
}

function layoutSectionOrderInvalid(): ServiceError {
  return new ServiceError(
    422,
    "RESUME_LAYOUT_SECTION_ORDER_INVALID",
    "布局章节顺序必须且只能包含当前正文中的全部 section 编号。",
  );
}

async function loadDocumentState(
  db: Kysely<Database>,
  owner: OwnerScope,
  documentId: string,
): Promise<ResumeDocumentMutationRow | null> {
  return (
    (await db
      .selectFrom("profile.resume_documents")
      .select([
        "id",
        "owner_id",
        "owner_epoch",
        "kind",
        "base_document_id",
        "base_document_revision_id",
        "evidence_revision_id",
        "current_content_revision_id",
        "current_layout_revision_id",
        "revision",
      ])
      .where("id", "=", documentId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("deleted_at", "is", null)
      .executeTakeFirst()) ?? null
  );
}

async function loadDocumentForUpdate(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  documentId: string,
): Promise<ResumeDocumentMutationRow | null> {
  return (
    (await transaction
      .selectFrom("profile.resume_documents")
      .select([
        "id",
        "owner_id",
        "owner_epoch",
        "kind",
        "base_document_id",
        "base_document_revision_id",
        "evidence_revision_id",
        "current_content_revision_id",
        "current_layout_revision_id",
        "revision",
      ])
      .where("id", "=", documentId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("deleted_at", "is", null)
      .forUpdate()
      .executeTakeFirst()) ?? null
  );
}

async function loadLatestLegacyResumeRevision(
  db: Kysely<Database> | Transaction<Database>,
  owner: OwnerScope,
): Promise<LegacyResumeRevisionRow | null> {
  return (
    (await db
      .selectFrom("profile.resume_document_revisions")
      .select([
        "id",
        "owner_id",
        "owner_epoch",
        "revision",
        "schema_version",
        "sections",
        "confirmed_at",
      ])
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("schema_version", "=", "resume-document-v1")
      .where("document_id", "is", null)
      .orderBy("revision", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst()) ?? null
  );
}

function convertLegacyContent(
  row: LegacyResumeRevisionRow,
  migratedDocumentId: string | null,
): LegacyResumeContentConversion {
  const legacy = ResumeDocumentInputSchema.safeParse({
    schemaVersion: "resume-document-v1",
    sections: parseJsonValue(row.sections),
  });
  if (!legacy.success) throw new Error("LEGACY_RESUME_DOCUMENT_INVALID");
  return LegacyResumeContentConversionSchema.parse({
    schemaVersion: "resume-legacy-content-conversion-v1",
    legacySource: {
      legacySourceRevisionId: row.id,
      legacySchemaVersion: "resume-document-v1",
      legacyRevision: Number(row.revision),
      ownerId: row.owner_id,
      ownerEpoch: Number(row.owner_epoch),
      confirmedAt: toIso(row.confirmed_at),
      readOnly: true,
      migratedDocumentId,
    },
    content: {
      schemaVersion: "resume-content-v1",
      sections: legacy.data.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => ({ ...block, evidenceIds: [] })),
      })),
    },
  });
}

export async function getLegacyResumeContentConversion(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  legacySourceRevisionId: string;
}): Promise<LegacyResumeContentConversion | null> {
  const row = await loadLatestLegacyResumeRevision(input.db, input.owner);
  if (!row || row.id !== input.legacySourceRevisionId) return null;
  const migration = await input.db
    .selectFrom("profile.resume_document_revisions")
    .select("document_id")
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("legacy_source_revision_id", "=", row.id)
    .where("document_id", "is not", null)
    .executeTakeFirst();
  return convertLegacyContent(row, migration?.document_id ?? null);
}

async function loadContentChain(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  document: ResumeDocumentMutationRow,
) {
  const latest = await contentRevisionSelect(transaction)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("document_id", "=", document.id)
    .orderBy("document_revision", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  const current = document.current_content_revision_id
    ? await contentRevisionSelect(transaction)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("document_id", "=", document.id)
        .where("id", "=", document.current_content_revision_id)
        .executeTakeFirst()
    : null;
  if (
    (document.current_content_revision_id === null) !== (latest === undefined) ||
    (latest && current?.id !== latest.id)
  ) {
    throw contentPointerInvalid();
  }
  return {
    latest: latest ? (latest as ResumeContentRevisionRow) : null,
    current: current ? (current as ResumeContentRevisionRow) : null,
  };
}

async function loadLayoutChain(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  document: ResumeDocumentMutationRow,
) {
  const latest = await layoutRevisionSelect(transaction)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("document_id", "=", document.id)
    .orderBy("layout_revision", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  const current = document.current_layout_revision_id
    ? await layoutRevisionSelect(transaction)
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("document_id", "=", document.id)
        .where("id", "=", document.current_layout_revision_id)
        .executeTakeFirst()
    : null;
  if (
    (document.current_layout_revision_id === null) !== (latest === undefined) ||
    (latest && current?.id !== latest.id)
  ) {
    throw layoutPointerInvalid();
  }
  return {
    latest: latest ? (latest as ResumeLayoutRevisionRow) : null,
    current: current ? (current as ResumeLayoutRevisionRow) : null,
  };
}

function contentIds(content: { sections: Array<{ id: string; blocks: Array<{ id: string }> }> }) {
  return {
    sections: new Set(content.sections.map((section) => section.id)),
    blocks: new Set(content.sections.flatMap((section) => section.blocks.map((block) => block.id))),
  };
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function assertSameContentStructure(
  source: { sections: Array<{ id: string; blocks: Array<{ id: string }> }> },
  candidate: ResumeSemanticContent,
): void {
  const sourceIds = contentIds(source);
  const candidateIds = contentIds(candidate);
  if (
    !sameSet(sourceIds.sections, candidateIds.sections) ||
    !sameSet(sourceIds.blocks, candidateIds.blocks)
  ) {
    throw contentStructureMismatch();
  }
}

async function loadFixedBaseContent(
  transaction: Transaction<Database>,
  owner: OwnerScope,
  document: ResumeDocumentMutationRow,
) {
  if (!document.base_document_id || !document.base_document_revision_id) {
    throw contentBaseRevisionInvalid();
  }
  const row = await contentRevisionSelect(transaction)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("document_id", "=", document.base_document_id)
    .where("id", "=", document.base_document_revision_id)
    .executeTakeFirst();
  if (!row) throw contentBaseRevisionInvalid();
  return mapContentRevision(row as ResumeContentRevisionRow).content;
}

async function validateEvidenceReferences(input: {
  transaction: Transaction<Database>;
  owner: OwnerScope;
  document: ResumeDocumentMutationRow;
  content: ResumeSemanticContent;
}): Promise<void> {
  const requestedIds = new Set(
    input.content.sections.flatMap((section) =>
      section.blocks.flatMap((block) => block.evidenceIds),
    ),
  );
  if (requestedIds.size === 0) return;

  let query = input.transaction
    .selectFrom("profile.resume_evidence_revisions")
    .selectAll()
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch);
  if (input.document.kind === "case_derived") {
    if (!input.document.evidence_revision_id) throw evidenceReferenceInvalid();
    query = query.where("id", "=", input.document.evidence_revision_id);
  } else {
    query = query.orderBy("revision", "desc").orderBy("id", "desc");
  }
  const row = await query.executeTakeFirst();
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
  const allowed = new Set(
    parsed.data.evidence.filter((item) => item.confirmed).map((item) => item.id),
  );
  if ([...requestedIds].some((id) => !allowed.has(id))) throw evidenceReferenceInvalid();
}

async function lockGlobalResumeRevision(
  transaction: Transaction<Database>,
  owner: OwnerScope,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`resume-evidence:${owner.ownerId}`}, 0))`.execute(
    transaction,
  );
}

async function nextGlobalResumeRevision(transaction: Transaction<Database>, owner: OwnerScope) {
  const latest = await transaction
    .selectFrom("profile.resume_document_revisions")
    .select(["revision"])
    .where("owner_id", "=", owner.ownerId)
    .orderBy("revision", "desc")
    .executeTakeFirst();
  return Number(latest?.revision ?? 0) + 1;
}

function orderedSectionIds(content: ResumeSemanticContent): string[] {
  return [...content.sections]
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
    .map((section) => section.id);
}

function layoutHash(input: {
  templateKey: "cn_classic_single_column" | "cn_compact_technical";
  sectionOrder: string[];
  settings: typeof DEFAULT_LAYOUT_SETTINGS;
}): string {
  return hashCanonicalJson({
    schemaVersion: "resume-layout-v2",
    templateKey: input.templateKey,
    sectionOrder: input.sectionOrder,
    settings: input.settings,
  });
}

async function ensureLayoutForContent(input: {
  transaction: Transaction<Database>;
  owner: OwnerScope;
  document: ResumeDocumentMutationRow;
  layoutChain: {
    latest: ResumeLayoutRevisionRow | null;
    current: ResumeLayoutRevisionRow | null;
  };
  content: ResumeSemanticContent;
}): Promise<string> {
  const newSectionOrder = orderedSectionIds(input.content);
  const current = input.layoutChain.current;
  if (current) {
    const currentOrder = parseJsonValue(current.section_order);
    if (
      Array.isArray(currentOrder) &&
      sameSet(
        new Set(currentOrder.filter((item): item is string => typeof item === "string")),
        new Set(newSectionOrder),
      )
    ) {
      return current.id;
    }
  }

  const parsedSettings = current
    ? ResumeLayoutSettingsSchema.safeParse(parseJsonValue(current.settings))
    : null;
  const settings = parsedSettings?.success ? parsedSettings.data : DEFAULT_LAYOUT_SETTINGS;
  const templateKey =
    current?.template_key === "cn_compact_technical"
      ? "cn_compact_technical"
      : "cn_classic_single_column";
  const existingOrder = current ? parseJsonValue(current.section_order) : [];
  const retained = Array.isArray(existingOrder)
    ? existingOrder.filter(
        (item): item is string => typeof item === "string" && newSectionOrder.includes(item),
      )
    : [];
  const sectionOrder = [
    ...retained,
    ...newSectionOrder.filter((sectionId) => !retained.includes(sectionId)),
  ];
  const id = randomUUID();
  await input.transaction
    .insertInto("profile.resume_layout_revisions")
    .values({
      id,
      owner_id: input.owner.ownerId,
      owner_epoch: input.owner.ownerEpoch,
      document_id: input.document.id,
      layout_revision: Number(input.layoutChain.latest?.layout_revision ?? 0) + 1,
      base_layout_revision: current ? Number(current.layout_revision) : null,
      schema_version: "resume-layout-v2",
      template_key: templateKey,
      section_order: JSON.stringify(sectionOrder) as unknown as JsonValue,
      settings: JSON.stringify(settings) as unknown as JsonValue,
      content_hash: layoutHash({ templateKey, sectionOrder, settings }),
      mutation_idempotency_key: null,
      mutation_request_hash: null,
      result_document_revision: null,
    })
    .execute();
  return id;
}

function postgresConstraint(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === "23505" && typeof candidate.constraint === "string"
    ? candidate.constraint
    : null;
}

export async function listResumeDocumentContentRevisions(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  documentId: string;
  query: ResumeDocumentRevisionPageQuery;
}): Promise<ListResumeDocumentContentRevisionsResponse> {
  const document = await loadDocumentState(input.db, input.owner, input.documentId);
  if (!document) throw resumeDocumentNotFound();
  let query = contentRevisionSelect(input.db)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("document_id", "=", document.id);
  if (input.query.beforeRevision) {
    query = query.where("document_revision", "<", input.query.beforeRevision);
  }
  const [rows, currentRow] = await Promise.all([
    query
      .orderBy("document_revision", "desc")
      .orderBy("id", "desc")
      .limit(input.query.limit + 1)
      .execute(),
    document.current_content_revision_id
      ? contentRevisionSelect(input.db)
          .where("owner_id", "=", input.owner.ownerId)
          .where("owner_epoch", "=", input.owner.ownerEpoch)
          .where("document_id", "=", document.id)
          .where("id", "=", document.current_content_revision_id)
          .executeTakeFirst()
      : Promise.resolve(undefined),
  ]);
  if (document.current_content_revision_id && !currentRow) throw contentPointerInvalid();
  const hasMore = rows.length > input.query.limit;
  const items = rows
    .slice(0, input.query.limit)
    .map((row) => mapContentRevision(row as ResumeContentRevisionRow));
  const last = items.at(-1);
  return ListResumeDocumentContentRevisionsResponseSchema.parse({
    documentRevision: Number(document.revision),
    currentContentRevisionId: document.current_content_revision_id,
    current: currentRow ? mapContentRevision(currentRow as ResumeContentRevisionRow) : null,
    items,
    nextBeforeRevision: hasMore && last ? last.documentRevision : null,
  });
}

export async function listResumeDocumentLayoutRevisions(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  documentId: string;
  query: ResumeDocumentRevisionPageQuery;
}): Promise<ListResumeDocumentLayoutRevisionsResponse> {
  const document = await loadDocumentState(input.db, input.owner, input.documentId);
  if (!document) throw resumeDocumentNotFound();
  let query = layoutRevisionSelect(input.db)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("document_id", "=", document.id);
  if (input.query.beforeRevision) {
    query = query.where("layout_revision", "<", input.query.beforeRevision);
  }
  const [rows, currentRow] = await Promise.all([
    query
      .orderBy("layout_revision", "desc")
      .orderBy("id", "desc")
      .limit(input.query.limit + 1)
      .execute(),
    document.current_layout_revision_id
      ? layoutRevisionSelect(input.db)
          .where("owner_id", "=", input.owner.ownerId)
          .where("owner_epoch", "=", input.owner.ownerEpoch)
          .where("document_id", "=", document.id)
          .where("id", "=", document.current_layout_revision_id)
          .executeTakeFirst()
      : Promise.resolve(undefined),
  ]);
  if (document.current_layout_revision_id && !currentRow) throw layoutPointerInvalid();
  const hasMore = rows.length > input.query.limit;
  const items = rows
    .slice(0, input.query.limit)
    .map((row) => mapLayoutRevision(row as ResumeLayoutRevisionRow));
  const last = items.at(-1);
  return ListResumeDocumentLayoutRevisionsResponseSchema.parse({
    documentRevision: Number(document.revision),
    currentLayoutRevisionId: document.current_layout_revision_id,
    current: currentRow ? mapLayoutRevision(currentRow as ResumeLayoutRevisionRow) : null,
    items,
    nextBeforeRevision: hasMore && last ? last.layoutRevision : null,
  });
}

export async function appendResumeDocumentContentRevisionInTransaction(input: {
  transaction: Transaction<Database>;
  owner: OwnerScope;
  documentId: string;
  request: PutResumeDocumentContentRevisionRequest;
  idempotencyKey: string;
}): Promise<PutResumeDocumentContentRevisionResponse> {
  const requestHash = hashCanonicalJson({
    operation: "resume-content-revision-v1",
    documentId: input.documentId,
    request: input.request,
  });
  const transaction = input.transaction;
  await lockGlobalResumeRevision(transaction, input.owner);
  await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);
  const document = await loadDocumentForUpdate(transaction, input.owner, input.documentId);
  if (!document) throw resumeDocumentNotFound();

  const replay = await contentRevisionSelect(transaction)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("document_id", "=", document.id)
    .where("mutation_idempotency_key", "=", input.idempotencyKey)
    .executeTakeFirst();
  if (replay) {
    if (replay.mutation_request_hash !== requestHash) throw idempotencyKeyReused();
    if (!replay.result_document_revision) {
      throw new Error("RESUME_CONTENT_MUTATION_RECEIPT_INVALID");
    }
    return PutResumeDocumentContentRevisionResponseSchema.parse({
      contentRevision: mapSemanticContentRevision(replay as ResumeContentRevisionRow),
      documentRevision: Number(replay.result_document_revision),
      created: true,
    });
  }

  const contentChain = await loadContentChain(transaction, input.owner, document);
  const layoutChain = await loadLayoutChain(transaction, input.owner, document);
  let legacySourceRevisionId: string | null = null;
  let baseDocumentRevisionId: string | null = null;

  if ("legacySourceRevisionId" in input.request) {
    if (
      document.kind !== "base" ||
      Number(document.revision) !== 1 ||
      contentChain.current ||
      layoutChain.current
    ) {
      throw firstBaseEditInvalid();
    }
    const legacy = await loadLatestLegacyResumeRevision(transaction, input.owner);
    if (!legacy || legacy.id !== input.request.legacySourceRevisionId) {
      throw legacyResumeSourceNotFound();
    }
    const existingMigration = await transaction
      .selectFrom("profile.resume_document_revisions")
      .select("id")
      .where("owner_id", "=", input.owner.ownerId)
      .where("legacy_source_revision_id", "=", legacy.id)
      .executeTakeFirst();
    if (existingMigration) throw legacySourceAlreadyMigrated();
    assertSameContentStructure(convertLegacyContent(legacy, null).content, input.request.content);
    legacySourceRevisionId = legacy.id;
  } else {
    if (Number(document.revision) !== input.request.expectedRevision) {
      throw documentRevisionConflict(Number(document.revision));
    }
    if (contentChain.current) {
      if (input.request.baseDocumentRevisionId !== contentChain.current.id) {
        throw contentBaseRevisionInvalid();
      }
      baseDocumentRevisionId = contentChain.current.id;
    } else {
      if (
        document.kind !== "case_derived" ||
        layoutChain.current !== null ||
        input.request.baseDocumentRevisionId !== document.base_document_revision_id
      ) {
        throw contentBaseRevisionInvalid();
      }
      const source = await loadFixedBaseContent(transaction, input.owner, document);
      assertSameContentStructure(source, input.request.content);
    }
  }

  await validateEvidenceReferences({
    transaction,
    owner: input.owner,
    document,
    content: input.request.content,
  });
  const contentHash = hashCanonicalJson(input.request.content);
  if (contentChain.current?.content_hash === contentHash) throw contentUnchanged();

  const documentRevision = Number(document.revision) + 1;
  const globalRevision = await nextGlobalResumeRevision(transaction, input.owner);
  const contentRevisionId = randomUUID();
  await transaction
    .insertInto("profile.resume_document_revisions")
    .values({
      id: contentRevisionId,
      owner_id: input.owner.ownerId,
      owner_epoch: input.owner.ownerEpoch,
      resume_analysis_id: null,
      revision: globalRevision,
      base_revision: null,
      schema_version: "resume-content-v1",
      sections: JSON.stringify(input.request.content.sections) as unknown as JsonValue,
      content_hash: contentHash,
      confirmed_at: sql<Date>`clock_timestamp()`,
      document_id: document.id,
      document_revision: Number(contentChain.latest?.document_revision ?? 0) + 1,
      base_document_revision_id: baseDocumentRevisionId,
      legacy_source_revision_id: legacySourceRevisionId,
      mutation_idempotency_key: input.idempotencyKey,
      mutation_request_hash: requestHash,
      result_document_revision: documentRevision,
    })
    .execute();

  const layoutRevisionId = await ensureLayoutForContent({
    transaction,
    owner: input.owner,
    document,
    layoutChain,
    content: input.request.content,
  });
  const updated = await transaction
    .updateTable("profile.resume_documents")
    .set({
      current_content_revision_id: contentRevisionId,
      current_layout_revision_id: layoutRevisionId,
      revision: documentRevision,
      updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
    })
    .where("id", "=", document.id)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("revision", "=", document.revision)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows) !== 1) {
    throw documentRevisionConflict(Number(document.revision));
  }
  const row = await contentRevisionSelect(transaction)
    .where("id", "=", contentRevisionId)
    .where("owner_id", "=", input.owner.ownerId)
    .executeTakeFirstOrThrow();
  return PutResumeDocumentContentRevisionResponseSchema.parse({
    contentRevision: mapSemanticContentRevision(row as ResumeContentRevisionRow),
    documentRevision,
    created: true,
  });
}

export async function putResumeDocumentContentRevision(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  documentId: string;
  request: PutResumeDocumentContentRevisionRequest;
  idempotencyKey: string;
}): Promise<PutResumeDocumentContentRevisionResponse> {
  try {
    return await input.db.transaction().execute(async (transaction) => {
      await lockOwnerIdempotencyKey(transaction, {
        ownerId: input.owner.ownerId,
        scope: `resume-content-revision:${input.documentId}`,
        idempotencyKey: input.idempotencyKey,
      });
      return appendResumeDocumentContentRevisionInTransaction({
        transaction,
        owner: input.owner,
        documentId: input.documentId,
        request: input.request,
        idempotencyKey: input.idempotencyKey,
      });
    });
  } catch (error) {
    const constraint = postgresConstraint(error);
    if (constraint === "resume_document_revisions_legacy_source_unique") {
      throw legacySourceAlreadyMigrated();
    }
    if (constraint === "resume_document_revisions_mutation_key_unique") {
      throw idempotencyKeyReused();
    }
    throw error;
  }
}

export async function putResumeDocumentLayoutRevision(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  documentId: string;
  request: PutResumeDocumentLayoutRevisionRequest;
  idempotencyKey: string;
}): Promise<PutResumeDocumentLayoutRevisionResponse> {
  const requestHash = hashCanonicalJson({
    operation: "resume-layout-revision-v1",
    documentId: input.documentId,
    request: input.request,
  });
  try {
    return await input.db.transaction().execute(async (transaction) => {
      await lockOwnerIdempotencyKey(transaction, {
        ownerId: input.owner.ownerId,
        scope: `resume-layout-revision:${input.documentId}`,
        idempotencyKey: input.idempotencyKey,
      });
      await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);
      const document = await loadDocumentForUpdate(transaction, input.owner, input.documentId);
      if (!document) throw resumeDocumentNotFound();

      const replay = await layoutRevisionSelect(transaction)
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .where("document_id", "=", document.id)
        .where("mutation_idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();
      if (replay) {
        if (replay.mutation_request_hash !== requestHash) throw idempotencyKeyReused();
        if (!replay.result_document_revision) {
          throw new Error("RESUME_LAYOUT_MUTATION_RECEIPT_INVALID");
        }
        return PutResumeDocumentLayoutRevisionResponseSchema.parse({
          layoutRevision: mapLayoutRevisionV2(replay as ResumeLayoutRevisionRow),
          documentRevision: Number(replay.result_document_revision),
          created: true,
        });
      }

      if (Number(document.revision) !== input.request.expectedRevision) {
        throw documentRevisionConflict(Number(document.revision));
      }
      const contentChain = await loadContentChain(transaction, input.owner, document);
      if (!contentChain.current) throw contentPointerInvalid();
      const currentContent = mapContentRevision(contentChain.current).content;
      const expectedSectionIds = contentIds(currentContent).sections;
      const requestedSectionIds = new Set(input.request.sectionOrder);
      if (!sameSet(expectedSectionIds, requestedSectionIds)) throw layoutSectionOrderInvalid();

      const layoutChain = await loadLayoutChain(transaction, input.owner, document);
      const contentHash = layoutHash({
        templateKey: input.request.templateKey,
        sectionOrder: input.request.sectionOrder,
        settings: input.request.settings,
      });
      if (layoutChain.current?.content_hash === contentHash) throw layoutUnchanged();

      const documentRevision = Number(document.revision) + 1;
      const layoutRevisionId = randomUUID();
      await transaction
        .insertInto("profile.resume_layout_revisions")
        .values({
          id: layoutRevisionId,
          owner_id: input.owner.ownerId,
          owner_epoch: input.owner.ownerEpoch,
          document_id: document.id,
          layout_revision: Number(layoutChain.latest?.layout_revision ?? 0) + 1,
          base_layout_revision: layoutChain.current
            ? Number(layoutChain.current.layout_revision)
            : null,
          schema_version: "resume-layout-v2",
          template_key: input.request.templateKey,
          section_order: JSON.stringify(input.request.sectionOrder) as unknown as JsonValue,
          settings: JSON.stringify(input.request.settings) as unknown as JsonValue,
          content_hash: contentHash,
          mutation_idempotency_key: input.idempotencyKey,
          mutation_request_hash: requestHash,
          result_document_revision: documentRevision,
        })
        .execute();
      const updated = await transaction
        .updateTable("profile.resume_documents")
        .set({
          current_layout_revision_id: layoutRevisionId,
          revision: documentRevision,
          updated_at: sql<Date>`GREATEST(updated_at, clock_timestamp())`,
        })
        .where("id", "=", document.id)
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .where("revision", "=", document.revision)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) {
        throw documentRevisionConflict(Number(document.revision));
      }
      const row = await layoutRevisionSelect(transaction)
        .where("id", "=", layoutRevisionId)
        .where("owner_id", "=", input.owner.ownerId)
        .executeTakeFirstOrThrow();
      return PutResumeDocumentLayoutRevisionResponseSchema.parse({
        layoutRevision: mapLayoutRevisionV2(row as ResumeLayoutRevisionRow),
        documentRevision,
        created: true,
      });
    });
  } catch (error) {
    const constraint = postgresConstraint(error);
    if (constraint === "resume_layout_revisions_mutation_key_unique") {
      throw idempotencyKeyReused();
    }
    throw error;
  }
}
