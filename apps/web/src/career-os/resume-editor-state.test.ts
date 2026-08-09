import { randomUUID } from "node:crypto";
import type { ResumeSemanticContent } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  addResumeBlock,
  addResumeSection,
  moveResumeBlock,
  moveResumeSectionId,
  reconcileResumeSectionOrder,
  removeResumeBlock,
  removeResumeSection,
  toggleResumeBlockEvidence,
  updateResumeBlock,
  validateResumeDraft,
} from "./resume-editor-state";

function fixture(): ResumeSemanticContent {
  return {
    schemaVersion: "resume-content-v1",
    sections: [
      {
        id: randomUUID(),
        ordinal: 0,
        title: "项目经历",
        blocks: [
          { id: randomUUID(), ordinal: 0, text: "负责合成项目 A。", evidenceIds: [] },
          { id: randomUUID(), ordinal: 1, text: "交付合成结果 B。", evidenceIds: [] },
        ],
      },
      {
        id: randomUUID(),
        ordinal: 1,
        title: "技能",
        blocks: [{ id: randomUUID(), ordinal: 0, text: "TypeScript", evidenceIds: [] }],
      },
    ],
  };
}

describe("resume editor state", () => {
  it("preserves stable IDs while editing and moving blocks", () => {
    const content = fixture();
    const section = content.sections[0] as (typeof content.sections)[number];
    const first = section.blocks[0] as (typeof section.blocks)[number];
    const second = section.blocks[1] as (typeof section.blocks)[number];
    const evidenceId = "synthetic-evidence-1";
    const edited = toggleResumeBlockEvidence(
      updateResumeBlock(content, section.id, first.id, { text: "增强后的真实表达。" }),
      section.id,
      first.id,
      evidenceId,
    );
    const moved = moveResumeBlock(edited, section.id, first.id, "down");

    expect(moved.sections[0]?.blocks.map((block) => block.id)).toEqual([second.id, first.id]);
    expect(moved.sections[0]?.blocks[1]).toMatchObject({
      id: first.id,
      ordinal: 1,
      text: "增强后的真实表达。",
      evidenceIds: [evidenceId],
    });
  });

  it("adds and removes structure without allowing an empty document or section", () => {
    const content = fixture();
    const newSectionId = randomUUID();
    const newBlockId = randomUUID();
    const withSection = addResumeSection(content, {
      sectionId: newSectionId,
      blockId: newBlockId,
    });
    const withBlock = addResumeBlock(withSection, newSectionId, randomUUID());
    const oneBlock = removeResumeBlock(withBlock, newSectionId, newBlockId);
    const stillOneBlock = removeResumeBlock(
      oneBlock,
      newSectionId,
      oneBlock.sections[2]?.blocks[0]?.id ?? "",
    );
    const oneSection = removeResumeSection(
      removeResumeSection(stillOneBlock, content.sections[0]?.id ?? ""),
      content.sections[1]?.id ?? "",
    );
    const stillOneSection = removeResumeSection(oneSection, newSectionId);

    expect(stillOneBlock.sections[2]?.blocks).toHaveLength(1);
    expect(stillOneSection.sections).toHaveLength(1);
    expect(validateResumeDraft(stillOneSection)).toContain("新章节 的第 1 个区块没有正文。");
  });

  it("keeps semantic ordinals separate from explicit layout order", () => {
    const content = fixture();
    const ids = content.sections.map((section) => section.id);
    const moved = moveResumeSectionId(ids, ids[1] as string, "up");
    const newSectionId = randomUUID();
    const expanded = addResumeSection(content, { sectionId: newSectionId, blockId: randomUUID() });

    expect(moved).toEqual([ids[1], ids[0]]);
    expect(reconcileResumeSectionOrder(moved, expanded)).toEqual([ids[1], ids[0], newSectionId]);
    expect(content.sections.map((section) => section.ordinal)).toEqual([0, 1]);
  });
});
