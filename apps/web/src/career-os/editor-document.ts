import type { ResumeStudioDraft } from "@aijob/contracts";
import type { NativeResumeDocument } from "@aijob/resume-core";
import { apiRequest, currentWorkspaceOwnerKey, ProductApiError } from "../api/client";
import { getStudio, saveStudio } from "../api/resume-studio";
import { flushOpenStudioDraft, refreshOpenStudioDraft } from "./studio/use-studio-draft";
export type EditableDraft =
  | (ResumeStudioDraft & { editorCore: "legacy" })
  | {
      editorCore: "native-v1";
      documentId: string;
      revision: number;
      title: string;
      document: NativeResumeDocument;
    };
export async function readEditableDraft(id: string): Promise<EditableDraft> {
  try {
    const draft = await apiRequest<{
      documentId: string;
      revision: number;
      title: string;
      document: unknown;
    }>(`/v2/resume-documents/${id}/native`);
    const { parseNativeResumeDocument } = await import("@aijob/resume-core");
    return {
      ...draft,
      editorCore: "native-v1",
      document: parseNativeResumeDocument(draft.document),
    };
  } catch (error) {
    if (
      !(error instanceof ProductApiError) ||
      !["RESUME_CORE_VERSION_MISMATCH", "RESUME_NOT_FOUND"].includes(error.code ?? "")
    )
      throw error;
    return { ...(await getStudio(id)), editorCore: "legacy" };
  }
}
export async function prepareEditableDraft(id: string) {
  await flushOpenStudioDraft(id);
  const draft = await readEditableDraft(id);
  if (draft.editorCore === "native-v1") {
    const { nativeRecoveryKey, readNativeRecovery } = await import("./native/recovery");
    if (
      readNativeRecovery(localStorage, nativeRecoveryKey(currentWorkspaceOwnerKey(), id), {
        baseRevision: draft.revision,
        title: draft.title,
        document: draft.document,
      })
    )
      throw new Error("简历还有未同步输入，请回到编辑器保存后继续；当前输入仍保留。");
  }
  return draft;
}
export async function restoreEditableDraft(
  draft: EditableDraft,
  expectedRevision: number,
  key: string,
) {
  if (draft.editorCore === "native-v1")
    return apiRequest(`/v2/resume-documents/${draft.documentId}/native`, {
      method: "PUT",
      idempotencyKey: key,
      body: { expectedRevision, title: draft.title, document: draft.document },
    });
  const saved = await saveStudio(
    draft.documentId,
    { expectedRevision, title: draft.title, content: draft.content, layout: draft.layout },
    key,
  );
  await refreshOpenStudioDraft(draft.documentId);
  return saved;
}
