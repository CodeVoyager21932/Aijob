import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  CreateResumeDocumentRequestSchema,
  PutResumeDocumentContentRevisionRequestSchema,
  ResumeDocumentReadModelSchema,
  ResumeDocumentSchema,
  ResumeTemplateKeySchema,
} from "./index.js";

const ids = {
  document: randomUUID(),
  revision: randomUUID(),
  section: randomUUID(),
  block: randomUUID(),
  owner: randomUUID(),
  case: randomUUID(),
  job: randomUUID(),
  version: randomUUID(),
  requirements: randomUUID(),
  evidence: randomUUID(),
};

const content = {
  sections: [
    {
      id: ids.section,
      ordinal: 0,
      title: "项目经历",
      blocks: [{ id: ids.block, ordinal: 0, text: "负责用户访谈与需求分析" }],
    },
  ],
};
const section = content.sections[0];
if (!section) throw new Error("test fixture section is missing");

describe("Resume Document V2 contracts", () => {
  it("freezes the two supported templates", () => {
    expect(ResumeTemplateKeySchema.options).toEqual([
      "cn_classic_single_column",
      "cn_compact_technical",
    ]);
  });

  it("keeps base and derived references mutually exclusive", () => {
    const common = {
      id: ids.document,
      ownerId: ids.owner,
      ownerEpoch: 1,
      title: "基础简历",
      revision: 1,
      currentContentRevisionId: ids.revision,
      currentLayoutRevisionId: null,
      expiresAt: "2026-08-20T00:00:00.000Z",
      deletedAt: null,
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    };
    expect(
      ResumeDocumentSchema.safeParse({
        ...common,
        kind: "base",
        caseId: null,
        publishedJobId: null,
        publishedJobVersionId: null,
        requirementSetId: null,
        baseDocumentRevisionId: null,
        evidenceRevisionId: null,
      }).success,
    ).toBe(true);
    expect(
      ResumeDocumentSchema.safeParse({
        ...common,
        kind: "case_derived",
        caseId: ids.case,
        publishedJobId: ids.job,
        publishedJobVersionId: ids.version,
        requirementSetId: ids.requirements,
        baseDocumentRevisionId: ids.revision,
        evidenceRevisionId: ids.evidence,
      }).success,
    ).toBe(true);
    expect(
      ResumeDocumentSchema.safeParse({
        ...common,
        kind: "base",
        caseId: ids.case,
        publishedJobId: null,
        publishedJobVersionId: null,
        requirementSetId: null,
        baseDocumentRevisionId: null,
        evidenceRevisionId: null,
      }).success,
    ).toBe(false);
  });

  it("keeps document creation scoped to a base or an existing case", () => {
    expect(
      CreateResumeDocumentRequestSchema.safeParse({ kind: "base", title: "基础简历" }).success,
    ).toBe(true);
    expect(
      CreateResumeDocumentRequestSchema.safeParse({
        kind: "case_derived",
        caseId: ids.case,
        baseDocumentRevisionId: ids.revision,
        title: "产品实习简历",
      }).success,
    ).toBe(true);
    expect(
      CreateResumeDocumentRequestSchema.safeParse({
        kind: "base",
        ownerId: ids.owner,
        title: "基础简历",
      }).success,
    ).toBe(false);
  });

  it("requires a legacy source for the first V2 edit and rejects server fields", () => {
    expect(
      PutResumeDocumentContentRevisionRequestSchema.safeParse({
        expectedRevision: 0,
        legacySourceRevisionId: ids.revision,
        content,
      }).success,
    ).toBe(true);
    expect(
      PutResumeDocumentContentRevisionRequestSchema.safeParse({
        expectedRevision: 0,
        content,
      }).success,
    ).toBe(false);
    expect(
      PutResumeDocumentContentRevisionRequestSchema.safeParse({
        expectedRevision: 1,
        baseDocumentRevisionId: ids.revision,
        content,
        ownerId: ids.owner,
      }).success,
    ).toBe(false);
  });

  it("keeps block IDs unique and distinguishes legacy from V2 read models", () => {
    expect(
      PutResumeDocumentContentRevisionRequestSchema.safeParse({
        expectedRevision: 0,
        legacySourceRevisionId: ids.revision,
        content: {
          sections: [
            {
              ...section,
              blocks: [section.blocks[0], section.blocks[0]],
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      ResumeDocumentReadModelSchema.safeParse({
        schemaVersion: "resume-document-v1",
        id: ids.revision,
        ownerId: ids.owner,
        ownerEpoch: 1,
        revision: 1,
        sections: [],
        readOnly: true,
      }).success,
    ).toBe(true);
    expect(
      ResumeDocumentReadModelSchema.safeParse({
        schemaVersion: "resume-document-v2",
        id: ids.revision,
        documentId: ids.document,
        ownerId: ids.owner,
        ownerEpoch: 1,
        documentRevision: 1,
        baseDocumentRevisionId: null,
        contentHash: "a".repeat(64),
        confirmedAt: "2026-08-05T00:00:00.000Z",
        createdAt: "2026-08-05T00:00:00.000Z",
        content,
      }).success,
    ).toBe(true);
  });

  it("does not allow an arbitrary template", () => {
    expect(ResumeTemplateKeySchema.safeParse("modern").success).toBe(false);
  });
});
