import type { ResumeDocument } from "@aijob/contracts";

export type BaseResumeDocument = Extract<ResumeDocument, { kind: "base" }>;

export function sortBaseResumeDocuments(documents: ResumeDocument[]): BaseResumeDocument[] {
  return documents
    .filter((document): document is BaseResumeDocument => document.kind === "base")
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
    );
}

export function findRecoverableEmptyBaseDocument(
  documents: BaseResumeDocument[],
): BaseResumeDocument | null {
  return documents.find((document) => document.currentContentRevisionId === null) ?? null;
}

export function resolveBaseResumeDocument(
  documents: BaseResumeDocument[],
  documentId: string | undefined,
): BaseResumeDocument | null {
  if (!documentId) return null;
  return documents.find((document) => document.id === documentId) ?? null;
}

export function resumeAssetStatus(document: BaseResumeDocument): {
  label: string;
  tone: "ready" | "draft";
} {
  return document.currentContentRevisionId
    ? { label: `可编辑 · 聚合修订 ${document.revision}`, tone: "ready" }
    : { label: "等待从已确认简历初始化", tone: "draft" };
}
