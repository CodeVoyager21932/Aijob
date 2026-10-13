import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import { ResumeOriginalSchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import {
  hasNativeResumeContent,
  importNativeChineseBlocks,
  type NativeResumeDocument,
  parseNativeResumeDocument,
} from "@aijob/resume-core";
import { type Kysely, sql } from "kysely";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { encryptResumePayload } from "../resume/crypto.js";
import { extractNativeResumeBlocks } from "../resume/native-extraction.js";
import { ResumeInputError, validateResumeUpload } from "../resume/security.js";
import { type OwnerTaskLease, withOwnerTaskLease } from "../workers/owner-task-lease.js";
import {
  getNativeStudioDraft,
  saveNativeStudioDraftInTransaction,
} from "./native-studio-service.js";
import { downloadStudioOriginal } from "./studio-import.js";

/** Adds a private original and a task atomically. Parsing never happens in the API process. */
export async function queueNativeImport(
  db: Kysely<Database>,
  owner: OwnerScope,
  documentId: string,
  input: {
    filename: string;
    mediaType: string;
    buffer: Buffer;
    encryptionKey: string;
    expectedRevision: number;
    kind?: "text";
  },
  key: string,
) {
  if (input.kind === "text") {
    const text = input.buffer.toString("utf8");
    if (!text.trim()) throw new ResumeInputError("RESUME_EMPTY", "请先粘贴简历内容。");
    if (text.length > 100000)
      throw new ResumeInputError("RESUME_TOO_LARGE", "粘贴内容不能超过 10 万字。");
    if (
      input.mediaType !== "text/plain" ||
      !Buffer.from(text, "utf8").equals(input.buffer) ||
      input.buffer.some((byte) => byte < 32 && ![9, 10, 13].includes(byte))
    )
      throw new ResumeInputError("RESUME_TYPE_MISMATCH", "请使用可阅读的 UTF-8 文本。");
  } else
    validateResumeUpload({
      filename: input.filename,
      mimetype: input.mediaType,
      buffer: input.buffer,
      maxBytes: 5 * 1024 * 1024,
    });
  const encrypted = encryptResumePayload(input.buffer, input.encryptionKey);
  const requestHash = hashCanonicalJson({
    documentId,
    filename: input.filename,
    hash: encrypted.plaintextSha256,
    expectedRevision: input.expectedRevision,
  });
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    await tx
      .selectFrom("profile.resume_documents")
      .select("id")
      .where("id", "=", documentId)
      .where("owner_id", "=", owner.ownerId)
      .forUpdate()
      .execute();
    const draft = await getNativeStudioDraft(tx, owner, documentId);
    const receiptKey = `native-import:${key}`;
    const receipt = (
      await sql<{
        request_hash: string;
        result: { originalId: string };
      }>`SELECT request_hash,result FROM profile.resume_draft_receipts WHERE document_id=${documentId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND idempotency_key=${receiptKey}`.execute(
        tx,
      )
    ).rows[0];
    if (receipt) {
      if (receipt.request_hash !== requestHash)
        throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "请求编号对应了不同文件。");
      const retained = (
        await sql`SELECT id FROM profile.resume_originals WHERE id=${receipt.result.originalId} AND document_id=${documentId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
          tx,
        )
      ).rows.length;
      if (!retained)
        throw new ServiceError(
          410,
          "RESUME_ORIGINAL_DELETED",
          "原件已删除，旧上传请求不会恢复它。",
        );
      return receipt.result;
    }
    if (draft.revision !== input.expectedRevision)
      throw new ServiceError(409, "RESUME_DRAFT_CONFLICT", "请先保存当前修改，再导入文件。");
    const existing = (
      await sql<{
        id: string;
      }>`SELECT id FROM profile.resume_originals WHERE document_id=${documentId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND content_hash=${encrypted.plaintextSha256}`.execute(
        tx,
      )
    ).rows[0];
    const originalId = existing?.id ?? randomUUID();
    if (!existing) {
      await sql`INSERT INTO profile.resume_originals(id,owner_id,owner_epoch,document_id,filename,media_type,byte_size,content_hash,ciphertext,nonce,auth_tag,key_version) VALUES(${originalId},${owner.ownerId},${owner.ownerEpoch},${documentId},${input.filename},${input.mediaType},${input.buffer.length},${encrypted.plaintextSha256},${encrypted.ciphertext},${encrypted.initializationVector},${encrypted.authenticationTag},'local-mvp-v1')`.execute(
        tx,
      );
      await tx
        .insertInto("task_queue.tasks")
        .values({
          id: randomUUID(),
          task_type: "resume_studio_import",
          owner_id: owner.ownerId,
          owner_epoch: owner.ownerEpoch,
          payload: JSON.stringify({
            originalId,
            documentId,
            expectedRevision: draft.revision,
            editorCore: "native-v1",
          }),
          idempotency_key: `resume-native-import:${originalId}`,
          status: "queued",
          attempt: 0,
          max_attempts: 3,
          available_at: new Date(),
          backoff_policy: JSON.stringify({ baseMs: 1000, maxMs: 30000 }),
          lease_owner: null,
          lease_until: null,
          heartbeat_at: null,
          last_error_code: null,
          last_error_summary: null,
          completed_at: null,
        })
        .execute();
    }
    const result = { originalId };
    await sql`INSERT INTO profile.resume_draft_receipts(owner_id,owner_epoch,document_id,idempotency_key,request_hash,result) VALUES(${owner.ownerId},${owner.ownerEpoch},${documentId},${receiptKey},${requestHash},${JSON.stringify(result)}::jsonb)`.execute(
      tx,
    );
    return result;
  });
}

export function nativeImportedContent(current: NativeResumeDocument, parsed: NativeResumeDocument) {
  const document = structuredClone(parsed);
  document.data.metadata = structuredClone(current.data.metadata);
  if (!document.data.picture.url) document.data.picture = structuredClone(current.data.picture);
  if (current.presentation) document.presentation = structuredClone(current.presentation);
  const layoutIds = new Set(
    document.data.metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]),
  );
  for (const section of document.data.customSections)
    if (!layoutIds.has(section.id)) document.data.metadata.layout.pages[0]?.main.push(section.id);
  return parseNativeResumeDocument(document);
}

export async function processNativeImport(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  originalId: string;
  documentId: string;
  expectedRevision: number;
  config: AppConfig;
  lease: OwnerTaskLease;
  signal?: AbortSignal;
}) {
  const { db, owner, originalId, documentId } = input;
  const row = (
    await sql<{
      status: string;
    }>`SELECT status FROM profile.resume_originals WHERE id=${originalId} AND document_id=${documentId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
      db,
    )
  ).rows[0];
  if (!row || row.status !== "queued") return;
  let extracted: Awaited<ReturnType<typeof extractNativeResumeBlocks>>;
  try {
    await getNativeStudioDraft(db, owner, documentId);
    const original = await downloadStudioOriginal(
      db,
      owner,
      originalId,
      input.config.resumeEncryptionKey,
    );
    extracted = await extractNativeResumeBlocks({
      kind:
        original.mediaType === "text/plain"
          ? "text"
          : original.mediaType === "application/pdf"
            ? "pdf"
            : "docx",
      buffer: original.buffer,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.config.resumeParser
        ? {
            sandbox: {
              mode: input.config.resumeParser.mode,
              ...(input.config.resumeParser.containerImage
                ? { containerImage: input.config.resumeParser.containerImage }
                : {}),
            },
          }
        : {}),
    });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    await withOwnerTaskLease(db, input.lease, async (tx) => {
      await sql`UPDATE profile.resume_originals SET status='failed',failure_code=${error instanceof ResumeInputError ? error.code : "RESUME_PARSE_FAILED"} WHERE id=${originalId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
        tx,
      );
    });
    return;
  }
  const result = importNativeChineseBlocks(extracted.blocks, originalId);
  const payload = { schemaVersion: "native-import-v1", ...extracted, result };
  await withOwnerTaskLease(db, input.lease, async (tx) => {
    // Same lock order as save/upload; deletion and late work cannot revive an original.
    await tx
      .selectFrom("profile.resume_documents")
      .select("id")
      .where("id", "=", documentId)
      .where("owner_id", "=", owner.ownerId)
      .forUpdate()
      .execute();
    const exists = (
      await sql`SELECT id FROM profile.resume_originals WHERE id=${originalId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} FOR UPDATE`.execute(
        tx,
      )
    ).rows.length;
    if (!exists) return;
    const draft = await getNativeStudioDraft(tx, owner, documentId);
    // Make the immutable extraction available to source-binding validation in this same transaction.
    await sql`UPDATE profile.resume_originals SET parsed_content=${JSON.stringify(payload)}::jsonb WHERE id=${originalId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
      tx,
    );
    const blank = !hasNativeResumeContent(draft.document);
    let status = "ready";
    if (blank && draft.revision === input.expectedRevision) {
      await saveNativeStudioDraftInTransaction(
        tx,
        owner,
        documentId,
        {
          expectedRevision: draft.revision,
          title: draft.title,
          document: nativeImportedContent(draft.document, result.document),
        },
        `import:${originalId}`,
      );
      status = "succeeded";
    }
    // Keep the source mapping independently of the editable draft, including after success.
    await sql`UPDATE profile.resume_originals SET status=${status},parsed_content=${JSON.stringify(payload)}::jsonb WHERE id=${originalId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
      tx,
    );
  });
}

export async function getNativeImport(
  db: Kysely<Database>,
  owner: OwnerScope,
  documentId: string,
  originalId: string,
) {
  const draft = await getNativeStudioDraft(db, owner, documentId);
  const linked =
    draft.document.sourceBindings?.some((binding) => binding.originalId === originalId) ?? false;
  const row = (
    await sql<{
      id: string;
      filename: string;
      status: string;
      failure_code: string | null;
      parsed_content: unknown;
    }>`SELECT id,filename,status,failure_code,parsed_content FROM profile.resume_originals WHERE id=${originalId} AND (document_id=${documentId} OR ${linked}) AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
      db,
    )
  ).rows[0];
  if (!row) throw new ServiceError(404, "RESUME_ORIGINAL_NOT_FOUND", "原件不存在或已删除。");
  return {
    originalId: row.id,
    filename: row.filename,
    status: row.status,
    failureCode: row.failure_code,
    parsed: row.parsed_content,
  };
}

/** Copies retain links to the owner's original; the binary is never duplicated. */
export async function listNativeImports(
  db: Kysely<Database>,
  owner: OwnerScope,
  documentId: string,
) {
  const draft = await getNativeStudioDraft(db, owner, documentId);
  const ids = [
    ...new Set((draft.document.sourceBindings ?? []).map((binding) => binding.originalId)),
  ];
  const linked = ids.length ? sql`id::text IN (${sql.join(ids)})` : sql`false`;
  const { rows } = await sql<{
    id: string;
    document_id: string;
    filename: string;
    media_type: string;
    byte_size: number;
    created_at: Date;
    status: string;
    failure_code: string | null;
  }>`SELECT id,document_id,filename,media_type,byte_size,created_at,status,failure_code
    FROM profile.resume_originals WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}
    AND (document_id=${documentId} OR ${linked}) ORDER BY created_at DESC`.execute(db);
  return rows.map((row) =>
    ResumeOriginalSchema.parse({
      id: row.id,
      documentId: row.document_id,
      filename: row.filename,
      mediaType: row.media_type,
      byteSize: row.byte_size,
      createdAt: new Date(row.created_at).toISOString(),
      status: row.status,
      failureCode: row.failure_code,
    }),
  );
}
