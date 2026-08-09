import { randomUUID } from "node:crypto";
import type { ResumeDocument } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  findRecoverableEmptyBaseDocument,
  resolveBaseResumeDocument,
  resumeAssetStatus,
  sortBaseResumeDocuments,
} from "./resume-assets-state";

function baseDocument(input: {
  id?: string;
  updatedAt: string;
  revision?: number;
  contentRevisionId?: string | null;
}): Extract<ResumeDocument, { kind: "base" }> {
  return {
    id: input.id ?? randomUUID(),
    ownerId: randomUUID(),
    ownerEpoch: 1,
    kind: "base",
    title: "基础简历",
    caseId: null,
    detachedFromCaseId: null,
    jobContext: null,
    baseDocumentId: null,
    baseDocumentRevisionId: null,
    evidenceRevisionId: null,
    revision: input.revision ?? 1,
    currentContentRevisionId: input.contentRevisionId ?? null,
    currentLayoutRevisionId: input.contentRevisionId ? randomUUID() : null,
    expiresAt: null,
    deletedAt: null,
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
  };
}

describe("resume asset state", () => {
  it("sorts base assets without admitting Case-derived documents", () => {
    const older = baseDocument({ updatedAt: "2026-08-08T00:00:00.000Z" });
    const newer = baseDocument({
      updatedAt: "2026-08-09T00:00:00.000Z",
      contentRevisionId: randomUUID(),
    });
    const derived: ResumeDocument = {
      ...newer,
      id: randomUUID(),
      kind: "case_derived",
      caseId: randomUUID(),
      detachedFromCaseId: null,
      jobContext: {
        kind: "public",
        publishedJobId: randomUUID(),
        publishedJobVersionId: randomUUID(),
        requirementSetId: randomUUID(),
        officialUrl: "https://example.com/jobs/1",
      },
      baseDocumentId: newer.id,
      baseDocumentRevisionId: newer.currentContentRevisionId as string,
      evidenceRevisionId: randomUUID(),
    };

    expect(sortBaseResumeDocuments([older, derived, newer]).map((item) => item.id)).toEqual([
      newer.id,
      older.id,
    ]);
  });

  it("recovers an interrupted V1 initialization and resolves explicit deep links", () => {
    const empty = baseDocument({ updatedAt: "2026-08-09T00:00:00.000Z" });
    const ready = baseDocument({
      updatedAt: "2026-08-08T00:00:00.000Z",
      revision: 3,
      contentRevisionId: randomUUID(),
    });
    const documents = [empty, ready];

    expect(findRecoverableEmptyBaseDocument(documents)?.id).toBe(empty.id);
    expect(resolveBaseResumeDocument(documents, ready.id)?.id).toBe(ready.id);
    expect(resolveBaseResumeDocument(documents, randomUUID())).toBeNull();
    expect(resumeAssetStatus(empty)).toEqual({
      label: "等待从已确认简历初始化",
      tone: "draft",
    });
    expect(resumeAssetStatus(ready)).toEqual({
      label: "可编辑 · 聚合修订 3",
      tone: "ready",
    });
  });
});
