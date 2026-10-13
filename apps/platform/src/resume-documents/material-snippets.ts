import { randomUUID } from "node:crypto";
import {
  type CreateMaterialSnippetRequest,
  MaterialSnippetListSchema,
  MaterialSnippetSchema,
} from "@aijob/contracts";
import type { Database, MaterialSnippetTable } from "@aijob/database";
import { joinNativeResumeDocument, type NativeResumeDocument } from "@aijob/resume-core";
import { type Kysely, type Selectable, sql, type Transaction } from "kysely";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";
import { erasePlannerReceipts, mutatePersonalAsset } from "../planner/service.js";
import { semanticContent } from "./export-service.js";
import { getNativeStudioDraft } from "./native-studio-service.js";
import { getStudioDraft } from "./studio-service.js";

function nativeEntryIds(document: NativeResumeDocument) {
  return new Set(
    [...Object.values(document.data.sections), ...document.data.customSections].flatMap((section) =>
      section.items.map((item) => item.id),
    ),
  );
}
type Context = { db: Kysely<Database>; owner: OwnerScope };
function project(row: Selectable<MaterialSnippetTable>) {
  return MaterialSnippetSchema.parse({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    sourceDocumentId: row.source_document_id,
    sourceContentRevisionId: row.source_content_revision_id,
    sourceBlockIds: row.source_block_ids,
    sourceExperienceIds: row.source_experience_ids,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}
async function validateSource(
  tx: Transaction<Database>,
  owner: OwnerScope,
  request: CreateMaterialSnippetRequest,
) {
  for (const id of request.sourceExperienceIds ?? []) {
    const source =
      await sql`SELECT id FROM profile.experiences WHERE id=${id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
        tx,
      );
    if (!source.rows.length)
      throw new ServiceError(404, "EXPERIENCE_NOT_FOUND", "引用的经历已删除或不属于当前账户。");
  }
  if (request.sourceDocumentId && !request.sourceContentRevisionId) {
    let ids: Set<string>;
    try {
      ids = nativeEntryIds(
        (await getNativeStudioDraft(tx, owner, request.sourceDocumentId)).document,
      );
    } catch (error) {
      if (
        !(error instanceof ServiceError) ||
        !["RESUME_CORE_VERSION_MISMATCH", "RESUME_NOT_FOUND"].includes(error.code)
      )
        throw error;
      const draft = await getStudioDraft(tx, owner, request.sourceDocumentId);
      ids = new Set(
        draft.content.sections.flatMap((section) => section.entries.map((entry) => entry.id)),
      );
    }
    if (request.sourceBlockIds.some((id) => !ids.has(id)))
      throw new ServiceError(409, "MATERIAL_ENTRY_NOT_FOUND", "引用的条目已不在当前简历中。");
    return;
  }
  if (
    !request.sourceDocumentId &&
    !request.sourceContentRevisionId &&
    !request.sourceBlockIds.length
  )
    return;
  if (!request.sourceDocumentId || !request.sourceContentRevisionId)
    throw new ServiceError(400, "MATERIAL_SOURCE_INCOMPLETE", "请同时选择简历和正文修订。");
  const row = await tx
    .selectFrom("profile.resume_document_revisions as revision")
    .innerJoin("profile.resume_documents as doc", "doc.id", "revision.document_id")
    .select([
      "revision.schema_version",
      "revision.sections",
      "revision.studio_content",
      "revision.result_document_revision",
    ])
    .where("revision.id", "=", request.sourceContentRevisionId)
    .where("revision.document_id", "=", request.sourceDocumentId)
    .where("revision.owner_id", "=", owner.ownerId)
    .where("revision.owner_epoch", "=", owner.ownerEpoch)
    .where("doc.deleted_at", "is", null)
    .executeTakeFirst();
  if (!row)
    throw new ServiceError(404, "MATERIAL_SOURCE_NOT_FOUND", "材料来源不存在或不属于当前账户。");
  let ids: Set<string>;
  if (row.schema_version === "aijob-native-content-v1") {
    const layout = await tx
      .selectFrom("profile.resume_layout_revisions")
      .select("studio_layout")
      .where("document_id", "=", request.sourceDocumentId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("result_document_revision", "=", row.result_document_revision)
      .where("schema_version", "=", "aijob-native-layout-v1")
      .executeTakeFirst();
    if (!layout)
      throw new ServiceError(409, "MATERIAL_SOURCE_INCOMPLETE", "无法读取这份简历的成对版本。");
    ids = nativeEntryIds(joinNativeResumeDocument(row.studio_content, layout.studio_layout));
  } else {
    ids = new Set(
      semanticContent(row.schema_version, row.sections).sections.flatMap((section) =>
        section.blocks.map((block) => block.id),
      ),
    );
  }
  if (request.sourceBlockIds.some((id) => !ids.has(id)))
    throw new ServiceError(409, "MATERIAL_BLOCK_NOT_FOUND", "所选段落不在这个正文修订中。");
}
const fields = (request: CreateMaterialSnippetRequest) => ({
  kind: request.kind,
  title: request.title,
  body: request.body,
  source_document_id: request.sourceDocumentId,
  source_content_revision_id: request.sourceContentRevisionId,
  source_block_ids: JSON.stringify(request.sourceBlockIds),
  source_experience_ids: JSON.stringify(request.sourceExperienceIds ?? []),
});
export async function insertMaterialSnippetInTransaction(
  tx: Transaction<Database>,
  owner: OwnerScope,
  request: CreateMaterialSnippetRequest,
) {
  await validateSource(tx, owner, request);
  return project(
    await tx
      .insertInto("profile.material_snippets")
      .values({
        id: randomUUID(),
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        ...fields(request),
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
}
export async function createMaterialSnippet(
  input: Context & { request: CreateMaterialSnippetRequest; idempotencyKey: string },
) {
  return mutatePersonalAsset(
    input,
    { action: "snippet_create", request: input.request },
    async (tx) => {
      await validateSource(tx, input.owner, input.request);
      return project(
        await tx
          .insertInto("profile.material_snippets")
          .values({
            id: randomUUID(),
            owner_id: input.owner.ownerId,
            owner_epoch: input.owner.ownerEpoch,
            ...fields(input.request),
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
    },
  );
}
export async function updateMaterialSnippet(
  input: Context & {
    snippetId: string;
    request: CreateMaterialSnippetRequest & { expectedRevision: number };
    idempotencyKey: string;
  },
) {
  return mutatePersonalAsset(
    input,
    { action: "snippet_update", id: input.snippetId, request: input.request },
    async (tx) => {
      const row = await tx
        .selectFrom("profile.material_snippets")
        .selectAll()
        .where("id", "=", input.snippetId)
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .executeTakeFirst();
      if (!row) throw new ServiceError(404, "MATERIAL_NOT_FOUND", "材料不存在或已删除。");
      if (row.revision !== input.request.expectedRevision)
        throw new ServiceError(409, "MATERIAL_REVISION_CONFLICT", "材料已更新，请刷新后保存。");
      if (
        row.source_document_id !== input.request.sourceDocumentId ||
        row.source_content_revision_id !== input.request.sourceContentRevisionId ||
        JSON.stringify(row.source_block_ids) !== JSON.stringify(input.request.sourceBlockIds)
      )
        await validateSource(tx, input.owner, input.request);
      return project(
        await tx
          .updateTable("profile.material_snippets")
          .set({ ...fields(input.request), revision: row.revision + 1, updated_at: new Date() })
          .where("id", "=", row.id)
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
    },
  );
}
export async function listMaterialSnippets(input: Context & { offset: number; limit: number }) {
  return input.db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    const rows = await tx
      .selectFrom("profile.material_snippets")
      .selectAll()
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .orderBy("updated_at", "desc")
      .orderBy("id")
      .offset(input.offset)
      .limit(input.limit + 1)
      .execute();
    return MaterialSnippetListSchema.parse({
      items: rows.slice(0, input.limit).map(project),
      nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
    });
  });
}
export async function deleteMaterialSnippet(
  input: Context & { snippetId: string; expectedRevision: number; idempotencyKey: string },
) {
  return mutatePersonalAsset(
    input,
    { action: "snippet_delete", id: input.snippetId, revision: input.expectedRevision },
    async (tx) => {
      const row = await tx
        .selectFrom("profile.material_snippets")
        .select("revision")
        .where("id", "=", input.snippetId)
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .executeTakeFirst();
      if (!row) throw new ServiceError(404, "MATERIAL_NOT_FOUND", "材料不存在或已删除。");
      if (row.revision !== input.expectedRevision)
        throw new ServiceError(409, "MATERIAL_REVISION_CONFLICT", "材料已更新，请刷新后删除。");
      await tx.deleteFrom("profile.material_snippets").where("id", "=", input.snippetId).execute();
      await erasePlannerReceipts(tx, input.owner.ownerId, "id", input.snippetId);
      return { id: input.snippetId, deleted: true };
    },
  );
}
