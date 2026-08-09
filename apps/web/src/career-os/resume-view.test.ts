import { randomUUID } from "node:crypto";
import type {
  ResumeDocumentContentRevisionReadModel,
  ResumeDocumentLayoutRevisionReadModel,
} from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { findResumeBlock, orderResumeSections } from "./resume-view";

describe("M1 resume read-only view", () => {
  it("uses immutable layout order while preserving stable block IDs", () => {
    const ownerId = randomUUID();
    const documentId = randomUUID();
    const firstSection = randomUUID();
    const secondSection = randomUUID();
    const firstBlock = randomUUID();
    const secondBlock = randomUUID();
    const content: ResumeDocumentContentRevisionReadModel = {
      schemaVersion: "resume-content-revision-v1",
      id: randomUUID(),
      documentId,
      ownerId,
      ownerEpoch: 1,
      documentRevision: 1,
      baseDocumentRevisionId: null,
      contentHash: "a".repeat(64),
      confirmedAt: "2026-08-09T00:00:00.000Z",
      createdAt: "2026-08-09T00:00:00.000Z",
      content: {
        schemaVersion: "resume-content-v1",
        sections: [
          {
            id: firstSection,
            ordinal: 0,
            title: "教育",
            blocks: [{ id: firstBlock, ordinal: 0, text: "教育内容", evidenceIds: [] }],
          },
          {
            id: secondSection,
            ordinal: 1,
            title: "项目",
            blocks: [
              { id: secondBlock, ordinal: 0, text: "项目内容", evidenceIds: ["evidence-1"] },
            ],
          },
        ],
      },
    };
    const layout: ResumeDocumentLayoutRevisionReadModel = {
      schemaVersion: "resume-layout-v2",
      id: randomUUID(),
      documentId,
      ownerId,
      ownerEpoch: 1,
      layoutRevision: 1,
      baseLayoutRevision: null,
      templateKey: "cn_classic_single_column",
      sectionOrder: [secondSection, firstSection],
      settings: {
        schemaVersion: "resume-layout-settings-v1",
        fontSizeToken: "standard",
        lineSpacingToken: "standard",
        sectionSpacingToken: "standard",
        colorToken: "charcoal",
        pageBreakPolicy: "keep_sections",
      },
      contentHash: "b".repeat(64),
      createdAt: "2026-08-09T00:00:00.000Z",
    };
    const sections = orderResumeSections(content, layout);
    expect(sections.map((section) => section.id)).toEqual([secondSection, firstSection]);
    expect(findResumeBlock(sections, secondBlock)).toMatchObject({
      selected: { id: secondBlock, evidenceIds: ["evidence-1"] },
      requestedBlockExists: true,
    });
    expect(findResumeBlock(sections, randomUUID()).requestedBlockExists).toBe(false);
  });
});
