import { randomUUID } from "node:crypto";
import type { Database } from "@aijob/database";
import {
  createNativeResumeDocument,
  applyNativeTemplate,
  insertNativeExperience,
  joinNativeResumeDocument,
  type NativeResumeDocument,
  splitNativeResumeDocument,
} from "@aijob/resume-core";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  assertActiveOwnerEpoch,
  type OwnerScope,
  retainOwnerAssetsAfterMaterialSave,
} from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { captureNativeExperiences, listReusableNativeExperiences } from "./native-experiences.js";
import { assertNativePhoto } from "./native-photo.js";
import { assertNativeSourceBindings } from "./native-source-bindings.js";
import { createResumeDocument } from "./service.js";
import { recordTemplateUse } from "./template-library.js";

type Db = Kysely<Database> | Transaction<Database>;
export interface NativeStudioDraft {
  documentId: string;
  caseId?: string | null;
  revision: number;
  title: string;
  document: NativeResumeDocument;
  updatedAt: string;
}
interface DraftRow {
  document_id: string;
  case_id: string | null;
  revision: number;
  title: string;
  content: unknown;
  layout: unknown;
  updated_at: Date;
}
const missing = () => new ServiceError(404, "RESUME_NOT_FOUND", "这份简历不存在或已删除。");
const conflict = () =>
  new ServiceError(409, "RESUME_DRAFT_CONFLICT", "已有较新的修改，你的输入仍保留。");
const wrongCore = () =>
  new ServiceError(
    409,
    "RESUME_CORE_VERSION_MISMATCH",
    "请使用对应版本的编辑器；旧稿需显式转换，不能直接覆盖。",
  );
const isNative = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  "schemaVersion" in value &&
  value.schemaVersion === "aijob-native-resume-v1";
const mapDraft = (row: DraftRow): NativeStudioDraft => ({
  documentId: row.document_id,
  caseId: row.case_id,
  revision: Number(row.revision),
  title: row.title,
  document: joinNativeResumeDocument(row.content, row.layout),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function getNativeStudioDraft(
  db: Db,
  owner: OwnerScope,
  documentId: string,
): Promise<NativeStudioDraft> {
  const row = (
    await sql<DraftRow>`SELECT s.*,d.case_id FROM profile.resume_document_drafts s JOIN profile.resume_documents d ON d.id=s.document_id WHERE d.id=${documentId} AND d.owner_id=${owner.ownerId} AND d.owner_epoch=${owner.ownerEpoch} AND d.deleted_at IS NULL AND s.owner_id=${owner.ownerId} AND s.owner_epoch=${owner.ownerEpoch}`.execute(
      db,
    )
  ).rows[0];
  if (!row) throw missing();
  if (!isNative(row.content)) throw wrongCore();
  return mapDraft(row);
}

export interface SaveNativeStudioDraft {
  expectedRevision: number;
  title: string;
  document: NativeResumeDocument;
}

export function saveNativeStudioDraft(
  db: Kysely<Database>,
  owner: OwnerScope,
  documentId: string,
  request: SaveNativeStudioDraft,
  idempotencyKey: string,
) {
  return db
    .transaction()
    .execute((tx) =>
      saveNativeStudioDraftInTransaction(tx, owner, documentId, request, idempotencyKey),
    );
}

/** The caller owns the transaction, including an import lease or other atomic work. */
export async function saveNativeStudioDraftInTransaction(
  tx: Transaction<Database>,
  owner: OwnerScope,
  documentId: string,
  request: SaveNativeStudioDraft,
  idempotencyKey: string,
) {
  // All validation precedes persistence. No tolerant schema or projection writes.
  const pair = splitNativeResumeDocument(request.document);
  if (
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 0 ||
    !request.title.trim() ||
    request.title.length > 200 ||
    !idempotencyKey ||
    idempotencyKey.length > 180
  )
    throw new ServiceError(400, "INVALID_NATIVE_DRAFT", "请检查标题和保存版本。");
  const requestHash = hashCanonicalJson(request);
  await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
  const doc = await tx
    .selectFrom("profile.resume_documents")
    .select("id")
    .where("id", "=", documentId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("deleted_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
  if (!doc) throw missing();
  await assertNativePhoto(tx, owner, request.document);
  const current = (
    await sql<DraftRow>`SELECT * FROM profile.resume_document_drafts WHERE document_id=${documentId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
      tx,
    )
  ).rows[0];
  if (current && !isNative(current.content)) throw wrongCore();
  const key = `native:${idempotencyKey}`;
  const replay = (
    await sql<{
      request_hash: string;
      result: NativeStudioDraft;
    }>`SELECT request_hash,result FROM profile.resume_draft_receipts WHERE document_id=${documentId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND idempotency_key=${key}`.execute(
      tx,
    )
  ).rows[0];
  if (replay) {
    if (replay.request_hash !== requestHash)
      throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "请求编号对应了不同内容。");
    return replay.result;
  }
  if (Number(current?.revision ?? 0) !== request.expectedRevision) throw conflict();
  await assertNativeSourceBindings(tx, owner, request.document, current ? mapDraft(current).document : undefined);
  await retainOwnerAssetsAfterMaterialSave(tx, owner);
  const contentHash = hashCanonicalJson({ title: request.title, ...pair });
  const unchanged =
    current &&
    hashCanonicalJson({
      title: current.title,
      content: current.content,
      layout: current.layout,
    }) === contentHash;
  if (!unchanged) {
    const previousTemplate = current ? mapDraft(current).document.presentation?.id : undefined;
    if (request.document.presentation?.id && request.document.presentation.id !== previousTemplate)
      await recordTemplateUse(tx, owner, `native:${request.document.presentation.id}`);
    await captureNativeExperiences(tx, owner, documentId, request.document);
    await sql`INSERT INTO profile.resume_document_drafts(document_id,owner_id,owner_epoch,revision,title,content,layout,content_hash) VALUES(${documentId},${owner.ownerId},${owner.ownerEpoch},${request.expectedRevision + 1},${request.title},${JSON.stringify(pair.content)}::jsonb,${JSON.stringify(pair.layout)}::jsonb,${contentHash}) ON CONFLICT(document_id) DO UPDATE SET revision=EXCLUDED.revision,title=EXCLUDED.title,content=EXCLUDED.content,layout=EXCLUDED.layout,content_hash=EXCLUDED.content_hash,updated_at=clock_timestamp()`.execute(
      tx,
    );
    await tx
      .updateTable("profile.resume_documents")
      .set({
        title: request.title,
        updated_at: sql<Date>`GREATEST(clock_timestamp(), created_at, updated_at)`,
      })
      .where("id", "=", documentId)
      .where("owner_id", "=", owner.ownerId)
      .execute();
  }
  const result = await getNativeStudioDraft(tx, owner, documentId);
  await sql`INSERT INTO profile.resume_draft_receipts(owner_id,owner_epoch,document_id,idempotency_key,request_hash,result) VALUES(${owner.ownerId},${owner.ownerEpoch},${documentId},${key},${requestHash},${JSON.stringify(result)}::jsonb)`.execute(
    tx,
  );
  return result;
}

export async function createNativeStudioDraft(
  db: Kysely<Database>,
  owner: OwnerScope,
  title: string,
  idempotencyKey: string,
  experienceIds: string[] = [],
  useStudioTemplates = true,
) {
  if (experienceIds.length > 50 || new Set(experienceIds).size !== experienceIds.length)
    throw new ServiceError(422, "INVALID_EXPERIENCE_SELECTION", "请选择不重复的经历，最多 50 段。");
  const created = await createResumeDocument({
    db,
    owner,
    request: { kind: "base", title },
    idempotencyKey: `native-create:${idempotencyKey}`,
    initializeBase: {
      ...(experienceIds.length ? { fingerprint: { experienceIds } } : {}),
      run: async (tx, id) => {
        const fresh = createNativeResumeDocument();
        const document = useStudioTemplates ? fresh : applyNativeTemplate(fresh,"lapis-cn");
        if (experienceIds.length) {
          const originals = await listReusableNativeExperiences(tx, owner, experienceIds);
          for (const experienceId of experienceIds) {
            const original = originals.find((item) => item.id === experienceId);
            if (!original)
              throw new ServiceError(
                404,
                "EXPERIENCE_NOT_FOUND",
                "所选经历已删除或不属于当前账户。",
              );
            insertNativeExperience(document, original.experience, randomUUID());
          }
        }
        await saveNativeStudioDraftInTransaction(
          tx,
          owner,
          id,
          { expectedRevision: 0, title, document },
          `initial:${idempotencyKey}`,
        );
      },
    },
  });
  return getNativeStudioDraft(db, owner, created.resumeDocument.id);
}
