import { randomUUID } from "node:crypto";
import {
  blankResumeStudioContent,
  resumeTemplateLayout,
  resumeTemplateStarter,
  ExperienceRecordSchema,
  type ResumeStudioContent,
  ResumeStudioContentSchema,
  type ResumeStudioDraft,
  ResumeStudioDraftSchema,
  type ResumeStudioEntry,
  ResumeStudioEntrySchema,
  type ResumeStudioLayout,
  ResumeStudioLayoutSchema,
  type SaveResumeStudioDraft,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { assertActiveOwnerEpoch, retainOwnerAssetsAfterMaterialSave, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { assertTemplateVersion, assertPhotoOwner, recordTemplateUse } from './template-library.js';
import { semanticContent } from "./export-service.js";
import { createResumeDocument } from "./service.js";
import {
  experienceCaptureHash,
  hasEntryContent,
  studioFromLegacy,
  studioSemanticProjection,
} from "./studio-content.js";

type Db = Kysely<Database> | Transaction<Database>;
export const studioJson = (v: unknown) => JSON.stringify(v);
export const studioMissing = () =>
  new ServiceError(404, "RESUME_NOT_FOUND", "这份简历不存在或已删除。");
export const studioConflict = () =>
  new ServiceError(
    409,
    "RESUME_DRAFT_CONFLICT",
    "已有较新的修改，你的输入仍保留。请比较后继续保存，或另存方向稿。",
  );
interface DraftRow {
  document_id: string;
  revision: number;
  title: string;
  content: unknown;
  layout: unknown;
  updated_at: Date;
  current_content_revision_id: string | null;
  current_layout_revision_id: string | null;
}

export async function getStudioDraft(
  db: Db,
  owner: OwnerScope,
  documentId: string,
): Promise<ResumeStudioDraft> {
  const { rows } =
    await sql<DraftRow>`SELECT s.*,d.current_content_revision_id,d.current_layout_revision_id FROM profile.resume_documents d JOIN profile.resume_document_drafts s ON s.document_id=d.id WHERE d.id=${documentId} AND d.owner_id=${owner.ownerId} AND d.owner_epoch=${owner.ownerEpoch} AND d.deleted_at IS NULL`.execute(
      db,
    );
  const row = rows[0];
  if (row && typeof row.content === "object" && row.content !== null && "schemaVersion" in row.content && row.content.schemaVersion === "aijob-native-resume-v1") {
    throw new ServiceError(409, "RESUME_CORE_VERSION_MISMATCH", "这份简历使用新版核心，请在新版编辑器中打开。");
  }
  if (row)
    return ResumeStudioDraftSchema.parse({
      documentId,
      revision: Number(row.revision),
      title: row.title,
      content: row.content,
      layout: row.layout,
      updatedAt: new Date(row.updated_at).toISOString(),
      contentRevisionId: row.current_content_revision_id,
      layoutRevisionId: row.current_layout_revision_id,
    });
  const doc = await db
    .selectFrom("profile.resume_documents")
    .selectAll()
    .where("id", "=", documentId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!doc) throw studioMissing();
  const sourceRevisionId = doc.current_content_revision_id ?? doc.base_document_revision_id;
  const revision = sourceRevisionId
    ? await db
        .selectFrom("profile.resume_document_revisions")
        .selectAll()
        .where("id", "=", sourceRevisionId)
        .where("owner_id", "=", owner.ownerId)
        .executeTakeFirst()
    : undefined;
  const layoutRow = doc.current_layout_revision_id
    ? await db
        .selectFrom("profile.resume_layout_revisions")
        .selectAll()
        .where("id", "=", doc.current_layout_revision_id)
        .where("owner_id", "=", owner.ownerId)
        .executeTakeFirst()
    : undefined;
  return ResumeStudioDraftSchema.parse({
    documentId,
    revision: 0,
    title: doc.title,
    content:
      revision?.studio_content ??
      (revision
        ? studioFromLegacy(semanticContent(revision.schema_version, revision.sections))
        : blankResumeStudioContent()),
    layout: ResumeStudioLayoutSchema.parse(layoutRow?.studio_layout ?? {}),
    updatedAt: new Date(doc.updated_at).toISOString(),
    contentRevisionId: doc.current_content_revision_id,
    layoutRevisionId: doc.current_layout_revision_id,
  });
}

async function captureExperiences(
  tx: Transaction<Database>,
  owner: OwnerScope,
  documentId: string,
  content: ResumeStudioContent,
) {
  const links = (await sql<{entry_id:string;experience_id:string|null;capture_revision:number;capture_open:boolean;stored_entry:unknown}>`
    SELECT l.entry_id,l.experience_id,l.capture_revision,l.capture_open,e.entry AS stored_entry
    FROM profile.resume_experience_links l LEFT JOIN profile.experiences e ON e.id=l.experience_id AND e.owner_id=l.owner_id AND e.owner_epoch=l.owner_epoch
    WHERE l.owner_id=${owner.ownerId} AND l.owner_epoch=${owner.ownerEpoch} AND l.document_id=${documentId}`.execute(tx)).rows;
  const byEntry=new Map(links.map(link=>[link.entry_id,link]));
  for (const section of content.sections) {
    if (!["internship", "project", "research", "activity"].includes(section.kind)) continue;
    for (const entry of section.entries) {
      if (!hasEntryContent(entry)) continue;
      const link = byEntry.get(entry.id);
      if (link) {
        const unchanged=hashCanonicalJson({...entry,experienceId:null,experienceRevision:null})===hashCanonicalJson(link.stored_entry);
        if (link.capture_open && link.experience_id && !unchanged) {
          const stored = { ...entry, experienceId: null, experienceRevision: null };
          const hash = experienceCaptureHash(section.kind, entry);
          const same = (
            await sql<{
              id: string;
              revision: number;
            }>`SELECT id,revision FROM profile.experiences WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND capture_hash=${hash} AND id<>${link.experience_id}`.execute(
              tx,
            )
          ).rows[0];
          if (same) {
            await sql`UPDATE profile.resume_experience_links SET experience_id=${same.id},capture_revision=${same.revision},capture_open=false WHERE owner_id=${owner.ownerId} AND document_id=${documentId} AND entry_id=${entry.id}`.execute(
              tx,
            );
            await sql`DELETE FROM profile.experiences WHERE id=${link.experience_id} AND owner_id=${owner.ownerId} AND NOT EXISTS(SELECT 1 FROM profile.resume_experience_links WHERE experience_id=${link.experience_id})`.execute(
              tx,
            );
            link.experience_id = same.id;
            link.capture_revision = same.revision;
          } else {
            const changed = (
              await sql<{
                revision: number;
              }>`UPDATE profile.experiences SET entry=${studioJson(stored)}::jsonb,title=${entry.title || entry.organization || section.title},capture_hash=${hash},revision=revision+1,updated_at=now() WHERE id=${link.experience_id} AND owner_id=${owner.ownerId} AND entry IS DISTINCT FROM ${studioJson(stored)}::jsonb RETURNING revision`.execute(
                tx,
              )
            ).rows[0];
            if (changed) {
              link.capture_revision = Number(changed.revision);
              await sql`INSERT INTO profile.experience_revisions(id,owner_id,owner_epoch,experience_id,revision,entry) VALUES(${randomUUID()},${owner.ownerId},${owner.ownerEpoch},${link.experience_id},${changed.revision},${studioJson(stored)}::jsonb)`.execute(
                tx,
              );
              await sql`UPDATE profile.resume_experience_links SET capture_revision=${changed.revision} WHERE owner_id=${owner.ownerId} AND document_id=${documentId} AND entry_id=${entry.id}`.execute(
                tx,
              );
            }
          }
        }
        entry.experienceId = link.experience_id;
        entry.experienceRevision = link.experience_id ? Number(link.capture_revision) : null;
        continue;
      }
      let experienceId: string | undefined;
      let captureOpen = false;
      let revision = 1;
      if (entry.experienceId) {
        const source = (
          await sql<{
            id: string;
            revision: number;
          }>`SELECT id,revision FROM profile.experiences WHERE id=${entry.experienceId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
            tx,
          )
        ).rows[0];
        if (!source)
          throw new ServiceError(422, "EXPERIENCE_NOT_FOUND", "关联的经历已删除，请重新选取。");
        experienceId = source.id;
        revision = Number(source.revision);
      } else {
        const hash = experienceCaptureHash(section.kind, entry);
        const existing = (
          await sql<{
            id: string;
            revision: number;
          }>`SELECT id,revision FROM profile.experiences WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND capture_hash=${hash}`.execute(
            tx,
          )
        ).rows[0];
        if (existing) {
          experienceId = existing.id;
          revision = Number(existing.revision);
        } else {
          captureOpen = true;
          experienceId = randomUUID();
          const stored = { ...entry, experienceId: null, experienceRevision: null };
          await sql`INSERT INTO profile.experiences(id,owner_id,owner_epoch,kind,title,entry,capture_hash) VALUES(${experienceId},${owner.ownerId},${owner.ownerEpoch},${section.kind},${entry.title || entry.organization || section.title},${studioJson(stored)}::jsonb,${hash})`.execute(
            tx,
          );
          await sql`INSERT INTO profile.experience_revisions(id,owner_id,owner_epoch,experience_id,revision,entry) VALUES(${randomUUID()},${owner.ownerId},${owner.ownerEpoch},${experienceId},1,${studioJson(stored)}::jsonb)`.execute(
            tx,
          );
        }
      }
      await sql`INSERT INTO profile.resume_experience_links(owner_id,owner_epoch,document_id,entry_id,experience_id,capture_revision,capture_open) VALUES(${owner.ownerId},${owner.ownerEpoch},${documentId},${entry.id},${experienceId},${revision},${captureOpen})`.execute(
        tx,
      );
      entry.experienceId = experienceId;
      entry.experienceRevision = revision;
    }
  }
}

export async function saveStudioDraftInTransaction(
  tx: Transaction<Database>,
  owner: OwnerScope,
  documentId: string,
  request: SaveResumeStudioDraft,
  idempotencyKey: string,
) {
  await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
  await retainOwnerAssetsAfterMaterialSave(tx, owner);
  const doc = await tx
    .selectFrom("profile.resume_documents")
    .selectAll()
    .where("id", "=", documentId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("deleted_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
  if (!doc) throw studioMissing();
  const hash = hashCanonicalJson(request);
  const replay = (
    await sql<{
      request_hash: string;
      result: unknown;
    }>`SELECT request_hash,result FROM profile.resume_draft_receipts WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND document_id=${documentId} AND idempotency_key=${idempotencyKey}`.execute(
      tx,
    )
  ).rows[0];
  if (replay) {
    if (replay.request_hash !== hash)
      throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "请求编号对应了不同内容。");
    return ResumeStudioDraftSchema.parse(replay.result);
  }
  const current = await getStudioDraft(tx, owner, documentId);
  if (current.revision !== request.expectedRevision) throw studioConflict();
  const content = ResumeStudioContentSchema.parse(request.content);
  assertTemplateVersion(request.layout);
  await assertPhotoOwner(tx, owner, content.basics.photoId);
  await captureExperiences(tx, owner, documentId, content);
  const contentHash = hashCanonicalJson({ title: request.title, content, layout: request.layout });
  const oldHash = hashCanonicalJson({
    title: current.title,
    content: current.content,
    layout: current.layout,
  });
  if (current.revision === 0 || contentHash !== oldHash) {
    await sql`INSERT INTO profile.resume_document_drafts(document_id,owner_id,owner_epoch,revision,title,content,layout,content_hash) VALUES(${documentId},${owner.ownerId},${owner.ownerEpoch},${current.revision + 1},${request.title},${studioJson(content)}::jsonb,${studioJson(request.layout)}::jsonb,${contentHash}) ON CONFLICT(document_id) DO UPDATE SET revision=EXCLUDED.revision,title=EXCLUDED.title,content=EXCLUDED.content,layout=EXCLUDED.layout,content_hash=EXCLUDED.content_hash,updated_at=now()`.execute(
      tx,
    );
    await tx
      .updateTable("profile.resume_documents")
      .set({ title: request.title, updated_at: sql<Date>`GREATEST(clock_timestamp(), created_at, updated_at)` })
      .where("id", "=", documentId)
      .where("owner_id", "=", owner.ownerId)
      .execute();
  }
  const result = await getStudioDraft(tx, owner, documentId);
  if (current.layout.templateKey !== request.layout.templateKey) await recordTemplateUse(tx, owner, request.layout.templateKey);
  await sql`INSERT INTO profile.resume_draft_receipts(owner_id,owner_epoch,document_id,idempotency_key,request_hash,result) VALUES(${owner.ownerId},${owner.ownerEpoch},${documentId},${idempotencyKey},${hash},${studioJson(result)}::jsonb)`.execute(
    tx,
  );
  return result;
}
export function saveStudioDraft(
  db: Kysely<Database>,
  owner: OwnerScope,
  documentId: string,
  request: SaveResumeStudioDraft,
  idempotencyKey: string,
) {
  return db
    .transaction()
    .execute((tx) => saveStudioDraftInTransaction(tx, owner, documentId, request, idempotencyKey));
}

export async function createStudioDocument(
  db: Kysely<Database>,
  owner: OwnerScope,
  input: {
    title: string;
    copyFromDocumentId?: string | undefined;
    experienceIds?: string[] | undefined;
    sourceHash?: string;
  },
  idempotencyKey: string,
) {
  const creationHash = hashCanonicalJson(input);
  await assertActiveOwnerEpoch(db, owner.ownerId, owner.ownerEpoch);
  const replay = await db
    .selectFrom("profile.resume_documents")
    .select(["id", "studio_creation_hash", "deleted_at"])
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("creation_idempotency_key", "=", idempotencyKey)
    .executeTakeFirst();
  if (replay?.studio_creation_hash && replay.studio_creation_hash !== creationHash)
    throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "请求编号对应了不同的创建内容。");
  if (replay) {
    const existing = await getStudioDraft(db, owner, replay.id);
    if (existing.revision > 0) return existing;
  }
  let content = resumeTemplateStarter('lapis_cn', randomUUID),
    layout = resumeTemplateLayout('lapis_cn');
  if (input.copyFromDocumentId) {
    const source = await getStudioDraft(db, owner, input.copyFromDocumentId);
    content = source.content;
    layout = source.layout;
  }
  if (input.experienceIds?.length) {
    const available = await listExperiences(db, owner);
    content.sections = input.experienceIds.map((id) => {
      const e = available.find((row) => row.id === id);
      if (!e) throw new ServiceError(404, "EXPERIENCE_NOT_FOUND", "没有找到所选经历。");
      return {
        id: randomUUID(),
        kind: e.kind,
        title: e.title,
        hidden: false,
        pageBreakBefore: false,
        column: "main" as const,
        entries: [
          { ...e.entry, id: randomUUID(), experienceId: e.id, experienceRevision: e.revision },
        ],
      };
    });
  }
  const created = await createResumeDocument({
    db,
    owner,
    request: { kind: "base", title: input.title },
    idempotencyKey,
  });
  const documentId = created.resumeDocument.id;
  await db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const row = (
      await sql<{
        studio_creation_hash: string | null;
      }>`SELECT studio_creation_hash FROM profile.resume_documents WHERE id=${documentId} AND owner_id=${owner.ownerId} FOR UPDATE`.execute(
        tx,
      )
    ).rows[0];
    if (row?.studio_creation_hash && row.studio_creation_hash !== creationHash)
      throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "请求编号对应了不同的创建内容。");
    await sql`UPDATE profile.resume_documents SET studio_creation_hash=${creationHash} WHERE id=${documentId} AND owner_id=${owner.ownerId}`.execute(
      tx,
    );
  });
  const existing = await getStudioDraft(db, owner, documentId);
  if (existing.revision > 0) return existing;
  return saveStudioDraft(
    db,
    owner,
    documentId,
    { expectedRevision: 0, title: input.title, content, layout },
    `initial:${idempotencyKey}`,
  );
}

/** A checkpoint fixes the content/layout pair without making every keystroke an immutable version. */
export async function checkpointStudioDraft(
  db: Kysely<Database>,
  owner: OwnerScope,
  documentId: string,
  expectedRevision: number,
) {
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const draft = await getStudioDraft(tx, owner, documentId);
    if (draft.revision !== expectedRevision) throw studioConflict();
    const doc = await tx
      .selectFrom("profile.resume_documents")
      .selectAll()
      .where("id", "=", documentId)
      .where("owner_id", "=", owner.ownerId)
      .where("deleted_at", "is", null)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const projection = studioSemanticProjection(draft.content);
    if (!projection)
      throw new ServiceError(422, "RESUME_EMPTY", "先填写姓名或一段内容，再保存版本或导出。");
    await sql`UPDATE profile.resume_experience_links SET capture_open=false WHERE owner_id=${owner.ownerId} AND document_id=${documentId}`.execute(
      tx,
    );
    const contentHash = hashCanonicalJson(draft.content),
      layoutHash = hashCanonicalJson(draft.layout);
    const oldContent = doc.current_content_revision_id
      ? await tx
          .selectFrom("profile.resume_document_revisions")
          .selectAll()
          .where("id", "=", doc.current_content_revision_id)
          .where("owner_id", "=", owner.ownerId)
          .executeTakeFirst()
      : undefined;
    const oldLayout = doc.current_layout_revision_id
      ? await tx
          .selectFrom("profile.resume_layout_revisions")
          .selectAll()
          .where("id", "=", doc.current_layout_revision_id)
          .where("owner_id", "=", owner.ownerId)
          .executeTakeFirst()
      : undefined;
    if (oldContent?.content_hash === contentHash && oldLayout?.content_hash === layoutHash)
      return { contentRevisionId: oldContent.id, layoutRevisionId: oldLayout.id };
    const contentId = randomUUID(),
      layoutId = randomUUID(),
      docRev = Number(doc.revision) + 1;
    const global = await tx
      .selectFrom("profile.resume_document_revisions")
      .select("revision")
      .where("owner_id", "=", owner.ownerId)
      .orderBy("revision", "desc")
      .executeTakeFirst();
    const lastContent = await tx
      .selectFrom("profile.resume_document_revisions")
      .select("document_revision")
      .where("document_id", "=", documentId)
      .where("owner_id", "=", owner.ownerId)
      .orderBy("document_revision", "desc")
      .executeTakeFirst();
    const lastLayout = await tx
      .selectFrom("profile.resume_layout_revisions")
      .select("layout_revision")
      .where("document_id", "=", documentId)
      .where("owner_id", "=", owner.ownerId)
      .orderBy("layout_revision", "desc")
      .executeTakeFirst();
    await tx
      .insertInto("profile.resume_document_revisions")
      .values({
        id: contentId,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        resume_analysis_id: null,
        revision: Number(global?.revision ?? 0) + 1,
        base_revision: null,
        schema_version: "resume-content-v1",
        sections: studioJson(projection.sections) as JsonValue,
        studio_content: studioJson(draft.content) as JsonValue,
        content_hash: contentHash,
        confirmed_at: sql<Date>`clock_timestamp()`,
        document_id: documentId,
        document_revision: Number(lastContent?.document_revision ?? 0) + 1,
        base_document_revision_id: oldContent?.id ?? null,
        result_document_revision: docRev,
        mutation_idempotency_key: `studio-checkpoint:${draft.revision}`,
        mutation_request_hash: hashCanonicalJson({ contentHash, layoutHash }),
      })
      .execute();
    const settings = {
      schemaVersion: "resume-layout-settings-v1",
      fontSizeToken: "standard",
      lineSpacingToken: "standard",
      sectionSpacingToken: "standard",
      colorToken: "black",
      pageBreakPolicy: "automatic",
    };
    await tx
      .insertInto("profile.resume_layout_revisions")
      .values({
        id: layoutId,
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        document_id: documentId,
        layout_revision: Number(lastLayout?.layout_revision ?? 0) + 1,
        base_layout_revision: oldLayout?.layout_revision ?? null,
        schema_version: "resume-layout-v2",
        template_key:
          draft.layout.templateKey === "cn_compact_technical"
            ? "cn_compact_technical"
            : "cn_classic_single_column",
        section_order: studioJson(projection.sections.map((s) => s.id)) as JsonValue,
        settings: studioJson(settings) as JsonValue,
        studio_layout: studioJson(draft.layout) as JsonValue,
        content_hash: layoutHash,
        result_document_revision: docRev,
        mutation_idempotency_key: `studio-checkpoint:${draft.revision}`,
        mutation_request_hash: hashCanonicalJson({ contentHash, layoutHash }),
      })
      .execute();
    await tx
      .updateTable("profile.resume_documents")
      .set({
        current_content_revision_id: contentId,
        current_layout_revision_id: layoutId,
        revision: docRev,
        updated_at: sql<Date>`clock_timestamp()`,
      })
      .where("id", "=", documentId)
      .where("owner_id", "=", owner.ownerId)
      .execute();
    return { contentRevisionId: contentId, layoutRevisionId: layoutId };
  });
}

export async function listExperiences(db: Db, owner: OwnerScope) {
  const { rows } = await sql<{
    id: string;
    kind: string;
    title: string;
    entry: unknown;
    revision: number;
    created_at: Date;
    updated_at: Date;
  }>`SELECT * FROM profile.experiences WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND entry->>'schemaVersion' IS DISTINCT FROM 'aijob-native-experience-v1' ORDER BY updated_at DESC LIMIT 500`.execute(
    db,
  );
  return rows.map((r) =>
    ExperienceRecordSchema.parse({
      ...r,
      revision: Number(r.revision),
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }),
  );
}
export async function updateExperience(
  db: Kysely<Database>,
  owner: OwnerScope,
  id: string,
  expectedRevision: number,
  entry: ResumeStudioEntry,
) {
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    await retainOwnerAssetsAfterMaterialSave(tx, owner);
    const value = ResumeStudioEntrySchema.parse({
      ...entry,
      experienceId: null,
      experienceRevision: null,
    });
    const { rows } =
      await sql`UPDATE profile.experiences SET entry=${studioJson(value)}::jsonb,title=${value.title || value.organization || "我的经历"},revision=revision+1,updated_at=now() WHERE id=${id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND revision=${expectedRevision} AND entry->>'schemaVersion' IS DISTINCT FROM 'aijob-native-experience-v1' RETURNING id`.execute(
        tx,
      );
    if (!rows.length) throw studioConflict();
    await sql`UPDATE profile.resume_experience_links SET capture_open=false WHERE owner_id=${owner.ownerId} AND experience_id=${id}`.execute(
      tx,
    );
    await sql`INSERT INTO profile.experience_revisions(id,owner_id,owner_epoch,experience_id,revision,entry) VALUES(${randomUUID()},${owner.ownerId},${owner.ownerEpoch},${id},${expectedRevision + 1},${studioJson(value)}::jsonb)`.execute(
      tx,
    );
    return (await listExperiences(tx, owner)).find((e) => e.id === id);
  });
}
