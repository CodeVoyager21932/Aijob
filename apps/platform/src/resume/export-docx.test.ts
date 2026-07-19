import { describe, expect, it } from "vitest";
import { createAtsResumeDocx } from "./export-docx.js";
import { validateDocxArchive } from "./parse.js";

describe("ATS-friendly DOCX export", () => {
  it("creates a valid macro-free DOCX from confirmed sections", async () => {
    const buffer = await createAtsResumeDocx({
      title: "产品运营实习简历",
      sections: [
        {
          id: "experience",
          heading: "项目经历",
          paragraphs: ["- 基于用户访谈整理需求，并交付可验证原型。"],
        },
      ],
    });

    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(buffer.length).toBeGreaterThan(1_000);
    await expect(validateDocxArchive(buffer)).resolves.toBeUndefined();
  });
});
