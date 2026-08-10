import {
  type ResumeDocumentDocxExportQuery,
  ResumeDocumentInputSchema,
  type ResumeSemanticContent,
  ResumeSemanticContentSchema,
  type ResumeTemplateKey,
  ResumeTemplateKeySchema,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";
import { type AtsResumeDocumentInput, createAtsResumeDocx } from "../resume/export-docx.js";

const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SectionOrderSchema = z.array(z.string().uuid()).min(1).max(100);

function parseJsonValue(value: JsonValue): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function semanticContent(schemaVersion: string, sections: JsonValue): ResumeSemanticContent {
  const parsedSections = parseJsonValue(sections);
  if (schemaVersion === "resume-content-v1") {
    return ResumeSemanticContentSchema.parse({
      schemaVersion: "resume-content-v1",
      sections: parsedSections,
    });
  }
  if (schemaVersion === "resume-document-v2") {
    const legacyV2 = ResumeDocumentInputSchema.parse({
      schemaVersion: "resume-document-v1",
      sections: parsedSections,
    });
    return ResumeSemanticContentSchema.parse({
      schemaVersion: "resume-content-v1",
      sections: legacyV2.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => ({ ...block, evidenceIds: [] })),
      })),
    });
  }
  throw new ServiceError(
    422,
    "RESUME_DOCUMENT_EXPORT_SCHEMA_UNSUPPORTED",
    "当前正文修订无法导出，请先在结构化编辑器中保存为 Resume V2。",
  );
}

export function buildResumeDocumentDocxInput(input: {
  title: string;
  content: ResumeSemanticContent;
  templateKey: ResumeTemplateKey;
  sectionOrder: string[];
}): AtsResumeDocumentInput {
  const sectionsById = new Map(input.content.sections.map((section) => [section.id, section]));
  if (
    input.sectionOrder.length !== sectionsById.size ||
    new Set(input.sectionOrder).size !== input.sectionOrder.length ||
    input.sectionOrder.some((sectionId) => !sectionsById.has(sectionId))
  ) {
    throw new ServiceError(
      409,
      "RESUME_DOCUMENT_EXPORT_LAYOUT_INVALID",
      "当前布局与正文结构不一致，请刷新简历后重试。",
    );
  }
  const sections = input.sectionOrder.map((sectionId) => {
    const section = sectionsById.get(sectionId);
    if (!section) throw new Error("RESUME_DOCUMENT_EXPORT_SECTION_MISSING");
    return {
      id: section.id,
      heading: section.title,
      paragraphs: [...section.blocks]
        .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
        .map((block) => block.text.trim())
        .filter(Boolean),
    };
  });
  if (sections.some((section) => section.paragraphs.length === 0)) {
    throw new ServiceError(
      422,
      "RESUME_DOCUMENT_EXPORT_EMPTY_SECTION",
      "简历包含空章节，请补充内容或删除空章节后重试。",
    );
  }
  return {
    title: input.title,
    templateKey: input.templateKey,
    sections,
  };
}

function safeFileName(title: string): string {
  const normalized = title
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*]|\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `Aijob-${normalized || "简历"}.docx`;
}

export async function exportResumeDocumentDocx(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  documentId: string;
  query: ResumeDocumentDocxExportQuery;
}): Promise<{ buffer: Buffer; fileName: string; mediaType: string }> {
  const document = await input.db
    .selectFrom("profile.resume_documents")
    .select(["id", "title", "current_content_revision_id", "current_layout_revision_id"])
    .where("id", "=", input.documentId)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!document) {
    throw new ServiceError(
      404,
      "RESUME_DOCUMENT_NOT_FOUND",
      "记录不存在、已删除或不属于当前账户。",
    );
  }
  if (
    document.current_content_revision_id !== input.query.contentRevisionId ||
    document.current_layout_revision_id !== input.query.layoutRevisionId
  ) {
    throw new ServiceError(
      409,
      "RESUME_DOCUMENT_EXPORT_REVISION_STALE",
      "简历已经产生新修订，请刷新并核对最新内容后再导出。",
    );
  }

  const [contentRow, layoutRow] = await Promise.all([
    input.db
      .selectFrom("profile.resume_document_revisions")
      .select(["schema_version", "sections"])
      .where("id", "=", input.query.contentRevisionId)
      .where("document_id", "=", document.id)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .executeTakeFirst(),
    input.db
      .selectFrom("profile.resume_layout_revisions")
      .select(["template_key", "section_order"])
      .where("id", "=", input.query.layoutRevisionId)
      .where("document_id", "=", document.id)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .executeTakeFirst(),
  ]);
  if (!contentRow || !layoutRow) {
    throw new ServiceError(
      409,
      "RESUME_DOCUMENT_EXPORT_POINTER_INVALID",
      "简历当前修订链不完整，请停止导出并联系维护者。",
    );
  }
  const content = semanticContent(contentRow.schema_version, contentRow.sections);
  const templateKey = ResumeTemplateKeySchema.parse(layoutRow.template_key);
  const sectionOrder = SectionOrderSchema.parse(parseJsonValue(layoutRow.section_order));
  const docxInput = buildResumeDocumentDocxInput({
    title: document.title,
    content,
    templateKey,
    sectionOrder,
  });
  return {
    buffer: await createAtsResumeDocx(docxInput),
    fileName: safeFileName(document.title),
    mediaType: DOCX_MEDIA_TYPE,
  };
}
