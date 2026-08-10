import { randomUUID } from "node:crypto";
import type { ResumeSemanticContent } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { buildResumeDocumentDocxInput } from "./export-service.js";

describe("Resume V2 DOCX adapter", () => {
  it("uses the immutable layout order and stable block order without changing content", () => {
    const firstSectionId = randomUUID();
    const secondSectionId = randomUUID();
    const content = {
      schemaVersion: "resume-content-v1",
      sections: [
        {
          id: firstSectionId,
          ordinal: 0,
          title: "教育经历",
          blocks: [
            { id: randomUUID(), ordinal: 1, text: "第二段", evidenceIds: ["evidence-2"] },
            { id: randomUUID(), ordinal: 0, text: "第一段", evidenceIds: ["evidence-1"] },
          ],
        },
        {
          id: secondSectionId,
          ordinal: 1,
          title: "项目经历",
          blocks: [{ id: randomUUID(), ordinal: 0, text: "项目内容", evidenceIds: ["evidence-3"] }],
        },
      ],
    } satisfies ResumeSemanticContent;

    expect(
      buildResumeDocumentDocxInput({
        title: "岗位简历",
        content,
        templateKey: "cn_compact_technical",
        sectionOrder: [secondSectionId, firstSectionId],
      }),
    ).toEqual({
      title: "岗位简历",
      templateKey: "cn_compact_technical",
      sections: [
        { id: secondSectionId, heading: "项目经历", paragraphs: ["项目内容"] },
        { id: firstSectionId, heading: "教育经历", paragraphs: ["第一段", "第二段"] },
      ],
    });
    expect(content.sections[0]?.blocks[0]?.evidenceIds).toEqual(["evidence-2"]);
  });

  it("fails closed when layout and content section IDs diverge", () => {
    const sectionId = randomUUID();
    expect(() =>
      buildResumeDocumentDocxInput({
        title: "岗位简历",
        content: {
          schemaVersion: "resume-content-v1",
          sections: [
            {
              id: sectionId,
              ordinal: 0,
              title: "项目经历",
              blocks: [{ id: randomUUID(), ordinal: 0, text: "内容", evidenceIds: [] }],
            },
          ],
        },
        templateKey: "cn_classic_single_column",
        sectionOrder: [randomUUID()],
      }),
    ).toThrow("当前布局与正文结构不一致");
  });
});
