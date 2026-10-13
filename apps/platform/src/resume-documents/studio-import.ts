import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  ResumeOriginalSchema,
  ResumeStudioContentSchema,
  ResumeStudioDraftSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { decryptResumePayload, encryptResumePayload } from "../resume/crypto.js";
import { parseResumeBuffer } from "../resume/parse.js";
import { ResumeInputError } from "../resume/security.js";
import { type OwnerTaskLease, withOwnerTaskLease } from "../workers/owner-task-lease.js";
import { importStudioText } from "./studio-content.js";
import {
  createStudioDocument,
  getStudioDraft,
  saveStudioDraftInTransaction,
  studioJson,
  studioMissing,
} from "./studio-service.js";

export async function createStudioImport(
  db: Kysely<Database>,
  owner: OwnerScope,
  input: { filename: string; mediaType: string; buffer: Buffer; encryptionKey: string },
  idempotencyKey: string,
) {
  const encrypted = encryptResumePayload(input.buffer, input.encryptionKey);
  const draft = await createStudioDocument(
    db,
    owner,
    {
      title: input.filename.replace(/\.(pdf|docx)$/i, "").slice(0, 180) || "导入的简历",
      sourceHash: encrypted.plaintextSha256,
    },
    idempotencyKey,
  );
  await db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const present = (
      await sql<{
        id: string;
      }>`SELECT id FROM profile.resume_originals WHERE owner_id=${owner.ownerId} AND document_id=${draft.documentId} AND content_hash=${encrypted.plaintextSha256}`.execute(
        tx,
      )
    ).rows[0];
    if (present) return;
    const id = randomUUID();
    await sql`INSERT INTO profile.resume_originals(id,owner_id,owner_epoch,document_id,filename,media_type,byte_size,content_hash,ciphertext,nonce,auth_tag,key_version) VALUES(${id},${owner.ownerId},${owner.ownerEpoch},${draft.documentId},${input.filename},${input.mediaType},${input.buffer.length},${encrypted.plaintextSha256},${encrypted.ciphertext},${encrypted.initializationVector},${encrypted.authenticationTag},'local-mvp-v1')`.execute(
      tx,
    );
    await tx
      .insertInto("task_queue.tasks")
      .values({
        id: randomUUID(),
        task_type: "resume_studio_import",
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        payload: studioJson({
          originalId: id,
          documentId: draft.documentId,
          expectedRevision: draft.revision,
        }),
        idempotency_key: `resume-studio-import:${id}`,
        status: "queued",
        attempt: 0,
        max_attempts: 3,
        available_at: new Date(),
        backoff_policy: studioJson({ baseMs: 1000, maxMs: 30000 }),
        lease_owner: null,
        lease_until: null,
        heartbeat_at: null,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();
  });
  return { draft, originals: await listStudioOriginals(db, owner, draft.documentId) };
}
export async function listStudioOriginals(
  db: Kysely<Database>,
  owner: OwnerScope,
  documentId: string,
) {
  await assertOriginalDocument(db, owner, documentId);
  const { rows } = await sql<{
    id: string;
    document_id: string;
    filename: string;
    media_type: string;
    byte_size: number;
    created_at: Date;
    status: string;
    failure_code: string | null;
  }>`SELECT id,document_id,filename,media_type,byte_size,created_at,status,failure_code FROM profile.resume_originals WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND document_id=${documentId} ORDER BY created_at DESC`.execute(
    db,
  );
  return rows.map((r) =>
    ResumeOriginalSchema.parse({
      id: r.id,
      documentId: r.document_id,
      filename: r.filename,
      mediaType: r.media_type,
      byteSize: r.byte_size,
      createdAt: new Date(r.created_at).toISOString(),
      status: r.status,
      failureCode: r.failure_code,
    }),
  );
}
export async function downloadStudioOriginal(
  db: Kysely<Database>,
  owner: OwnerScope,
  id: string,
  encryptionKey: string,
) {
  const { rows } = await sql<{
    document_id: string;
    filename: string;
    media_type: string;
    ciphertext: Buffer;
    nonce: Buffer;
    auth_tag: Buffer;
  }>`SELECT * FROM profile.resume_originals WHERE id=${id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
    db,
  );
  const row = rows[0];
  if (!row) throw studioMissing();
  await assertOriginalDocument(db, owner, row.document_id);
  return {
    buffer: decryptResumePayload(
      {
        ciphertext: row.ciphertext,
        initializationVector: row.nonce,
        authenticationTag: row.auth_tag,
      },
      encryptionKey,
    ),
    filename: row.filename,
    mediaType: row.media_type,
  };
}
/** Original access is independent of editor format; document ownership remains required. */
async function assertOriginalDocument(db:Kysely<Database>,owner:OwnerScope,documentId:string) {
  const row=await db.selectFrom("profile.resume_documents").select("id").where("id","=",documentId).where("owner_id","=",owner.ownerId).where("owner_epoch","=",owner.ownerEpoch).where("deleted_at","is",null).executeTakeFirst();
  if(!row)throw studioMissing();
}
export async function processStudioImport(input: {
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
  const current = (
    await sql<{
      status: string;
    }>`SELECT status FROM profile.resume_originals WHERE id=${originalId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
      db,
    )
  ).rows[0];
  if (!current || current.status !== "queued") return;
  let content: ReturnType<typeof ResumeStudioContentSchema.parse>;
  try {
    const original = await downloadStudioOriginal(
      db,
      owner,
      originalId,
      input.config.resumeEncryptionKey,
    );
    const text = await parseResumeBuffer({
      kind: original.mediaType === "application/pdf" ? "pdf" : "docx",
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
    content = ResumeStudioContentSchema.parse(importStudioText(text));
  } catch (error) {
    if (input.signal?.aborted) throw error;
    await withOwnerTaskLease(db, input.lease, async (tx) => {
      await sql`UPDATE profile.resume_originals SET status='failed',failure_code=${error instanceof ResumeInputError ? error.code : "RESUME_PARSE_FAILED"} WHERE id=${originalId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
        tx,
      );
    });
    return;
  }
  await withOwnerTaskLease(db, input.lease, async (tx) => {
    const exists = (
      await sql`SELECT id FROM profile.resume_originals WHERE id=${originalId} AND owner_id=${owner.ownerId} FOR UPDATE`.execute(
        tx,
      )
    ).rows.length;
    if (!exists) return;
    const draft = await getStudioDraft(tx, owner, documentId);
    if (draft.revision === input.expectedRevision) {
      await saveStudioDraftInTransaction(
        tx,
        owner,
        documentId,
        {
          title: draft.title,
          expectedRevision: draft.revision,
          content,
          // Parsing supplies content only. Preserve the document's chosen,
          // versioned template instead of resetting it to the legacy defaults.
          layout: draft.layout,
        },
        `import:${originalId}`,
      );
      await sql`UPDATE profile.resume_originals SET status='succeeded' WHERE id=${originalId} AND owner_id=${owner.ownerId}`.execute(
        tx,
      );
      await sql`UPDATE profile.resume_experience_links SET capture_open=false WHERE document_id=${documentId} AND owner_id=${owner.ownerId}`.execute(
        tx,
      );
    } else {
      await sql`UPDATE profile.resume_originals SET status='ready',parsed_content=${studioJson(content)}::jsonb WHERE id=${originalId} AND owner_id=${owner.ownerId}`.execute(
        tx,
      );
    }
  });
}

/** Applying a completed parse is one user mutation even when its response is lost. */
export async function applyStudioParsedOriginal(
  db: Kysely<Database>,
  owner: OwnerScope,
  originalId: string,
  expectedRevision: number,
  idempotencyKey: string,
) {
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const row = (
      await sql<{
        document_id: string;
        parsed_content: unknown;
      }>`SELECT document_id,parsed_content FROM profile.resume_originals WHERE id=${originalId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} FOR UPDATE`.execute(
        tx,
      )
    ).rows[0];
    if (!row) throw studioMissing();
    const draft = await getStudioDraft(tx, owner, row.document_id);
    const key = `use-parsed:${originalId}:${idempotencyKey}`;
    const hash = hashCanonicalJson({ originalId, expectedRevision });
    const replay = (
      await sql<{
        request_hash: string;
        result: unknown;
      }>`SELECT request_hash,result FROM profile.resume_draft_receipts WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND document_id=${row.document_id} AND idempotency_key=${key}`.execute(
        tx,
      )
    ).rows[0];
    if (replay) {
      if (replay.request_hash !== hash)
        throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "请求编号对应了不同内容。");
      return ResumeStudioDraftSchema.parse(replay.result);
    }
    if (!row.parsed_content) throw studioMissing();
    const result = await saveStudioDraftInTransaction(
      tx,
      owner,
      row.document_id,
      {
        title: draft.title,
        layout: draft.layout,
        expectedRevision,
        content: ResumeStudioContentSchema.parse(row.parsed_content),
      },
      `save:${key}`,
    );
    await sql`UPDATE profile.resume_originals SET status='succeeded',parsed_content=NULL WHERE id=${originalId} AND owner_id=${owner.ownerId}`.execute(
      tx,
    );
    await sql`UPDATE profile.resume_experience_links SET capture_open=false WHERE document_id=${row.document_id} AND owner_id=${owner.ownerId}`.execute(
      tx,
    );
    await sql`INSERT INTO profile.resume_draft_receipts(owner_id,owner_epoch,document_id,idempotency_key,request_hash,result) VALUES(${owner.ownerId},${owner.ownerEpoch},${row.document_id},${key},${hash},${studioJson(result)}::jsonb)`.execute(
      tx,
    );
    return result;
  });
}
