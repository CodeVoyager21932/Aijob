import type { ResumeTemplateKey } from "@aijob/contracts";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

export interface AtsResumeSection {
  id: string;
  heading: string;
  paragraphs: string[];
}

export interface AtsResumeDocumentInput {
  title?: string;
  templateKey?: ResumeTemplateKey;
  sections: AtsResumeSection[];
}

interface DocxTemplatePreset {
  bodySize: number;
  headingSize: number;
  titleSize: number;
  bodyLine: number;
  bodyAfter: number;
  headingBefore: number;
  headingAfter: number;
  titleAfter: number;
  margin: number;
}

const DOCX_TEMPLATE_PRESETS: Record<ResumeTemplateKey, DocxTemplatePreset> = {
  cn_classic_single_column: {
    bodySize: 21,
    headingSize: 24,
    titleSize: 34,
    bodyLine: 276,
    bodyAfter: 100,
    headingBefore: 180,
    headingAfter: 100,
    titleAfter: 260,
    margin: 1_080,
  },
  cn_compact_technical: {
    bodySize: 19,
    headingSize: 22,
    titleSize: 30,
    bodyLine: 240,
    bodyAfter: 60,
    headingBefore: 120,
    headingAfter: 70,
    titleAfter: 180,
    margin: 720,
  },
};

function bodyParagraph(text: string, preset: DocxTemplatePreset): Paragraph {
  const isBullet = /^[•·*-]\s+/.test(text);
  const normalized = isBullet ? text.replace(/^[•·*-]\s+/, "") : text;
  return new Paragraph({
    ...(isBullet ? { bullet: { level: 0 } } : {}),
    spacing: { after: preset.bodyAfter, line: preset.bodyLine },
    children: [
      new TextRun({
        text: normalized,
        font: "Microsoft YaHei",
        size: preset.bodySize,
      }),
    ],
  });
}

export async function createAtsResumeDocx(input: AtsResumeDocumentInput): Promise<Buffer> {
  if (input.sections.length === 0) {
    throw new Error("RESUME_EXPORT_REQUIRES_SECTIONS");
  }

  const preset = DOCX_TEMPLATE_PRESETS[input.templateKey ?? "cn_classic_single_column"];
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: preset.titleAfter },
      children: [
        new TextRun({
          text: input.title?.trim() || "简历",
          bold: true,
          font: "Microsoft YaHei",
          size: preset.titleSize,
        }),
      ],
    }),
  ];

  for (const section of input.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: preset.headingBefore, after: preset.headingAfter },
        children: [
          new TextRun({
            text: section.heading.trim(),
            bold: true,
            font: "Microsoft YaHei",
            size: preset.headingSize,
          }),
        ],
      }),
    );
    for (const paragraph of section.paragraphs.filter((value) => value.trim())) {
      children.push(bodyParagraph(paragraph.trim(), preset));
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
            size: preset.bodySize,
          },
          paragraph: {
            spacing: { line: preset.bodyLine },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: preset.margin,
              right: preset.margin,
              bottom: preset.margin,
              left: preset.margin,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}
