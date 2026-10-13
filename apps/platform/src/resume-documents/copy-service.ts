import { randomUUID } from "node:crypto";
import { ResumeLayoutSettingsSchema, ResumeTemplateKeySchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { splitNativeResumeDocument } from "@aijob/resume-core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { buildResumeDocumentDocxInput, semanticContent } from "./export-service.js";
import { loadNativeSnapshot } from "./native-checkpoint.js";
import { convertLegacyStudioContent } from "./native-legacy-content.js";
import { assertNativePhoto } from "./native-photo.js";

/** Runs inside the existing create-document transaction after the owner and global revision lock. */
export async function copyResumeIntoDocument(
  tx: Transaction<Database>,
  owner: OwnerScope,
  targetId: string,
  source: {
    documentId: string;
    contentRevisionId: string;
    layoutRevisionId: string;
    targetCore?: "native-v1" | undefined;
  },
) {
  const document = await tx
    .selectFrom("profile.resume_documents")
    .selectAll()
    .where("id", "=", source.documentId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!document)
    throw new ServiceError(
      404,
      "RESUME_DOCUMENT_NOT_FOUND",
      "复制来源不存在、已删除或不属于当前账户。",
    );
  if (
    document.current_content_revision_id !== source.contentRevisionId ||
    document.current_layout_revision_id !== source.layoutRevisionId
  )
    throw new ServiceError(409, "COPY_SOURCE_CHANGED", "来源简历已更新，请重新核对后复制。");
  const contentRow = await tx
    .selectFrom("profile.resume_document_revisions")
    .selectAll()
    .where("id", "=", source.contentRevisionId)
    .where("document_id", "=", source.documentId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .executeTakeFirstOrThrow();
  const layoutRow = await tx
    .selectFrom("profile.resume_layout_revisions")
    .selectAll()
    .where("id", "=", source.layoutRevisionId)
    .where("document_id", "=", source.documentId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .executeTakeFirstOrThrow();
  if (
    contentRow.schema_version === "aijob-native-content-v1" ||
    source.targetCore === "native-v1"
  ) {
    if (contentRow.schema_version !== "aijob-native-content-v1" && !contentRow.studio_content)
      throw new ServiceError(
        422,
        "NATIVE_MIGRATION_SOURCE_UNSUPPORTED",
        "这份历史版本尚无完整模块结构，请先保留原稿并使用原件导入。",
      );
    const converted =
      contentRow.schema_version !== "aijob-native-content-v1"
        ? convertLegacyStudioContent(
            typeof contentRow.studio_content === "string"
              ? JSON.parse(contentRow.studio_content)
              : contentRow.studio_content,
          )
        : null;
    const nativeDocument =
      converted?.document ??
      (await loadNativeSnapshot(tx, owner, source.documentId, source)).document;
    const pair = splitNativeResumeDocument(nativeDocument);
    await assertNativePhoto(tx, owner, nativeDocument);
    const target = await tx
      .selectFrom("profile.resume_documents")
      .select("title")
      .where("id", "=", targetId)
      .where("owner_id", "=", owner.ownerId)
      .executeTakeFirstOrThrow();
    const hash = hashCanonicalJson({ title: target.title, ...pair });
    await sql`INSERT INTO profile.resume_document_drafts(document_id,owner_id,owner_epoch,revision,title,content,layout,content_hash)
      VALUES(${targetId},${owner.ownerId},${owner.ownerEpoch},1,${target.title},${JSON.stringify(pair.content)}::jsonb,${JSON.stringify(pair.layout)}::jsonb,${hash})`.execute(
      tx,
    );
    await tx
      .updateTable("profile.resume_documents")
      .set({
        copied_from_revision_id: source.contentRevisionId,
        updated_at: sql<Date>`GREATEST(clock_timestamp(),created_at,updated_at)`,
      })
      .where("id", "=", targetId)
      .execute();
    const entryIds = nativeDocument.data.customSections.flatMap((section) =>
      section.items.map((item) => item.id),
    );
    for (const section of Object.values(nativeDocument.data.sections))
      entryIds.push(...section.items.map((item) => item.id));
    if (entryIds.length)
      await sql`INSERT INTO profile.resume_experience_links(owner_id,owner_epoch,document_id,entry_id,experience_id,capture_revision,capture_open)
      SELECT owner_id,owner_epoch,${targetId},entry_id,experience_id,capture_revision,false FROM profile.resume_experience_links
      WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND document_id=${source.documentId}
      AND entry_id::text IN (${sql.join(entryIds)})`.execute(tx);
    return;
  }
  const content = semanticContent(contentRow.schema_version, contentRow.sections);
  const settings = ResumeLayoutSettingsSchema.safeParse(layoutRow.settings);
  const layout = {
    templateKey: ResumeTemplateKeySchema.parse(layoutRow.template_key),
    sectionOrder: z.array(z.string().uuid()).parse(layoutRow.section_order),
    settings: settings.success
      ? settings.data
      : ResumeLayoutSettingsSchema.parse({
          schemaVersion: "resume-layout-settings-v1",
          fontSizeToken: "standard",
          lineSpacingToken: "standard",
          sectionSpacingToken: "standard",
          colorToken: "charcoal",
          pageBreakPolicy: "keep_sections",
        }),
  };
  buildResumeDocumentDocxInput({ title: document.title, content, ...layout });
  const last = await tx
    .selectFrom("profile.resume_document_revisions")
    .select("revision")
    .where("owner_id", "=", owner.ownerId)
    .orderBy("revision", "desc")
    .executeTakeFirst();
  const contentId = randomUUID(),
    layoutId = randomUUID();
  await tx
    .insertInto("profile.resume_document_revisions")
    .values({
      id: contentId,
      owner_id: owner.ownerId,
      owner_epoch: owner.ownerEpoch,
      resume_analysis_id: null,
      revision: Number(last?.revision ?? 0) + 1,
      base_revision: null,
      schema_version: "resume-content-v1",
      sections: JSON.stringify(content.sections),
      ...(contentRow.studio_content
        ? {
            studio_content: contentRow.studio_content,
            result_document_revision: 1,
            mutation_idempotency_key: `studio-copy:${source.contentRevisionId}`,
            mutation_request_hash: hashCanonicalJson(source),
          }
        : {}),
      content_hash: hashCanonicalJson(content),
      confirmed_at: sql<Date>`clock_timestamp()`,
      document_id: targetId,
      document_revision: 1,
      base_document_revision_id: null,
    })
    .execute();
  await tx
    .insertInto("profile.resume_layout_revisions")
    .values({
      id: layoutId,
      owner_id: owner.ownerId,
      owner_epoch: owner.ownerEpoch,
      document_id: targetId,
      layout_revision: 1,
      base_layout_revision: null,
      schema_version: "resume-layout-v2",
      template_key: layout.templateKey,
      section_order: JSON.stringify(layout.sectionOrder),
      settings: JSON.stringify(layout.settings),
      ...(layoutRow.studio_layout
        ? {
            studio_layout: layoutRow.studio_layout,
            result_document_revision: 1,
            mutation_idempotency_key: `studio-copy:${source.contentRevisionId}`,
            mutation_request_hash: hashCanonicalJson(source),
          }
        : {}),
      content_hash: hashCanonicalJson({ schemaVersion: "resume-layout-v2", ...layout }),
    })
    .execute();
  await tx
    .updateTable("profile.resume_documents")
    .set({
      current_content_revision_id: contentId,
      current_layout_revision_id: layoutId,
      copied_from_revision_id: source.contentRevisionId,
      updated_at: sql<Date>`clock_timestamp()`,
    })
    .where("id", "=", targetId)
    .execute();
}
