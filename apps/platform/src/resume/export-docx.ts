import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

export interface AtsResumeSection {
  id: string;
  heading: string;
  paragraphs: string[];
}

export interface AtsResumeDocumentInput {
  title?: string;
  sections: AtsResumeSection[];
}

function bodyParagraph(text: string): Paragraph {
  const isBullet = /^[•·*-]\s+/.test(text);
  const normalized = isBullet ? text.replace(/^[•·*-]\s+/, "") : text;
  return new Paragraph({
    ...(isBullet ? { bullet: { level: 0 } } : {}),
    spacing: { after: 100, line: 276 },
    children: [
      new TextRun({
        text: normalized,
        font: "Microsoft YaHei",
        size: 21,
      }),
    ],
  });
}

export async function createAtsResumeDocx(input: AtsResumeDocumentInput): Promise<Buffer> {
  if (input.sections.length === 0) {
    throw new Error("RESUME_EXPORT_REQUIRES_SECTIONS");
  }

  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
      children: [
        new TextRun({
          text: input.title?.trim() || "简历",
          bold: true,
          font: "Microsoft YaHei",
          size: 34,
        }),
      ],
    }),
  ];

  for (const section of input.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 180, after: 100 },
        children: [
          new TextRun({
            text: section.heading.trim(),
            bold: true,
            font: "Microsoft YaHei",
            size: 24,
          }),
        ],
      }),
    );
    for (const paragraph of section.paragraphs.filter((value) => value.trim())) {
      children.push(bodyParagraph(paragraph.trim()));
    }
  }

  const document = new Document({
    creator: "Aijob local MVP",
    description: "User-confirmed ATS-friendly resume export",
    styles: {
      default: {
        document: {
          run: {
            font: "Microsoft YaHei",
            size: 21,
          },
          paragraph: {
            spacing: { line: 276 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1_080,
              right: 1_080,
              bottom: 1_080,
              left: 1_080,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}
