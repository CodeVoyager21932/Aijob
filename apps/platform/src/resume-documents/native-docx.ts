import type { NativeResumeDocument } from "@aijob/resume-core";
import { load } from "cheerio";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  ImageRun,
  type INumberingOptions,
  LevelFormat,
  Packer,
  Paragraph,
  type ParagraphChild,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

/** Output adapter only. Never writes or converts the stored native document. */
export async function createNativeDocx(document: NativeResumeDocument): Promise<Buffer> {
  const { data } = document,
    m = data.metadata;
  const bodySize = m.typography.body.fontSize * 2;
  const color =
    m.design.colors.primary
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map((n) => Math.round(Number(n)).toString(16).padStart(2, "0"))
      .join("") ?? "263E49";
  const line = (text: string, bold = false, keepNext = false) =>
    new Paragraph({ children: [new TextRun({ text, bold })], keepNext, spacing: { after: 60 } });
  const numbering: INumberingOptions["config"][number][] = [];
  const rich = (html: string): Paragraph[] => {
    const $ = load(html, null, false);
    const runs = (
      node: unknown,
      marks: {
        bold?: boolean;
        italics?: boolean;
        underline?: Record<string, never>;
        style?: string;
      } = {},
    ): ParagraphChild[] => {
      const n = node as {
        type: string;
        data?: string;
        name?: string;
        attribs?: Record<string, string>;
        children?: unknown[];
      };
      if (n.type === "text") return [new TextRun({ text: n.data ?? "", ...marks })];
      if (n.name === "br") return [new TextRun({ break: 1 })];
      const child = (n.children ?? []).flatMap((c) =>
        runs(c, {
          ...marks,
          ...(["b", "strong"].includes(n.name ?? "") ? { bold: true } : {}),
          ...(["i", "em"].includes(n.name ?? "") ? { italics: true } : {}),
          ...(n.name === "u" ? { underline: {} } : {}),
          ...(n.name === "a" ? { style: "Hyperlink" } : {}),
        }),
      );
      const href = n.attribs?.href;
      return n.name === "a" && href && /^(https?:\/\/|mailto:|tel:)/i.test(href)
        ? [
            new ExternalHyperlink({
              link: href,
              children: child.filter((c): c is TextRun => c instanceof TextRun),
            }),
          ]
        : child;
    };
    const paragraphs: Paragraph[] = [];
    const visit = (node: unknown, depth = 0, listReference?: string) => {
      const n = node as { type: string; name?: string; children?: unknown[] };
      if (n.name === "ul" || n.name === "ol") {
        const reference = n.name === "ol" ? `native-list-${numbering.length}` : undefined;
        if (reference)
          numbering.push({
            reference,
            levels: Array.from({ length: 9 }, (_, level) => ({
              level,
              format: LevelFormat.DECIMAL,
              text: `%${level + 1}.`,
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 300 + level * 240, hanging: 180 } } },
            })),
          });
        for (const child of n.children ?? []) visit(child, depth + 1, reference);
        return;
      }
      if (n.name === "li") {
        const nodes = n.children ?? [];
        const inline = nodes.filter(
          (c) => !["ul", "ol"].includes((c as { name?: string }).name ?? ""),
        );
        paragraphs.push(
          new Paragraph({
            children: inline.flatMap((c) => runs(c)),
            ...(listReference
              ? {
                  numbering: {
                    reference: listReference,
                    level: Math.min(8, Math.max(0, depth - 1)),
                  },
                }
              : { bullet: { level: Math.min(8, Math.max(0, depth - 1)) } }),
            spacing: { after: 40 },
          }),
        );
        for (const child of nodes.filter((c) =>
          ["ul", "ol"].includes((c as { name?: string }).name ?? ""),
        ))
          visit(child, depth);
        return;
      }
      if (n.name === "p" || n.name === "div" || n.type === "text") {
        if (
          $(node as never)
            .text()
            .trim()
        )
          paragraphs.push(new Paragraph({ children: runs(node), spacing: { after: 40 } }));
        return;
      }
      for (const child of n.children ?? []) visit(child, depth);
    };
    for (const node of $.root().contents().toArray()) visit(node);
    return paragraphs;
  };
  const link = (website: { url: string; label: string }) =>
    website.url
      ? [
          new Paragraph({
            children: [
              new ExternalHyperlink({
                link: website.url,
                children: [new TextRun({ text: website.label || website.url, style: "Hyperlink" })],
              }),
            ],
          }),
        ]
      : [];
  const header: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: data.basics.name, bold: true, size: 32 })],
      alignment:
        document.presentation?.id === "lapis-cn" ? AlignmentType.CENTER : AlignmentType.LEFT,
      keepNext: true,
    }),
    ...[
      data.basics.headline,
      [data.basics.phone, data.basics.email, data.basics.location].filter(Boolean).join(" · "),
    ]
      .filter(Boolean)
      .map((text) => line(text)),
    ...link(data.basics.website),
    ...data.basics.customFields.flatMap((field) =>
      field.link ? link({ url: field.link, label: field.text }) : [line(field.text)],
    ),
  ];
  if (!data.picture.hidden && data.picture.url) {
    const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(data.picture.url);
    if (!match?.[2]) throw new Error("NATIVE_PHOTO_MUST_BE_RESOLVED_BY_OWNER_SERVICE");
    header.unshift(
      new Paragraph({
        children: [
          new ImageRun({
            type: match[1] === "jpeg" ? "jpg" : "png",
            data: Buffer.from(match[2], "base64"),
            transformation: {
              width: (data.picture.size * 4) / 3,
              height: ((data.picture.size / data.picture.aspectRatio) * 4) / 3,
            },
          }),
        ],
      }),
    );
  }
  const titles = new Set([
    "school",
    "company",
    "name",
    "title",
    "organization",
    "network",
    "language",
  ]);
  const fieldOrder = [
    "school",
    "company",
    "name",
    "title",
    "organization",
    "network",
    "language",
    "role",
    "unit",
    "method",
    "authors",
    "authorPosition",
    "status",
    "position",
    "degree",
    "area",
    "grade",
    "period",
    "date",
    "location",
    "publisher",
    "issuer",
    "awarder",
    "proficiency",
    "fluency",
    "username",
    "phone",
    "keywords",
  ];
  const item = (raw: unknown): Paragraph[] => {
    const value = raw as Record<string, unknown>;
    if (value.hidden) return [];
    const output: Paragraph[] = [];
    const fields = fieldOrder.flatMap((key) => {
      const v = value[key];
      const text = typeof v === "string" ? v : Array.isArray(v) ? v.join("、") : "";
      return text ? [{ key, text }] : [];
    });
    const heading = fields.filter((f) => titles.has(f.key));
    if (heading.length) output.push(line(heading.map((f) => f.text).join(" · "), true, true));
    const detail = fields.filter((f) => !titles.has(f.key));
    if (detail.length) output.push(line(detail.map((f) => f.text).join(" · ")));
    for (const key of ["description", "content"])
      if (typeof value[key] === "string") output.push(...rich(value[key]));
    if (Array.isArray(value.roles)) for (const role of value.roles) output.push(...item(role));
    if (value.website) output.push(...link(value.website as { url: string; label: string }));
    return output;
  };
  const section = (id: string, keepHeadingWithNext = true): Paragraph[] => {
    const s =
      id === "summary"
        ? data.summary
        : id in data.sections
          ? data.sections[id as keyof typeof data.sections]
          : data.customSections.find((s) => s.id === id);
    if (!s || s.hidden) return [];
    const content = "content" in s ? rich(s.content) : s.items.flatMap(item);
    if (!content.length) return [];
    return [
      ...(s.showHeading === false
        ? []
        : [
            new Paragraph({
              text: s.title,
              heading: "Heading2",
              keepNext: keepHeadingWithNext,
              border: { bottom: { style: BorderStyle.SINGLE, color, size: 4 } },
              spacing: { before: 160, after: 80 },
            }),
          ]),
      ...content,
    ];
  };
  const width = Math.round((595.28 - 2 * m.page.marginX) * 20);
  const children: (Paragraph | Table)[] = [...header];
  for (const [index, page] of m.layout.pages.entries()) {
    if (index) children.push(new Paragraph({ pageBreakBefore: true }));
    // Writer treats keepNext on the first cell paragraph as keeping the entire
    // table row together. Release only that first heading, retaining subsequent
    // heading/entry groups and allowing the two columns to continue across pages.
    const column = (ids: string[]) => {
      let hasContent = false;
      return ids.flatMap((id) => {
        const paragraphs = section(id, page.fullWidth || hasContent);
        if (paragraphs.length) hasContent = true;
        return paragraphs;
      });
    };
    const main = column(page.main),
      side = column(page.sidebar);
    if (page.fullWidth || !side.length) children.push(...main, ...side);
    else {
      const sideWidth = Math.round((width * m.layout.sidebarWidth) / 100),
        mainWidth = width - sideWidth;
      const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
      children.push(
        new Table({
          width: { size: width, type: WidthType.DXA },
          columnWidths: [sideWidth, mainWidth],
          layout: TableLayoutType.FIXED,
          borders: {
            top: none,
            bottom: none,
            left: none,
            right: none,
            insideHorizontal: none,
            insideVertical: none,
          },
          rows: [
            new TableRow({
              cantSplit: false,
              children: [
                new TableCell({
                  width: { size: sideWidth, type: WidthType.DXA },
                  margins: { right: 180 },
                  children: side,
                }),
                new TableCell({
                  width: { size: mainWidth, type: WidthType.DXA },
                  children: main.length ? main : [new Paragraph("")],
                }),
              ],
            }),
          ],
        }),
      );
    }
  }
  return Packer.toBuffer(
    new Document({
      numbering: { config: numbering },
      styles: {
        default: {
          document: {
            run: { font: m.typography.body.fontFamily, size: bodySize },
            paragraph: { spacing: { line: Math.round(m.typography.body.lineHeight * 240) } },
          },
          heading2: {
            run: {
              font: m.typography.heading.fontFamily,
              bold: true,
              size: m.typography.heading.fontSize * 2,
              color,
            },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: {
                top: Math.round(m.page.marginY * 20),
                bottom: Math.round(m.page.marginY * 20),
                left: Math.round(m.page.marginX * 20),
                right: Math.round(m.page.marginX * 20),
              },
            },
          },
          children,
        },
      ],
    }),
  );
}
