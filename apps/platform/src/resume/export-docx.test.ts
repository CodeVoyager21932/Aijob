import { describe, expect, it } from "vitest";
import { fromBuffer } from "yauzl";
import { createAtsResumeDocx } from "./export-docx.js";
import { runResumeParserProcess } from "./parse.js";

async function validateGeneratedDocx(buffer: Buffer): Promise<void> {
  await runResumeParserProcess({
    operation: "validate-docx",
    buffer,
    timeoutMs: 10_000,
  });
}

async function readArchiveEntry(buffer: Buffer, fileName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true }, (openError, archive) => {
      if (openError || !archive) return reject(openError ?? new Error("DOCX_ARCHIVE_OPEN_FAILED"));
      archive.on("error", reject);
      archive.on("end", () => reject(new Error(`DOCX_ENTRY_MISSING:${fileName}`)));
      archive.on("entry", (entry) => {
        if (entry.fileName !== fileName) {
          archive.readEntry();
          return;
        }
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            reject(streamError ?? new Error("DOCX_ENTRY_READ_FAILED"));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        });
      });
      archive.readEntry();
    });
  });
}

describe("ATS-friendly DOCX export", () => {
  it("creates a valid macro-free DOCX from confirmed sections", async () => {
    const buffer = await createAtsResumeDocx({
      title: "产品运营实习简历",
      sections: [
        {
          id: "education",
          heading: "教育经历",
          paragraphs: ["本科在读，预计 2027 年毕业。"],
        },
        {
          id: "experience",
          heading: "项目经历",
          paragraphs: ["- 使用 SQL 分析反馈，完成 3 次用户访谈。"],
        },
      ],
    });

    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(buffer.length).toBeGreaterThan(1_000);
    await expect(validateGeneratedDocx(buffer)).resolves.toBeUndefined();
    const documentXml = await readArchiveEntry(buffer, "word/document.xml");
    expect(documentXml).toContain("教育经历");
    expect(documentXml).toContain("本科在读，预计 2027 年毕业。");
    expect(documentXml).toContain("项目经历");
    expect(documentXml).toContain("使用 SQL 分析反馈，完成 3 次用户访谈。");
    expect(documentXml.indexOf("教育经历")).toBeLessThan(documentXml.indexOf("项目经历"));
  }, 15_000);

  it("keeps the compact technical template single-column and ATS-readable", async () => {
    const buffer = await createAtsResumeDocx({
      title: "技术实习简历",
      templateKey: "cn_compact_technical",
      sections: [
        {
          id: "skills",
          heading: "技术能力",
          paragraphs: ["TypeScript、PostgreSQL、React"],
        },
      ],
    });

    await expect(validateGeneratedDocx(buffer)).resolves.toBeUndefined();
    const documentXml = await readArchiveEntry(buffer, "word/document.xml");
    expect(documentXml).toContain("技术能力");
    expect(documentXml).toContain("TypeScript、PostgreSQL、React");
    expect(documentXml).toContain('w:top="720"');
    expect(documentXml).not.toContain("w:tbl");
  }, 15_000);
});
