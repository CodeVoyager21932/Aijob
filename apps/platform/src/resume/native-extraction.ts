import { type NativeImportBlock, nativePdfBlocks, nativeTextBlocks } from "@aijob/resume-core";
import { load } from "cheerio";
import { z } from "zod";
import { extractResumeStructure, type ResumeParserSandboxOptions } from "./parse.js";

const docxStructure = z
  .object({
    schemaVersion: z.literal("native-docx-extraction-v1"),
    html: z.string().max(800000),
    warnings: z.array(z.object({ type: z.string(), message: z.string() })).max(1000),
  })
  .strict();
export function nativeDocxBlocks(input: unknown): {
  blocks: NativeImportBlock[];
  warnings: string[];
} {
  const parsed = docxStructure.parse(input),
    $ = load(parsed.html),
    blocks: NativeImportBlock[] = [];
  const counters = new Map<string, number>();
  const sourceIds = new Map<unknown, string>();
  for (const node of $("p,h1,h2,h3,h4,h5,h6,li").toArray()) {
    const element = $(node);
    if (element.parents("li").length && node.tagName !== "li") continue;
    const cell = element.closest("td,th"),
      row = cell.parent(),
      table = cell.closest("table");
    const path = cell.length
      ? `table:${$("table").index(table)}/row:${table.find("tr").index(row)}/cell:${row.children("td,th").index(cell)}`
      : "body";
    const index = counters.get(path) ?? 0;
    counters.set(path, index + 1);
    const copy = element.clone();
    copy.find("ul,ol").remove();
    copy.find("br").replaceWith("\n");
    const text = copy.text().trim();
    if (!text) continue;
    const location = `${path}/paragraph:${index}`;
    sourceIds.set(node, `docx:${location}`);
    const emphasis = copy.find("strong,b").text().trim().length >= text.length * 0.5;
    blocks.push({
      id: `docx:${location}`,
      text,
      emphasis,
      kind:
        node.tagName === "li"
          ? "list-item"
          : /^h[1-6]$/.test(node.tagName)
            ? "heading"
            : cell.length
              ? "table-cell"
              : "paragraph",
      source: { kind: "docx", path: location },
    });
  }
  // Hyperlinks remain an explicit readable part, including a labeled link's target.
  for (const [index, node] of $("a[href]").toArray().entries()) {
    const href = $(node).attr("href") ?? "";
    if (/^(https?:|mailto:|tel:)/i.test(href) && !$(node).text().includes(href))
      blocks.push({
        id: `docx:link:${index}`,
        text: `${$(node).text()}: ${href}`,
        kind: "paragraph",
        link: {
          url: href,
          label: $(node).text(),
          ...(sourceIds.get($(node).closest("p,li,h1,h2,h3,h4,h5,h6")[0])
            ? {
                relatedBlockId: sourceIds.get(
                  $(node).closest("p,li,h1,h2,h3,h4,h5,h6")[0],
                ) as string,
              }
            : {}),
        },
        source: { kind: "docx", path: `link:${index}` },
      });
  }
  return { blocks, warnings: parsed.warnings.map((value) => `${value.type}: ${value.message}`) };
}
export async function extractNativeResumeBlocks(input: {
  kind: "pdf" | "docx" | "text";
  buffer: Buffer;
  sandbox?: ResumeParserSandboxOptions;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  if (input.kind === "text")
    return { blocks: nativeTextBlocks(input.buffer.toString("utf8")), warnings: [] };
  const structure = await extractResumeStructure({ ...input, kind: input.kind, timeoutMs: input.timeoutMs ?? 20_000 });
  return input.kind === "pdf" ? nativePdfBlocks(structure) : nativeDocxBlocks(structure);
}
