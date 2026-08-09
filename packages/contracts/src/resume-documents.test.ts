import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  CreateResumeDocumentRequestSchema,
  CreateResumeDocumentResponseSchema,
  DecideResumeReviewSuggestionRequestSchema,
  CreateResumeReviewRequestSchema,
  CurrentResumeReviewResponseSchema,
  LegacyResumeContentConversionSchema,
  ListResumeDocumentContentRevisionsResponseSchema,
  ListResumeDocumentLayoutRevisionsResponseSchema,
  ListResumeDocumentsQuerySchema,
  ListResumeDocumentsResponseSchema,
  PutResumeDocumentContentRevisionRequestSchema,
  PutResumeDocumentContentRevisionResponseSchema,
  PutResumeDocumentLayoutRevisionResponseSchema,
  PutResumeDocumentLayoutRevisionV2RequestSchema,
  ResumeDocumentCursorSchema,
  ResumeDocumentReadModelSchema,
  ResumeDocumentRevisionPageQuerySchema,
  ResumeDocumentSchema,
  ResumeLayoutSettingsSchema,
  ResumeReviewDecisionSchema,
  ResumeReviewRunSchema,
  ResumeReviewSuggestionSchema,
  ResumeSemanticContentSchema,
  ResumeTemplateKeySchema,
} from "./index.js";

const ids = {
  document: randomUUID(),
  revision: randomUUID(),
  section: randomUUID(),
  secondSection: randomUUID(),
  block: randomUUID(),
  owner: randomUUID(),
  case: randomUUID(),
  job: randomUUID(),
  version: randomUUID(),
  requirements: randomUUID(),
  evidence: randomUUID(),
  finding: randomUUID(),
  reviewRun: randomUUID(),
  suggestion: randomUUID(),
  decision: randomUUID(),
  snapshot: randomUUID(),
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
      expiresAt: null,
      deletedAt: null,
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    };
    expect(
      ResumeDocumentSchema.safeParse({
        ...common,
        kind: "base",
        caseId: null,
        detachedFromCaseId: null,
        jobContext: null,
        baseDocumentId: null,
        baseDocumentRevisionId: null,
        evidenceRevisionId: null,
      }).success,
    ).toBe(true);
    expect(
      ResumeDocumentSchema.safeParse({
        ...common,
        kind: "case_derived",
        caseId: ids.case,
        detachedFromCaseId: null,
        jobContext: {
          kind: "public",
          publishedJobId: ids.job,
          publishedJobVersionId: ids.version,
          requirementSetId: ids.requirements,
          officialUrl: "https://example.test/jobs/1",
        },
        baseDocumentId: ids.document,
        baseDocumentRevisionId: ids.revision,
        evidenceRevisionId: ids.evidence,
      }).success,
    ).toBe(true);
    expect(
      ResumeDocumentSchema.safeParse({
        ...common,
        kind: "base",
        caseId: ids.case,
        detachedFromCaseId: null,
        jobContext: null,
        baseDocumentId: null,
        baseDocumentRevisionId: null,
        evidenceRevisionId: null,
      }).success,
    ).toBe(false);
    expect(
      ResumeDocumentSchema.safeParse({
        ...common,
        kind: "case_derived",
        caseId: null,
        detachedFromCaseId: ids.case,
        jobContext: {
          kind: "private",
          snapshotId: ids.snapshot,
          ownerId: ids.owner,
          title: "用户私有岗位",
          companyName: null,
          sourceLabel: "用户粘贴",
          contentRevision: 1,
          requirementSetRevision: 1,
          sourceProvided: false,
        },
        baseDocumentId: ids.document,
        baseDocumentRevisionId: ids.revision,
        evidenceRevisionId: ids.evidence,
      }).success,
    ).toBe(true);
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
        expectedCaseRevision: 1,
        title: "产品实习简历",
      }).success,
    ).toBe(true);
    expect(
      CreateResumeDocumentRequestSchema.safeParse({
        kind: "case_derived",
        caseId: ids.case,
        baseDocumentRevisionId: ids.revision,
        title: "缺少 Case revision",
      }).success,
    ).toBe(false);
    expect(
      CreateResumeDocumentRequestSchema.safeParse({
        kind: "base",
        ownerId: ids.owner,
        title: "基础简历",
      }).success,
    ).toBe(false);
  });

  it("freezes stable document pagination and keeps legacy V1 explicit but outside V2 items", () => {
    const resumeDocument = ResumeDocumentSchema.parse({
      id: ids.document,
      ownerId: ids.owner,
      ownerEpoch: 1,
      kind: "base",
      title: "基础简历",
      caseId: null,
      detachedFromCaseId: null,
      jobContext: null,
      baseDocumentId: null,
      baseDocumentRevisionId: null,
      evidenceRevisionId: null,
      revision: 1,
      currentContentRevisionId: null,
      currentLayoutRevisionId: null,
      expiresAt: null,
      deletedAt: null,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(ListResumeDocumentsQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(ListResumeDocumentsQuerySchema.parse({ kind: "base" })).toEqual({
      limit: 20,
      kind: "base",
    });
    expect(
      ListResumeDocumentsQuerySchema.parse({ kind: "case_derived", caseId: ids.case }),
    ).toEqual({ limit: 20, kind: "case_derived", caseId: ids.case });
    expect(
      ListResumeDocumentsQuerySchema.safeParse({ kind: "base", caseId: ids.case }).success,
    ).toBe(false);
    expect(ListResumeDocumentsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(
      ResumeDocumentCursorSchema.safeParse({
        updatedAt: resumeDocument.updatedAt,
        id: ids.document,
      }).success,
    ).toBe(true);
    expect(
      ListResumeDocumentsResponseSchema.safeParse({
        items: [resumeDocument],
        nextCursor: null,
        legacySource: {
          legacySourceRevisionId: ids.revision,
          legacySchemaVersion: "resume-document-v1",
          legacyRevision: 2,
          ownerId: ids.owner,
          ownerEpoch: 1,
          confirmedAt: "2026-08-08T00:00:00.000Z",
          readOnly: true,
          migratedDocumentId: null,
        },
      }).success,
    ).toBe(true);
    expect(
      ListResumeDocumentsResponseSchema.safeParse({
        items: [
          {
            schemaVersion: "resume-document-v1",
            id: ids.revision,
            ownerId: ids.owner,
            ownerEpoch: 1,
            revision: 2,
            sections: [],
            readOnly: true,
          },
        ],
        nextCursor: null,
        legacySource: null,
      }).success,
    ).toBe(false);
  });

  it("returns the original aggregate outcome for idempotent document creation", () => {
    expect(
      CreateResumeDocumentResponseSchema.safeParse({
        resumeDocument: {
          id: ids.document,
          ownerId: ids.owner,
          ownerEpoch: 1,
          kind: "base",
          title: "基础简历",
          caseId: null,
          detachedFromCaseId: null,
          jobContext: null,
          baseDocumentId: null,
          baseDocumentRevisionId: null,
          evidenceRevisionId: null,
          revision: 1,
          currentContentRevisionId: null,
          currentLayoutRevisionId: null,
          expiresAt: null,
          deletedAt: null,
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:00.000Z",
        },
        created: true,
      }).success,
    ).toBe(true);
  });

  it("keeps legacy conversion read-only and freezes revision page/result envelopes", () => {
    const semanticContent = {
      schemaVersion: "resume-content-v1" as const,
      sections: content.sections.map((item) => ({
        ...item,
        blocks: item.blocks.map((block) => ({ ...block, evidenceIds: [] })),
      })),
    };
    const semanticRevision = {
      schemaVersion: "resume-content-revision-v1" as const,
      id: ids.revision,
      documentId: ids.document,
      ownerId: ids.owner,
      ownerEpoch: 1,
      documentRevision: 1,
      baseDocumentRevisionId: null,
      contentHash: "a".repeat(64),
      confirmedAt: "2026-08-09T00:00:00.000Z",
      createdAt: "2026-08-09T00:00:00.000Z",
      content: semanticContent,
    };
    const layoutRevision = {
      schemaVersion: "resume-layout-v2" as const,
      id: randomUUID(),
      documentId: ids.document,
      ownerId: ids.owner,
      ownerEpoch: 1,
      layoutRevision: 1,
      baseLayoutRevision: null,
      templateKey: "cn_classic_single_column" as const,
      sectionOrder: [ids.section],
      settings: {
        schemaVersion: "resume-layout-settings-v1" as const,
        fontSizeToken: "standard" as const,
        lineSpacingToken: "standard" as const,
        sectionSpacingToken: "standard" as const,
        colorToken: "charcoal" as const,
        pageBreakPolicy: "keep_sections" as const,
      },
      contentHash: "b".repeat(64),
      createdAt: "2026-08-09T00:00:00.000Z",
    };

    expect(
      LegacyResumeContentConversionSchema.safeParse({
        schemaVersion: "resume-legacy-content-conversion-v1",
        legacySource: {
          legacySourceRevisionId: ids.revision,
          legacySchemaVersion: "resume-document-v1",
          legacyRevision: 1,
          ownerId: ids.owner,
          ownerEpoch: 1,
          confirmedAt: "2026-08-09T00:00:00.000Z",
          readOnly: true,
          migratedDocumentId: null,
        },
        content: semanticContent,
      }).success,
    ).toBe(true);
    expect(ResumeDocumentRevisionPageQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(ResumeDocumentRevisionPageQuerySchema.safeParse({ beforeRevision: 0 }).success).toBe(
      false,
    );
    expect(
      ListResumeDocumentContentRevisionsResponseSchema.safeParse({
        documentRevision: 2,
        currentContentRevisionId: ids.revision,
        current: semanticRevision,
        items: [semanticRevision],
        nextBeforeRevision: null,
      }).success,
    ).toBe(true);
    expect(
      PutResumeDocumentContentRevisionResponseSchema.safeParse({
        contentRevision: semanticRevision,
        documentRevision: 2,
        created: true,
      }).success,
    ).toBe(true);
    expect(
      ListResumeDocumentLayoutRevisionsResponseSchema.safeParse({
        documentRevision: 2,
        currentLayoutRevisionId: layoutRevision.id,
        current: layoutRevision,
        items: [layoutRevision],
        nextBeforeRevision: null,
      }).success,
    ).toBe(true);
    expect(
      PutResumeDocumentLayoutRevisionResponseSchema.safeParse({
        layoutRevision,
        documentRevision: 3,
        created: true,
      }).success,
    ).toBe(true);
  });

  it("requires a legacy source for the first V2 edit and rejects server fields", () => {
    expect(
      PutResumeDocumentContentRevisionRequestSchema.safeParse({
        expectedRevision: 0,
        legacySourceRevisionId: ids.revision,
        content: {
          schemaVersion: "resume-content-v1",
          sections: content.sections.map((item) => ({
            ...item,
            blocks: item.blocks.map((block) => ({ ...block, evidenceIds: [] })),
          })),
        },
      }).success,
    ).toBe(true);
    expect(
      PutResumeDocumentContentRevisionRequestSchema.safeParse({
        expectedRevision: 0,
        content: { schemaVersion: "resume-content-v1", sections: [] },
      }).success,
    ).toBe(false);
    expect(
      PutResumeDocumentContentRevisionRequestSchema.safeParse({
        expectedRevision: 1,
        baseDocumentRevisionId: ids.revision,
        content: {
          schemaVersion: "resume-content-v1",
          sections: content.sections.map((item) => ({
            ...item,
            blocks: item.blocks.map((block) => ({ ...block, evidenceIds: [] })),
          })),
        },
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
          schemaVersion: "resume-content-v1",
          sections: [
            {
              ...section,
              blocks: [
                { ...section.blocks[0], evidenceIds: [] },
                { ...section.blocks[0], evidenceIds: [] },
              ],
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

  it("keeps legacy block review state read-only and new content semantic", () => {
    const semanticContent = {
      schemaVersion: "resume-content-v1",
      sections: [
        {
          id: ids.section,
          ordinal: 0,
          title: "项目经历",
          blocks: [
            {
              id: ids.block,
              ordinal: 0,
              text: "负责用户访谈与需求分析",
              evidenceIds: ["evidence-1"],
            },
          ],
        },
      ],
    };
    expect(ResumeSemanticContentSchema.safeParse(semanticContent).success).toBe(true);
    expect(
      ResumeSemanticContentSchema.safeParse({
        ...semanticContent,
        sections: [
          {
            ...semanticContent.sections[0],
            blocks: [
              {
                ...semanticContent.sections[0]?.blocks[0],
                suggestionDecision: "accepted",
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      PutResumeDocumentContentRevisionRequestSchema.safeParse({
        expectedRevision: 1,
        baseDocumentRevisionId: ids.revision,
        content: {
          schemaVersion: "resume-content-v1",
          sections: [
            {
              id: ids.section,
              ordinal: 0,
              title: "项目经历",
              blocks: [
                {
                  id: ids.block,
                  ordinal: 0,
                  text: "兼容旧 024 正文",
                  evidenceIds: [],
                  suggestionDecision: "rejected",
                },
              ],
            },
          ],
        },
      }).success,
    ).toBe(false);
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
        content: {
          sections: [
            {
              id: ids.section,
              ordinal: 0,
              title: "项目经历",
              blocks: [
                {
                  id: ids.block,
                  ordinal: 0,
                  text: "旧建议状态仍可读取",
                  suggestionDecision: "accepted",
                },
              ],
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it("allows only versioned layout tokens and rejects content or CSS fields", () => {
    const settings = {
      schemaVersion: "resume-layout-settings-v1" as const,
      fontSizeToken: "standard" as const,
      lineSpacingToken: "standard" as const,
      sectionSpacingToken: "tight" as const,
      colorToken: "charcoal" as const,
      pageBreakPolicy: "keep_sections" as const,
    };
    expect(ResumeLayoutSettingsSchema.safeParse(settings).success).toBe(true);
    expect(
      ResumeLayoutSettingsSchema.safeParse({ ...settings, css: "body { display: none }" }).success,
    ).toBe(false);
    expect(
      PutResumeDocumentLayoutRevisionV2RequestSchema.safeParse({
        expectedRevision: 1,
        templateKey: "cn_classic_single_column",
        sectionOrder: [ids.section],
        settings,
        resumeText: "正文不能进入布局",
      }).success,
    ).toBe(false);
  });

  it("requires text-changing review suggestions to cite confirmed evidence", () => {
    const suggestion = {
      schemaVersion: "resume-review-suggestion-v1" as const,
      id: ids.suggestion,
      ownerId: ids.owner,
      ownerEpoch: 1,
      reviewRunId: ids.reviewRun,
      findingId: ids.finding,
      targetType: "block" as const,
      targetIds: [ids.block],
      changeType: "rewrite_block" as const,
      suggestedText: "基于 8 次用户访谈梳理 3 项核心需求",
      evidenceIds: ["evidence-1"],
      decision: "pending" as const,
      revision: 1,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    expect(ResumeReviewSuggestionSchema.safeParse(suggestion).success).toBe(true);
    expect(ResumeReviewSuggestionSchema.safeParse({ ...suggestion, evidenceIds: [] }).success).toBe(
      false,
    );
    expect(
      ResumeReviewSuggestionSchema.safeParse({
        ...suggestion,
        targetType: "section",
      }).success,
    ).toBe(false);
    expect(
      ResumeReviewSuggestionSchema.safeParse({
        ...suggestion,
        targetType: "section",
        targetIds: [ids.section, ids.secondSection],
        changeType: "reorder_section",
        suggestedText: null,
        evidenceIds: [],
      }).success,
    ).toBe(true);
  });

  it("keeps review decisions traceable without overwriting the suggestion", () => {
    const common = {
      schemaVersion: "resume-review-decision-v1" as const,
      id: ids.decision,
      ownerId: ids.owner,
      ownerEpoch: 1,
      reviewRunId: ids.reviewRun,
      suggestionId: ids.suggestion,
      basedOnSuggestionRevision: 1,
      idempotencyKeyHash: "b".repeat(64),
      createdAt: "2026-08-06T00:00:00.000Z",
    };
    expect(
      ResumeReviewDecisionSchema.safeParse({
        ...common,
        decision: "accepted",
        editedText: null,
        resultContentRevisionId: ids.revision,
        reasonCode: null,
      }).success,
    ).toBe(true);
    expect(
      ResumeReviewDecisionSchema.safeParse({
        ...common,
        decision: "accepted",
        editedText: null,
        resultContentRevisionId: ids.revision,
        reasonCode: "UNEXPECTED_REASON",
      }).success,
    ).toBe(false);
    expect(
      ResumeReviewDecisionSchema.safeParse({
        ...common,
        decision: "edited",
        editedText: "用户确认后的表达",
        resultContentRevisionId: ids.revision,
        reasonCode: null,
      }).success,
    ).toBe(true);
    expect(
      ResumeReviewDecisionSchema.safeParse({
        ...common,
        decision: "rejected",
        editedText: null,
        resultContentRevisionId: ids.revision,
        reasonCode: "USER_REJECTED",
      }).success,
    ).toBe(false);
    expect(
      DecideResumeReviewSuggestionRequestSchema.safeParse({
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        decision: "accepted",
        ownerId: ids.owner,
      }).success,
    ).toBe(false);
  });

  it("keeps template review creation explicit and the empty current response honest", () => {
    expect(
      CreateResumeReviewRequestSchema.safeParse({ expectedRevision: 2, mode: "template" }).success,
    ).toBe(true);
    expect(
      CreateResumeReviewRequestSchema.safeParse({
        expectedRevision: 2,
        mode: "controlled_ai",
      }).success,
    ).toBe(false);
    expect(CurrentResumeReviewResponseSchema.parse({ review: null })).toEqual({ review: null });
  });

  it("keeps private review runs owner-scoped", () => {
    const reviewRun = {
      schemaVersion: "resume-review-run-v1" as const,
      id: ids.reviewRun,
      ownerId: ids.owner,
      ownerEpoch: 1,
      caseId: ids.case,
      detachedFromCaseId: null,
      documentId: ids.document,
      contentRevisionId: ids.revision,
      jobContext: {
        kind: "private" as const,
        snapshotId: ids.snapshot,
        ownerId: ids.owner,
        title: "产品实习生",
        companyName: null,
        sourceLabel: "用户粘贴",
        contentRevision: 1,
        requirementSetRevision: 1,
        sourceProvided: false,
      },
      evidenceRevisionId: ids.evidence,
      mode: "template" as const,
      status: "pending" as const,
      revision: 1,
      completedAt: null,
      deletedAt: null,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    expect(ResumeReviewRunSchema.safeParse(reviewRun).success).toBe(true);
    expect(
      ResumeReviewRunSchema.safeParse({
        ...reviewRun,
        caseId: null,
        detachedFromCaseId: ids.case,
      }).success,
    ).toBe(true);
    expect(
      ResumeReviewRunSchema.safeParse({
        ...reviewRun,
        status: "superseded",
        completedAt: "2026-08-06T01:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      ResumeReviewRunSchema.safeParse({
        ...reviewRun,
        status: "superseded",
      }).success,
    ).toBe(false);
    expect(
      ResumeReviewRunSchema.safeParse({
        ...reviewRun,
        jobContext: { ...reviewRun.jobContext, ownerId: randomUUID() },
      }).success,
    ).toBe(false);
  });
});
