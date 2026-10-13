import { randomUUID } from "node:crypto";
import {
  type RecordManualApplicationRequest,
  SubmittedMaterialListSchema,
  SubmittedMaterialSchema,
} from "@aijob/contracts";
import type { Database, SubmittedMaterialTable } from "@aijob/database";
import { joinNativeResumeDocument, splitNativeResumeDocument } from "@aijob/resume-core";
import { sql, type Kysely, type Selectable, type Transaction } from "kysely";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { mutatePersonalAsset } from "../planner/service.js";
import { createAtsResumeDocx } from "../resume/export-docx.js";
import { decryptResumePayload } from "../resume/crypto.js";
import {
  buildResumeDocumentDocxInput,
  loadResumeExportSnapshot,
  safeResumeFileName,
} from "../resume-documents/export-service.js";
import { loadNativeSnapshot, retainNativeCheckpoint } from "../resume-documents/native-checkpoint.js";
import { renderResolvedNativeExport } from "../resume-documents/native-export.js";
import { resolveNativePhoto } from "../resume-documents/native-photo.js";
import { type PdfRuntimeConfig, renderResumePdf } from "../resume-documents/pdf-service.js";
import { createStudioDocx } from "../resume-documents/studio-docx.js";

export async function captureSubmittedMaterial(
  tx: Transaction<Database>,
  owner: OwnerScope,
  caseId: string,
  caseRevision: number,
  request: RecordManualApplicationRequest,
  encryptionKey?: string | undefined,
) {
  const submittedAt = request.submittedAt ? new Date(request.submittedAt) : new Date();
  if (submittedAt.getTime() > Date.now() + 300000)
    throw new ServiceError(400, "SUBMISSION_TIME_IN_FUTURE", "实际投递时间不能晚于当前时间。");
  if (!request.submittedResume) return null;
  const reference = request.submittedResume;
  let title: string, content: unknown, layout: unknown;
  try {
    const native = await loadNativeSnapshot(tx, owner, reference.documentId, reference);
    await retainNativeCheckpoint(tx, owner, reference.contentRevisionId);
    const resolved = await resolveNativePhoto(tx, owner, native.document, encryptionKey);
    const pair = splitNativeResumeDocument(resolved);
    title = native.title;
    content = pair.content;
    layout = pair.layout;
  } catch (error) {
    if (!(error instanceof ServiceError) || error.code !== "NATIVE_REVISION_PAIR_NOT_FOUND")
      throw error;
    const snapshot = await loadResumeExportSnapshot({
      db: tx,
      owner,
      documentId: reference.documentId,
      query: {
        contentRevisionId: reference.contentRevisionId,
        layoutRevisionId: reference.layoutRevisionId,
      },
      allowHistorical: true,
      encryptionKey,
    });
    const { content: legacyContent, title: legacyTitle, ...legacyLayout } = snapshot;
    title = legacyTitle;
    content = legacyContent;
    layout = legacyLayout;
  }
  const id = randomUUID();
  await tx
    .insertInto("application.submitted_materials")
    .values({
      id,
      owner_id: owner.ownerId,
      owner_epoch: owner.ownerEpoch,
      case_id: caseId,
      case_revision: caseRevision,
      document_id: reference.documentId,
      content_revision_id: reference.contentRevisionId,
      layout_revision_id: reference.layoutRevisionId,
      title,
      content: JSON.stringify(content),
      layout: JSON.stringify(layout),
      content_hash: hashCanonicalJson({ title, content, layout }),
      submitted_at: submittedAt,
    })
    .execute();
  if (reference.exportArtifactId) {
    const copied = await sql`INSERT INTO application.submitted_material_files(material_id,owner_id,owner_epoch,artifact_id,format,file_name,media_type,content_hash,ciphertext,nonce,auth_tag)
      SELECT ${id},owner_id,owner_epoch,id,format,file_name,media_type,content_hash,ciphertext,nonce,auth_tag
      FROM profile.resume_export_artifacts WHERE id=${reference.exportArtifactId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}
        AND document_id=${reference.documentId} AND content_revision_id=${reference.contentRevisionId} AND layout_revision_id=${reference.layoutRevisionId} AND state='ready'`.execute(tx);
    if (Number(copied.numAffectedRows) !== 1) throw new ServiceError(409,"SUBMITTED_FILE_VERSION_MISMATCH","所选文件不属于这份稿件版本，请重新选择实际投递文件。");
    await sql`UPDATE profile.resume_export_artifacts SET purpose='retained',expires_at=NULL WHERE id=${reference.exportArtifactId}`.execute(tx);
  }
  return id;
}
function project(row: Selectable<SubmittedMaterialTable>) {
  return SubmittedMaterialSchema.parse({
    editorCore:
      typeof row.content === "object" &&
      row.content !== null &&
      "schemaVersion" in row.content &&
      row.content.schemaVersion === "aijob-native-resume-v1"
        ? "native-v1"
        : "legacy",
    id: row.id,
    caseId: row.case_id,
    caseRevision: row.case_revision,
    documentId: row.document_id,
    contentRevisionId: row.content_revision_id,
    layoutRevisionId: row.layout_revision_id,
    title: row.title,
    content: row.content,
    layout: row.layout,
    submittedAt: new Date(row.submitted_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  });
}
export async function listSubmittedMaterials(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
}) {
  return input.db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    const rows = await tx
      .selectFrom("application.submitted_materials as material")
      .innerJoin("application.application_cases as c", (join) =>
        join.onRef("c.id", "=", "material.case_id").onRef("c.owner_id", "=", "material.owner_id"),
      )
      .selectAll("material")
      .where("material.owner_id", "=", input.owner.ownerId)
      .where("material.owner_epoch", "=", input.owner.ownerEpoch)
      .where("material.case_id", "=", input.caseId)
      .where("c.deleted_at", "is", null)
      .orderBy("material.submitted_at", "desc")
      .execute();
    const files = (await sql<{material_id:string;artifact_id:string;format:string;file_name:string;content_hash:string}>`
      SELECT material_id,artifact_id,format,file_name,content_hash FROM application.submitted_material_files
      WHERE owner_id=${input.owner.ownerId} AND owner_epoch=${input.owner.ownerEpoch}`.execute(tx)).rows;
    return SubmittedMaterialListSchema.parse({ items: rows.map(row => {
      const file=files.find(file=>file.material_id===row.id);
      return {...project(row),...(file?{submittedFile:{artifactId:file.artifact_id,format:file.format,fileName:file.file_name,sha256:file.content_hash}}:{})};
    }) });
  });
}
export async function deleteSubmittedMaterial(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  materialId: string;
  idempotencyKey: string;
}) {
  return mutatePersonalAsset(
    input,
    { action: "delete_submission", caseId: input.caseId, id: input.materialId },
    async (tx) => {
      await tx
        .deleteFrom("application.submitted_materials")
        .where("id", "=", input.materialId)
        .where("case_id", "=", input.caseId)
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .execute();
      return { id: input.materialId, deleted: true };
    },
  );
}
export async function exportSubmittedMaterial(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  caseId: string;
  materialId: string;
  format: "pdf" | "docx";
  runtime?: PdfRuntimeConfig;
  encryptionKey?: string | undefined;
}) {
  const load = async (tx: Transaction<Database>) => {
    await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    const row = await tx
      .selectFrom("application.submitted_materials")
      .selectAll()
      .where("id", "=", input.materialId)
      .where("case_id", "=", input.caseId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .executeTakeFirst();
    if (!row)
      throw new ServiceError(
        404,
        "SUBMITTED_MATERIAL_NOT_FOUND",
        "投递稿不存在、已删除或不属于当前账户。",
      );
    return project(row);
  };
  const material = await input.db.transaction().execute(load);
  const retained = (await sql<{ciphertext:Buffer;nonce:Buffer;auth_tag:Buffer;file_name:string;media_type:string}>`
    SELECT ciphertext,nonce,auth_tag,file_name,media_type FROM application.submitted_material_files
    WHERE material_id=${input.materialId} AND owner_id=${input.owner.ownerId} AND owner_epoch=${input.owner.ownerEpoch} AND format=${input.format}`.execute(input.db)).rows[0];
  if(retained) {
    if(!input.encryptionKey) throw new ServiceError(503,"RESUME_ENCRYPTION_UNAVAILABLE","当前运行环境尚未配置文件读取密钥。");
    const buffer=decryptResumePayload({ciphertext:retained.ciphertext,initializationVector:retained.nonce,authenticationTag:retained.auth_tag},input.encryptionKey);
    await input.db.transaction().execute(load);
    return {buffer,fileName:retained.file_name,mediaType:retained.media_type};
  }
  if (material.editorCore === "native-v1") {
    const document = joinNativeResumeDocument(material.content, material.layout);
    const rendered = await renderResolvedNativeExport(document, input.format);
    await input.db.transaction().execute(load);
    return {
      buffer: rendered.buffer,
      fileName: safeResumeFileName(`已投递-${material.title}`, input.format),
      mediaType:
        input.format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  const snapshot = { title: material.title, content: material.content, ...material.layout };
  const buffer =
    input.format === "pdf"
      ? await renderResumePdf({
          db: input.db,
          snapshot,
          ...(input.runtime ? { runtime: input.runtime } : {}),
        })
      : snapshot.studio
        ? await createStudioDocx(
            snapshot.studio.content,
            snapshot.studio.layout,
            snapshot.studio.resources,
          )
        : await createAtsResumeDocx(buildResumeDocumentDocxInput(snapshot));
  await input.db.transaction().execute(load);
  return {
    buffer,
    fileName: safeResumeFileName(`已投递-${material.title}`, input.format),
    mediaType:
      input.format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}
