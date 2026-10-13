import type { AssistantResult } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { sql, type Transaction } from "kysely";
import { nativeAssistantDocument } from "../ai/assistant-document.js";
import type { OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";
import {
  getNativeStudioDraft,
  saveNativeStudioDraftInTransaction,
} from "./native-studio-service.js";

type Source = ReturnType<typeof nativeAssistantDocument>;
const conflict = () =>
  new ServiceError(
    409,
    "NATIVE_AI_SOURCE_CHANGED",
    "原段落或排版已有变化，请重新对照后采用；当前输入已保留。",
  );
const plainHtml = (value: string) =>
  value
    .split(/\n/)
    .map(
      (line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
    )
    .join("");
function items(content: Source["content"]) {
  return [...Object.values(content.sections), ...content.customSections].flatMap(
    (section) => section.items as { id: string; [key: string]: unknown }[],
  );
}
export async function adoptNativeAssistantChanges(
  tx: Transaction<Database>,
  owner: OwnerScope,
  documentId: string,
  expectedRevision: number,
  source: Source,
  result: AssistantResult,
  changeIds: string[],
  key: string,
) {
  if (source.editorCore !== "native-v1" || source.documentId !== documentId || !source.content)
    throw conflict();
  const draft = await getNativeStudioDraft(tx, owner, documentId);
  if (draft.revision !== expectedRevision) throw conflict();
  const before = nativeAssistantDocument(documentId, draft.revision, draft.document);
  const changes = result.changes.filter((change) => changeIds.includes(change.id));
  if (!changes.length || changes.length !== new Set(changeIds).size)
    throw new ServiceError(422, "AI_CHANGE_REQUIRED", "请选择本轮实际存在的修改。");
  for (const change of changes) {
    if (change.target === "headline") {
      if (before.content.basics.headline !== source.content.basics.headline) throw conflict();
      draft.document.data.basics.headline = change.text;
    } else if (change.target === "section_order") {
      if (JSON.stringify(before.sectionOrder) !== JSON.stringify(source.sectionOrder))
        throw conflict();
      const ids = new Set(before.sectionOrder);
      if (
        change.sectionIds.length !== ids.size ||
        new Set(change.sectionIds).size !== ids.size ||
        change.sectionIds.some((id) => !ids.has(id))
      )
        throw new ServiceError(422, "AI_SECTION_ORDER_INVALID", "模块顺序必须包含当前全部模块。");
      const ranks = new Map(change.sectionIds.map((id, rank) => [id, rank]));
      for (const page of draft.document.data.metadata.layout.pages)
        for (const column of [page.main, page.sidebar])
          column.sort(
            (a, b) =>
              (ranks.get(a) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b) ?? Number.MAX_SAFE_INTEGER),
          );
    } else {
      const previous = items(source.content).find((item) => item.id === change.entryId);
      const target = items(draft.document.data).find((item) => item.id === change.entryId);
      if (!previous || !target) throw conflict();
      const field =
        change.target === "entry_body"
          ? "description"
          : ["name", "school", "company", "title", "organization", "language"].find(
              (name) => name in target,
            );
      if (
        !field ||
        !(field in target) ||
        typeof target[field] !== "string" ||
        target[field] !== previous[field]
      )
        throw conflict();
      target[field] = change.target === "entry_body" ? plainHtml(change.text) : change.text;
    }
  }
  await sql`UPDATE profile.resume_experience_links SET capture_open=false WHERE document_id=${documentId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
    tx,
  );
  return {
    target: "resume",
    draft: await saveNativeStudioDraftInTransaction(
      tx,
      owner,
      documentId,
      { expectedRevision, title: draft.title, document: draft.document },
      `ai-adopt:${key}`,
    ),
  };
}
