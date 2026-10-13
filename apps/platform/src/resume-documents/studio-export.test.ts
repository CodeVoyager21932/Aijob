import { randomUUID } from "node:crypto";
import {
  blankResumeEntry,
  blankResumeStudioContent,
  ResumeStudioLayoutSchema,
  resumeRichText,
  resumeStudioPrintHtml,
} from "@aijob/contracts";
import { createDatabase } from "@aijob/database";
import { describe, expect, it } from "vitest";
import { fromBuffer } from "yauzl";
import { renderResumePdf } from "./pdf-service.js";
import { studioSemanticProjection } from "./studio-content.js";
import { createStudioDocx } from "./studio-docx.js";

function fixture() {
  const c = blankResumeStudioContent();
  c.basics.name = "中文夹具";
  c.basics.links = [{ label: "作品集", url: "https://example.test/portfolio" }];
  const e = {
    ...blankResumeEntry(randomUUID()),
    title: "项目研究",
    body: resumeRichText("保留完整项目背景。"),
  };
  e.body = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "研究步骤" }] },
              { type: "paragraph", content: [{ type: "text", text: "同一项的补充说明" }] },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "项目报告",
                    marks: [
                      { type: "link", attrs: { href: "https://example.test/report" } },
                      { type: "bold" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  c.sections = [
    {
      id: randomUUID(),
      kind: "project",
      title: "项目经历",
      column: "main",
      hidden: false,
      pageBreakBefore: false,
      entries: [e],
    },
  ];
  return c;
}
function firstSection(content: ReturnType<typeof fixture>) {
  const section = content.sections[0];
  if (!section) throw new Error("Missing fixture section");
  return section;
}

function archiveEntry(buffer: Buffer, filename: string): Promise<string> {
  return new Promise((resolve, reject) =>
    fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("No archive"));
      zip.on("error", reject);
      zip.on("end", () => reject(new Error("Missing archive entry")));
      zip.on("entry", (entry) => {
        if (entry.fileName !== filename) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            zip.close();
            reject(error);
            return;
          }
          const bytes: Buffer[] = [];
          stream.on("data", (chunk) => bytes.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            zip.close();
            resolve(Buffer.concat(bytes).toString("utf8"));
          });
        });
      });
      zip.readEntry();
    }),
  );
}
describe("studio export structure", () => {
  it("keeps ordered numbering, continuation paragraphs, rich text and hyperlinks in DOCX", async () => {
    const output = await createStudioDocx(fixture(), ResumeStudioLayoutSchema.parse({}));
    const [xml, numbering, rels] = await Promise.all([
      archiveEntry(output, "word/document.xml"),
      archiveEntry(output, "word/numbering.xml"),
      archiveEntry(output, "word/_rels/document.xml.rels"),
    ]);
    expect(xml).toContain("中文夹具");
    expect(xml).toContain("同一项的补充说明");
    expect(xml).toContain("<w:b/>");
    expect((xml.match(/<w:numPr>/g) ?? []).length).toBe(2);
    expect(numbering).toContain('<w:numFmt w:val="decimal"/>');
    expect(numbering).toContain('<w:start w:val="3"/>');
    expect(rels).toContain('Target="https://example.test/report"');
    expect(rels).toContain('Target="https://example.test/portfolio"');
  });
  it("places only body modules in two DOCX columns and supports explicit main/aside assignment", async () => {
    const content = fixture(),
      layout = ResumeStudioLayoutSchema.parse({ templateKey: "cn_simple_two_column" });
    const automatic = await archiveEntry(
      await createStudioDocx(content, layout),
      "word/document.xml",
    );
    expect((automatic.match(/<w:sectPr>/g) ?? []).length).toBe(3);
    expect(automatic).toContain('w:num="2"');
    content.sections.push({
      ...firstSection(content),
      id: randomUUID(),
      column: "aside",
      entries: [
        { ...blankResumeEntry(randomUUID()), title: "技能", body: resumeRichText("工具使用") },
      ],
    });
    const assigned = await archiveEntry(
      await createStudioDocx(content, layout),
      "word/document.xml",
    );
    expect(assigned).toContain("<w:tbl>");
    const rows = assigned.match(/<w:tr>[\s\S]*?<\/w:tr>/g) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    // Long editable columns use bounded rows so Word/WPS can paginate them;
    // the contract is two cells per row, not one unbreakable row per document.
    for (const row of rows) expect((row.match(/<w:tc>/g) ?? []).length).toBe(2);
    expect(assigned).toContain("工具使用");
  });
  it("escapes imported strings, preserves section assignment and keeps hidden content absent", () => {
    const content = fixture();
    content.basics.name = '<img src="https://example.test/track">';
    firstSection(content).column = "aside";
    const html = resumeStudioPrintHtml(
      "fixture",
      content,
      ResumeStudioLayoutSchema.parse({ columns: "two" }),
    );
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img src=");
    expect(html).toContain('class="sections sections--assigned"');
    expect(html).toContain('<ol start="3">');
    firstSection(content).hidden = true;
    expect(
      resumeStudioPrintHtml("fixture", content, ResumeStudioLayoutSchema.parse({})),
    ).not.toContain("项目研究");
  });
  it("lifts explicit module and entry page breaks out of multi-column flows", () => {
    const content = fixture();
    content.sections.push({
      ...firstSection(content),
      id: randomUUID(),
      pageBreakBefore: true,
      entries: [
        { ...blankResumeEntry(randomUUID()), title: "第二页", body: resumeRichText("第一页之后") },
        {
          ...blankResumeEntry(randomUUID()),
          title: "第三页",
          pageBreakBefore: true,
          body: resumeRichText("第二页之后"),
        },
      ],
    });
    const html = resumeStudioPrintHtml(
      "fixture",
      content,
      ResumeStudioLayoutSchema.parse({ columns: "two" }),
    );
    expect((html.match(/class="print-group page-break"/g) ?? []).length).toBe(2);
    expect((html.match(/class="sections sections--flow"/g) ?? []).length).toBe(3);
  });
  it("reports missing serif font before querying the database or silently changing typography", async () => {
    const db = createDatabase("postgresql://unused");
    try {
      const content = fixture(),
        plain = studioSemanticProjection(content);
      if (!plain) throw new Error("Invalid fixture");
      await expect(
        renderResumePdf({
          db,
          snapshot: {
            title: "fixture",
            studio: { content, layout: ResumeStudioLayoutSchema.parse({ fontFamily: "serif" }) },
            content: plain,
            templateKey: "cn_classic_single_column",
            sectionOrder: plain.sections.map((s) => s.id),
            settings: {
              schemaVersion: "resume-layout-settings-v1",
              fontSizeToken: "standard",
              lineSpacingToken: "standard",
              sectionSpacingToken: "standard",
              colorToken: "black",
              pageBreakPolicy: "automatic",
            },
          },
          runtime: {
            executablePath: "unused",
            fontPath: "unused",
            concurrency: 1,
            timeoutMs: 5000,
          },
        }),
      ).rejects.toMatchObject({ code: "PDF_SERIF_FONT_NOT_READY" });
    } finally {
      await db.destroy();
    }
  });
});
