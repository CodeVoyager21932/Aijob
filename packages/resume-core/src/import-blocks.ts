import { buildExtractedDocument } from "@reactive-resume/resume/ats-pdf/extract";
import type { RawExtraction, TextSpan } from "@reactive-resume/resume/ats-pdf/types";
import { z } from "zod";
import { isNativeImportSectionHeading } from "./import-headings.js";

export interface NativeImportBlock {
  id: string;
  text: string;
  kind: "line" | "paragraph" | "list-item" | "table-cell" | "heading";
  emphasis?: boolean;
  link?: { url: string; label: string; relatedBlockId?: string };
  source:
    | {
        kind: "pdf";
        page: number;
        column: number;
        x: number;
        y: number;
        width: number;
        height: number;
        fontSize: number;
      }
    | { kind: "docx"; path: string }
    | { kind: "text"; line: number };
}
const finite = z.number().finite();
const item = z.object({
  str: z.string().max(200000),
  transform: z.tuple([finite, finite, finite, finite, finite, finite]),
  width: finite,
  height: finite,
  fontRef: z.string(),
  hasEol: z.boolean(),
  bold: z.boolean().optional(),
});
const pdfInput = z.object({
  schemaVersion: z.literal("native-pdf-extraction-v1"),
  pages: z
    .array(
      z.object({
        pageNumber: z.number().int().positive(),
        width: finite.positive(),
        height: finite.positive(),
        rotation: finite,
        items: z.array(item).max(100000),
        operators: z.null(),
      }),
    )
    .max(30),
  links: z
    .array(
      z.object({
        page: z.number().int().positive(),
        url: z.string().nullable(),
        rect: z.tuple([finite, finite, finite, finite]),
      }),
    )
    .max(10000),
});

/** v5.3.0 pdf-text.ts field gaps and column rules, retaining geometry instead of flattening it away. */
function joinSpans(spans: readonly TextSpan[]) {
  let text = "",
    previous: TextSpan | undefined;
  for (const span of spans) {
    if (previous) {
      const gap = span.x - previous.x - previous.width,
        size = Math.max(previous.fontSize, span.fontSize, 1);
      if (gap > 1.5 * size) text += "  ";
      else if (gap > 0.25 * size && !/\s$/.test(text) && !/^\s/.test(span.text)) text += " ";
    }
    text += span.text;
    previous = span;
  }
  return text.trim();
}
export function nativePdfBlocks(input: unknown): {
  blocks: NativeImportBlock[];
  warnings: string[];
} {
  const parsed = pdfInput.parse(input);
  const raw: RawExtraction = {
    version: 1,
    file: { name: "", sizeBytes: 0, magicBytesOk: true },
    pageCount: parsed.pages.length,
    truncated: false,
    pages: parsed.pages,
    fonts: [],
    links: parsed.links,
    operatorsAvailable: false,
    metadata: {
      producer: null,
      creator: null,
      title: null,
      author: null,
      language: null,
      pdfVersion: null,
      isEncrypted: false,
      isXfa: false,
      isCollection: false,
      isTagged: false,
      hasAcroForm: false,
    },
  };
  const document = buildExtractedDocument(raw),
    blocks: NativeImportBlock[] = [];
  for (const page of document.pages) {
    const gutter = page.gutter;
    // Narrow sidebars have fewer text runs than the main column. ATS risk scores are not
    // a reading-order contract: require an actual empty band, not balanced text volume.
    let candidate =
      gutter && gutter.coverage >= 0.98 && gutter.width >= 18 && gutter.splitRatio >= 0.1
        ? gutter.x + gutter.width / 2
        : null;
    const sectionHeading = isNativeImportSectionHeading;
    // A full-width contact header crosses the gutter even when the body has two columns.
    // Detect a body boundary only from two complete section headings on the same line,
    // then require every body span to stay on its own side of an actual blank gap.
    let bodyStart = 0;
    for (const [lineIndex, line] of page.lines.entries()) {
      for (let i = 1; i < line.spans.length; i++) {
        const left = line.spans.slice(0, i),
          right = line.spans.slice(i);
        const edge = left[left.length - 1],
          first = right[0];
        if (!edge || !first || first.x - edge.x - edge.width < 18) continue;
        if (
          !sectionHeading(joinSpans(left).replace(/\s/g, "")) ||
          !sectionHeading(joinSpans(right).replace(/\s/g, ""))
        )
          continue;
        const boundary = first.x - 9;
        // Aligned headings later down an already split document are not the end
        // of a full-width header. Otherwise a name/contact card and the earlier
        // work section above this row would be merged into one supposed header.
        const earlierSection = page.lines
          .slice(0, lineIndex)
          .some((row) =>
            [0, 1].some((column) =>
              sectionHeading(
                joinSpans(
                  row.spans.filter(
                    (span) => (span.x + span.width / 2 < boundary ? 0 : 1) === column,
                  ),
                ).replace(/[\s／/]/g, ""),
              ),
            ),
          );
        if (earlierSection) continue;
        const crosses = page.lines
          .slice(lineIndex)
          .some((row) =>
            row.spans.some((span) => span.x < boundary && span.x + span.width > boundary),
          );
        if (!crosses) {
          candidate = boundary;
          bodyStart = lineIndex;
          break;
        }
      }
      if (bodyStart > 0) break;
    }
    // Some resumes place only a personal name/contact card in the narrow column.
    // Require an actual page-wide empty gutter plus section headings on the other
    // side; a right-aligned date does not satisfy this independent-column evidence.
    const textsOnSide = (boundary: number, column: number) =>
      page.lines.map((line) =>
        joinSpans(
          line.spans.filter((span) => (span.x + span.width / 2 < boundary ? 0 : 1) === column),
        ),
      );
    const contactColumn = (boundary: number, column: number) => {
      const texts = textsOnSide(boundary, column).filter(Boolean);
      return (
        texts.length >= 2 &&
        !texts.some((text) => /(?:19|20)\d{2}\s*[.年/-]|GPA\s*\d|[。；]/i.test(text)) &&
        texts.some((text) => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text))
      );
    };
    // A statistically wide gutter may lie between a main title and its date.
    // Validate geometry-based alternatives as well when no full-width header
    // boundary was established; independent section content wins over that score.
    if (bodyStart === 0) {
      const wideBoundaries = page.lines.flatMap((line) =>
        line.spans.flatMap((span, i) => {
          const prior = line.spans[i - 1];
          return prior && span.x - prior.x - prior.width >= 18 ? [span.x - 9] : [];
        }),
      );
      // A genuine sidebar can have a much narrower gutter. Only consider those
      // gaps when one side is a contact card and the other has multiple complete
      // section headings; a right-aligned date alone cannot establish a column.
      const spans = page.lines.flatMap((line) => line.spans.filter((span) => span.text.trim()));
      const edges = [...new Set(spans.flatMap((span) => [span.x, span.x + span.width]))].sort((a, b) => a - b);
      const narrowBoundaries = edges.flatMap((edge, index) => {
        const next = edges[index + 1];
        if (!next || next - edge < 2 || edge < page.width * 0.1 || next > page.width * 0.6)
          return [];
        const boundary = (edge + next) / 2;
        return spans.some((span) => span.x < boundary && span.x + span.width > boundary)
          ? []
          : [boundary];
      });
      for (const boundary of [...wideBoundaries, ...narrowBoundaries]) {
        const crosses = page.lines.some((line) =>
          line.spans.some((span) => span.x < boundary && span.x + span.width > boundary),
        );
        if (crosses) continue;
        const headings = [0, 1].map(
          (column) =>
            textsOnSide(boundary, column).filter((text) =>
              sectionHeading(text.replace(/[\s／/]/g, "")),
            ).length,
        );
        const hasContactAndHeadings =
          (contactColumn(boundary, 0) && (headings[1] ?? 0) >= 2) ||
          (contactColumn(boundary, 1) && (headings[0] ?? 0) >= 2);
        if (
          ((headings[0] ?? 0) >= 1 && (headings[1] ?? 0) >= 1) ||
          hasContactAndHeadings
        ) {
          candidate = boundary;
          break;
        }
      }
    }
    const headingInColumn = (column: number) =>
      candidate !== null &&
      page.lines.some((line) =>
        sectionHeading(
          joinSpans(
            line.spans.filter((span) => (span.x + span.width / 2 < candidate ? 0 : 1) === column),
          ).replace(/\s/g, ""),
        ),
      );
    const hasColumnContent = (column: number) =>
      candidate !== null &&
      textsOnSide(candidate, column).some(
        (text) => text.trim() && !sectionHeading(text.replace(/[\s／/]/g, "")),
      );
    // A right-aligned date field is not a second reading column. Require independent
    // section headings on both sides; unresolved layouts remain in source order.
    const split =
      candidate !== null &&
      hasColumnContent(0) &&
      hasColumnContent(1) &&
      (headingInColumn(0) || contactColumn(candidate, 0)) &&
      (headingInColumn(1) || contactColumn(candidate, 1))
        ? candidate
        : null;
    for (let column = 0; column < (split === null ? 1 : 2); column++)
      for (const [lineIndex, line] of page.lines.entries()) {
        if (split !== null && lineIndex < bodyStart && column !== 0) continue;
        const selectedSpans =
          split === null || lineIndex < bodyStart
            ? line.spans
            : line.spans.filter((span) => (span.x + span.width / 2 < split ? 0 : 1) === column);
        if (!selectedSpans.length) continue;
        // Index layouts put a section title and its first entry on one baseline.
        // Keep the title as a separate block instead of merging it into the school.
        const titleEnd = selectedSpans.findIndex((span, i) => {
          const next = selectedSpans[i + 1];
          return (
            next &&
            next.x - span.x - span.width > 1.5 * Math.max(span.fontSize, next.fontSize) &&
            sectionHeading(joinSpans(selectedSpans.slice(0, i + 1)).replace(/[\s／/]/g, ""))
          );
        });
        const groups =
          titleEnd >= 0
            ? [selectedSpans.slice(0, titleEnd + 1), selectedSpans.slice(titleEnd + 1)]
            : [selectedSpans];
        for (const [groupIndex, spans] of groups.entries()) {
          const x = Math.min(...spans.map((span) => span.x)),
            right = Math.max(...spans.map((span) => span.x + span.width));
          const y = Math.min(...spans.map((span) => span.y)),
            bottom = Math.max(...spans.map((span) => span.y + span.height));
          const sourcePage = parsed.pages.find((value) => value.pageNumber === page.pageNumber);
          if (!sourcePage) throw new Error("NATIVE_IMPORT_PAGE_MISSING");
          const emphasized = spans
            .filter((span) => sourcePage.items[span.streamIndex]?.bold)
            .reduce((n, span) => n + span.text.length, 0);
          blocks.push({
            id: `pdf:${page.pageNumber}:${column}:${lineIndex}${groups.length > 1 ? `:${groupIndex}` : ""}`,
            text: joinSpans(spans),
            kind: "line",
            emphasis: emphasized >= spans.reduce((n, span) => n + span.text.length, 0) * 0.5,
            source: {
              kind: "pdf",
              page: page.pageNumber,
              column,
              x,
              y,
              width: right - x,
              height: bottom - y,
              fontSize: spans[0]?.fontSize ?? line.fontSize,
            },
          });
        }
      }
  }
  for (const [index, link] of parsed.links.entries()) {
    if (!link.url || !/^(https?:\/\/|mailto:|tel:)/i.test(link.url)) continue;
    const page = parsed.pages.find((value) => value.pageNumber === link.page);
    if (!page) continue;
    const [x1, y1, x2, y2] = link.rect,
      x = Math.min(x1, x2),
      y = page.height - Math.max(y1, y2),
      width = Math.abs(x2 - x1),
      height = Math.abs(y2 - y1);
    const related = blocks.find(
      (block) =>
        block.source.kind === "pdf" &&
        block.source.page === link.page &&
        block.source.x < x + width + 2 &&
        block.source.x + block.source.width > x - 2 &&
        block.source.y < y + height + 2 &&
        block.source.y + block.source.height > y - 2,
    );
    const linkSpans =
      document.pages
        .find((value) => value.pageNumber === link.page)
        ?.lines.flatMap((line) => line.spans)
        .filter(
          (span) =>
            span.x + span.width / 2 >= x - 1 &&
            span.x + span.width / 2 <= x + width + 1 &&
            span.y < y + height + 2 &&
            span.y + span.height > y - 2,
        ) ?? [];
    blocks.push({
      id: `pdf-link:${link.page}:${index}`,
      text: link.url,
      kind: "line",
      link: {
        url: link.url,
        label: joinSpans(linkSpans) || related?.text || link.url,
        ...(related ? { relatedBlockId: related.id } : {}),
      },
      source: {
        kind: "pdf",
        page: link.page,
        column: related?.source.kind === "pdf" ? related.source.column : 0,
        x,
        y,
        width,
        height,
        fontSize: 0,
      },
    });
  }
  return {
    blocks,
    warnings: parsed.pages
      .filter((page) => page.rotation !== 0)
      .map((page) => `rotated-page:${page.pageNumber}`),
  };
}
export function nativeTextBlocks(text: string): NativeImportBlock[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((text, index) =>
      text.trim()
        ? [
            {
              id: `text:${index + 1}`,
              text: text.trim(),
              kind: "paragraph" as const,
              source: { kind: "text" as const, line: index + 1 },
            },
          ]
        : [],
    );
}
