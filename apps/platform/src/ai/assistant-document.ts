import type { Database } from "@aijob/database";
import type { NativeResumeDocument } from "@aijob/resume-core";
import type { Kysely, Transaction } from "kysely";
import type { OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";
import { loadResumeExportSnapshot } from "../resume-documents/export-service.js";
import { loadNativeSnapshot } from "../resume-documents/native-checkpoint.js";
import { getNativeStudioDraft } from "../resume-documents/native-studio-service.js";
import { getStudioDraft } from "../resume-documents/studio-service.js";

/** Read-only task context. No renderer metadata, image bytes, or conversion back to legacy content. */
export function nativeAssistantDocument(
  documentId: string,
  revision: number | null,
  document: NativeResumeDocument,
) {
  const { basics, summary, sections, customSections } = document.data;
  return {
    editorCore: "native-v1" as const,
    documentId,
    revision,
    content: structuredClone({ basics, summary, sections, customSections }),
    sectionOrder: document.data.metadata.layout.pages.flatMap((page) => [
      ...page.main,
      ...page.sidebar,
    ]),
  };
}
export async function readAssistantDocument(
  db: Kysely<Database> | Transaction<Database>,
  owner: OwnerScope,
  documentId: string,
  pair?: { contentRevisionId: string; layoutRevisionId: string },
) {
  if (pair) {
    try {
      const snapshot = await loadNativeSnapshot(db, owner, documentId, pair);
      return nativeAssistantDocument(documentId, null, snapshot.document);
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== "NATIVE_REVISION_PAIR_NOT_FOUND")
        throw error;
      return loadResumeExportSnapshot({
        db,
        owner,
        documentId,
        query: pair,
        allowHistorical: true,
      });
    }
  }
  try {
    const draft = await getNativeStudioDraft(db, owner, documentId);
    return nativeAssistantDocument(documentId, draft.revision, draft.document);
  } catch (error) {
    if (
      !(error instanceof ServiceError) ||
      !["RESUME_CORE_VERSION_MISMATCH", "RESUME_NOT_FOUND"].includes(error.code)
    )
      throw error;
    return getStudioDraft(db, owner, documentId);
  }
}
