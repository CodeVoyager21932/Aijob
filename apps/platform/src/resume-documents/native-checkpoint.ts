import { randomUUID } from "node:crypto";
import type { Database } from "@aijob/database";
import { joinNativeResumeDocument, splitNativeResumeDocument } from "@aijob/resume-core";
import { type Kysely, sql, type Transaction } from "kysely";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { getNativeStudioDraft } from "./native-studio-service.js";

export async function checkpointNativeDraft(
  db: Kysely<Database>,
  owner: OwnerScope,
  documentId: string,
  expectedRevision: number,
  purpose: "preview" | "retained" = "retained",
) {
  return db.transaction().execute((tx) => checkpointNativeDraftInTransaction(tx, owner, documentId, expectedRevision, purpose));
}

export async function checkpointNativeDraftInTransaction(
  tx: Transaction<Database>, owner: OwnerScope, documentId: string, expectedRevision: number,
  purpose: "preview" | "retained" = "retained",
) {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const doc = await tx
      .selectFrom("profile.resume_documents")
      .selectAll()
      .where("id", "=", documentId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("deleted_at", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!doc) throw new ServiceError(404, "RESUME_NOT_FOUND", "简历不存在或已删除。");
    const draft = await getNativeStudioDraft(tx, owner, documentId);
    if (draft.revision !== expectedRevision)
      throw new ServiceError(
        409,
        "RESUME_DRAFT_CONFLICT",
        "保存版本已变化，请保存最新输入后重试。",
      );
    if (purpose === "retained") await sql`UPDATE profile.resume_experience_links SET capture_open=false WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND document_id=${documentId}`.execute(
      tx,
    );
    const pair = splitNativeResumeDocument(draft.document),
      contentHash = hashCanonicalJson(pair.content),
      layoutHash = hashCanonicalJson(pair.layout);
    const previous = (
      await sql<{
        content_id: string;
        layout_id: string;
      }>`SELECT c.id content_id,l.id layout_id FROM profile.resume_document_revisions c JOIN profile.resume_layout_revisions l ON c.document_id=l.document_id AND c.owner_id=l.owner_id AND c.result_document_revision=l.result_document_revision WHERE c.id=${doc.current_content_revision_id} AND l.id=${doc.current_layout_revision_id} AND c.content_hash=${contentHash} AND l.content_hash=${layoutHash}`.execute(
        tx,
      )
    ).rows[0];
    if (previous) {
      if (purpose === "retained") await retainNativeCheckpoint(tx, owner, previous.content_id);
      return { contentRevisionId: previous.content_id, layoutRevisionId: previous.layout_id };
    }
    const contentId = randomUUID(),
      layoutId = randomUUID(),
      resultRevision = Number(doc.revision) + 1;
    const key = `native-checkpoint:${draft.revision}`,
      requestHash = hashCanonicalJson({ contentHash, layoutHash });
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`resume-evidence:${owner.ownerId}`},0))`.execute(tx);
    await sql`INSERT INTO profile.resume_document_revisions(id,owner_id,owner_epoch,resume_analysis_id,revision,base_revision,schema_version,sections,studio_content,content_hash,confirmed_at,document_id,document_revision,base_document_revision_id,result_document_revision,mutation_idempotency_key,mutation_request_hash)
      SELECT ${contentId},${owner.ownerId},${owner.ownerEpoch},NULL,COALESCE(MAX(revision),0)+1,NULL,'aijob-native-content-v1','[]'::jsonb,${JSON.stringify(pair.content)}::jsonb,${contentHash},clock_timestamp(),${documentId},
      (SELECT COALESCE(MAX(document_revision),0)+1 FROM profile.resume_document_revisions WHERE document_id=${documentId}),${doc.current_content_revision_id},${resultRevision},${key},${requestHash} FROM profile.resume_document_revisions WHERE owner_id=${owner.ownerId}`.execute(
      tx,
    );
    await sql`INSERT INTO profile.resume_layout_revisions(id,owner_id,owner_epoch,document_id,layout_revision,base_layout_revision,schema_version,template_key,section_order,settings,studio_layout,content_hash,result_document_revision,mutation_idempotency_key,mutation_request_hash)
      SELECT ${layoutId},${owner.ownerId},${owner.ownerEpoch},${documentId},COALESCE(MAX(layout_revision),0)+1,MAX(layout_revision),'aijob-native-layout-v1','native','[]'::jsonb,'{}'::jsonb,${JSON.stringify(pair.layout)}::jsonb,${layoutHash},${resultRevision},${key},${requestHash} FROM profile.resume_layout_revisions WHERE document_id=${documentId} AND owner_id=${owner.ownerId}`.execute(
      tx,
    );
    await tx
      .updateTable("profile.resume_documents")
      .set({
        current_content_revision_id: contentId,
        current_layout_revision_id: layoutId,
        revision: resultRevision,
        updated_at: sql<Date>`GREATEST(clock_timestamp(), created_at, updated_at)`,
      })
      .where("id", "=", documentId)
      .execute();
    await sql`INSERT INTO profile.native_checkpoint_visibility(owner_id,owner_epoch,document_id,content_revision_id,layout_revision_id,retained)
      VALUES(${owner.ownerId},${owner.ownerEpoch},${documentId},${contentId},${layoutId},${purpose === "retained"})`.execute(tx);
    return { contentRevisionId: contentId, layoutRevisionId: layoutId };
}

export async function loadNativeSnapshot(
  db: Kysely<Database> | Transaction<Database>,
  owner: OwnerScope,
  documentId: string,
  pair: { contentRevisionId: string; layoutRevisionId: string },
) {
  await assertActiveOwnerEpoch(db, owner.ownerId, owner.ownerEpoch);
  const row = (
    await sql<{
      title: string;
      content: unknown;
      layout: unknown;
    }>`SELECT d.title,c.studio_content content,l.studio_layout layout FROM profile.resume_documents d
    JOIN profile.resume_document_revisions c ON c.document_id=d.id AND c.owner_id=d.owner_id AND c.owner_epoch=d.owner_epoch
    JOIN profile.resume_layout_revisions l ON l.document_id=d.id AND l.owner_id=d.owner_id AND l.owner_epoch=d.owner_epoch AND l.result_document_revision=c.result_document_revision
    WHERE d.id=${documentId} AND d.owner_id=${owner.ownerId} AND d.owner_epoch=${owner.ownerEpoch} AND d.deleted_at IS NULL
    AND c.id=${pair.contentRevisionId} AND l.id=${pair.layoutRevisionId} AND c.schema_version='aijob-native-content-v1' AND l.schema_version='aijob-native-layout-v1'`.execute(
      db,
    )
  ).rows[0];
  if (!row)
    throw new ServiceError(404, "NATIVE_REVISION_PAIR_NOT_FOUND", "找不到这组正文与布局版本。");
  return { title: row.title, document: joinNativeResumeDocument(row.content, row.layout) };
}

export async function listNativeSnapshots(
  db: Kysely<Database>,
  owner: OwnerScope,
  documentId: string,
) {
  await getNativeStudioDraft(db, owner, documentId);
  const result = await sql<{
    contentRevisionId: string;
    layoutRevisionId: string;
    revision: number;
    createdAt: Date;
  }>`
    SELECT c.id AS "contentRevisionId", l.id AS "layoutRevisionId", c.result_document_revision AS revision,
      c.confirmed_at AS "createdAt"
    FROM profile.resume_documents d
    JOIN profile.resume_document_revisions c ON c.document_id=d.id AND c.owner_id=d.owner_id AND c.owner_epoch=d.owner_epoch
    JOIN profile.resume_layout_revisions l ON l.document_id=d.id AND l.owner_id=d.owner_id AND l.owner_epoch=d.owner_epoch
      AND l.result_document_revision=c.result_document_revision
    WHERE d.id=${documentId} AND d.owner_id=${owner.ownerId} AND d.owner_epoch=${owner.ownerEpoch} AND d.deleted_at IS NULL
      AND c.schema_version='aijob-native-content-v1' AND l.schema_version='aijob-native-layout-v1'
      AND NOT EXISTS(SELECT 1 FROM profile.native_checkpoint_visibility v WHERE v.content_revision_id=c.id AND NOT v.retained)
    ORDER BY c.result_document_revision DESC LIMIT 100`.execute(db);
  return { items: result.rows };
}

export async function retainNativeCheckpoint(
  db: Kysely<Database> | Transaction<Database>, owner: OwnerScope, contentRevisionId: string,
) {
  await sql`UPDATE profile.native_checkpoint_visibility SET retained=true
    WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND content_revision_id=${contentRevisionId}`.execute(db);
  await sql`UPDATE profile.resume_export_artifacts SET purpose='retained',expires_at=NULL
    WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND content_revision_id=${contentRevisionId} AND state<>'deleted'`.execute(db);
}
